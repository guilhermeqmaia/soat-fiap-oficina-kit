import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import {
  DeleteMessageCommand,
  Message,
  ReceiveMessageCommand,
  SQSClient,
} from '@aws-sdk/client-sqs';
import { MessageEnvelope, validarEnvelope } from './envelope';
import {
  MESSAGE_HANDLERS,
  MessageHandler,
  PROCESSED_MESSAGE_STORE,
  ProcessedMessageStore,
} from './ports';
import { runWithCorrelation } from '../logging/correlation-context';
import { extractTraceIdFromTraceparent } from '../logging/resolve-correlation-id';

export interface SqsConsumerOptions {
  readonly queueUrl: string;
  /** Long polling (s). Default 20. */
  readonly waitTimeSeconds?: number;
  /** Mensagens por recebimento (1–10). Default 10. */
  readonly batchSize?: number;
  /** Processa as mensagens de um lote em paralelo? Default false (ordem FIFO). */
  readonly paralelo?: boolean;
  /** Nao inicia o loop no bootstrap (testes / workers desligados). */
  readonly autoStart?: boolean;
}
export const SQS_CONSUMER_OPTIONS = Symbol('SQS_CONSUMER_OPTIONS');
export const SQS_CLIENT = Symbol('SQS_CLIENT');

/** Formato do corpo quando a assinatura SNS->SQS esta sem raw delivery. */
interface SnsNotification {
  Type?: string;
  Message?: string;
}

/**
 * Consumidor SQS com long polling e **idempotencia** (ADR-0009):
 * 1. parseia o envelope (aceita entrega crua ou embrulhada pelo SNS);
 * 2. duplicata (`ProcessedMessageStore`) -> apaga da fila sem reprocessar;
 * 3. chama o handler do `type` dentro do contexto de correlacao da mensagem;
 * 4. sucesso -> `marcar` + delete; erro -> NAO apaga (visibility timeout ->
 *    retry -> DLQ apos `maxReceiveCount`, RFC-0006). Envelope invalido ->
 *    tambem fica para a DLQ, com log de erro.
 */
@Injectable()
export class SqsConsumer implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(SqsConsumer.name);
  private readonly handlers = new Map<string, MessageHandler>();
  private rodando = false;
  private loop?: Promise<void>;

  constructor(
    @Inject(SQS_CONSUMER_OPTIONS) private readonly options: SqsConsumerOptions,
    @Inject(PROCESSED_MESSAGE_STORE) private readonly processed: ProcessedMessageStore,
    @Optional() @Inject(MESSAGE_HANDLERS) handlers: MessageHandler[] = [],
    @Optional() @Inject(SQS_CLIENT) private readonly client: SQSClient = new SQSClient({}),
  ) {
    for (const h of handlers) this.registrar(h);
  }

  registrar(handler: MessageHandler): void {
    if (this.handlers.has(handler.type)) throw new Error(`Handler duplicado para ${handler.type}`);
    this.handlers.set(handler.type, handler);
  }

  onApplicationBootstrap(): void {
    if (this.options.autoStart === false) return;
    this.iniciar();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.parar();
  }

  iniciar(): void {
    if (this.rodando) return;
    this.rodando = true;
    this.loop = this.executar();
  }

  async parar(): Promise<void> {
    this.rodando = false;
    await this.loop;
  }

  /** Um ciclo de recebimento — exposto para testes e para workers one-shot. */
  async receberUmaVez(): Promise<number> {
    const res = await this.client.send(
      new ReceiveMessageCommand({
        QueueUrl: this.options.queueUrl,
        MaxNumberOfMessages: this.options.batchSize ?? 10,
        WaitTimeSeconds: this.options.waitTimeSeconds ?? 20,
        MessageAttributeNames: ['All'],
        MessageSystemAttributeNames: ['ApproximateReceiveCount'],
      }),
    );
    const mensagens = res.Messages ?? [];
    if (this.options.paralelo) await Promise.all(mensagens.map((m) => this.processar(m)));
    else for (const m of mensagens) await this.processar(m);
    return mensagens.length;
  }

  private async executar(): Promise<void> {
    while (this.rodando) {
      try {
        await this.receberUmaVez();
        // Cede o event loop entre ciclos: o long polling real ja espera ate
        // 20 s, mas com fila vazia/mocks o retorno e imediato e, sem isto, o
        // loop monopolizaria a thread (e `parar()` nunca seria atendido).
        await new Promise((r) => setImmediate(r));
      } catch (err) {
        this.logger.error({
          msg: 'falha ao receber da fila',
          erro: (err as Error).message,
          queueUrl: this.options.queueUrl,
        });
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  private async processar(message: Message): Promise<void> {
    let envelope: MessageEnvelope;
    try {
      envelope = SqsConsumer.parsear(message.Body ?? '');
    } catch (err) {
      // Mensagem mal formada: nao ha o que reprocessar — deixa ir para a DLQ (triagem humana).
      this.logger.error({
        msg: 'envelope invalido — mensagem ira para a DLQ',
        erro: (err as Error).message,
        messageId: message.MessageId,
      });
      return;
    }

    const traceId =
      (envelope.traceparent && extractTraceIdFromTraceparent(envelope.traceparent)) ||
      envelope.correlationId;
    await runWithCorrelation({ correlationId: envelope.correlationId, traceId }, async () => {
      if (await this.processed.jaProcessada(envelope.id)) {
        this.logger.log({
          msg: 'mensagem duplicada ignorada',
          type: envelope.type,
          id: envelope.id,
          duplicate: true,
        });
        await this.apagar(message);
        return;
      }
      const handler = this.handlers.get(envelope.type);
      if (!handler) {
        // Assinatura filtra por type; chegar aqui e erro de configuracao — DLQ.
        this.logger.error({
          msg: 'sem handler para o type — mensagem ira para a DLQ',
          type: envelope.type,
          id: envelope.id,
        });
        return;
      }
      try {
        await handler.handle(envelope);
        await this.processed.marcar(envelope.id, envelope.type);
        await this.apagar(message);
        this.logger.debug({ msg: 'mensagem processada', type: envelope.type, id: envelope.id });
      } catch (err) {
        const tentativa = message.Attributes?.ApproximateReceiveCount ?? '?';
        this.logger.warn({
          msg: 'falha ao processar — sera reentregue',
          type: envelope.type,
          id: envelope.id,
          tentativa,
          erro: (err as Error).message,
        });
      }
    });
  }

  private async apagar(message: Message): Promise<void> {
    await this.client.send(
      new DeleteMessageCommand({
        QueueUrl: this.options.queueUrl,
        ReceiptHandle: message.ReceiptHandle,
      }),
    );
  }

  /** Aceita o envelope cru ou embrulhado na notificacao do SNS (`Message`). */
  static parsear(body: string): MessageEnvelope {
    let parsed: unknown = JSON.parse(body);
    const sns = parsed as SnsNotification;
    if (
      sns &&
      typeof sns === 'object' &&
      sns.Type === 'Notification' &&
      typeof sns.Message === 'string'
    ) {
      parsed = JSON.parse(sns.Message);
    }
    validarEnvelope(parsed);
    return parsed;
  }
}
