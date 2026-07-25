import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuditResult } from '../../common/types';
import { AuditRepository } from './audit.repository';
import { QueueService } from '../../shared/queue/queue.service';
import { LoggerService } from '../../shared/logger/logger.service';
import type { Logger } from 'pino';
import type { AuditResponseDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  private readonly log: Logger;
  private readonly requestTimeout: number;

  public constructor(
    private readonly auditRepository: AuditRepository,
    private readonly queueService: QueueService,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
  ) {
    this.log = this.loggerService.child('AuditService');
    this.requestTimeout = this.configService.get<number>('http.REQUEST_TIMEOUT', 8_000);
  }

  public async auditUrl(
    url: string,
    requestId: string,
  ): Promise<AuditResponseDto> {
    const cached = await this.auditRepository.findCachedAudit(url);
    if (cached) {
      this.log.info({ requestId, url }, 'Cache hit — returning cached audit');
      return {
        success: true,
        requestId,
        cached: true,
        audit: cached,
      };
    }

    this.log.info({ requestId, url }, 'Cache miss — dispatching audit job');
    const jobId = await this.queueService.dispatchAuditJob({
      url,
      requestId,
      timestamp: new Date().toISOString(),
    });

    if (!jobId) {
      throw new QueueFullError('Audit queue is at capacity. Please retry shortly.');
    }

    const result = await this.waitForResult(url, jobId);

    if (!result) {
      throw new AuditTimeoutError(
        `Audit for ${url} did not complete within ${this.requestTimeout}ms`,
      );
    }

    return {
      success: true,
      requestId,
      cached: false,
      audit: result,
    };
  }

  private async waitForResult(
    url: string,
    _jobId: string,
  ): Promise<AuditResult | null> {
    const maxWaitMs = this.requestTimeout + 2_000;
    const startTime = Date.now();
    let pollInterval = 100;
    const maxInterval = 1_000;

    while (Date.now() - startTime < maxWaitMs) {
      const result = await this.auditRepository.findCachedAudit(url);
      if (result) return result;

      await sleep(pollInterval);
      pollInterval = Math.min(pollInterval * 1.5, maxInterval);
    }

    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class QueueFullError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QueueFullError';
  }
}

export class AuditTimeoutError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'AuditTimeoutError';
  }
}
