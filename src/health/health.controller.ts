import { Controller, Get, Inject, Optional, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/infrastructure/decorators/public.decorator';
import { HEALTH_INDICATORS, HealthIndicator } from './health.indicator';

export interface HealthResult {
  status: 'ok' | 'ready' | 'not-ready';
  timestamp: string;
  uptime: number;
  checks?: Record<string, { status: 'ok' | 'error'; message?: string }>;
}

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @Optional() @Inject(HEALTH_INDICATORS) private readonly indicators: HealthIndicator[] = [],
  ) {}

  @Get()
  @Public()
  @ApiOperation({ summary: 'Liveness probe - o processo esta de pe' })
  @ApiOkResponse({ description: 'Aplicacao respondendo' })
  liveness(): HealthResult {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks: { app: { status: 'ok' } },
    };
  }

  @Get('ready')
  @Public()
  @ApiOperation({ summary: 'Readiness probe - verifica as dependencias (banco, broker...)' })
  @ApiOkResponse({ description: 'Dependencias acessiveis' })
  @ApiResponse({ status: 503, description: 'Alguma dependencia inacessivel' })
  async readiness(): Promise<HealthResult> {
    const checks: NonNullable<HealthResult['checks']> = {};
    let healthy = true;
    for (const indicator of this.indicators) {
      try {
        await indicator.check();
        checks[indicator.name] = { status: 'ok' };
      } catch (err) {
        healthy = false;
        checks[indicator.name] = {
          status: 'error',
          message: err instanceof Error ? err.message : 'unknown',
        };
      }
    }
    const result: HealthResult = {
      status: healthy ? 'ready' : 'not-ready',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      checks,
    };
    if (!healthy) throw new ServiceUnavailableException(result);
    return result;
  }
}
