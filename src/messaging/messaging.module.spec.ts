import 'reflect-metadata';
import { Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { ReceiveMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { mockClient } from 'aws-sdk-client-mock';
import { MessagingModule } from './messaging.module';
import {
  MESSAGE_PUBLISHER,
  MessageHandler,
  MessagePublisher,
  PROCESSED_MESSAGE_STORE,
} from './ports';
import { OutboxPoller } from './outbox/outbox-poller';
import { SqsConsumer } from './sqs-consumer';
import { criarEnvelope } from './envelope';
import {
  InMemoryOutboxRepository,
  InMemoryProcessedMessageStore,
} from '../testing/messaging-fakes';

const sns = mockClient(SNSClient);
const sqs = mockClient(SQSClient);

@Injectable()
class Outbox extends InMemoryOutboxRepository {}
@Injectable()
class Store extends InMemoryProcessedMessageStore {}
@Injectable()
class Handler implements MessageHandler {
  readonly type = 'billing.orcamento-gerado';
  readonly vistos: string[] = [];
  async handle(e: { id: string }) {
    this.vistos.push(e.id);
  }
}

@Module({
  imports: [
    MessagingModule.forRoot({
      aws: { endpoint: 'http://localhost:4566', region: 'us-east-1' },
      topicArn: 'arn:aws:sns:us-east-1:000000000000:oficina-os.fifo',
      outboxRepository: Outbox,
      poller: { autoStart: false },
      consumer: {
        queueUrl: 'http://localhost:4566/000000000000/os-eventos.fifo',
        autoStart: false,
        processedMessageStore: Store,
        handlers: [Handler],
      },
    }),
  ],
})
class AppModule {}

describe('MessagingModule.forRoot — fluxo ponta a ponta com SDK mockado', () => {
  beforeEach(() => {
    sns.reset();
    sqs.reset();
  });

  it('caso de uso grava no outbox -> poller publica no SNS -> consumer recebe, deduplica e trata', async () => {
    sns.on(PublishCommand).resolves({ MessageId: '1' });
    const app = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await app.init();

    const publisher = app.get<MessagePublisher>(MESSAGE_PUBLISHER);
    const e = criarEnvelope({
      type: 'billing.orcamento-gerado',
      producer: 'billing-service',
      correlationId: 'OS-5',
      data: { total: '10.00' },
    });
    await publisher.publish(e);
    expect(sns.commandCalls(PublishCommand)).toHaveLength(0); // ainda so no outbox

    expect(await app.get(OutboxPoller).varrer()).toBe(1);
    const publicado = JSON.parse(sns.commandCalls(PublishCommand)[0].args[0].input.Message!);
    expect(publicado.id).toBe(e.id);

    // a mesma mensagem chega duas vezes pela fila
    sqs.on(ReceiveMessageCommand).resolves({
      Messages: [
        { MessageId: 'a', ReceiptHandle: 'r1', Body: JSON.stringify(e) },
        { MessageId: 'b', ReceiptHandle: 'r2', Body: JSON.stringify(e) },
      ],
    });
    await app.get(SqsConsumer).receberUmaVez();
    expect(app.get(Handler).vistos).toEqual([e.id]); // tratada UMA vez
    expect(
      await app.get<InMemoryProcessedMessageStore>(PROCESSED_MESSAGE_STORE).jaProcessada(e.id),
    ).toBe(true);
    await app.close();
  });

  it('sem consumer configurado nao registra SqsConsumer', async () => {
    @Module({
      imports: [
        MessagingModule.forRoot({
          topicArn: 'arn',
          outboxRepository: Outbox,
          poller: { autoStart: false },
        }),
      ],
    })
    class SoProdutor {}
    const app = await Test.createTestingModule({ imports: [SoProdutor] }).compile();
    expect(() => app.get(SqsConsumer)).toThrow();
    expect(app.get(MESSAGE_PUBLISHER)).toBeDefined();
  });
});
