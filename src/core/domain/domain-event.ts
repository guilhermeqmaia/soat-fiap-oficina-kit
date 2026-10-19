/**
 * Base class para eventos de dominio que cruzam bounded contexts.
 *
 * Cada evento expoe `eventName`, usado pelo publisher para roteamento, e
 * `occurredAt`, usado para rastreabilidade sem acoplar dominio a framework.
 */
export abstract class DomainEvent {
  abstract readonly eventName: string;

  /** Timestamp em que o evento foi disparado (UTC) */
  readonly occurredAt?: Date;

  constructor() {
    this.occurredAt = new Date();
  }
}
