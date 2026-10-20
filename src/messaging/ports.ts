import { MessageEnvelope } from './envelope';

/** Porta de saida: publica um envelope no broker (SNS) — ou, via outbox, apos o commit. */
export interface MessagePublisher {
  publish(envelope: MessageEnvelope): Promise<void>;
}
export const MESSAGE_PUBLISHER = Symbol('MESSAGE_PUBLISHER');

/**
 * Porta de deduplicacao do consumidor (ADR-0009): `marcar` deve ser atomico
 * e falhar se o id ja existe (unique) — o efeito e a marca ficam na mesma
 * transacao sempre que o adapter permitir.
 */
export interface ProcessedMessageStore {
  /** `true` se a mensagem ja foi processada (duplicata — ack silencioso). */
  jaProcessada(messageId: string): Promise<boolean>;
  marcar(messageId: string, type: string): Promise<void>;
}
export const PROCESSED_MESSAGE_STORE = Symbol('PROCESSED_MESSAGE_STORE');

/** Quem trata um `type` de mensagem. Lancar = retry pelo broker (visibility timeout) ate a DLQ. */
export interface MessageHandler<T = unknown> {
  readonly type: string;
  handle(envelope: MessageEnvelope<T>): Promise<void>;
}
export const MESSAGE_HANDLERS = Symbol('MESSAGE_HANDLERS');
