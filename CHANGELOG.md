# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [0.1.0] — 2026-10-19

### Adicionado
- `core`: `DomainError`/`DomainErrorKind`, `DomainEvent`, `UseCase`, `EntityNotFoundError`, `NotOwnedByUserError`, `DomainExceptionFilter`, `CoreModule`.
- `auth`: `AuthenticatedUser`, `Role`, `Cpf`, `JwtStrategy`, `JwtAuthGuard`, `RolesGuard`, `@Public`, `@Roles`, `@CurrentUser`, `AuthModule.forRoot/forRootAsync` (resource server do JWT da Lambda).
- `logging`: `LoggerModule.forRoot/forRootAsync` (pino JSON, redacao, correlacao log<->trace), `CorrelationIdMiddleware`, `correlation-context` (AsyncLocalStorage), `tracer-bridge`, `maskCpfCnpj`, `redactSensitiveText`.
- `metrics`: `registry`, `httpDuration`, `MetricsInterceptor`, `MetricsController`, `MetricsModule.forRoot({ serviceName })`, `iniciarTracing`.
- `health`: `HealthModule.forRoot({ indicators })`, `HealthIndicator`.
- `messaging`: `DomainEventPublisher` (porta), `EventEmitterDomainEventPublisher`, `InProcessMessagingModule`.
- `testing`: `mintToken`, `FakeDomainEventPublisher`.

Extraido de `soat-fiap-oficina-mecanica-app` (Fases 2–3) conforme ADR-0010.
