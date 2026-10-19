import { DomainEvent } from '../core/domain/domain-event';
import { FakeDomainEventPublisher } from './fake-domain-event-publisher';

class E extends DomainEvent {
  readonly eventName = 'e';
}

describe('FakeDomainEventPublisher', () => {
  it('guarda os eventos publicados, expoe o ultimo e limpa', () => {
    const fake = new FakeDomainEventPublisher();
    expect(fake.ultimo()).toBeUndefined();
    fake.publish(new E());
    fake.publish(new E());
    expect(fake.publicados).toHaveLength(2);
    expect(fake.ultimo()?.eventName).toBe('e');
    expect(fake.ultimo()?.occurredAt).toBeInstanceOf(Date);
    fake.limpar();
    expect(fake.publicados).toHaveLength(0);
  });
});
