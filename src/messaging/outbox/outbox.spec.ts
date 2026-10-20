import { OutboxPoller } from './outbox-poller';
import { OutboxPublisher } from './outbox-publisher';
import {
  PrismaOutboxRepository,
  PrismaProcessedMessageStore,
  OutboxRow,
} from './prisma-outbox.repository';
import { criarEnvelope } from '../envelope';
import { FakeMessagePublisher, InMemoryOutboxRepository } from '../../testing/messaging-fakes';

const env = (n: number) =>
  criarEnvelope({
    type: 'os.aberta',
    producer: 'os-service',
    correlationId: `OS-${n}`,
    data: { n },
  });

describe('OutboxPublisher', () => {
  it('grava no outbox (na transacao) em vez de falar com o broker', async () => {
    const repo = new InMemoryOutboxRepository();
    const e = env(1);
    await new OutboxPublisher(repo).publish(e, 'tx-fake');
    expect((await repo.pendentes(10))[0]).toMatchObject({
      id: e.id,
      status: 'PENDENTE',
      tentativas: 0,
    });
  });
  it('valida o envelope', async () => {
    await expect(
      new OutboxPublisher(new InMemoryOutboxRepository()).publish({} as never),
    ).rejects.toThrow(/Envelope invalido/);
  });
});

describe('OutboxPoller', () => {
  it('entrega as pendentes em ordem e marca como enviadas', async () => {
    const repo = new InMemoryOutboxRepository();
    const broker = new FakeMessagePublisher();
    const a = env(1);
    const b = env(2);
    await repo.gravar(a);
    await repo.gravar(b);
    const enviadas = await new OutboxPoller(repo, broker, { autoStart: false }).varrer();
    expect(enviadas).toBe(2);
    expect(broker.publicados.map((e) => e.id)).toEqual([a.id, b.id]);
    expect(await repo.pendentes(10)).toHaveLength(0);
    expect(repo.registros.get(a.id)?.status).toBe('ENVIADA');
  });

  it('falha no broker: incrementa tentativas, guarda o erro e mantem PENDENTE para a proxima varredura', async () => {
    const repo = new InMemoryOutboxRepository();
    const broker = new FakeMessagePublisher();
    const e = env(1);
    await repo.gravar(e);
    broker.falhar = new Error('SNS indisponivel');
    expect(await new OutboxPoller(repo, broker, { autoStart: false }).varrer()).toBe(0);
    expect(repo.registros.get(e.id)).toMatchObject({
      status: 'PENDENTE',
      tentativas: 1,
      ultimoErro: 'SNS indisponivel',
    });
    broker.falhar = undefined;
    expect(await new OutboxPoller(repo, broker, { autoStart: false }).varrer()).toBe(1);
  });

  it('loga erro quando as tentativas esgotam (maxTentativas)', async () => {
    const repo = new InMemoryOutboxRepository();
    const broker = new FakeMessagePublisher();
    await repo.gravar(env(1));
    broker.falhar = new Error('x');
    const poller = new OutboxPoller(repo, broker, { autoStart: false, maxTentativas: 1 });
    const erro = jest
      .spyOn((poller as never as { logger: { error: jest.Mock } }).logger, 'error')
      .mockImplementation(() => undefined);
    await poller.varrer();
    expect(erro).toHaveBeenCalledWith(
      expect.objectContaining({ msg: expect.stringContaining('esgotadas') }),
    );
  });

  it('varreduras nao se sobrepoem', async () => {
    const repo = new InMemoryOutboxRepository();
    await repo.gravar(env(1));
    const lento = new FakeMessagePublisher();
    lento.publish = async (e) => {
      await new Promise((r) => setTimeout(r, 20));
      lento.publicados.push(e);
    };
    const poller = new OutboxPoller(repo, lento, { autoStart: false });
    const [a, b] = await Promise.all([poller.varrer(), poller.varrer()]);
    expect([a, b].sort()).toEqual([0, 1]);
  });

  it('bootstrap inicia o timer e shutdown para', async () => {
    jest.useFakeTimers();
    const repo = new InMemoryOutboxRepository();
    const broker = new FakeMessagePublisher();
    await repo.gravar(env(1));
    const poller = new OutboxPoller(repo, broker, { intervaloMs: 10 });
    poller.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(35);
    poller.onApplicationShutdown();
    expect(broker.publicados).toHaveLength(1);
    await repo.gravar(env(2));
    await jest.advanceTimersByTimeAsync(50);
    expect(broker.publicados).toHaveLength(1); // parado
    jest.useRealTimers();
  });

  it('autoStart=false nao agenda', () => {
    const poller = new OutboxPoller(new InMemoryOutboxRepository(), new FakeMessagePublisher(), {
      autoStart: false,
    });
    poller.onApplicationBootstrap();
    expect((poller as never as { timer?: unknown }).timer).toBeUndefined();
  });
});

describe('PrismaOutboxRepository / PrismaProcessedMessageStore (contrato minimo do client)', () => {
  function fakePrisma() {
    const rows: OutboxRow[] = [];
    const calls: unknown[] = [];
    const outbox = {
      create: jest.fn(async ({ data }: { data: OutboxRow }) => {
        rows.push(data);
        return data;
      }),
      findMany: jest.fn(async ({ where, take }: { where: { status: string }; take: number }) =>
        rows.filter((r) => r.status === where.status).slice(0, take),
      ),
      update: jest.fn(async (args: unknown) => {
        calls.push(args);
        return {};
      }),
    };
    return { outbox, rows, calls };
  }

  it('gravar usa o client transacional quando informado', async () => {
    const base = fakePrisma();
    const tx = fakePrisma();
    const e = env(1);
    await new PrismaOutboxRepository(base).gravar(e, tx);
    expect(tx.outbox.create).toHaveBeenCalled();
    expect(base.outbox.create).not.toHaveBeenCalled();
    expect(tx.rows[0]).toMatchObject({
      id: e.id,
      type: 'os.aberta',
      correlationId: 'OS-1',
      status: 'PENDENTE',
      tentativas: 0,
    });
  });

  it('pendentes/marcarEnviada/marcarFalha mapeiam para o client', async () => {
    const p = fakePrisma();
    const repo = new PrismaOutboxRepository(p);
    await repo.gravar(env(1));
    const pend = await repo.pendentes(5);
    expect(pend).toHaveLength(1);
    expect(p.outbox.findMany).toHaveBeenCalledWith({
      where: { status: 'PENDENTE' },
      orderBy: { criadaEm: 'asc' },
      take: 5,
    });
    await repo.marcarEnviada(pend[0].id);
    await repo.marcarFalha(pend[0].id, 'x'.repeat(2000));
    expect(p.calls[0]).toMatchObject({
      where: { id: pend[0].id },
      data: { status: 'ENVIADA', ultimoErro: null },
    });
    expect((p.calls[1] as { data: { ultimoErro: string } }).data.ultimoErro).toHaveLength(1000);
    expect(p.calls[1]).toMatchObject({ data: { tentativas: { increment: 1 } } });
  });

  it('processed store consulta e grava por id', async () => {
    const ids = new Set<string>();
    const client = {
      processedMessage: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          ids.has(where.id) ? {} : null,
        ),
        create: jest.fn(async ({ data }: { data: { id: string } }) => {
          ids.add(data.id);
        }),
      },
    };
    const store = new PrismaProcessedMessageStore(client);
    expect(await store.jaProcessada('a')).toBe(false);
    await store.marcar('a', 't');
    expect(await store.jaProcessada('a')).toBe(true);
  });
});
