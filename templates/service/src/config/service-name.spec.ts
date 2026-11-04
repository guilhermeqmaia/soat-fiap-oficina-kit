import { PRODUCER_NAME, SERVICE_NAME } from './service-name';

it('expoe o nome do servico (DD_SERVICE ou default)', () =>
  expect(typeof SERVICE_NAME).toBe('string'));
it('expoe o nome usado nas chamadas entre servicos (<servico>-service)', () =>
  expect(PRODUCER_NAME).toMatch(/-service$/));
