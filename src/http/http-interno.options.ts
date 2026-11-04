import type { ModuleMetadata } from '@nestjs/common';

/** Nomes dos servicos que falam entre si (mesmos `producer` do AsyncAPI). */
export type NomeServico = 'os-service' | 'billing-service' | 'execucao-service' | (string & {});

export interface HttpInternoOptions {
  /** Nome DESTE servico: vira o `sub` do JWT de servico (`Authorization`). */
  readonly servico: NomeServico;
  /** Mesmo segredo HS256 da Lambda (`JWT_SECRET`): o destino valida com o `AuthModule` do kit. */
  readonly jwtSecret: string;
  /** `iss` do token de servico. Default: o da Lambda (`oficina-auth-lambda`), que e o que o `AuthModule` aceita. */
  readonly issuer?: string;
  /** Timeout por tentativa. Default 5000 ms. */
  readonly timeoutMs?: number;
  /** Tentativas por chamada (so para 5xx / timeout / erro de rede). Default 3. */
  readonly tentativas?: number;
  /** Espera antes de cada nova tentativa. Default `[200, 800, 3000]` (exponencial). */
  readonly backoffMs?: readonly number[];
}

export interface HttpInternoAsyncOptions extends Pick<ModuleMetadata, 'imports'> {
  readonly inject?: any[];
  readonly useFactory: (...args: any[]) => HttpInternoOptions | Promise<HttpInternoOptions>;
}

export const HTTP_INTERNO_OPTIONS = Symbol('HTTP_INTERNO_OPTIONS');

export const HTTP_INTERNO_DEFAULTS = {
  timeoutMs: 5000,
  tentativas: 3,
  backoffMs: [200, 800, 3000] as readonly number[],
} as const;
