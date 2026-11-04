# **REPO**

[![CI](https://github.com/guilhermeqmaia/__REPO__/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/guilhermeqmaia/__REPO__/actions/workflows/ci.yml) [![CD AWS](https://github.com/guilhermeqmaia/__REPO__/actions/workflows/cd-aws.yml/badge.svg)](https://github.com/guilhermeqmaia/__REPO__/actions/workflows/cd-aws.yml)

****DESCRICAO**** — microsserviço do Sistema da Oficina Mecânica (Tech Challenge FIAP, Fase 4). Gerado pelo template do [`@guilhermeqmaia/oficina-kit`](https://github.com/guilhermeqmaia/soat-fiap-oficina-kit).

> Planejamento, RFCs/ADRs, contratos de eventos (AsyncAPI) e diagramas: [hub](https://github.com/guilhermeqmaia/soat-fiap-oficina-os-service/blob/main/docs/plano-execucao-fase-4.md).

## Responsabilidades

<!-- bounded contexts que este serviço POSSUI e o que ele NÃO possui -->

## Endpoints internos e callbacks

<!-- o que este servico expoe para os outros (role SERVICO) e que callbacks envia ao OS Service —
     ver docs/contratos/http-interno.md no hub -->

## Execução local

```bash
cp .env.example .env
npm ci && npx prisma generate
npm run docker:up                 # Postgres próprio
npx prisma migrate deploy
npm run start:dev                 # http://localhost:__PORT__/api (Swagger)
```

Token para testar: a Lambda de auth (`POST {gateway}/auth`) ou, localmente, `mintToken` do kit (`@guilhermeqmaia/oficina-kit/testing`) com o mesmo `JWT_SECRET`. Endpoints internos/callbacks (`@Roles(Role.SERVICO)`) aceitam o JWT de serviço: `mintServiceToken({ servico: 'os-service' })`.

Os outros serviços são alcançados por HTTP direto (`ClienteHttpInterno` do kit): `OS_SERVICE_URL`, `BILLING_SERVICE_URL`, `EXECUCAO_SERVICE_URL` (defaults em `localhost`; no cluster, o DNS interno do ConfigMap).

## Testes e qualidade

```bash
npm run test:unit:cov        # gate 80% (jest.unit.config.js)
npm run test:integration     # e2e com Postgres via testcontainers
```

<!-- Evidências de cobertura: badge do SonarCloud + print em docs/evidencias/ -->

## Deploy

CD automático (`cd-aws.yml`): `homolog` → homologação, `main` → produção. Build → ECR → EKS (`k8s-aws/`) → migrations → smoke.

| Secret/var do repo                      | Uso                                                        |
| --------------------------------------- | ---------------------------------------------------------- |
| `AWS_ROLE_ARN` (secret)                 | OIDC da role `github-actions-oficina`                      |
| `EKS_CLUSTER_NAME`, `AWS_REGION` (vars) | cluster alvo                                               |
| `DB_SECRET_ID` (var)                    | segredo do banco **próprio** no Secrets Manager (infra-db) |
| `JWT_SECRET_ID` (var)                   | segredo HS256 compartilhado com a Lambda                   |

O Service expõe o **NodePort `__NODE_PORT__`**, alvo do target group deste serviço no NLB interno único (ADR-0013).

## Arquitetura do serviço

```mermaid
flowchart LR
  GW[API Gateway] -->|/__SERVICE__*| S[__SERVICE_NAME__]
  S --> DB[(Postgres __DB_NAME__)]
  OS[OS Service] -->|HTTP interno + JWT de serviço| S
  S -->|callback POST /ordens-servico/:n/eventos| OS
```
