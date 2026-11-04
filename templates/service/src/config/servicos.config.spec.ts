import { httpInternoConfig, urlsDosServicos } from './servicos.config';

describe('urlsDosServicos', () => {
  it('fora de producao usa localhost nas portas convencionadas', () =>
    expect(urlsDosServicos({})).toEqual({
      osServiceUrl: 'http://localhost:3000',
      billingServiceUrl: 'http://localhost:3001',
      execucaoServiceUrl: 'http://localhost:3002',
    }));
  it('em producao usa o DNS do cluster', () =>
    expect(urlsDosServicos({ NODE_ENV: 'production' }).execucaoServiceUrl).toBe(
      'http://execucao-service:3002',
    ));
  it('respeita as variaveis e remove a barra final', () =>
    expect(urlsDosServicos({ BILLING_SERVICE_URL: 'http://b:9/' }).billingServiceUrl).toBe(
      'http://b:9',
    ));
});

describe('httpInternoConfig', () => {
  it('sem variaveis deixa os defaults do kit', () =>
    expect(httpInternoConfig({})).toEqual({ timeoutMs: undefined, tentativas: undefined }));
  it('le timeout e tentativas; ignora valores invalidos', () => {
    expect(
      httpInternoConfig({ HTTP_INTERNO_TIMEOUT_MS: '2000', HTTP_INTERNO_TENTATIVAS: '2' }),
    ).toEqual({
      timeoutMs: 2000,
      tentativas: 2,
    });
    expect(
      httpInternoConfig({ HTTP_INTERNO_TIMEOUT_MS: 'x', HTTP_INTERNO_TENTATIVAS: '0' }),
    ).toEqual({
      timeoutMs: undefined,
      tentativas: undefined,
    });
  });
});
