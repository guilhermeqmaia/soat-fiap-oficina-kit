import { DeleteMessageCommand, ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { SqsConsumer } from './sqs-consumer';
import { MessageEnvelope, criarEnvelope } from './envelope';
import { MessageHandler } from './ports';
import { InMemoryProcessedMessageStore } from '../testing/messaging-fakes';
import { getCorrelationContext } from '../logging/correlation-context';

const sqs = mockClient(SQSClient);
const QUEUE = 'http://localhost:4566/000000000000/os-eventos.fifo';
const env = (type = 'execucao.enfileirada', correlationId = 'OS-1') =>
  criarEnvelope({ type, producer: 'execucao-service', correlationId, data: { ok: true } });
const msg = (e: MessageEnvelope, viaSns = false, receiveCount = '1') => ({
  MessageId: `sqs-${e.id}`,
  ReceiptHandle: `rh-${e.id}`,
  Body: viaSns
    ? JSON.stringify({ Type: 'Notification', Message: JSON.stringify(e) })
    : JSON.stringify(e),
  Attributes: { ApproximateReceiveCount: receiveCount },
});

function consumer(
  handlers: MessageHandler[],
  store = new InMemoryProcessedMessageStore(),
  opts: Partial<ConstructorParameters<typeof SqsConsumer>[0]> = {},
) {
  return {
    consumer: new SqsConsumer(
      { queueUrl: QUEUE, autoStart: false, ...opts },
      store,
      handlers,
      new SQSClient({}),
    ),
    store,
  };
}

beforeEach(() => sqs.reset());

describe('SqsConsumer', () => {
  it('processa, marca como processada e apaga da fila', async () => {
    const e = env();
    const handle = jest.fn(async () => undefined);
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e)] });
    sqs.on(DeleteMessageCommand).resolves({});
    const { consumer: c, store } = consumer([{ type: e.type, handle }]);

    expect(await c.receberUmaVez()).toBe(1);
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: e.id }));
    expect(await store.jaProcessada(e.id)).toBe(true);
    expect(sqs.commandCalls(DeleteMessageCommand)[0].args[0].input).toEqual({
      QueueUrl: QUEUE,
      ReceiptHandle: `rh-${e.id}`,
    });
    const recv = sqs.commandCalls(ReceiveMessageCommand)[0].args[0].input;
    expect(recv).toMatchObject({ QueueUrl: QUEUE, MaxNumberOfMessages: 10, WaitTimeSeconds: 20 });
  });

  it('desembrulha a notificacao do SNS (assinatura sem raw delivery)', async () => {
    const e = env();
    const handle = jest.fn(async () => undefined);
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e, true)] });
    sqs.on(DeleteMessageCommand).resolves({});
    await consumer([{ type: e.type, handle }]).consumer.receberUmaVez();
    expect(handle).toHaveBeenCalledWith(expect.objectContaining({ id: e.id, type: e.type }));
  });

  it('duplicata: nao chama o handler e apaga da fila (idempotencia, ADR-0009)', async () => {
    const e = env();
    const handle = jest.fn(async () => undefined);
    const store = new InMemoryProcessedMessageStore();
    await store.marcar(e.id, e.type);
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e)] });
    sqs.on(DeleteMessageCommand).resolves({});
    await consumer([{ type: e.type, handle }], store).consumer.receberUmaVez();
    expect(handle).not.toHaveBeenCalled();
    expect(sqs.commandCalls(DeleteMessageCommand)).toHaveLength(1);
  });

  it('erro no handler: NAO apaga nem marca (vai ser reentregue ate a DLQ)', async () => {
    const e = env();
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e, false, '3')] });
    const { consumer: c, store } = consumer([
      {
        type: e.type,
        handle: async () => {
          throw new Error('banco fora');
        },
      },
    ]);
    await c.receberUmaVez();
    expect(sqs.commandCalls(DeleteMessageCommand)).toHaveLength(0);
    expect(await store.jaProcessada(e.id)).toBe(false);
  });

  it('envelope invalido ou sem handler: nao apaga (DLQ) e nao explode o loop', async () => {
    const e = env('outro.tipo');
    sqs
      .on(ReceiveMessageCommand)
      .resolves({ Messages: [{ MessageId: 'x', ReceiptHandle: 'r', Body: '{nao-json' }, msg(e)] });
    const { consumer: c } = consumer([{ type: 'execucao.enfileirada', handle: jest.fn() }]);
    await expect(c.receberUmaVez()).resolves.toBe(2);
    expect(sqs.commandCalls(DeleteMessageCommand)).toHaveLength(0);
  });

  it('executa o handler dentro do contexto de correlacao da mensagem (correlationId + traceId do traceparent)', async () => {
    const e = {
      ...env('a.b', 'OS-42'),
      traceparent: '00-0000000000000000000000000000beef-0000000000000001-01',
    };
    let visto: ReturnType<typeof getCorrelationContext>;
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e)] });
    sqs.on(DeleteMessageCommand).resolves({});
    await consumer([
      {
        type: 'a.b',
        handle: async () => {
          visto = getCorrelationContext();
        },
      },
    ]).consumer.receberUmaVez();
    expect(visto).toEqual({ correlationId: 'OS-42', traceId: '0000000000000000000000000000beef' });
  });

  it('respeita a ordem FIFO por padrao e paraleliza quando configurado', async () => {
    const ordem: string[] = [];
    const e1 = env('a.b', 'OS-1');
    const e2 = env('a.b', 'OS-2');
    sqs.on(ReceiveMessageCommand).resolves({ Messages: [msg(e1), msg(e2)] });
    sqs.on(DeleteMessageCommand).resolves({});
    const handler: MessageHandler = {
      type: 'a.b',
      handle: async (x) => {
        ordem.push(`in:${x.correlationId}`);
        await new Promise((r) => setTimeout(r, 5));
        ordem.push(`out:${x.correlationId}`);
      },
    };
    await consumer([handler]).consumer.receberUmaVez();
    expect(ordem).toEqual(['in:OS-1', 'out:OS-1', 'in:OS-2', 'out:OS-2']);
    ordem.length = 0;
    await consumer([handler], undefined, { paralelo: true }).consumer.receberUmaVez();
    expect(ordem.slice(0, 2)).toEqual(['in:OS-1', 'in:OS-2']);
  });

  it('rejeita handler duplicado para o mesmo type', () => {
    const h = { type: 'a.b', handle: jest.fn() };
    expect(() => consumer([h, h])).toThrow(/duplicado/);
  });

  it('loop: inicia no bootstrap, tolera erro de recebimento e para no shutdown', async () => {
    sqs
      .on(ReceiveMessageCommand)
      .callsFake(() => new Promise((r) => setTimeout(() => r({ Messages: [] }), 5)));
    const { consumer: c } = consumer([], undefined, { autoStart: true });
    c.onApplicationBootstrap();
    c.iniciar(); // idempotente
    await new Promise((r) => setTimeout(r, 60));
    await c.onApplicationShutdown();
    const chamadas = sqs.commandCalls(ReceiveMessageCommand).length;
    expect(chamadas).toBeGreaterThanOrEqual(3);
    await new Promise((r) => setTimeout(r, 30));
    expect(sqs.commandCalls(ReceiveMessageCommand).length).toBe(chamadas); // parou de fato
  });

  it('loop: erro de recebimento e logado e o loop continua apos 1 s', async () => {
    jest.useFakeTimers();
    sqs
      .on(ReceiveMessageCommand)
      .rejectsOnce(new Error('rede'))
      .callsFake(() => new Promise((r) => setTimeout(() => r({ Messages: [] }), 50)));
    const { consumer: c } = consumer([], undefined, { autoStart: true });
    c.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1100);
    expect(sqs.commandCalls(ReceiveMessageCommand).length).toBeGreaterThanOrEqual(2);
    const parada = c.parar();
    await jest.advanceTimersByTimeAsync(100);
    await parada;
    jest.useRealTimers();
  });

  it('autoStart=false nao inicia o loop no bootstrap', () => {
    const { consumer: c } = consumer([]);
    c.onApplicationBootstrap();
    expect(sqs.commandCalls(ReceiveMessageCommand)).toHaveLength(0);
  });
});
