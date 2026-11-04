import { Logger } from '@nestjs/common';
import jwt from 'jsonwebtoken';
import { runWithCorrelation } from '../logging/correlation-context';
import { registrarTracer, resetTracerBridge } from '../logging/tracer-bridge';
import { ClienteHttpInterno, HttpInternoError } from './cliente-http-interno';

const SECRET = 'segredo-de-teste-0123456789';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const texto = (status: number, body = '') => new Response(body || null, { status });

describe('ClienteHttpInterno', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  const originalFetch = global.fetch;
  let cliente: ClienteHttpInterno;
  let aguardar: jest.SpyInstance;

  beforeAll(() => {
    Logger.overrideLogger(false);
  });
  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
    cliente = new ClienteHttpInterno({ servico: 'os-service', jwtSecret: SECRET });
    aguardar = jest
      .spyOn(cliente as unknown as { aguardar: (ms: number) => Promise<void> }, 'aguardar')
      .mockResolvedValue(undefined);
  });
  afterAll(() => {
    global.fetch = originalFetch;
    resetTracerBridge();
  });

  it('exige jwtSecret e servico', () => {
    expect(() => new ClienteHttpInterno({ servico: 'os-service', jwtSecret: '' })).toThrow(
      /jwtSecret/,
    );
    expect(() => new ClienteHttpInterno({ servico: '', jwtSecret: SECRET })).toThrow(/servico/);
  });

  it('POST envia JSON com Bearer de servico (role SERVICO, sub = servico), correlacao e devolve o corpo', async () => {
    fetchMock.mockResolvedValueOnce(json(201, { numeroOS: 'OS-1', posicaoFila: 2 }));
    const r = await cliente.post(
      'http://execucao-service:3002/execucao/ordens',
      { numeroOS: 'OS-1' },
      { correlationId: 'OS-1' },
    );
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ numeroOS: 'OS-1', posicaoFila: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://execucao-service:3002/execucao/ordens');
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ numeroOS: 'OS-1' }));
    const headers = init.headers as Record<string, string>;
    expect(headers['content-type']).toBe('application/json');
    expect(headers['x-correlation-id']).toBe('OS-1');
    expect(headers.traceparent).toBeUndefined();
    const token = headers.authorization.replace('Bearer ', '');
    const claims = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      sub: 'os-service',
      role: 'SERVICO',
      iss: 'oficina-auth-lambda',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('herda x-correlation-id do contexto da requisicao e traceparent do APM; GET nao manda corpo', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { ok: true }));
    registrarTracer({
      scope: () => ({
        active: () => ({
          context: () => ({ toTraceId: () => '1', toSpanId: () => '2' }),
          setTag: () => undefined,
        }),
      }),
    });
    await runWithCorrelation({ correlationId: 'OS-9', traceId: 't' }, () =>
      cliente.get('http://billing-service:3001/orcamentos/OS-9', { headers: { 'x-extra': '1' } }),
    );
    resetTracerBridge();
    const [, init] = fetchMock.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
    expect(headers['x-correlation-id']).toBe('OS-9');
    expect(headers['x-extra']).toBe('1');
    expect(headers.traceparent).toBe(`00-${'1'.padStart(32, '0')}-${'2'.padStart(16, '0')}-01`);
  });

  it('reaproveita o token de servico entre chamadas (cache)', async () => {
    fetchMock.mockImplementation(async () => json(200, {}));
    await cliente.get('http://a/1');
    await cliente.get('http://a/2');
    const auth = (i: number) =>
      (fetchMock.mock.calls[i][1].headers as Record<string, string>).authorization;
    expect(auth(0)).toBe(auth(1));
  });

  it('4xx nao repete: lanca HttpInternoError com status, body e tentativas = 1', async () => {
    fetchMock.mockResolvedValueOnce(json(409, { motivo: 'veiculo ja em execucao' }));
    const err = await cliente.post('http://x/execucao/ordens', {}).catch((e) => e);
    expect(err).toBeInstanceOf(HttpInternoError);
    expect(err).toMatchObject({
      status: 409,
      body: { motivo: 'veiculo ja em execucao' },
      tentativas: 1,
      metodo: 'POST',
      url: 'http://x/execucao/ordens',
      transitoria: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(aguardar).not.toHaveBeenCalled();
  });

  it('5xx repete com backoff exponencial (200, 800 ms) e devolve a resposta que deu certo', async () => {
    fetchMock
      .mockResolvedValueOnce(texto(503, 'indisponivel'))
      .mockResolvedValueOnce(texto(502))
      .mockResolvedValueOnce(json(200, { numeroOS: 'OS-1' }));
    const r = await cliente.delete('http://x/execucao/ordens/OS-1', { motivo: 'cancelada' });
    expect(r.body).toEqual({ numeroOS: 'OS-1' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(aguardar.mock.calls.map((c) => c[0])).toEqual([200, 800]);
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify({ motivo: 'cancelada' }));
  });

  it('5xx em todas as tentativas: HttpInternoError transitoria com tentativas = 3 e corpo da ultima resposta', async () => {
    fetchMock.mockImplementation(async () => json(500, { erro: 'boom' }));
    const err = await cliente.post('http://x/orcamentos', { a: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(HttpInternoError);
    expect(err).toMatchObject({
      status: 500,
      body: { erro: 'boom' },
      tentativas: 3,
      transitoria: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('erro de rede repete e, esgotado, lanca sem status (transitoria) guardando a causa', async () => {
    const rede = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    fetchMock.mockRejectedValue(rede);
    const err = await cliente.get('http://nao-existe:1/x').catch((e) => e);
    expect(err).toBeInstanceOf(HttpInternoError);
    expect(err).toMatchObject({ status: undefined, tentativas: 3, transitoria: true, causa: rede });
    expect(err.message).toContain('ECONNREFUSED');
    expect(aguardar.mock.calls.map((c) => c[0])).toEqual([200, 800]);
  });

  it('timeout por tentativa aborta o fetch e conta como falha transitoria', async () => {
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal!.addEventListener('abort', () =>
            reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
          );
        }),
    );
    const rapido = new ClienteHttpInterno({
      servico: 'billing-service',
      jwtSecret: SECRET,
      timeoutMs: 5,
      tentativas: 2,
      backoffMs: [1],
    });
    const err = await rapido.post('http://lento/x', {}).catch((e) => e);
    expect(err).toBeInstanceOf(HttpInternoError);
    expect(err.message).toMatch(/timeout de 5 ms/);
    expect(err.tentativas).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('tentativas configuraveis (1 = sem retry) e backoff usa o ultimo valor quando ha mais tentativas que entradas', async () => {
    const umaVez = new ClienteHttpInterno({
      servico: 'os-service',
      jwtSecret: SECRET,
      tentativas: 1,
    });
    fetchMock.mockImplementation(async () => texto(500));
    await expect(umaVez.get('http://x')).rejects.toMatchObject({ tentativas: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => texto(500));
    const quatro = new ClienteHttpInterno({
      servico: 'os-service',
      jwtSecret: SECRET,
      tentativas: 4,
      backoffMs: [1, 2],
    });
    const espera = jest
      .spyOn(quatro as unknown as { aguardar: (ms: number) => Promise<void> }, 'aguardar')
      .mockResolvedValue(undefined);
    await expect(quatro.get('http://x')).rejects.toMatchObject({ tentativas: 4 });
    expect(espera.mock.calls.map((c) => c[0])).toEqual([1, 2, 2]);
  });

  it('le corpo texto, vazio e JSON invalido sem quebrar', async () => {
    fetchMock
      .mockResolvedValueOnce(texto(200, 'pong'))
      .mockResolvedValueOnce(texto(204))
      .mockResolvedValueOnce(
        new Response('{nao-json', { status: 200, headers: { 'content-type': 'application/json' } }),
      );
    expect((await cliente.get('http://x')).body).toBe('pong');
    expect((await cliente.get('http://x')).body).toBeUndefined();
    expect((await cliente.get('http://x')).body).toBe('{nao-json');
  });

  it('aguardar real espera o tempo pedido', async () => {
    aguardar.mockRestore();
    const inicio = Date.now();
    await (cliente as unknown as { aguardar: (ms: number) => Promise<void> }).aguardar(5);
    expect(Date.now() - inicio).toBeGreaterThanOrEqual(4);
  });
});
