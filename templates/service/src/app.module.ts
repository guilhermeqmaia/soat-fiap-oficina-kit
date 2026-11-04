import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from '@guilhermeqmaia/oficina-kit/core';
import { AuthModule } from '@guilhermeqmaia/oficina-kit/auth';
import { CorrelationIdMiddleware, LoggerModule } from '@guilhermeqmaia/oficina-kit/logging';
import { MetricsModule } from '@guilhermeqmaia/oficina-kit/metrics';
import { HealthModule } from '@guilhermeqmaia/oficina-kit/health';
import { InProcessMessagingModule } from '@guilhermeqmaia/oficina-kit/messaging';
import { HttpInternoModule } from '@guilhermeqmaia/oficina-kit/http';
import { validateEnv } from './config/env.validation';
import { PRODUCER_NAME, SERVICE_NAME } from './config/service-name';
import { httpInternoConfig } from './config/servicos.config';
import { THROTTLER_LIMIT, THROTTLER_TTL_MS, shouldSkipThrottling } from './config/throttler.config';
import { PrismaModule } from './prisma/prisma.module';
import { PrismaHealthIndicator } from './health/prisma-health.indicator';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // --- comum aos microsservicos (ADR-0010) ---
    CoreModule,
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        serviceName: SERVICE_NAME,
        nodeEnv: c.get('NODE_ENV'),
        level: c.get('LOG_LEVEL'),
      }),
    }),
    AuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        secret: c.getOrThrow<string>('JWT_SECRET'),
        issuer: c.get<string>('JWT_ISSUER'),
      }),
    }),
    MetricsModule.forRoot({ serviceName: SERVICE_NAME }),
    HealthModule.forRoot({ imports: [PrismaModule], indicators: [PrismaHealthIndicator] }),
    // Eventos de dominio dentro do processo (listeners @OnEvent).
    InProcessMessagingModule,
    // Chamadas HTTP para os outros servicos (RFC-0008): JWT de servico, correlacao, retry.
    // Enderecos: `urlsDosServicos()` em config/servicos.config.ts.
    HttpInternoModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({
        servico: PRODUCER_NAME,
        jwtSecret: c.getOrThrow<string>('JWT_SECRET'),
        issuer: c.get<string>('JWT_ISSUER'),
        ...httpInternoConfig(),
      }),
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: THROTTLER_TTL_MS, limit: THROTTLER_LIMIT }],
      skipIf: (context) => shouldSkipThrottling(process.env, context),
    }),
    // --- este servico ---
    PrismaModule,
    // TODO: modulos de dominio (ex.: OrcamentoModule)
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
