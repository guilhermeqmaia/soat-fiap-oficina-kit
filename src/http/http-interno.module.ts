import { DynamicModule, Module } from '@nestjs/common';
import { ClienteHttpInterno } from './cliente-http-interno';
import {
  HTTP_INTERNO_OPTIONS,
  HttpInternoAsyncOptions,
  HttpInternoOptions,
} from './http-interno.options';

/**
 * Comunicacao HTTP entre os servicos (substitui a mensageria SNS/SQS —
 * decisao de 03/11/2026, RFC-0008). Registra o `ClienteHttpInterno` como
 * provider GLOBAL: qualquer modulo do servico injeta sem reimportar.
 *
 * ```ts
 * HttpInternoModule.forRootAsync({
 *   inject: [ConfigService],
 *   useFactory: (c) => ({ servico: 'os-service', jwtSecret: c.getOrThrow('JWT_SECRET') }),
 * })
 * ```
 */
@Module({})
export class HttpInternoModule {
  static forRoot(options: HttpInternoOptions): DynamicModule {
    return {
      module: HttpInternoModule,
      global: true,
      providers: [{ provide: HTTP_INTERNO_OPTIONS, useValue: options }, ClienteHttpInterno],
      exports: [HTTP_INTERNO_OPTIONS, ClienteHttpInterno],
    };
  }

  static forRootAsync(options: HttpInternoAsyncOptions): DynamicModule {
    return {
      module: HttpInternoModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: HTTP_INTERNO_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory,
        },
        ClienteHttpInterno,
      ],
      exports: [HTTP_INTERNO_OPTIONS, ClienteHttpInterno],
    };
  }
}
