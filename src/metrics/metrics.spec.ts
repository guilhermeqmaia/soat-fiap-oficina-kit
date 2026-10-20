import { EventEmitter } from 'node:events';
import { lastValueFrom, of, throwError } from 'rxjs';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsController } from './metrics.controller';
import { MetricsModule } from './metrics.module';
import { definirServico, httpDuration, registry } from './metrics.registry';
import { iniciarTracing } from './tracing';
import { getActiveTraceIds, resetTracerBridge } from '../logging/tracer-bridge';

/** Resposta fake que emite `finish` como o Express faz ao encerrar a request. */
class FakeResponse extends EventEmitter {
  constructor(public statusCode: number) {
    super();
  }
  finalizar(status = this.statusCode): void {
    this.statusCode = status;
    this.emit('finish');
  }
}

function httpContext(
  method: string,
  routePath: string | undefined,
  res: FakeResponse,
): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ method, route: routePath ? { path: routePath } : undefined }),
      getResponse: () => res,
    }),
  } as unknown as ExecutionContext;
}

const handler = (obs: unknown): CallHandler => ({ handle: () => obs as never });

beforeEach(() => httpDuration.reset());

describe('MetricsInterceptor', () => {
  it('mede a latencia usando o PADRAO da rota (nao a URL concreta)', async () => {
    const res = new FakeResponse(200);
    await lastValueFrom(
      new MetricsInterceptor().intercept(
        httpContext('GET', '/clientes/:id', res),
        handler(of('ok')),
      ),
    );
    res.finalizar();

    const texto = await registry.metrics();
    expect(texto).toContain('route="/clientes/:id"');
    expect(texto).not.toContain('/clientes/123');
  });

  it('usa o status FINAL da resposta, nao o erro lancado pelo handler', async () => {
    // O handler lanca um erro de dominio; o DomainExceptionFilter responde 404
    // depois. Rotular 500 aqui inflaria os 5xx dos dashboards/alertas.
    const res = new FakeResponse(200);
    await expect(
      lastValueFrom(
        new MetricsInterceptor().intercept(
          httpContext('GET', '/ordens-servico/:numero', res),
          handler(throwError(() => new Error('nao encontrada'))),
        ),
      ),
    ).rejects.toBeDefined();
    res.finalizar(404);

    const texto = await registry.metrics();
    expect(texto).toContain('status="404"');
    expect(texto).not.toContain('status="500"');
  });

  it('rotula "desconhecida" quando a requisicao nao casou com rota', async () => {
    const res = new FakeResponse(404);
    await lastValueFrom(
      new MetricsInterceptor().intercept(httpContext('GET', undefined, res), handler(of(null))),
    );
    res.finalizar();
    expect(await registry.metrics()).toContain('route="desconhecida"');
  });

  it('ignora contextos nao-HTTP (ex.: listeners de evento)', async () => {
    const ctx = { getType: () => 'rpc' } as unknown as ExecutionContext;
    await lastValueFrom(new MetricsInterceptor().intercept(ctx, handler(of('ok'))));
    expect(await registry.metrics()).not.toContain('oficina_http_request_duration_seconds_count{');
  });
});

describe('MetricsController / registry', () => {
  it('expoe o registry no formato de scrape com metricas de processo', async () => {
    const texto = await new MetricsController().scrape();
    expect(texto).toContain('oficina_http_request_duration_seconds');
    expect(texto).toContain('oficina_process_cpu_user_seconds_total');
  });

  it('definirServico aplica o label service em todas as series', async () => {
    definirServico('billing-service');
    const res = new FakeResponse(200);
    await lastValueFrom(
      new MetricsInterceptor().intercept(httpContext('GET', '/x', res), handler(of(1))),
    );
    res.finalizar();
    expect(await registry.metrics()).toMatch(
      /oficina_http_request_duration_seconds_count\{[^}]*service="billing-service"/,
    );
  });

  it('MetricsModule.forRoot registra controller e interceptor e define o servico', async () => {
    const mod = MetricsModule.forRoot({ serviceName: 'execucao-service' });
    expect(mod.controllers).toEqual([MetricsController]);
    expect(mod.providers).toHaveLength(1);
    expect(await registry.metrics()).toContain('service="execucao-service"');
  });
});

describe('iniciarTracing', () => {
  afterEach(() => {
    delete process.env.DD_TRACE_ENABLED;
    resetTracerBridge();
    jest.resetModules();
  });

  it('e no-op sem DD_TRACE_ENABLED=true (nao exige a dependencia)', () => {
    delete process.env.DD_TRACE_ENABLED;
    expect(() => iniciarTracing({ service: 'x' })).not.toThrow();
    expect(getActiveTraceIds()).toBeUndefined();
  });

  it('registra o tracer no bridge quando ligado e o dd-trace esta disponivel', () => {
    process.env.DD_TRACE_ENABLED = 'true';
    const init = jest.fn();
    const span = {
      context: () => ({ toTraceId: () => 't1', toSpanId: () => 's1' }),
      setTag: jest.fn(),
    };
    jest.doMock('dd-trace', () => ({ init, scope: () => ({ active: () => span }) }), {
      virtual: true,
    });

    iniciarTracing({ service: 'os-service', env: 'test', version: '1.2.3' });

    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        service: 'os-service',
        env: 'test',
        version: '1.2.3',
        logInjection: false,
      }),
    );
    expect(getActiveTraceIds()).toEqual({ traceId: 't1', spanId: 's1' });
  });

  it('segue sem tracing quando o dd-trace nao esta instalado', () => {
    process.env.DD_TRACE_ENABLED = 'true';
    jest.doMock(
      'dd-trace',
      () => {
        throw new Error('Cannot find module');
      },
      { virtual: true },
    );
    const stderr = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);

    expect(() => iniciarTracing()).not.toThrow();
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining('APM desabilitado'));
    expect(getActiveTraceIds()).toBeUndefined();
    stderr.mockRestore();
  });
});
