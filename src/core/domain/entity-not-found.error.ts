import { DomainError, DomainErrorKind } from './domain-error';

/**
 * Erro generico de "entidade nao encontrada" — substitui erros
 * especificos como ClienteNotFoundError, VeiculoNotFoundError.
 *
 * Mantemos os especificos como subclasses para compatibilidade,
 * mas codigo novo pode usar este diretamente.
 */
export class EntityNotFoundError extends DomainError {
  readonly kind = DomainErrorKind.NOT_FOUND;

  constructor(
    public readonly entityName: string,
    public readonly identifier: string,
  ) {
    super(`${entityName} com identificador '${identifier}' nao encontrado`);
  }
}
