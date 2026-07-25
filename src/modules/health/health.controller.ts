import { Controller, Get, HttpCode, HttpStatus, HttpException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { HealthService } from './health.service';

@ApiTags('health')
@Controller()
export class HealthController {
  public constructor(private readonly healthService: HealthService) {}

  /** Kubernetes liveness probe — is the process alive? */
  @Get('health')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Liveness probe' })
  @ApiResponse({ status: 200, description: 'Application is alive' })
  public liveness(): { status: string; timestamp: string } {
    return this.healthService.getLiveness();
  }

  /** Kubernetes readiness probe — is the app ready to serve traffic? */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  @ApiResponse({ status: 200, description: 'Application is ready' })
  @ApiResponse({ status: 503, description: 'Application is not ready' })
  public async readiness(): Promise<unknown> {
    const health = await this.healthService.getReadiness();
    if (health.status === 'down') {
      throw new HttpException(health, HttpStatus.SERVICE_UNAVAILABLE);
    }
    return health;
  }
}
