import type { ModuleMetadata } from '@nestjs/common';

/** Issuer do JWT emitido pela Lambda de autenticacao por CPF (RFC-0003). */
export const DEFAULT_JWT_ISSUER = 'oficina-auth-lambda';

export interface AuthOptions {
  /** Segredo HS256 compartilhado com a Lambda (vem do Secrets Manager). */
  readonly secret: string;
  /** `iss` esperado no token. Default: `oficina-auth-lambda`. */
  readonly issuer?: string;
}

export interface AuthAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: any[];
  readonly useFactory: (...args: any[]) => AuthOptions | Promise<AuthOptions>;
}

export const AUTH_OPTIONS = Symbol('AUTH_OPTIONS');
