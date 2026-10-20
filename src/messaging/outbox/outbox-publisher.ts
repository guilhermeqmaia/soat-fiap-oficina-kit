import { Inject, Injectable } from '@nestjs/common';
import { MessageEnvelope, validarEnvelope } from '../envelope';
import { MessagePublisher } from '../ports';
import { OUTBOX_REPOSITORY, OutboxRepository } from './outbox.ports';

/**
 * `MessagePublisher` que NAO fala com o broker: grava no outbox na transacao
 * corrente. E o que os casos de uso injetam (`MESSAGE_PUBLISHER`); quem
 * entrega ao SNS e o `OutboxPoller`.
 */
@Injectable()
export class OutboxPublisher<Tx = unknown> implements MessagePublisher {
  constructor(@Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository<Tx>) {}

  async publish(envelope: MessageEnvelope, tx?: Tx): Promise<void> {
    validarEnvelope(envelope);
    await this.outbox.gravar(envelope, tx);
  }
}
