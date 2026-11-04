import { criarEnvelope, type Producer } from '../messaging/envelope';
import { getCorrelationId } from '../logging/correlation-context';

/**
 * Envelope dos callbacks HTTP entre servicos (`POST /ordens-servico/{numero}/eventos`)
 * e do corpo dos eventos. Mesmo vocabulario do AsyncAPI, sem `correlationId`
 * no corpo: a correlacao e o `{numero}` do path e o cabecalho `x-correlation-id`.
 */
export interface EnvelopeHttp<T = unknown> {
  /** UUID v7 — chave de idempotencia do callback (`processed_messages` no destino). */
  readonly id: string;
  /** `<dominio>.<fato>`, ex.: `execucao.diagnostico-concluido`. */
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  readonly producer: Producer;
  readonly data: T;
}

export interface CriarEnvelopeHttpInput<T> {
  readonly type: string;
  readonly data: T;
  readonly producer: Producer;
  readonly version?: number;
  readonly occurredAt?: Date;
}

/** Formato aceito em `type` (o mesmo do envelope de mensageria). */
export const ENVELOPE_HTTP_TYPE_RE = /^[a-z]+\.[a-z][a-z0-9-]*$/;

/**
 * Monta um envelope de callback. Reaproveita `criarEnvelope` (id v7, validacao
 * de `type`) mas NAO exige contexto de correlacao: fora de uma requisicao
 * (ex.: webhook do Mercado Pago, job) o envelope continua valido.
 */
export function criarEnvelopeHttp<T>(input: CriarEnvelopeHttpInput<T>): EnvelopeHttp<T> {
  const numeroOS = (input.data as { numeroOS?: unknown } | null)?.numeroOS;
  const completo = criarEnvelope({
    type: input.type,
    data: input.data,
    producer: input.producer,
    version: input.version,
    occurredAt: input.occurredAt,
    correlationId: getCorrelationId() ?? (typeof numeroOS === 'string' ? numeroOS : 'n/a'),
  });
  return {
    id: completo.id,
    type: completo.type,
    version: completo.version,
    occurredAt: completo.occurredAt,
    producer: completo.producer,
    data: completo.data,
  };
}

export class EnvelopeHttpInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Envelope invalido: ${motivo}`);
    this.name = 'EnvelopeHttpInvalidoError';
  }
}

/** Validacao estrutural do envelope recebido num callback. */
export function validarEnvelopeHttp(value: unknown): asserts value is EnvelopeHttp {
  if (!value || typeof value !== 'object') throw new EnvelopeHttpInvalidoError('nao e um objeto');
  const e = value as Record<string, unknown>;
  const str = (k: string) => typeof e[k] === 'string' && (e[k] as string).length > 0;
  if (!str('id')) throw new EnvelopeHttpInvalidoError('id ausente');
  if (!str('type') || !ENVELOPE_HTTP_TYPE_RE.test(e.type as string))
    throw new EnvelopeHttpInvalidoError(`type invalido: ${String(e.type)}`);
  if (typeof e.version !== 'number' || e.version < 1)
    throw new EnvelopeHttpInvalidoError('version deve ser inteiro >= 1');
  if (!str('occurredAt') || Number.isNaN(Date.parse(e.occurredAt as string)))
    throw new EnvelopeHttpInvalidoError('occurredAt invalido');
  if (!str('producer')) throw new EnvelopeHttpInvalidoError('producer ausente');
  if (!e.data || typeof e.data !== 'object' || Array.isArray(e.data))
    throw new EnvelopeHttpInvalidoError('data deve ser um objeto');
}
