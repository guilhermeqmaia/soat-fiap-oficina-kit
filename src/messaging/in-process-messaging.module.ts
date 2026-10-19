import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DOMAIN_EVENT_PUBLISHER } from '../core/application/domain-event-publisher';
import { EventEmitterDomainEventPublisher } from './event-emitter-domain-event-publisher';

/**
 * Publicacao de eventos de dominio DENTRO do processo (EventEmitter2) —
 * efeitos locais como metricas, auditoria e notificacao. A publicacao para o
 * broker (outbox -> SNS) chega na v0.2 como segundo adapter da mesma porta
 * (ADR-0009).
 */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    EventEmitterDomainEventPublisher,
    { provide: DOMAIN_EVENT_PUBLISHER, useExisting: EventEmitterDomainEventPublisher },
  ],
  exports: [DOMAIN_EVENT_PUBLISHER, EventEmitterModule],
})
export class InProcessMessagingModule {}
