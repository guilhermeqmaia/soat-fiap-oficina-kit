import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthenticatedUser } from '../../domain/authenticated-user';
import { Role } from '../../domain/role.enum';
import { AUTH_OPTIONS, AuthOptions, DEFAULT_JWT_ISSUER } from '../../auth.options';

/** Claims do token emitido pela Lambda de CPF (contrato da RFC-0003). */
export interface JwtPayload {
  sub: string;
  cpf?: string;
  nome?: string;
  role: string;
  iss: string;
}

/**
 * Resource server (US-F3-03): o servico NAO emite tokens — valida assinatura
 * (segredo compartilhado), `iss` da Lambda e `exp`, e monta o principal direto
 * das claims, sem consulta ao banco. A revogacao de um usuario vale a partir
 * da expiracao do token (TTL 1h).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(@Inject(AUTH_OPTIONS) options: AuthOptions) {
    if (!options?.secret) {
      throw new Error(
        'AuthModule: `secret` e obrigatorio (JWT_SECRET compartilhado com a Lambda).',
      );
    }
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: options.secret,
      algorithms: ['HS256'],
      issuer: options.issuer ?? DEFAULT_JWT_ISSUER,
    });
  }

  validate(payload: JwtPayload): AuthenticatedUser {
    const role = Object.values(Role).find((value) => value === payload.role);
    if (!payload.sub || !role) {
      throw new UnauthorizedException('Token sem as claims obrigatorias (sub/role)');
    }
    return new AuthenticatedUser(payload.sub, payload.nome ?? '', payload.cpf ?? null, role);
  }
}
