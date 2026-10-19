import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { AUTH_OPTIONS, AuthAsyncOptions, AuthOptions } from './auth.options';
import { JwtAuthGuard } from './infrastructure/guards/jwt-auth.guard';
import { RolesGuard } from './infrastructure/guards/roles.guard';
import { JwtStrategy } from './infrastructure/strategies/jwt.strategy';

const GUARDS = [
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: RolesGuard },
];

/**
 * Resource server do JWT emitido pela Lambda de CPF (ADR-0003/ADR-0010).
 * Registra a strategy de VALIDACAO e os guards globais (JWT + roles); rotas
 * abertas usam `@Public()`. Nenhum servico emite token.
 *
 * ```ts
 * AuthModule.forRoot({ secret: process.env.JWT_SECRET! })
 * AuthModule.forRootAsync({ inject: [ConfigService], useFactory: (c) => ({ secret: c.getOrThrow('JWT_SECRET') }) })
 * ```
 */
@Module({})
export class AuthModule {
  static forRoot(options: AuthOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [PassportModule],
      providers: [{ provide: AUTH_OPTIONS, useValue: options }, JwtStrategy, ...GUARDS],
      exports: [AUTH_OPTIONS],
    };
  }

  static forRootAsync(options: AuthAsyncOptions): DynamicModule {
    return {
      module: AuthModule,
      imports: [PassportModule, ...(options.imports ?? [])],
      providers: [
        { provide: AUTH_OPTIONS, inject: options.inject ?? [], useFactory: options.useFactory },
        JwtStrategy,
        ...GUARDS,
      ],
      exports: [AUTH_OPTIONS],
    };
  }
}
