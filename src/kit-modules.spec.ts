import 'reflect-metadata';
import { Controller, Get, INestApplication, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from './auth/auth.module';
import { Public } from './auth/infrastructure/decorators/public.decorator';
import { Roles } from './auth/infrastructure/decorators/roles.decorator';
import { CurrentUser } from './auth/infrastructure/decorators/current-user.decorator';
import { AuthenticatedUser } from './auth/domain/authenticated-user';
import { Role } from './auth/domain/role.enum';
import { CoreModule } from './core/core.module';
import { EntityNotFoundError } from './core/domain/entity-not-found.error';
import { HealthModule } from './health/health.module';
import { HealthIndicator } from './health/health.indicator';
import { LoggerModule } from './logging/logger.module';
import { MetricsModule } from './metrics/metrics.module';
import { InProcessMessagingModule } from './messaging/in-process-messaging.module';
import {
  DOMAIN_EVENT_PUBLISHER,
  DomainEventPublisher,
} from './core/application/domain-event-publisher';
import { DomainEvent } from './core/domain/domain-event';
import { mintToken } from './testing/token-factory';
import { FakeDomainEventPublisher } from './testing/fake-domain-event-publisher';

/**
 * Teste de integracao do kit como um servico o consumiria: todos os modulos
 * `forRoot` juntos num Nest real, exercitando guards, filtro, health, metrics
 * e messaging ponta a ponta por HTTP.
 */
const SECRET = 'kit-e2e-secret';

@Injectable()
class BrokerOk implements HealthIndicator {
  readonly name = 'broker';
  async check(): Promise<void> {}
}

class PingEvent extends DomainEvent {
  readonly eventName = 'ping';
}

@Controller('t')
class TestController {
  constructor(private readonly publisher: FakeDomainEventPublisher) {}
  @Get('public') @Public() publico() {
    return { ok: true };
  }
  @Get('me') me(@CurrentUser() user: AuthenticatedUser) {
    return { id: user.id, role: user.role };
  }
  @Get('admin') @Roles(Role.ADMIN) admin() {
    return { admin: true };
  }
  @Get('nao-existe') naoExiste() {
    throw new EntityNotFoundError('Coisa', '42');
  }
  @Get('publica-evento') @Public() publica() {
    this.publisher.publish(new PingEvent());
    return { publicados: this.publisher.publicados.length };
  }
}

@Module({
  imports: [
    CoreModule,
    LoggerModule.forRoot({ serviceName: 'kit-e2e', nodeEnv: 'test' }),
    AuthModule.forRootAsync({ useFactory: () => ({ secret: SECRET }) }),
    MetricsModule.forRoot({ serviceName: 'kit-e2e' }),
    HealthModule.forRoot({ indicators: [BrokerOk] }),
    InProcessMessagingModule,
  ],
  controllers: [TestController],
  providers: [FakeDomainEventPublisher],
})
class TestAppModule {}

describe('kit — modulos integrados num Nest real', () => {
  let app: INestApplication;
  const token = (role: Role) => `Bearer ${mintToken({ sub: 'u1', role }, { secret: SECRET })}`;

  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [TestAppModule] }).compile();
    app = ref.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('rotas @Public passam sem token; demais exigem JWT valido', async () => {
    await request(app.getHttpServer()).get('/t/public').expect(200);
    await request(app.getHttpServer()).get('/t/me').expect(401);
    await request(app.getHttpServer())
      .get('/t/me')
      .set('Authorization', token(Role.CLIENTE))
      .expect(200, { id: 'u1', role: 'CLIENTE' });
  });

  it('issuer diferente da Lambda e rejeitado', async () => {
    const t = mintToken({ sub: 'u1', role: Role.ADMIN }, { secret: SECRET, issuer: 'outro' });
    await request(app.getHttpServer()).get('/t/me').set('Authorization', `Bearer ${t}`).expect(401);
  });

  it('@Roles autoriza por claim', async () => {
    await request(app.getHttpServer())
      .get('/t/admin')
      .set('Authorization', token(Role.CLIENTE))
      .expect(403);
    await request(app.getHttpServer())
      .get('/t/admin')
      .set('Authorization', token(Role.ADMIN))
      .expect(200);
  });

  it('DomainError vira HTTP pelo filtro global do CoreModule', async () => {
    const res = await request(app.getHttpServer())
      .get('/t/nao-existe')
      .set('Authorization', token(Role.ADMIN))
      .expect(404);
    expect(res.body.message).toContain("Coisa com identificador '42'");
  });

  it('/health e /health/ready (com indicadores) e /metrics sao publicos', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    const ready = await request(app.getHttpServer()).get('/health/ready').expect(200);
    expect(ready.body.checks).toEqual({ broker: { status: 'ok' } });
    const metrics = await request(app.getHttpServer()).get('/metrics').expect(200);
    expect(metrics.text).toContain('service="kit-e2e"');
  });

  it('InProcessMessagingModule prove a porta DOMAIN_EVENT_PUBLISHER', async () => {
    const publisher = app.get<DomainEventPublisher>(DOMAIN_EVENT_PUBLISHER);
    expect(typeof publisher.publish).toBe('function');
    await request(app.getHttpServer()).get('/t/publica-evento').expect(200, { publicados: 1 });
  });

  it('AuthModule.forRoot exige segredo', async () => {
    await expect(
      Test.createTestingModule({ imports: [AuthModule.forRoot({ secret: '' })] }).compile(),
    ).rejects.toThrow(/secret/);
  });
});
