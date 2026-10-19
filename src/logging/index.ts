export * from './logger.module';
export * from './correlation-context';
export * from './correlation-id.middleware';
export * from './resolve-correlation-id';
export * from './redact-paths';
export * from './redact-sensitive-text';
export * from './mask-cpf-cnpj';
export * from './tracer-bridge';
export {
  Logger as PinoLogger,
  InjectPinoLogger,
  PinoLogger as PinoLoggerService,
} from 'nestjs-pino';
