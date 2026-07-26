import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { AuditResult } from '../../common/types';
import { QueueFullException, AuditTimeoutException } from '../../common/exceptions/domain.exception';
import { AuditRepository } from './audit.repository';
import { QueueService } from '../../shared/queue/queue.service';
import { LoggerService } from '../../shared/logger/logger.service';
import type { Logger } from 'pino';
import type { AuditResponseDto } from './dto/audit.dto';

@Injectable()
export class AuditService {
  private readonly log: Logger;

  public constructor(
    private readonly auditRepository: AuditRepository,
    private readonly queueService: QueueService,
    private readonly loggerService: LoggerService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.log = this.loggerService.child('AuditService');
  }

  public async auditUrl(
    url: string,
    requestId: string,
  ): Promise<AuditResponseDto> {
    const serviceStartTime = Date.now();

    // Check cache first
    const cached = await this.auditRepository.findCachedAudit(url);
    if (cached) {
      this.log.info({ requestId, url, cacheCheckMs: Date.now() - serviceStartTime }, 'Cache hit');
      return {
        success: true,
        requestId,
        cached: true,
        audit: cached,
      };
    }

    // Dispatch new job
    this.log.info({ requestId, url }, 'Cache miss — dispatching job');
    const jobId = await this.queueService.dispatchAuditJob({
      url,
      requestId,
      timestamp: new Date().toISOString(),
    });

    if (!jobId) {
      this.log.error({ url }, 'Queue is full');
      throw new QueueFullException();
    }

    this.log.info({ requestId, jobId, dispatchMs: Date.now() - serviceStartTime }, 'Job dispatched');

    // Wait for result
    const result = await this.waitForResult(url, jobId, requestId);

    if (!result) {
      const totalMs = Date.now() - serviceStartTime;
      this.log.error({ url, totalMs }, 'Audit timeout');
      throw new AuditTimeoutException(`Audit did not complete within ${totalMs}ms`);
    }

    const totalMs = Date.now() - serviceStartTime;
    this.log.info({ requestId, url, totalMs }, 'Audit completed');

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
    requestId: string,
  ): Promise<AuditResult | null> {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkInterval: NodeJS.Timeout | undefined;
      let timeoutHandle: NodeJS.Timeout | undefined;
      let resolved = false;

      // Event listener for job completion
      const onAuditComplete = (data: { url: string; result: AuditResult }) => {
        if (data.url === url && !resolved) {
          resolved = true;
          cleanup();
          const elapsedMs = Date.now() - startTime;
          this.log.debug(
            { jobId, url, elapsedMs, source: 'event' },
            'Result resolved',
          );
          resolve(data.result);
        }
      };

      const cleanup = () => {
        if (checkInterval) clearInterval(checkInterval);
        if (timeoutHandle) clearTimeout(timeoutHandle);
        this.eventEmitter.off('audit.completed', onAuditComplete);
      };

      // Subscribe to job completion event FIRST
      this.eventEmitter.on('audit.completed', onAuditComplete);

      // Aggressive polling: every 50ms for instant cache detection
      let pollCount = 0;
      checkInterval = setInterval(async () => {
        if (resolved) return;

        const result = await this.auditRepository.findCachedAudit(url);
        if (result && !resolved) {
          resolved = true;
          cleanup();
          this.log.debug(
            { jobId, url, pollCount, elapsedMs: Date.now() - startTime, source: 'poll' },
            'Result resolved',
          );
          resolve(result);
          return;
        }

        pollCount++;
        // After 10 seconds of polling, back off to 500ms
        if (pollCount === 200) {
          if (checkInterval) clearInterval(checkInterval);
          checkInterval = setInterval(async () => {
            if (resolved) return;
            const result = await this.auditRepository.findCachedAudit(url);
            if (result && !resolved) {
              resolved = true;
              cleanup();
              resolve(result);
            }
          }, 500);
        }
      }, 50); // Aggressive: 50ms polls

      // Hard timeout: 10 seconds max
      timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          cleanup();
          const elapsedMs = Date.now() - startTime;
          this.log.warn(
            { jobId, url, requestId, elapsedMs },
            'Result wait timeout',
          );
          resolve(null);
        }
      }, 10000); // Reduced from 35s to 10s
    });
  }
}
