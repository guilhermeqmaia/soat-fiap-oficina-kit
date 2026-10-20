import { v7 as uuidv7 } from 'uuid';
import { getCorrelationId } from '../logging/correlation-context';
import { getActiveTraceIds } from '../logging/tracer-bridge';

/** Servicos que produzem mensagens (ADR-0009 / AsyncAPI do hub). */
export type Producer = 'os-service' | 'billing-service' | 'execucao-service' | (string & {});

/**
 * Envelope comum de TODA mensagem que cruza o broker (ADR-0009). `type`,
 * `correlationId`, `producer` e `traceparent` tambem viajam como message
 * attributes (filtro de assinatura SNS->SQS e continuidade do trace).
 */
export interface MessageEnvelope<T = unknown> {
  /** UUID v7 — ordenavel no tempo; chave de idempotencia e MessageDeduplicationId. */
  readonly id: string;
  /** `<dominio>.<fato>` (eventos) ou `<dominio>.<acao>` (comandos), ex.: `billing.orcamento-gerado`. */
  readonly type: string;
  readonly version: number;
  readonly occurredAt: string;
  /** Numero da OS — MessageGroupId (ordem por saga). */
  readonly correlationId: string;
  /** Id da mensagem que originou esta (cadeia causal), quando houver. */
  readonly causationId?: string;
  readonly producer: Producer;
  /** W3C Trace Context do produtor, quando ha APM ativo. */
  readonly traceparent?: string;
  readonly data: T;
}

export interface CriarEnvelopeInput<T> {
  readonly type: string;
  readonly data: T;
  readonly producer: Producer;
  /** Default: `correlationId` do AsyncLocalStorage da requisicao corrente. */
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly version?: number;
  readonly occurredAt?: Date;
}

const TYPE_RE = /^[a-z]+\.[a-z][a-z0-9-]*$/;

export class EnvelopeInvalidoError extends Error {
  constructor(motivo: string) {
    super(`Envelope invalido: ${motivo}`);
    this.name = 'EnvelopeInvalidoError';
  }
}

/** Monta um envelope valido, herdando correlacao e trace do contexto corrente. */
export function criarEnvelope<T>(input: CriarEnvelopeInput<T>): MessageEnvelope<T> {
  const correlationId = input.correlationId ?? getCorrelationId();
  if (!correlationId) {
    throw new EnvelopeInvalidoError(
      'correlationId ausente (numero da OS) e nenhum contexto de requisicao ativo',
    );
  }
  const trace = getActiveTraceIds();
  const envelope: MessageEnvelope<T> = {
    id: uuidv7(),
    type: input.type,
    version: input.version ?? 1,
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
    correlationId,
    causationId: input.causationId,
    producer: input.producer,
    traceparent: trace ? traceparentDe(trace.traceId, trace.spanId) : undefined,
    data: input.data,
  };
  validarEnvelope(envelope);
  return envelope;
}

/** Validacao estrutural (a validacao por schema JSON do AsyncAPI entra na US-F4-15). */
export function validarEnvelope(value: unknown): asserts value is MessageEnvelope {
  if (!value || typeof value !== 'object') throw new EnvelopeInvalidoError('nao e um objeto');
  const e = value as Record<string, unknown>;
  const str = (k: string) => typeof e[k] === 'string' && (e[k] as string).length > 0;
  if (!str('id')) throw new EnvelopeInvalidoError('id ausente');
  if (!str('type') || !TYPE_RE.test(e.type as string))
    throw new EnvelopeInvalidoError(`type invalido: ${String(e.type)}`);
  if (typeof e.version !== 'number' || e.version < 1)
    throw new EnvelopeInvalidoError('version deve ser inteiro >= 1');
  if (!str('occurredAt') || Number.isNaN(Date.parse(e.occurredAt as string)))
    throw new EnvelopeInvalidoError('occurredAt invalido');
  if (!str('correlationId')) throw new EnvelopeInvalidoError('correlationId ausente');
  if (!str('producer')) throw new EnvelopeInvalidoError('producer ausente');
  if (!('data' in e) || e.data === undefined) throw new EnvelopeInvalidoError('data ausente');
}

/**
 * `traceparent` W3C a partir dos ids do dd-trace (decimais de 64 bits):
 * `00-<trace-id 32 hex>-<parent-id 16 hex>-01`.
 */
export function traceparentDe(traceId: string, spanId: string): string {
  const hex = (v: string, len: number) => {
    const n = /^\d+$/.test(v) ? BigInt(v).toString(16) : v;
    return n.padStart(len, '0').slice(-len);
  };
  return `00-${hex(traceId, 32)}-${hex(spanId, 16)}-01`;
}
