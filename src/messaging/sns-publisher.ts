import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { MessageEnvelope, validarEnvelope } from './envelope';
import { MessagePublisher } from './ports';

export interface SnsPublisherOptions {
  readonly topicArn: string;
}
export const SNS_PUBLISHER_OPTIONS = Symbol('SNS_PUBLISHER_OPTIONS');
export const SNS_CLIENT = Symbol('SNS_CLIENT');

/**
 * Publica no topico SNS FIFO do servico (RFC-0006). `MessageGroupId` =
 * correlationId (ordem por OS); `MessageDeduplicationId` = id do envelope.
 * Atributos permitem filtro por `type` nas assinaturas SNS->SQS.
 *
 * Nao deve ser chamado de dentro de um caso de uso — o caminho correto e o
 * outbox (ADR-0009); este publisher e quem o poller usa.
 */
@Injectable()
export class SnsPublisher implements MessagePublisher {
  private readonly logger = new Logger(SnsPublisher.name);

  constructor(
    @Inject(SNS_PUBLISHER_OPTIONS) private readonly options: SnsPublisherOptions,
    @Optional() @Inject(SNS_CLIENT) private readonly client: SNSClient = new SNSClient({}),
  ) {}

  async publish(envelope: MessageEnvelope): Promise<void> {
    validarEnvelope(envelope);
    const attrs: Record<string, { DataType: 'String'; StringValue: string }> = {
      type: { DataType: 'String', StringValue: envelope.type },
      correlationId: { DataType: 'String', StringValue: envelope.correlationId },
      producer: { DataType: 'String', StringValue: envelope.producer },
    };
    if (envelope.traceparent)
      attrs.traceparent = { DataType: 'String', StringValue: envelope.traceparent };

    await this.client.send(
      new PublishCommand({
        TopicArn: this.options.topicArn,
        Message: JSON.stringify(envelope),
        MessageAttributes: attrs,
        MessageGroupId: envelope.correlationId,
        MessageDeduplicationId: envelope.id,
      }),
    );
    this.logger.debug({
      msg: 'mensagem publicada',
      type: envelope.type,
      id: envelope.id,
      correlationId: envelope.correlationId,
    });
  }
}
