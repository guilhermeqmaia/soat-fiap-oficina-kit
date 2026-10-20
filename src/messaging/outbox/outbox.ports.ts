import { MessageEnvelope } from '../envelope';

export type OutboxStatus = 'PENDENTE' | 'ENVIADA' | 'FALHA';

export interface OutboxRecord {
  readonly id: string;
  readonly type: string;
  readonly correlationId: string;
  readonly envelope: MessageEnvelope;
  readonly status: OutboxStatus;
  readonly tentativas: number;
  readonly criadaEm: Date;
  readonly enviadaEm?: Date | null;
  readonly ultimoErro?: string | null;
}

/**
 * Porta do outbox transacional (ADR-0009). `gravar` DEVE rodar na mesma
 * transacao da mudanca de estado — por isso recebe o `tx` do servico (ex.: o
 * client transacional do Prisma) e o adapter decide como usa-lo.
 */
export interface OutboxRepository<Tx = unknown> {
  gravar(envelope: MessageEnvelope, tx?: Tx): Promise<void>;
  /** Pendentes mais antigas primeiro, no maximo `limite`. */
  pendentes(limite: number): Promise<OutboxRecord[]>;
  marcarEnviada(id: string): Promise<void>;
  marcarFalha(id: string, erro: string): Promise<void>;
}
export const OUTBOX_REPOSITORY = Symbol('OUTBOX_REPOSITORY');
