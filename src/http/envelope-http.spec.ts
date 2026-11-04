import { runWithCorrelation } from '../logging/correlation-context';
import {
  criarEnvelopeHttp,
  EnvelopeHttpInvalidoError,
  ENVELOPE_HTTP_TYPE_RE,
  validarEnvelopeHttp,
} from './envelope-http';

describe('EnvelopeHttp', () => {
  it('criarEnvelopeHttp monta id v7, version 1, occurredAt ISO e NAO carrega correlationId', () => {
    const e = criarEnvelopeHttp({
      type: 'execucao.finalizada',
      producer: 'execucao-service',
      data: { numeroOS: 'OS-1', finalizadaEm: '2026-11-03T18:00:00Z' },
    });
    expect(e.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(e).toMatchObject({
      type: 'execucao.finalizada',
      version: 1,
      producer: 'execucao-service',
    });
    expect(Number.isNaN(Date.parse(e.occurredAt))).toBe(false);
    expect(e).not.toHaveProperty('correlationId');
    expect(e).not.toHaveProperty('traceparent');
    expect(e.data).toEqual({ numeroOS: 'OS-1', finalizadaEm: '2026-11-03T18:00:00Z' });
  });

  it('funciona fora de uma requisicao (sem contexto de correlacao) e sem numeroOS', () => {
    const e = criarEnvelopeHttp({
      type: 'billing.pagamento-aprovado',
      producer: 'billing-service',
      data: {},
    });
    expect(e.type).toBe('billing.pagamento-aprovado');
    const dentro = runWithCorrelation({ correlationId: 'OS-2', traceId: 't' }, () =>
      criarEnvelopeHttp({
        type: 'billing.pagamento-aprovado',
        producer: 'billing-service',
        data: null,
      }),
    );
    expect(dentro.data).toBeNull();
  });

  it('respeita version/occurredAt informados e rejeita type fora do padrao', () => {
    const quando = new Date('2026-11-03T18:00:00Z');
    const e = criarEnvelopeHttp({
      type: 'a.b',
      producer: 'os-service',
      data: {},
      version: 2,
      occurredAt: quando,
    });
    expect(e).toMatchObject({ version: 2, occurredAt: quando.toISOString() });
    expect(() =>
      criarEnvelopeHttp({ type: 'Execucao.Finalizada', producer: 'x', data: {} }),
    ).toThrow(/type invalido/);
    expect(ENVELOPE_HTTP_TYPE_RE.test('billing.orcamento-aprovado')).toBe(true);
    expect(ENVELOPE_HTTP_TYPE_RE.test('billing.-x')).toBe(false);
  });

  it('validarEnvelopeHttp aceita um envelope valido e aponta o campo errado', () => {
    const ok = criarEnvelopeHttp({
      type: 'a.b',
      producer: 'os-service',
      data: { numeroOS: 'OS-1' },
    });
    expect(() => validarEnvelopeHttp(ok)).not.toThrow();
    const casos: Array<[unknown, RegExp]> = [
      [null, /objeto/],
      [{ ...ok, id: '' }, /id/],
      [{ ...ok, type: 'ruim' }, /type/],
      [{ ...ok, version: 0 }, /version/],
      [{ ...ok, occurredAt: 'ontem' }, /occurredAt/],
      [{ ...ok, producer: '' }, /producer/],
      [{ ...ok, data: [] }, /data/],
    ];
    for (const [valor, re] of casos) {
      expect(() => validarEnvelopeHttp(valor)).toThrow(EnvelopeHttpInvalidoError);
      expect(() => validarEnvelopeHttp(valor)).toThrow(re);
    }
  });
});
