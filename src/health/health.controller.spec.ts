import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthIndicator } from './health.indicator';

const ok = (name: string): HealthIndicator => ({ name, check: jest.fn(async () => undefined) });
const falha = (name: string, msg: string): HealthIndicator => ({
  name,
  check: jest.fn(async () => {
    throw new Error(msg);
  }),
});

describe('HealthController', () => {
  it('liveness responde ok com timestamp, uptime e check da app, sem tocar nos indicadores', () => {
    const db = ok('database');
    const result = new HealthController([db]).liveness();

    expect(result.status).toBe('ok');
    expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    expect(typeof result.uptime).toBe('number');
    expect(result.checks?.app.status).toBe('ok');
    expect(db.check).not.toHaveBeenCalled();
  });

  it('readiness responde ready quando todos os indicadores passam', async () => {
    await expect(
      new HealthController([ok('database'), ok('broker')]).readiness(),
    ).resolves.toMatchObject({
      status: 'ready',
      checks: { database: { status: 'ok' }, broker: { status: 'ok' } },
    });
  });

  it('readiness responde ready sem indicadores registrados', async () => {
    await expect(new HealthController().readiness()).resolves.toMatchObject({
      status: 'ready',
      checks: {},
    });
  });

  it('readiness lanca 503 com o detalhe de cada dependencia que falhou', async () => {
    const controller = new HealthController([
      ok('database'),
      falha('broker', 'connection refused'),
    ]);
    const err = await controller.readiness().catch((e) => e);

    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(err.getResponse()).toMatchObject({
      status: 'not-ready',
      checks: {
        database: { status: 'ok' },
        broker: { status: 'error', message: 'connection refused' },
      },
    });
  });
});
