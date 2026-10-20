import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HEALTH_INDICATORS, HealthIndicator } from './health.indicator';

export interface HealthOptions {
  /** Classes injetaveis que implementam `HealthIndicator` (ex.: PrismaHealthIndicator). */
  readonly indicators?: Type<HealthIndicator>[];
  /** Modulos que proveem as dependencias dos indicadores (ex.: PrismaModule). */
  readonly imports?: DynamicModule['imports'];
}

/** `/health` (liveness) e `/health/ready` (readiness com indicadores do servico). */
@Module({})
export class HealthModule {
  static forRoot(options: HealthOptions = {}): DynamicModule {
    const indicators = options.indicators ?? [];
    const providers: Provider[] = [
      ...indicators,
      {
        provide: HEALTH_INDICATORS,
        inject: indicators,
        useFactory: (...instances: HealthIndicator[]) => instances,
      },
    ];
    return {
      module: HealthModule,
      imports: options.imports ?? [],
      controllers: [HealthController],
      providers,
    };
  }
}
