import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
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
  private readonly maxWaitMs: number;

  public constructor(
    private readonly auditRepository: AuditRepository,
    private readonly queueService: QueueService,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.log = this.loggerService.child('AuditService');
    this.requestTimeout = this.configService.get<number>('http.REQUEST_TIMEOUT', 20000);
    this.maxWaitMs = this.requestTimeout + 15000; // Buffer for queue + processing
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
        `Audit for ${url} did not complete within ${this.maxWaitMs}ms`,
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
    jobId: string,
  ): Promise<AuditResult | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkInterval: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      // Event listener for job completion
      const onAuditComplete = (data: { url: string; result: AuditResult }) => {
        if (data.url === url) {
          cleanup();
          this.log.debug({ jobId, url }, 'Audit job completed via event');
          resolve(data.result);
        }
      };

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.eventEmitter.off('audit.completed', onAuditComplete);
      };

      // Subscribe to job completion event
      this.eventEmitter.on('audit.completed', onAuditComplete);

      // Fallback: Periodic polling (cheaper than continuous polling)
      checkInterval = setInterval(async () => {
        const result = await this.auditRepository.findCachedAudit(url);
        if (result) {
          cleanup();
          this.log.debug({ jobId, url }, 'Audit job completed via fallback polling');
          resolve(result);
        }
      }, 1000); // Check every 1 second instead of aggressive polling

      // Hard timeout
      timeoutHandle = setTimeout(() => {
        cleanup();
        this.log.warn(
          { jobId, url, elapsedMs: Date.now() - startTime },
          'Audit job wait timeout',
        );
        resolve(null);
      }, this.maxWaitMs);
    });
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
