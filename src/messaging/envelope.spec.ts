import { EnvelopeInvalidoError, criarEnvelope, traceparentDe, validarEnvelope } from './envelope';
import { runWithCorrelation } from '../logging/correlation-context';
import { registrarTracer, resetTracerBridge } from '../logging/tracer-bridge';

describe('criarEnvelope', () => {
  afterEach(() => resetTracerBridge());

  it('monta envelope valido com id v7, version 1 e occurredAt ISO', () => {
    const e = criarEnvelope({
      type: 'os.aberta',
      producer: 'os-service',
      correlationId: 'OS-1',
      data: { numeroOS: 'OS-1' },
    });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e.id[14]).toBe('7');
    expect(e).toMatchObject({
      type: 'os.aberta',
      version: 1,
      correlationId: 'OS-1',
      producer: 'os-service',
      data: { numeroOS: 'OS-1' },
    });
    expect(Date.parse(e.occurredAt)).not.toBeNaN();
    expect(e.traceparent).toBeUndefined();
  });

  it('ids v7 sao crescentes no tempo (ordenaveis)', () => {
    const a = criarEnvelope({ type: 'x.a', producer: 'p', correlationId: 'c', data: 1 });
    const b = criarEnvelope({ type: 'x.a', producer: 'p', correlationId: 'c', data: 2 });
    expect(a.id < b.id).toBe(true);
  });

  it('herda correlationId do AsyncLocalStorage da requisicao', () => {
    const e = runWithCorrelation({ correlationId: 'OS-77', traceId: 't' }, () =>
      criarEnvelope({ type: 'os.aberta', producer: 'os-service', data: {} }),
    );
    expect(e.correlationId).toBe('OS-77');
  });

  it('falha sem correlationId e sem contexto', () => {
    expect(() => criarEnvelope({ type: 'os.aberta', producer: 'os-service', data: {} })).toThrow(
      EnvelopeInvalidoError,
    );
  });

  it('propaga traceparent do span de APM ativo', () => {
    const span = {
      context: () => ({ toTraceId: () => '1234567890', toSpanId: () => '42' }),
      setTag: jest.fn(),
    };
    registrarTracer({ scope: () => ({ active: () => span }) } as never);
    const e = criarEnvelope({
      type: 'os.aberta',
      producer: 'os-service',
      correlationId: 'OS-1',
      data: {},
    });
    expect(e.traceparent).toBe(`00-${'499602d2'.padStart(32, '0')}-${'2a'.padStart(16, '0')}-01`);
  });

  it('aceita causationId, version e occurredAt explicitos', () => {
    const quando = new Date('2026-10-20T10:00:00Z');
    const e = criarEnvelope({
      type: 'x.y',
      producer: 'p',
      correlationId: 'c',
      data: {},
      causationId: 'abc',
      version: 2,
      occurredAt: quando,
    });
    expect(e).toMatchObject({ causationId: 'abc', version: 2, occurredAt: quando.toISOString() });
  });
});

describe('validarEnvelope', () => {
  const base = {
    id: 'i',
    type: 'os.aberta',
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: 'c',
    producer: 'p',
    data: {},
  };
  it.each([
    ['nao objeto', null, /objeto/],
    ['sem id', { ...base, id: '' }, /id/],
    ['type invalido', { ...base, type: 'OsAberta' }, /type/],
    ['version 0', { ...base, version: 0 }, /version/],
    ['occurredAt invalido', { ...base, occurredAt: 'ontem' }, /occurredAt/],
    ['sem correlationId', { ...base, correlationId: undefined }, /correlationId/],
    ['sem producer', { ...base, producer: '' }, /producer/],
    ['sem data', { ...base, data: undefined }, /data/],
  ])('rejeita %s', (_n, value, re) => {
    expect(() => validarEnvelope(value)).toThrow(re);
  });
  it('aceita envelope completo', () => {
    expect(() => validarEnvelope(base)).not.toThrow();
  });
});

describe('traceparentDe', () => {
  it('converte ids decimais do dd-trace para hex com padding', () => {
    expect(traceparentDe('255', '1')).toBe(
      '00-000000000000000000000000000000ff-0000000000000001-01',
    );
  });
  it('mantem ids ja em hex', () => {
    expect(traceparentDe('abc', 'def')).toBe(
      '00-00000000000000000000000000000abc-0000000000000def-01',
    );
  });
});
