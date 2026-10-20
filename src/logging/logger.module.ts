import { DynamicModule, Module, ModuleMetadata } from '@nestjs/common';
import { hostname } from 'node:os';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import type { Options } from 'pino-http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getCorrelationContext } from './correlation-context';
import { REDACT_PATHS } from './redact-paths';
import { resolveCorrelationId } from './resolve-correlation-id';
import { getActiveTraceIds } from './tracer-bridge';

interface RequestWithUser extends IncomingMessage {
  correlationId?: string;
  user?: { id?: string; role?: string };
}

interface RequestWithCorrelationId extends IncomingMessage {
  correlationId?: string;
}

/** `debug` fora de producao (US-F3-09), sobrescrevivel via `LOG_LEVEL`. */
function defaultLevel(nodeEnv: string): string {
  return nodeEnv === 'production' ? 'info' : 'debug';
}

export interface LoggerOptions {
  /** Nome do servico, emitido em toda linha (`service`) — distingue os microsservicos. */
  readonly serviceName: string;
  /** Default: `process.env.NODE_ENV` ou `development`. */
  readonly nodeEnv?: string;
  /** Default: `process.env.LOG_LEVEL`, senao `debug` fora de producao e `info` em producao. */
  readonly level?: string;
}

export interface LoggerAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: any[];
  readonly useFactory: (...args: any[]) => LoggerOptions | Promise<LoggerOptions>;
}

export function buildPinoHttpOptions(options: LoggerOptions): Options {
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? 'development';
  const isTest = nodeEnv === 'test';

  return {
    level: isTest ? 'silent' : (options.level ?? process.env.LOG_LEVEL ?? defaultLevel(nodeEnv)),
    base: { pid: process.pid, hostname: hostname(), service: options.serviceName },
    autoLogging: !isTest,
    // Le `req.correlationId` primeiro para o caso de `CorrelationIdMiddleware`
    // (aplicado via `AppModule.configure`) ja ter rodado antes deste
    // middleware na cadeia — mantem um unico ID mesmo com ordem invertida
    // entre os dois, sem depender de qual dos dois roda primeiro.
    genReqId: (req: RequestWithCorrelationId) =>
      req.correlationId || resolveCorrelationId(req.headers),
    // Todo log emitido durante uma requisicao (incluindo `new Logger().log()`
    // em services/listeners fora do pino-http) herda correlationId/traceId
    // do AsyncLocalStorage — nao apenas a linha automatica de request/response.
    //
    // Com APM ativo (`dd-trace`), o `traceId` vem do span REAL do tracer e os
    // campos `dd.trace_id`/`dd.span_id` (formato que o pipeline do Datadog
    // casa automaticamente com o trace) sao emitidos aqui — em vez de delegar
    // ao `logInjection` do dd-trace, que dependeria dele conseguir dar patch
    // no pino instanciado pelo nestjs-pino. Uma unica fonte de verdade.
    mixin() {
      const ctx = getCorrelationContext();
      if (!ctx) return {};

      const active = getActiveTraceIds();
      if (!active) {
        return { correlationId: ctx.correlationId, traceId: ctx.traceId };
      }

      return {
        correlationId: ctx.correlationId,
        traceId: active.traceId,
        dd: { trace_id: active.traceId, span_id: active.spanId },
      };
    },
    // Campos padrao da US-F3-09 (method/path/statusCode/userId/role) em vez
    // dos objetos `req`/`res` verbosos default do pino-http. Usa
    // customSuccessObject/customErrorObject (chamados uma unica vez, na
    // conclusao da requisicao, com o statusCode final) em vez de
    // `customProps` — este ultimo tambem eh avaliado no INICIO da
    // requisicao (statusCode ainda default) e, como pino-http nao decupa
    // bindings quando o valor muda, cada chave apareceria duplicada no JSON.
    customSuccessObject: (req: RequestWithUser, res: ServerResponse, val: object) => ({
      ...val,
      method: req.method,
      path: req.url,
      statusCode: res.statusCode,
      userId: req.user?.id,
      role: req.user?.role,
    }),
    customErrorObject: (req: RequestWithUser, res: ServerResponse, _err: Error, val: object) => ({
      ...val,
      method: req.method,
      path: req.url,
      statusCode: res.statusCode,
      userId: req.user?.id,
      role: req.user?.role,
    }),
    serializers: {
      req: () => undefined,
      res: () => undefined,
    },
    customAttributeKeys: {
      reqId: 'correlationId',
      responseTime: 'latencyMs',
    },
    customSuccessMessage: (req: IncomingMessage, res: ServerResponse) =>
      `${req.method} ${req.url} -> ${res.statusCode}`,
    customErrorMessage: (req: IncomingMessage, res: ServerResponse, err: Error) =>
      `${req.method} ${req.url} -> ${res.statusCode} (${err.message})`,
    redact: {
      paths: REDACT_PATHS,
      censor: '[REDACTED]',
    },
  };
}

/**
 * Logs JSON estruturados (pino) com `correlationId`/`traceId` em toda linha,
 * redacao de segredos e campos padrao de request (US-F3-09). O servico aplica
 * `CorrelationIdMiddleware` em `configure()` e `app.useLogger(app.get(Logger))`
 * no bootstrap (ver README).
 */
@Module({})
export class LoggerModule {
  static forRoot(options: LoggerOptions): DynamicModule {
    return {
      module: LoggerModule,
      imports: [PinoLoggerModule.forRoot({ pinoHttp: buildPinoHttpOptions(options) })],
      exports: [PinoLoggerModule],
    };
  }

  static forRootAsync(options: LoggerAsyncOptions): DynamicModule {
    return {
      module: LoggerModule,
      imports: [
        PinoLoggerModule.forRootAsync({
          imports: options.imports,
          inject: options.inject ?? [],
          useFactory: async (...args: any[]) => ({
            pinoHttp: buildPinoHttpOptions(await options.useFactory(...args)),
          }),
        }),
      ],
      exports: [PinoLoggerModule],
    };
  }
}
