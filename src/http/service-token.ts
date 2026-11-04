import jwt from 'jsonwebtoken';
import { DEFAULT_JWT_ISSUER } from '../auth/auth.options';
import { Role } from '../auth/domain/role.enum';
import type { NomeServico } from './http-interno.options';

/** Validade do JWT de servico (mesma da Lambda: 1 h). */
export const TOKEN_SERVICO_TTL_S = 3600;
/** O token e reaproveitado por 50 min e renovado antes de expirar. */
export const TOKEN_SERVICO_CACHE_MS = 50 * 60 * 1000;

export interface EmitirTokenServicoOptions {
  readonly secret: string;
  readonly issuer?: string;
  readonly expiresIn?: number;
}

/**
 * JWT de servico (comunicacao HTTP interna): `role: SERVICO`, `sub` = nome do
 * servico, assinado com o MESMO `JWT_SECRET` da Lambda e com o `iss` que o
 * `AuthModule` do kit aceita. Emitido localmente — nao passa pela Lambda.
 */
export function emitirTokenDeServico(
  servico: NomeServico,
  options: EmitirTokenServicoOptions,
): string {
  if (!options.secret) {
    throw new Error('JWT_SECRET ausente para emitir o token de servico');
  }
  return jwt.sign({ role: Role.SERVICO, nome: servico }, options.secret, {
    algorithm: 'HS256',
    subject: servico,
    issuer: options.issuer ?? DEFAULT_JWT_ISSUER,
    expiresIn: options.expiresIn ?? TOKEN_SERVICO_TTL_S,
  });
}

/** Emite e guarda o token de servico em memoria, renovando a cada `cacheMs`. */
export class EmissorTokenServico {
  private cache?: { token: string; expiraEm: number };

  constructor(
    private readonly servico: NomeServico,
    private readonly options: EmitirTokenServicoOptions,
    private readonly cacheMs: number = TOKEN_SERVICO_CACHE_MS,
  ) {}

  token(agora: number = Date.now()): string {
    if (!this.cache || this.cache.expiraEm <= agora) {
      this.cache = {
        token: emitirTokenDeServico(this.servico, this.options),
        expiraEm: agora + this.cacheMs,
      };
    }
    return this.cache.token;
  }

  /** Descarta o token em cache (ex.: segredo rotacionado). */
  invalidar(): void {
    this.cache = undefined;
  }
}
