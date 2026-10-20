import { DynamicModule, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { definirServico } from './metrics.registry';

export interface MetricsOptions {
  /** Vira label `service` em todas as metricas. */
  readonly serviceName: string;
}

/** `/metrics` (OpenMetrics) + latencia HTTP por rota + metricas de processo. */
@Module({})
export class MetricsModule {
  static forRoot(options: MetricsOptions): DynamicModule {
    definirServico(options.serviceName);
    return {
      module: MetricsModule,
      controllers: [MetricsController],
      providers: [{ provide: APP_INTERCEPTOR, useClass: MetricsInterceptor }],
    };
  }
}
