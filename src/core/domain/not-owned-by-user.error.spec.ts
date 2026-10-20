import { NotOwnedByUserError } from './not-owned-by-user.error';
import { DomainError } from './domain-error';

describe('NotOwnedByUserError', () => {
  it('inclui resource e identifier na mensagem', () => {
    const err = new NotOwnedByUserError('OS', 'OS-2026-001');
    expect(err.message).toContain('OS');
    expect(err.message).toContain('OS-2026-001');
    expect(err.message).toContain('permissao');
  });

  it('eh subclasse de DomainError', () => {
    const err = new NotOwnedByUserError('Cliente', '123');
    expect(err).toBeInstanceOf(DomainError);
  });
});
