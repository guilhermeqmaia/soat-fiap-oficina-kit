import jwt from 'jsonwebtoken';
import { Role } from '../auth/domain/role.enum';
import { emitirTokenDeServico } from '../http/service-token';
import type { NomeServico } from '../http/http-interno.options';

/**
 * Fabrica de tokens para TESTES e desenvolvimento local (resource server —
 * US-F3-03): em producao o unico emissor e a Lambda de CPF; aqui reproduzimos
 * o contrato dela (claims + iss) para exercitar a aplicacao sem o gateway.
 */

export interface TokenClaims {
  sub: string;
  nome?: string;
  cpf?: string;
  role: Role | string;
}

export function mintToken(
  claims: TokenClaims,
  options: { secret?: string; issuer?: string; expiresIn?: number } = {},
): string {
  const secret = options.secret ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET ausente para emitir token de teste');
  }
  return jwt.sign({ cpf: claims.cpf, nome: claims.nome ?? 'Teste', role: claims.role }, secret, {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: options.issuer ?? process.env.JWT_ISSUER ?? 'oficina-auth-lambda',
    expiresIn: options.expiresIn ?? 3600,
  });
}

/**
 * Token de SERVICO (comunicacao HTTP interna): `role: SERVICO`, `sub` = nome do
 * servico, mesmo `JWT_SECRET`. E o que `ClienteHttpInterno` envia em producao —
 * aqui serve para testar endpoints internos e callbacks (`@Roles(Role.SERVICO)`).
 */
export function mintServiceToken(
  claims: { servico: NomeServico },
  options: { secret?: string; issuer?: string; expiresIn?: number } = {},
): string {
  const secret = options.secret ?? process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET ausente para emitir token de servico de teste');
  }
  return emitirTokenDeServico(claims.servico, {
    secret,
    issuer: options.issuer ?? process.env.JWT_ISSUER,
    expiresIn: options.expiresIn,
  });
}
