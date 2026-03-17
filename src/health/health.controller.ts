import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { HealthService, HealthStatus } from './health.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Check application health' })
  @ApiResponse({ status: 200, description: 'Application is healthy' })
  @ApiResponse({ status: 503, description: 'Database is unavailable' })
  @HttpCode(HttpStatus.OK)
  async check(): Promise<HealthStatus> {
    const health = await this.healthService.check();
    if (health.services.database === 'disconnected') {
      throw new ServiceUnavailableException({
        ...health,
        status: 'degraded',
      });
    }
    return health;
  }
}
