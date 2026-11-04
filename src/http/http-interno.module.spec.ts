import 'reflect-metadata';
import { Controller, Get, INestApplication, Injectable, Module } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuthModule } from '../auth/auth.module';
import { Roles } from '../auth/infrastructure/decorators/roles.decorator';
import { Role } from '../auth/domain/role.enum';
import { CurrentUser } from '../auth/infrastructure/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/domain/authenticated-user';
import { mintServiceToken, mintToken } from '../testing/token-factory';
import { ClienteHttpInterno } from './cliente-http-interno';
import { HttpInternoModule } from './http-interno.module';
import { HTTP_INTERNO_OPTIONS, HttpInternoOptions } from './http-interno.options';

const SECRET = 'segredo-http-interno';

@Injectable()
class Config {
  readonly jwtSecret = SECRET;
}

@Controller('interno')
class InternoController {
  constructor(private readonly http: ClienteHttpInterno) {}
  @Get('eventos')
  @Roles(Role.SERVICO)
  eventos(@CurrentUser() user: AuthenticatedUser) {
    return { de: user.id, role: user.role, cliente: this.http.constructor.name };
  }
}

@Module({ providers: [Config], exports: [Config] })
class ConfigModule {}

/** Modulo de dominio que injeta o cliente SEM importar o HttpInternoModule (global). */
@Module({ controllers: [InternoController] })
class DominioModule {}

@Module({
  imports: [
    AuthModule.forRoot({ secret: SECRET }),
    HttpInternoModule.forRootAsync({
      imports: [ConfigModule],
      inject: [Config],
      useFactory: (c: Config) => ({ servico: 'os-service', jwtSecret: c.jwtSecret, tentativas: 2 }),
    }),
    DominioModule,
  ],
})
class AppModule {}

describe('HttpInternoModule', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const ref = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = ref.createNestApplication({ logger: false });
    await app.init();
  });
  afterAll(() => app.close());

  it('forRootAsync prove opcoes e ClienteHttpInterno globalmente', () => {
    expect(app.get<HttpInternoOptions>(HTTP_INTERNO_OPTIONS)).toMatchObject({
      servico: 'os-service',
      tentativas: 2,
    });
    expect(app.get(ClienteHttpInterno)).toBeInstanceOf(ClienteHttpInterno);
  });

  it('@Roles(SERVICO) aceita o token de servico e recusa usuarios (403) e sem token (401)', async () => {
    await request(app.getHttpServer()).get('/interno/eventos').expect(401);
    await request(app.getHttpServer())
      .get('/interno/eventos')
      .set(
        'Authorization',
        `Bearer ${mintToken({ sub: 'u1', role: Role.ADMIN }, { secret: SECRET })}`,
      )
      .expect(403);
    await request(app.getHttpServer())
      .get('/interno/eventos')
      .set(
        'Authorization',
        `Bearer ${mintServiceToken({ servico: 'billing-service' }, { secret: SECRET })}`,
      )
      .expect(200, { de: 'billing-service', role: 'SERVICO', cliente: 'ClienteHttpInterno' });
  });

  it('forRoot sincrono tambem registra o cliente', async () => {
    const ref = await Test.createTestingModule({
      imports: [HttpInternoModule.forRoot({ servico: 'execucao-service', jwtSecret: SECRET })],
    }).compile();
    expect(ref.get(ClienteHttpInterno)).toBeDefined();
  });
});
