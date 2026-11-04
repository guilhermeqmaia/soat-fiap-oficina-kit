/**
 * Enderecos internos dos outros servicos (comunicacao HTTP direta, RFC-0008 —
 * `docs/contratos/http-interno.md` no hub). Em producao vem do ConfigMap com o
 * DNS do cluster; fora dele, `localhost` nas portas convencionadas.
 */
export interface UrlsDosServicos {
  readonly osServiceUrl: string;
  readonly billingServiceUrl: string;
  readonly execucaoServiceUrl: string;
}

const DEFAULTS_LOCAL: UrlsDosServicos = {
  osServiceUrl: 'http://localhost:3000',
  billingServiceUrl: 'http://localhost:3001',
  execucaoServiceUrl: 'http://localhost:3002',
};

const DEFAULTS_CLUSTER: UrlsDosServicos = {
  osServiceUrl: 'http://oficina-app:3000',
  billingServiceUrl: 'http://billing-service:3001',
  execucaoServiceUrl: 'http://execucao-service:3002',
};

const semBarra = (url: string) => url.replace(/\/+$/, '');

export function urlsDosServicos(env: NodeJS.ProcessEnv = process.env): UrlsDosServicos {
  const defaults = env.NODE_ENV === 'production' ? DEFAULTS_CLUSTER : DEFAULTS_LOCAL;
  return {
    osServiceUrl: semBarra(env.OS_SERVICE_URL || defaults.osServiceUrl),
    billingServiceUrl: semBarra(env.BILLING_SERVICE_URL || defaults.billingServiceUrl),
    execucaoServiceUrl: semBarra(env.EXECUCAO_SERVICE_URL || defaults.execucaoServiceUrl),
  };
}

/** Timeout por tentativa e numero de tentativas do `ClienteHttpInterno` (defaults do kit: 5 s / 3). */
export function httpInternoConfig(env: NodeJS.ProcessEnv = process.env): {
  timeoutMs?: number;
  tentativas?: number;
} {
  const numero = (v?: string) =>
    v && Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : undefined;
  return {
    timeoutMs: numero(env.HTTP_INTERNO_TIMEOUT_MS),
    tentativas: numero(env.HTTP_INTERNO_TENTATIVAS),
  };
}
