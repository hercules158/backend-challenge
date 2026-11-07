import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthCheckResult,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { EntityManager } from '@mikro-orm/postgresql';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly em: EntityManager,
  ) {}

  /**
   * GET /health/live
   * Liveness probe: indica se o processo está vivo e respondendo requisições.
   */
  @Get('live')
  @HealthCheck()
  async getLive(): Promise<HealthCheckResult> {
    return this.health.check([
      () => ({
        process: {
          status: 'up',
          uptime: process.uptime(),
          timestamp: new Date().toISOString(),
        },
      }),
    ]);
  }

  /**
   * GET /health/ready
   * Readiness probe: indica se o PostgreSQL (e futuramente SQS) estão alcançáveis.
   */
  @Get('ready')
  @HealthCheck()
  async getReady(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkSqs(),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      // Executa um ping rápido no PostgreSQL
      await this.em.getConnection().execute('SELECT 1');
      return {
        database: {
          status: 'up',
        },
      };
    } catch (error: any) {
      return {
        database: {
          status: 'down',
          message: error?.message || 'Database connection error',
        },
      };
    }
  }

  private async checkSqs(): Promise<HealthIndicatorResult> {
    // Por enquanto retorna UP (ou configurado quando ativarmos o client SQS no passo 3)
    return {
      sqs: {
        status: 'up',
      },
    };
  }
}

