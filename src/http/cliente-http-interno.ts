import { Inject, Injectable, Logger } from '@nestjs/common';
import { getCorrelationId } from '../logging/correlation-context';
import { getActiveTraceIds } from '../logging/tracer-bridge';
import { traceparentDe } from '../messaging/envelope';
import {
  HTTP_INTERNO_DEFAULTS,
  HTTP_INTERNO_OPTIONS,
  HttpInternoOptions,
} from './http-interno.options';
import { EmissorTokenServico } from './service-token';

export type MetodoHttpInterno = 'GET' | 'POST' | 'DELETE';

export interface OpcoesChamadaInterna {
  /** Default: `correlationId` do contexto da requisicao corrente (kit `logging`). */
  readonly correlationId?: string;
  /** Cabecalhos extras (nao sobrescrevem os de autenticacao/correlacao). */
  readonly headers?: Record<string, string>;
  /** Sobrescreve o timeout por tentativa desta chamada. */
  readonly timeoutMs?: number;
}

export interface RespostaHttpInterna<T = unknown> {
  readonly status: number;
  readonly body: T;
  readonly headers: Headers;
}

/**
 * Falha de uma chamada interna. `status` ausente = timeout ou erro de rede
 * (esgotadas as tentativas); `status` presente = resposta nao-2xx (4xx na
 * primeira tentativa, 5xx apos esgotar as tentativas). `body` e o corpo da
 * ultima resposta (ex.: `{ motivo }` de um 409).
 */
export class HttpInternoError extends Error {
  constructor(
    message: string,
    readonly metodo: MetodoHttpInterno,
    readonly url: string,
    readonly status: number | undefined,
    readonly body: unknown,
    readonly tentativas: number,
    readonly causa?: unknown,
  ) {
    super(message);
    this.name = 'HttpInternoError';
  }

  /** `true` quando a falha foi de transporte/5xx (o destino pode nao ter recebido). */
  get transitoria(): boolean {
    return this.status === undefined || this.status >= 500;
  }
}

/**
 * Cliente HTTP para chamadas ENTRE servicos (decisao de 03/11/2026: HTTP direto
 * no lugar de SNS/SQS). Usa o `fetch` nativo do Node e, em toda chamada:
 * - `Authorization: Bearer <JWT de servico>` (emitido localmente, cache de 50 min);
 * - `x-correlation-id` (numero da OS) e `traceparent` quando ha APM ativo;
 * - timeout por tentativa (5 s) e ate 3 tentativas com backoff exponencial
 *   (200 ms, 800 ms, 3 s) SOMENTE para 5xx / timeout / erro de rede — 4xx e
 *   resposta de negocio (409 = recusado) e nao se repete.
 */
@Injectable()
export class ClienteHttpInterno {
  private readonly logger = new Logger(ClienteHttpInterno.name);
  private readonly emissor: EmissorTokenServico;
  private readonly timeoutMs: number;
  private readonly tentativas: number;
  private readonly backoffMs: readonly number[];

  constructor(@Inject(HTTP_INTERNO_OPTIONS) private readonly options: HttpInternoOptions) {
    if (!options?.jwtSecret) {
      throw new Error('HttpInternoModule: `jwtSecret` e obrigatorio (JWT_SECRET compartilhado).');
    }
    if (!options.servico) {
      throw new Error('HttpInternoModule: `servico` e obrigatorio (nome deste servico).');
    }
    this.emissor = new EmissorTokenServico(options.servico, {
      secret: options.jwtSecret,
      issuer: options.issuer,
    });
    this.timeoutMs = options.timeoutMs ?? HTTP_INTERNO_DEFAULTS.timeoutMs;
    this.tentativas = Math.max(1, options.tentativas ?? HTTP_INTERNO_DEFAULTS.tentativas);
    this.backoffMs =
      options.backoffMs && options.backoffMs.length > 0
        ? options.backoffMs
        : HTTP_INTERNO_DEFAULTS.backoffMs;
  }

  post<T = unknown>(
    url: string,
    body?: unknown,
    opcoes: OpcoesChamadaInterna = {},
  ): Promise<RespostaHttpInterna<T>> {
    return this.requisitar<T>('POST', url, body, opcoes);
  }

  get<T = unknown>(
    url: string,
    opcoes: OpcoesChamadaInterna = {},
  ): Promise<RespostaHttpInterna<T>> {
    return this.requisitar<T>('GET', url, undefined, opcoes);
  }

  delete<T = unknown>(
    url: string,
    body?: unknown,
    opcoes: OpcoesChamadaInterna = {},
  ): Promise<RespostaHttpInterna<T>> {
    return this.requisitar<T>('DELETE', url, body, opcoes);
  }

  /** Cabecalhos que toda chamada interna leva (exposto para quem precisa compor a chamada manualmente). */
  cabecalhos(opcoes: OpcoesChamadaInterna = {}, comCorpo = false): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json', ...opcoes.headers };
    if (comCorpo) headers['content-type'] = 'application/json';
    headers.authorization = `Bearer ${this.emissor.token()}`;
    const correlationId = opcoes.correlationId ?? getCorrelationId();
    if (correlationId) headers['x-correlation-id'] = correlationId;
    const trace = getActiveTraceIds();
    if (trace) headers.traceparent = traceparentDe(trace.traceId, trace.spanId);
    return headers;
  }

  private async requisitar<T>(
    metodo: MetodoHttpInterno,
    url: string,
    body: unknown,
    opcoes: OpcoesChamadaInterna,
  ): Promise<RespostaHttpInterna<T>> {
    const timeoutMs = opcoes.timeoutMs ?? this.timeoutMs;
    const comCorpo = body !== undefined;
    for (let tentativa = 1; ; tentativa++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: metodo,
          headers: this.cabecalhos(opcoes, comCorpo),
          body: comCorpo ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });
        const corpo = await lerCorpo(res);
        if (res.ok) return { status: res.status, body: corpo as T, headers: res.headers };
        if (res.status >= 500 && tentativa < this.tentativas) {
          await this.aguardarRetentativa(metodo, url, tentativa, `HTTP ${res.status}`);
          continue;
        }
        throw new HttpInternoError(
          `${metodo} ${url} respondeu ${res.status} (tentativa ${tentativa}/${this.tentativas})`,
          metodo,
          url,
          res.status,
          corpo,
          tentativa,
        );
      } catch (e) {
        if (e instanceof HttpInternoError) throw e;
        const timeout = (e as { name?: string })?.name === 'AbortError';
        const motivo = timeout ? `timeout de ${timeoutMs} ms` : `erro de rede: ${mensagem(e)}`;
        if (tentativa < this.tentativas) {
          await this.aguardarRetentativa(metodo, url, tentativa, motivo);
          continue;
        }
        throw new HttpInternoError(
          `${metodo} ${url} falhou: ${motivo} (tentativa ${tentativa}/${this.tentativas})`,
          metodo,
          url,
          undefined,
          undefined,
          tentativa,
          e,
        );
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private async aguardarRetentativa(
    metodo: MetodoHttpInterno,
    url: string,
    tentativa: number,
    motivo: string,
  ): Promise<void> {
    const ms = this.backoffMs[Math.min(tentativa - 1, this.backoffMs.length - 1)];
    this.logger.warn({
      msg: 'chamada interna falhou — nova tentativa',
      metodo,
      url,
      tentativa,
      motivo,
      aguardarMs: ms,
    });
    await this.aguardar(ms);
  }

  /** Separado para os testes nao esperarem o backoff real. */
  protected aguardar(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

async function lerCorpo(res: Response): Promise<unknown> {
  const texto = await res.text();
  if (!texto) return undefined;
  const tipo = res.headers.get('content-type') ?? '';
  if (tipo.includes('json')) {
    try {
      return JSON.parse(texto);
    } catch {
      return texto;
    }
  }
  return texto;
}

function mensagem(e: unknown): string {
  const err = e as { cause?: { message?: string; code?: string }; message?: string };
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(e);
}
