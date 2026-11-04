import jwt from 'jsonwebtoken';
import { EmissorTokenServico, emitirTokenDeServico, TOKEN_SERVICO_CACHE_MS } from './service-token';
import { mintServiceToken } from '../testing/token-factory';

const SECRET = 'segredo-servico';

describe('token de servico', () => {
  it('emitirTokenDeServico: role SERVICO, sub = servico, iss da Lambda, 1 h', () => {
    const token = emitirTokenDeServico('billing-service', { secret: SECRET });
    const claims = jwt.verify(token, SECRET) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      sub: 'billing-service',
      role: 'SERVICO',
      nome: 'billing-service',
      iss: 'oficina-auth-lambda',
    });
    expect(claims.exp! - claims.iat!).toBe(3600);
    expect(() => emitirTokenDeServico('os-service', { secret: '' })).toThrow(/JWT_SECRET/);
  });

  it('aceita issuer e expiresIn proprios', () => {
    const token = emitirTokenDeServico('os-service', {
      secret: SECRET,
      issuer: 'outro',
      expiresIn: 60,
    });
    const claims = jwt.verify(token, SECRET, { issuer: 'outro' }) as jwt.JwtPayload;
    expect(claims.exp! - claims.iat!).toBe(60);
  });

  it('EmissorTokenServico guarda o token por 50 min e renova depois (ou ao invalidar)', () => {
    const sign = jest.spyOn(jwt, 'sign');
    const emissor = new EmissorTokenServico('execucao-service', { secret: SECRET });
    const t0 = Date.now();
    const a = emissor.token(t0);
    const b = emissor.token(t0 + 1000);
    expect(a).toBe(b);
    expect(sign).toHaveBeenCalledTimes(1);
    emissor.token(t0 + TOKEN_SERVICO_CACHE_MS + 1);
    expect(sign).toHaveBeenCalledTimes(2);
    emissor.invalidar();
    emissor.token(t0);
    expect(sign).toHaveBeenCalledTimes(3);
    sign.mockRestore();
  });

  it('mintServiceToken (testing) usa JWT_SECRET do ambiente e o mesmo contrato', () => {
    const token = mintServiceToken({ servico: 'os-service' });
    const claims = jwt.verify(token, process.env.JWT_SECRET!) as jwt.JwtPayload;
    expect(claims).toMatchObject({ sub: 'os-service', role: 'SERVICO' });
    const proprio = mintServiceToken(
      { servico: 'billing-service' },
      { secret: SECRET, issuer: 'x' },
    );
    expect((jwt.decode(proprio) as jwt.JwtPayload).iss).toBe('x');
    const antigo = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => mintServiceToken({ servico: 'os-service' })).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = antigo;
  });
});
