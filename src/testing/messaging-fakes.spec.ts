import { criarEnvelope } from '../messaging/envelope';
import { FakeMessagePublisher, InMemoryProcessedMessageStore } from './messaging-fakes';

describe('fakes de mensageria', () => {
  it('FakeMessagePublisher filtra por tipo e simula falha', async () => {
    const f = new FakeMessagePublisher();
    await f.publish(criarEnvelope({ type: 'a.b', producer: 'p', correlationId: 'c', data: {} }));
    await f.publish(criarEnvelope({ type: 'a.c', producer: 'p', correlationId: 'c', data: {} }));
    expect(f.doTipo('a.b')).toHaveLength(1);
    f.falhar = new Error('x');
    await expect(
      f.publish(criarEnvelope({ type: 'a.b', producer: 'p', correlationId: 'c', data: {} })),
    ).rejects.toThrow('x');
  });
  it('InMemoryProcessedMessageStore e unique por id', async () => {
    const s = new InMemoryProcessedMessageStore();
    await s.marcar('1', 't');
    await expect(s.marcar('1', 't')).rejects.toThrow(/duplicata/);
  });
});
