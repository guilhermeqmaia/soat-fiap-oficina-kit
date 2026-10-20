import { Histogram, Registry, collectDefaultMetrics } from 'prom-client';

/**
 * Registry unico de metricas no formato OpenMetrics/Prometheus (US-F3-10).
 * UMA instancia por processo — os servicos registram suas metricas de negocio
 * aqui (`registers: [registry]`) e nunca criam outro registry.
 *
 * Formato agnostico de fornecedor: o agente do Datadog faz scrape via
 * OpenMetrics e um Prometheus/Grafana consome o mesmo endpoint (ADR-0004).
 */
export const registry = new Registry();

// CPU, memoria, event loop e GC do processo.
collectDefaultMetrics({ register: registry, prefix: 'oficina_' });

/** Latencia HTTP por rota — base dos p50/p95/p99. */
export const httpDuration = new Histogram({
  name: 'oficina_http_request_duration_seconds',
  help: 'Duracao das requisicoes HTTP por rota, metodo e status',
  labelNames: ['method', 'route', 'status'] as const,
  // Faixas em torno dos SLOs da suite perf/ (p95 < 500ms leitura, < 800ms escrita).
  buckets: [0.025, 0.05, 0.1, 0.25, 0.5, 0.8, 1.5, 3, 5],
  registers: [registry],
});

/**
 * Label `service` em TODAS as series do processo — e o que separa os
 * microsservicos num mesmo dashboard (ADR-0010).
 */
export function definirServico(serviceName: string): void {
  registry.setDefaultLabels({ service: serviceName });
}
