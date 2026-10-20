import { MessageEnvelope } from '../envelope';
import { OutboxRecord, OutboxRepository } from './outbox.ports';

/**
 * Contrato minimo do client Prisma do servico para a tabela `outbox`
 * (tipagem estrutural: o kit nao depende do client gerado de cada servico).
 *
 * Modelo esperado (copiar para o `schema.prisma` do servico):
 * ```prisma
 * model Outbox {
 *   id            String    @id
 *   type          String
 *   correlationId String    @map("correlation_id")
 *   envelope      Json
 *   status        String    @default("PENDENTE")
 *   tentativas    Int       @default(0)
 *   criadaEm      DateTime  @default(now()) @map("criada_em")
 *   enviadaEm     DateTime? @map("enviada_em")
 *   ultimoErro    String?   @map("ultimo_erro")
 *   @@index([status, criadaEm])
 *   @@map("outbox")
 * }
 * model ProcessedMessage {
 *   id           String   @id
 *   type         String
 *   processadaEm DateTime @default(now()) @map("processada_em")
 *   @@map("processed_messages")
 * }
 * ```
 */
/*
 * Os parametros sao `any` de proposito: o delegate gerado pelo Prisma tem tipos
 * de entrada proprios (`OutboxCreateInput`, `InputJsonValue`...) que nao sao
 * assinaveis a um contrato estrutural estrito em nenhuma direcao. O retorno
 * continua tipado (`OutboxRow`) — e o que o kit consome.
 */
export interface OutboxDelegate {
  create(args: { data: any }): Promise<unknown>;
  findMany(args: any): Promise<OutboxRow[]>;
  update(args: any): Promise<unknown>;
}
export type OutboxUpdateData = Partial<Omit<OutboxRow, 'tentativas'>> & {
  tentativas?: number | { increment: number };
};
export interface OutboxRow {
  id: string;
  type: string;
  correlationId: string;
  envelope: unknown;
  status: string;
  tentativas: number;
  criadaEm: Date;
  enviadaEm?: Date | null;
  ultimoErro?: string | null;
}
export interface OutboxPrismaClient {
  outbox: OutboxDelegate;
}

/** Adapter Prisma/Postgres do outbox. Para gravar na transacao, passe o client transacional (`tx`). */
export class PrismaOutboxRepository implements OutboxRepository<OutboxPrismaClient> {
  constructor(private readonly prisma: OutboxPrismaClient) {}

  async gravar(envelope: MessageEnvelope, tx?: OutboxPrismaClient): Promise<void> {
    await (tx ?? this.prisma).outbox.create({
      data: {
        id: envelope.id,
        type: envelope.type,
        correlationId: envelope.correlationId,
        envelope: envelope as unknown,
        status: 'PENDENTE',
        tentativas: 0,
        criadaEm: new Date(envelope.occurredAt),
      },
    });
  }

  async pendentes(limite: number): Promise<OutboxRecord[]> {
    const rows = await this.prisma.outbox.findMany({
      where: { status: 'PENDENTE' },
      orderBy: { criadaEm: 'asc' },
      take: limite,
    });
    return rows.map((r) => ({
      id: r.id,
      type: r.type,
      correlationId: r.correlationId,
      envelope: r.envelope as MessageEnvelope,
      status: r.status as OutboxRecord['status'],
      tentativas: r.tentativas,
      criadaEm: r.criadaEm,
      enviadaEm: r.enviadaEm,
      ultimoErro: r.ultimoErro,
    }));
  }

  async marcarEnviada(id: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { status: 'ENVIADA', enviadaEm: new Date(), ultimoErro: null },
    });
  }

  async marcarFalha(id: string, erro: string): Promise<void> {
    await this.prisma.outbox.update({
      where: { id },
      data: { tentativas: { increment: 1 }, ultimoErro: erro.slice(0, 1000) },
    });
  }
}

/** Contrato minimo para a tabela `processed_messages` (dedup do consumidor). */
export interface ProcessedMessageDelegate {
  findUnique(args: any): Promise<unknown | null>;
  create(args: { data: any }): Promise<unknown>;
}
export interface ProcessedMessagePrismaClient {
  processedMessage: ProcessedMessageDelegate;
}

export class PrismaProcessedMessageStore {
  constructor(private readonly prisma: ProcessedMessagePrismaClient) {}
  async jaProcessada(messageId: string): Promise<boolean> {
    return (await this.prisma.processedMessage.findUnique({ where: { id: messageId } })) !== null;
  }
  async marcar(messageId: string, type: string): Promise<void> {
    await this.prisma.processedMessage.create({ data: { id: messageId, type } });
  }
}
