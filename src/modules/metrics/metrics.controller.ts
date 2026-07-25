import { Controller, Get, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  public constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @ApiOperation({ summary: 'Prometheus metrics endpoint' })
  @ApiResponse({ status: 200, description: 'Prometheus text format metrics' })
  public async metrics(@Res() res: Response): Promise<void> {
    const data = await this.metricsService.getMetrics();
    res
      .setHeader('Content-Type', this.metricsService.getContentType())
      .status(200)
      .send(data);
  }
}
