import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import { mockClient } from 'aws-sdk-client-mock';
import { SnsPublisher } from './sns-publisher';
import { criarEnvelope } from './envelope';

const sns = mockClient(SNSClient);
beforeEach(() => sns.reset());

describe('SnsPublisher', () => {
  const publisher = () =>
    new SnsPublisher({ topicArn: 'arn:aws:sns:us-east-1:1:oficina-os.fifo' }, new SNSClient({}));

  it('publica com MessageGroupId=correlationId, DeduplicationId=id e atributos de filtro', async () => {
    sns.on(PublishCommand).resolves({ MessageId: 'm1' });
    const e = criarEnvelope({
      type: 'os.aberta',
      producer: 'os-service',
      correlationId: 'OS-9',
      data: { x: 1 },
    });
    await publisher().publish({ ...e, traceparent: '00-abc-def-01' });

    const call = sns.commandCalls(PublishCommand)[0].args[0].input;
    expect(call.TopicArn).toBe('arn:aws:sns:us-east-1:1:oficina-os.fifo');
    expect(call.MessageGroupId).toBe('OS-9');
    expect(call.MessageDeduplicationId).toBe(e.id);
    expect(JSON.parse(call.Message!)).toMatchObject({ type: 'os.aberta', data: { x: 1 } });
    expect(call.MessageAttributes).toMatchObject({
      type: { DataType: 'String', StringValue: 'os.aberta' },
      correlationId: { DataType: 'String', StringValue: 'OS-9' },
      producer: { DataType: 'String', StringValue: 'os-service' },
      traceparent: { DataType: 'String', StringValue: '00-abc-def-01' },
    });
  });

  it('omite o atributo traceparent quando nao ha trace', async () => {
    sns.on(PublishCommand).resolves({});
    await publisher().publish(
      criarEnvelope({ type: 'os.aberta', producer: 'os-service', correlationId: 'c', data: {} }),
    );
    expect(sns.commandCalls(PublishCommand)[0].args[0].input.MessageAttributes).not.toHaveProperty(
      'traceparent',
    );
  });

  it('valida o envelope antes de publicar', async () => {
    await expect(publisher().publish({ id: '', type: 'x' } as never)).rejects.toThrow(
      /Envelope invalido/,
    );
    expect(sns.commandCalls(PublishCommand)).toHaveLength(0);
  });

  it('propaga erro do SNS (quem decide o retry e o outbox)', async () => {
    sns.on(PublishCommand).rejects(new Error('throttled'));
    await expect(
      publisher().publish(
        criarEnvelope({ type: 'a.b', producer: 'p', correlationId: 'c', data: {} }),
      ),
    ).rejects.toThrow('throttled');
  });
});
