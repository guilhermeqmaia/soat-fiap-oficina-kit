# @guilhermeqmaia/oficina-kit

[![CI](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit/actions/workflows/ci.yml) [![Release](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit/actions/workflows/release.yml/badge.svg)](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit/actions/workflows/release.yml) [![npm](https://img.shields.io/npm/v/%40guilhermeqmaia%2Foficina-kit)](https://www.npmjs.com/package/@guilhermeqmaia/oficina-kit)

Kit compartilhado dos microsserviços do **Sistema da Oficina Mecânica** (Tech Challenge FIAP — SOAT, Fase 4). Contém **o que é comum e não é domínio**: autenticação como _resource server_, logs JSON com correlação, métricas, health e o cliente HTTP das chamadas entre serviços — para que OS Service, Billing e Execução nasçam iguais e cada repositório escreva só código de negócio ([ADR-0010](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/arquitetura/adr/ADR-0010-kit-compartilhado.md)).

> Repositório 7 de 7. Planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas ficam no hub: [`docs/plano-execucao-fase-4.md`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/plano-execucao-fase-4.md).

## Instalação

```bash
npm install @guilhermeqmaia/oficina-kit
# peers (mesmas versões do monólito da Fase 3):
npm install @nestjs/common @nestjs/core @nestjs/passport @nestjs/event-emitter @nestjs/swagger nestjs-pino pino passport passport-jwt prom-client reflect-metadata rxjs
```

Publicado no **npmjs.org** — nenhum token é necessário para instalar (local, CI ou `docker build`).

## O que vem em cada subpath

| Subpath      | Exporta                                                                                                                                                                                                                                      | Origem no monólito                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `/core`      | `DomainError`/`DomainErrorKind`, `DomainEvent`, `UseCase`, `EntityNotFoundError`, `NotOwnedByUserError`, `DomainExceptionFilter`, **`CoreModule`** (filtro global)                                                                           | `src/shared/{domain,application}`                |
| `/auth`      | `AuthenticatedUser`, `Role` (inclui `SERVICO`), `Cpf`, `JwtStrategy`, `JwtAuthGuard`, `RolesGuard`, `@Public`, `@Roles`, `@CurrentUser`, **`AuthModule.forRoot/forRootAsync`**                                                               | `src/auth/` (só a parte de validação — US-F3-03) |
| `/logging`   | **`LoggerModule.forRoot/forRootAsync`** (pino JSON, redação, `correlationId`/`traceId` em toda linha), `CorrelationIdMiddleware`, `getCorrelationId`, `tracer-bridge`, `maskCpfCnpj`, `redactSensitiveText`                                  | `src/shared/infrastructure/logging`              |
| `/metrics`   | `registry` (singleton), `httpDuration`, **`MetricsModule.forRoot({ serviceName })`** (`/metrics` + interceptor), `iniciarTracing`                                                                                                            | `src/observabilidade/`                           |
| `/health`    | **`HealthModule.forRoot({ indicators })`**, `HealthIndicator`                                                                                                                                                                                | `src/health/` (indicador Prisma fica no serviço) |
| `/http`      | **`HttpInternoModule.forRoot/forRootAsync`**, `ClienteHttpInterno` (`post/get/delete` com JWT de serviço, correlação, timeout e retry), `HttpInternoError`, `EnvelopeHttp`/`criarEnvelopeHttp`/`validarEnvelopeHttp`, `emitirTokenDeServico` | novo (Fase 4, 03/11/2026)                        |
| `/messaging` | `DomainEventPublisher` (porta), `DOMAIN_EVENT_PUBLISHER`, `EventEmitterDomainEventPublisher`, **`InProcessMessagingModule`** — o restante (SNS/SQS/outbox) está **descontinuado**                                                            | `src/shared/shared.module.ts`                    |
| `/testing`   | `mintToken` (reproduz o JWT da Lambda), `mintServiceToken` (JWT de serviço), `FakeDomainEventPublisher`                                                                                                                                      | `src/auth/testing/`                              |

A raiz (`@guilhermeqmaia/oficina-kit`) reexporta tudo exceto `/testing`.

## Uso num serviço

```ts
// main.ts — tracing ANTES de qualquer import do Nest
import { iniciarTracing } from '@guilhermeqmaia/oficina-kit/metrics';
iniciarTracing({ service: 'billing-service' });

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
const app = await NestFactory.create(AppModule, { bufferLogs: true });
app.useLogger(app.get(Logger));
```

```ts
// app.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CoreModule } from '@guilhermeqmaia/oficina-kit/core';
import { AuthModule } from '@guilhermeqmaia/oficina-kit/auth';
import { CorrelationIdMiddleware, LoggerModule } from '@guilhermeqmaia/oficina-kit/logging';
import { MetricsModule } from '@guilhermeqmaia/oficina-kit/metrics';
import { HealthModule } from '@guilhermeqmaia/oficina-kit/health';
import { InProcessMessagingModule } from '@guilhermeqmaia/oficina-kit/messaging';

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRoot({ serviceName: 'billing-service' }),
    AuthModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (c) => ({ secret: c.getOrThrow('JWT_SECRET') }),
    }),
    MetricsModule.forRoot({ serviceName: 'billing-service' }),
    HealthModule.forRoot({ imports: [PrismaModule], indicators: [PrismaHealthIndicator] }),
    InProcessMessagingModule,
    // ...módulos de domínio
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
```

```ts
// Indicador de readiness do serviço (ex.: Postgres via Prisma)
@Injectable()
export class PrismaHealthIndicator implements HealthIndicator {
  readonly name = 'database';
  constructor(private readonly prisma: PrismaService) {}
  async check() {
    await this.prisma.$queryRaw`SELECT 1`;
  }
}
```

Métricas de negócio ficam **no serviço**, registradas no `registry` do kit:

```ts
import { Counter } from 'prom-client';
import { registry } from '@guilhermeqmaia/oficina-kit/metrics';
export const osTransicoes = new Counter({
  name: 'oficina_os_transicoes_total',
  help: '...',
  labelNames: ['de', 'para'],
  registers: [registry],
});
```

### Comunicação HTTP entre os serviços (decisão de 03/11/2026 — RFC-0008)

Os serviços conversam por **HTTP direto** pelo DNS interno do cluster (`http://execucao-service:3002`,
`http://billing-service:3001`), sem passar pelo API Gateway. O kit entrega o cliente, o JWT de serviço e o
envelope dos callbacks; a especificação completa (endpoints, respostas = eventos, callbacks, retry,
idempotência) está no hub em [`docs/contratos/http-interno.md`](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/contratos/http-interno.md).

```ts
// app.module.ts — o modulo e GLOBAL: qualquer modulo injeta ClienteHttpInterno sem reimportar
HttpInternoModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (c) => ({
    servico: 'os-service', // `sub` do JWT de servico
    jwtSecret: c.getOrThrow('JWT_SECRET'), // mesmo segredo da Lambda — o destino valida com o AuthModule
    timeoutMs: 5000, // por tentativa (default)
    tentativas: 3, // default; backoff 200 ms, 800 ms, 3 s
  }),
});
```

```ts
// adapter de saida (infrastructure): a resposta sincrona vira o evento da saga
const r = await this.http.post(`${execucaoUrl}/execucao/ordens`, body, { correlationId: numeroOS });
// r.status === 201, r.body === { numeroOS, posicaoFila }  ≙ execucao.enfileirada
try { ... } catch (e) {
  if (e instanceof HttpInternoError && e.status === 409) {
    /* evento de falha: execucao.recusada com e.body.motivo */
  }
}
```

- **Cabeçalhos** em toda chamada: `Authorization: Bearer <JWT role SERVICO, sub = nome do serviço>` (emitido
  localmente com `jsonwebtoken`, cache de 50 min), `x-correlation-id` (o informado ou o do contexto de
  correlação do `logging`), `traceparent` quando há APM ativo.
- **Retry** só para `5xx`, timeout e erro de rede: 3 tentativas com backoff exponencial (200 ms, 800 ms, 3 s).
  `4xx` não se repete (409 = recusa de negócio). Esgotadas as tentativas, `HttpInternoError` traz `status`
  (ausente em timeout/rede), `body` da última resposta e `tentativas`.
- **Callbacks** (`POST /ordens-servico/{numero}/eventos`): corpo = `EnvelopeHttp` (`id` v7, `type`, `version`,
  `occurredAt`, `producer`, `data`) montado com `criarEnvelopeHttp` — sem `correlationId` no corpo (é o
  `{numero}` do path e o cabeçalho). O destino deduplica pelo `id` (`processed_messages`).
- **Autorização**: endpoints internos e callbacks usam `@Roles(Role.SERVICO)`; nos testes, `mintServiceToken`
  (`/testing`) emite o mesmo token.

### Mensageria (descontinuada)

`MessagingModule`, `SnsPublisher`, `SqsConsumer`, outbox e `scripts/messaging-local.sh` (LocalStack) **continuam
no pacote por compatibilidade**, mas não recebem evolução: a mensageria SNS/SQS foi substituída pela comunicação
HTTP acima (RFC-0008). `InProcessMessagingModule` e o `DomainEventPublisher` (eventos de domínio dentro do
processo) continuam válidos e em uso.

### Regras que o kit impõe (e por quê)

- **Uma instância por processo** de `registry`, do `AsyncLocalStorage` de correlação e do `tracer-bridge`: o serviço **nunca** mantém cópias locais desses arquivos — importa do kit. Duplicar quebra a correlação log↔trace silenciosamente.
- `@nestjs/*`, `passport`, `pino`, `prom-client` são **peerDependencies**: o Nest precisa rodar numa única instância de DI para os guards do kit enxergarem os providers do serviço. Verifique com `npm ls @nestjs/core` (um único resultado).
- Variáveis que o kit lê por fallback: `NODE_ENV`, `LOG_LEVEL`, `DD_TRACE_ENABLED`, `DD_SERVICE`, `DD_ENV`, `DD_VERSION`, `JWT_SECRET`/`JWT_ISSUER` (só em `mintToken`). Tudo o mais é parâmetro explícito dos `forRoot`.
- Se o serviço usa `@nestjs/throttler`, exclua `/health` e `/metrics` no `skipIf` do `ThrottlerModule` (o kit não depende do throttler).

## Template de serviço

`templates/service/` é o esqueleto de um microsserviço já ligado ao kit (auth, logs, métricas, health com Prisma, `HttpInternoModule` + URLs dos outros serviços por env, `processed_messages` para dedup de callbacks no schema, Dockerfile, `k8s/` + overlay `k8s-aws/` com NodePort para o NLB único, CI com gate de 80 % e CD para ECR/EKS, Sonar, CODEOWNERS). O CI do kit gera um serviço a cada PR e roda install → lint → typecheck → unitários → e2e → `docker build`, então o template nunca fica para trás.

```bash
scripts/new-service.sh billing ../soat-fiap-oficina-billing-service 3001 30081 "Orçamento, aprovação e pagamento"
#                      <serviço> <destino>                           <porta> <nodePort> "<descrição>"
```

Placeholders substituídos: nome do serviço/repo/banco, porta, NodePort e descrição. As URLs internas dos outros serviços (`OS_SERVICE_URL`, `BILLING_SERVICE_URL`, `EXECUCAO_SERVICE_URL`) já vêm no ConfigMap com o DNS do cluster.

## Desenvolvimento

```bash
npm ci
npm run typecheck && npm run lint && npm run format
npm run test:cov        # gate de 80% (jest.config.js)
npm run pack:smoke      # build + npm pack + instala o tarball num projeto vazio e importa os 9 subpaths
```

## Publicação

1. Atualize `CHANGELOG.md` e a `version` do `package.json` (SemVer: campo novo opcional = minor; quebra = major).
2. Merge na `main` e crie a tag: `git tag v0.1.0 && git push origin v0.1.0`.
3. O workflow [`release.yml`](.github/workflows/release.yml) valida tag == versão, roda os testes e publica com `--provenance`.

A primeira publicação usa o secret `NPM_TOKEN`. Depois que o pacote existir no registry, ative **Trusted Publishing** na página do pacote (_Settings → Publishing access → GitHub Actions_, repositório `guilhermeqmaia/soat-fiap-oficina-kit`, workflow `release.yml`) e remova o token — o `id-token: write` do workflow já está pronto para isso.

## Roadmap

- Testes de contrato (US-F4-15) sobre os endpoints/callbacks HTTP da `docs/contratos/http-interno.md`.
- Remoção definitiva do módulo `messaging` (SNS/SQS) numa versão major.

## Histórias

[US-F4-01 — Kit compartilhado](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-01-kit-compartilhado.md) · [US-F4-15 — Testes de contrato](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/user-stories/f4-15-testes-de-contrato.md)
