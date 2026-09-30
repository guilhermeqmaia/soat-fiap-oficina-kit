# soat-fiap-oficina-kit

Pacote **`@soat-fiap/oficina-kit`** (npm, GitHub Packages) — o que é comum aos microsserviços da Oficina Mecânica e **não é domínio**: autenticação como resource server (JWT da Lambda), logs JSON com correlação, `/metrics` e `/health`, mensageria SNS/SQS com envelope padrão, **outbox transacional**, **consumidor idempotente**, schemas dos eventos e um **template de serviço**.

> Repositório 7 de 7. Decisões em [ADR-0009 (outbox + idempotência)](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/arquitetura/adr/ADR-0009-outbox-e-consumidor-idempotente.md) e [ADR-0010 (kit compartilhado)](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/arquitetura/adr/ADR-0010-kit-compartilhado.md). Contratos: [`docs/contratos/asyncapi.yaml`](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/contratos/asyncapi.yaml).

## Histórias

- [US-F4-01 — Kit compartilhado](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-01-kit-compartilhado.md)
- [US-F4-15 — Testes de contrato dos eventos](https://github.com/guilhermeqmaia/soat-fiap-oficina-mecanica-app/blob/main/docs/user-stories/f4-15-testes-de-contrato.md)

## Estado

Bootstrap — primeira história da Onda 1.
