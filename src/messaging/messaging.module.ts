import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { SNSClient } from '@aws-sdk/client-sns';
import { SQSClient } from '@aws-sdk/client-sqs';
import {
  MESSAGE_HANDLERS,
  MESSAGE_PUBLISHER,
  MessageHandler,
  PROCESSED_MESSAGE_STORE,
  ProcessedMessageStore,
} from './ports';
import { SNS_CLIENT, SNS_PUBLISHER_OPTIONS, SnsPublisher } from './sns-publisher';
import { SQS_CLIENT, SQS_CONSUMER_OPTIONS, SqsConsumer, SqsConsumerOptions } from './sqs-consumer';
import {
  BROKER_PUBLISHER,
  OUTBOX_POLLER_OPTIONS,
  OutboxPoller,
  OutboxPollerOptions,
} from './outbox/outbox-poller';
import { OutboxPublisher } from './outbox/outbox-publisher';
import { OUTBOX_REPOSITORY, OutboxRepository } from './outbox/outbox.ports';

export interface AwsClientConfig {
  readonly region?: string;
  /** LocalStack: `http://localhost:4566`. */
  readonly endpoint?: string;
  readonly credentials?: { accessKeyId: string; secretAccessKey: string };
}

export interface MessagingModuleOptions {
  readonly aws?: AwsClientConfig;
  /** Topico SNS FIFO deste servico (RFC-0006). */
  readonly topicArn: string;
  /** Classe injetavel que implementa `OutboxRepository` (ex.: wrapper do PrismaOutboxRepository). */
  readonly outboxRepository: Type<OutboxRepository>;
  readonly poller?: OutboxPollerOptions;
  /** Filas consumidas por este servico. */
  readonly consumer?: SqsConsumerOptions & {
    readonly processedMessageStore: Type<ProcessedMessageStore>;
    readonly handlers: Type<MessageHandler>[];
  };
  /** Modulos que proveem as dependencias dos adapters (ex.: PrismaModule). */
  readonly imports?: DynamicModule['imports'];
}

/**
 * Mensageria do servico (ADR-0009 / RFC-0006):
 * - `MESSAGE_PUBLISHER` -> `OutboxPublisher` (casos de uso gravam na transacao);
 * - `OutboxPoller` entrega ao SNS (`BROKER_PUBLISHER` = `SnsPublisher`);
 * - `SqsConsumer` opcional com handlers e dedup.
 */
@Module({})
export class MessagingModule {
  static forRoot(options: MessagingModuleOptions): DynamicModule {
    const providers: Provider[] = [
      { provide: SNS_CLIENT, useFactory: () => new SNSClient(options.aws ?? {}) },
      { provide: SNS_PUBLISHER_OPTIONS, useValue: { topicArn: options.topicArn } },
      SnsPublisher,
      { provide: BROKER_PUBLISHER, useExisting: SnsPublisher },
      options.outboxRepository,
      { provide: OUTBOX_REPOSITORY, useExisting: options.outboxRepository },
      OutboxPublisher,
      { provide: MESSAGE_PUBLISHER, useExisting: OutboxPublisher },
      { provide: OUTBOX_POLLER_OPTIONS, useValue: options.poller ?? {} },
      OutboxPoller,
    ];
    const exports: (symbol | Type<unknown>)[] = [
      MESSAGE_PUBLISHER,
      BROKER_PUBLISHER,
      OUTBOX_REPOSITORY,
      OutboxPoller,
    ];

    if (options.consumer) {
      const { processedMessageStore, handlers, ...consumerOptions } = options.consumer;
      providers.push(
        { provide: SQS_CLIENT, useFactory: () => new SQSClient(options.aws ?? {}) },
        { provide: SQS_CONSUMER_OPTIONS, useValue: consumerOptions },
        processedMessageStore,
        { provide: PROCESSED_MESSAGE_STORE, useExisting: processedMessageStore },
        ...handlers,
        {
          provide: MESSAGE_HANDLERS,
          inject: handlers,
          useFactory: (...hs: MessageHandler[]) => hs,
        },
        SqsConsumer,
      );
      exports.push(SqsConsumer, PROCESSED_MESSAGE_STORE);
    }
    return { module: MessagingModule, imports: options.imports ?? [], providers, exports };
  }
}
