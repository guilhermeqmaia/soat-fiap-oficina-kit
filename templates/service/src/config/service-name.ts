/** Nome deste servico em logs (`service`), metricas (label `service`) e APM. */
export const SERVICE_NAME = process.env.DD_SERVICE ?? '__SERVICE_NAME__';

/**
 * Nome deste servico nas chamadas entre servicos: `sub` do JWT de servico e
 * `producer` dos envelopes de callback (`os-service` | `billing-service` | `execucao-service`).
 */
export const PRODUCER_NAME = '__SERVICE__-service';
