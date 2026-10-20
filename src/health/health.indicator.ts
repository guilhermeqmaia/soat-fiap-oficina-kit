/**
 * Verificacao de readiness de uma dependencia (banco, broker...). O servico
 * registra seus indicadores em `HealthModule.forRoot({ indicators })`; cada um
 * lanca em caso de falha e o `/health/ready` responde 503 com o detalhe.
 */
export interface HealthIndicator {
  readonly name: string;
  check(): Promise<void>;
}

export const HEALTH_INDICATORS = Symbol('HEALTH_INDICATORS');
