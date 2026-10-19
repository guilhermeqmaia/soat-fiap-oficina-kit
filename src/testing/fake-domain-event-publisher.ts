import { DomainEvent } from '../core/domain/domain-event';
import { DomainEventPublisher } from '../core/application/domain-event-publisher';

/** Publisher em memoria para testes de casos de uso: guarda o que foi publicado. */
export class FakeDomainEventPublisher implements DomainEventPublisher {
  readonly publicados: DomainEvent[] = [];

  publish(event: DomainEvent): void {
    this.publicados.push(event);
  }

  ultimo<T extends DomainEvent = DomainEvent>(): T | undefined {
    return this.publicados[this.publicados.length - 1] as T | undefined;
  }

  limpar(): void {
    this.publicados.length = 0;
  }
}
