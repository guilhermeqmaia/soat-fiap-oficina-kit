import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import { MessagePublisher } from '../ports';
import { OUTBOX_REPOSITORY, OutboxRepository } from './outbox.ports';

export interface OutboxPollerOptions {
  /** Intervalo entre varreduras (ms). Default 500. */
  readonly intervaloMs?: number;
  /** Mensagens por varredura. Default 50. */
  readonly lote?: number;
  /** Tentativas antes de marcar FALHA definitiva (alarme/runbook). Default 10. */
  readonly maxTentativas?: number;
  readonly autoStart?: boolean;
}
export const OUTBOX_POLLER_OPTIONS = Symbol('OUTBOX_POLLER_OPTIONS');
/** Publisher REAL (SNS) usado pelo poller — distinto do `MESSAGE_PUBLISHER` (outbox) dos casos de uso. */
export const BROKER_PUBLISHER = Symbol('BROKER_PUBLISHER');

/**
 * Entrega ao broker o que foi gravado no outbox (ADR-0009). At-least-once:
 * se o processo cair entre o publish e o `marcarEnviada`, a mensagem sai de
 * novo — o consumidor deduplica pelo `id`.
 */
@Injectable()
export class OutboxPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutboxPoller.name);
  private timer?: NodeJS.Timeout;
  private emExecucao = false;

  constructor(
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository,
    @Inject(BROKER_PUBLISHER) private readonly broker: MessagePublisher,
    @Optional() @Inject(OUTBOX_POLLER_OPTIONS) private readonly options: OutboxPollerOptions = {},
  ) {}

  onApplicationBootstrap(): void {
    if (this.options.autoStart === false) return;
    this.iniciar();
  }

  onApplicationShutdown(): void {
    this.parar();
  }

  iniciar(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.varrer(), this.options.intervaloMs ?? 500);
    this.timer.unref?.();
  }

  parar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** Uma varredura — exposta para testes e para flush explicito. Devolve quantas enviou. */
  async varrer(): Promise<number> {
    if (this.emExecucao) return 0; // varreduras nao se sobrepoem
    this.emExecucao = true;
    let enviadas = 0;
    try {
      const pendentes = await this.outbox.pendentes(this.options.lote ?? 50);
      for (const registro of pendentes) {
        try {
          await this.broker.publish(registro.envelope);
          await this.outbox.marcarEnviada(registro.id);
          enviadas++;
        } catch (err) {
          const erro = (err as Error).message;
          await this.outbox.marcarFalha(registro.id, erro);
          const esgotou = registro.tentativas + 1 >= (this.options.maxTentativas ?? 10);
          this.logger[esgotou ? 'error' : 'warn']({
            msg: esgotou
              ? 'outbox: tentativas esgotadas — intervencao manual'
              : 'outbox: falha ao publicar, tentara de novo',
            id: registro.id,
            type: registro.type,
            correlationId: registro.correlationId,
            tentativas: registro.tentativas + 1,
            erro,
          });
        }
      }
    } finally {
      this.emExecucao = false;
    }
    return enviadas;
  }
}
