# Changelog

Formato: [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) · versionamento [SemVer](https://semver.org/lang/pt-BR/).

## [0.2.1] — 2026-10-20

### Corrigido
- `typesVersions` no `package.json`: os subpaths (`/auth`, `/messaging`...) resolvem tambem com `moduleResolution: node10` (consumidores NestJS com `module: commonjs`).

### Adicionado
- `templates/service/` + `scripts/new-service.sh`: esqueleto de microsserviço ligado ao kit (US-F4-01/US-F4-04), validado no CI do kit (gera, instala, testa, builda).
- `release.yml` com Node 22 + npm@11 (Trusted Publishing).

## [0.2.0] — 2026-10-20

### Adicionado
- `messaging`: `MessageEnvelope` + `criarEnvelope`/`validarEnvelope` (ADR-0009; UUID v7, correlacao e `traceparent` herdados do contexto), portas `MessagePublisher`/`ProcessedMessageStore`/`MessageHandler`, `SnsPublisher` (FIFO: `MessageGroupId`=correlationId, dedup id, atributos para filtro), `SqsConsumer` (long polling, dedup por id, contexto de correlacao por mensagem, falha => reentrega/DLQ), outbox transacional (`OutboxRepository`, `OutboxPublisher`, `OutboxPoller`, adapters Prisma `PrismaOutboxRepository`/`PrismaProcessedMessageStore`), `MessagingModule.forRoot`.
- `testing`: `FakeMessagePublisher`, `InMemoryProcessedMessageStore`, `InMemoryOutboxRepository`.
- LocalStack: `docker-compose.localstack.yml` + `scripts/messaging-local.sh` (topologia da RFC-0006).
- Release por **Trusted Publishing** (OIDC), sem token.

### Peers novos (opcionais para quem nao usa mensageria)
- `@aws-sdk/client-sns`, `@aws-sdk/client-sqs`.

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
