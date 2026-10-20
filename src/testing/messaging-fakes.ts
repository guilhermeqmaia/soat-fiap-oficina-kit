import { MessageEnvelope } from '../messaging/envelope';
import { MessagePublisher, ProcessedMessageStore } from '../messaging/ports';
import { OutboxRecord, OutboxRepository } from '../messaging/outbox/outbox.ports';

/** Publisher em memoria: guarda os envelopes; pode simular falha. */
export class FakeMessagePublisher implements MessagePublisher {
  readonly publicados: MessageEnvelope[] = [];
  falhar?: Error;
  async publish(envelope: MessageEnvelope): Promise<void> {
    if (this.falhar) throw this.falhar;
    this.publicados.push(envelope);
  }
  doTipo(type: string): MessageEnvelope[] {
    return this.publicados.filter((e) => e.type === type);
  }
}

export class InMemoryProcessedMessageStore implements ProcessedMessageStore {
  readonly ids = new Map<string, string>();
  async jaProcessada(messageId: string): Promise<boolean> {
    return this.ids.has(messageId);
  }
  async marcar(messageId: string, type: string): Promise<void> {
    if (this.ids.has(messageId)) throw new Error(`duplicata: ${messageId}`);
    this.ids.set(messageId, type);
  }
}

export class InMemoryOutboxRepository implements OutboxRepository {
  readonly registros = new Map<string, OutboxRecord>();
  async gravar(envelope: MessageEnvelope): Promise<void> {
    this.registros.set(envelope.id, {
      id: envelope.id,
      type: envelope.type,
      correlationId: envelope.correlationId,
      envelope,
      status: 'PENDENTE',
      tentativas: 0,
      criadaEm: new Date(envelope.occurredAt),
      enviadaEm: null,
      ultimoErro: null,
    });
  }
  async pendentes(limite: number): Promise<OutboxRecord[]> {
    return [...this.registros.values()]
      .filter((r) => r.status === 'PENDENTE')
      .sort((a, b) => +a.criadaEm - +b.criadaEm)
      .slice(0, limite);
  }
  async marcarEnviada(id: string): Promise<void> {
    const r = this.registros.get(id)!;
    this.registros.set(id, { ...r, status: 'ENVIADA', enviadaEm: new Date(), ultimoErro: null });
  }
  async marcarFalha(id: string, erro: string): Promise<void> {
    const r = this.registros.get(id)!;
    this.registros.set(id, { ...r, tentativas: r.tentativas + 1, ultimoErro: erro });
  }
}
