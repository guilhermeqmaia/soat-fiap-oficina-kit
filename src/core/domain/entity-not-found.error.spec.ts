import { EntityNotFoundError } from './entity-not-found.error';
import { DomainError } from './domain-error';

describe('EntityNotFoundError', () => {
  it('inclui nome da entidade e identifier na mensagem', () => {
    const err = new EntityNotFoundError('Cliente', 'abc-123');
    expect(err.message).toContain('Cliente');
    expect(err.message).toContain('abc-123');
    expect(err.entityName).toBe('Cliente');
    expect(err.identifier).toBe('abc-123');
  });

  it('eh subclasse de DomainError (instanceof correto)', () => {
    const err = new EntityNotFoundError('Veiculo', 'xyz');
    expect(err).toBeInstanceOf(DomainError);
    expect(err).toBeInstanceOf(EntityNotFoundError);
    expect(err).toBeInstanceOf(Error);
  });

  it('preserva o name correto (nao Error generico)', () => {
    const err = new EntityNotFoundError('OS', '1');
    expect(err.name).toBe('EntityNotFoundError');
  });
});
