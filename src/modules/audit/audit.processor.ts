import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Worker, type Job } from 'bullmq';
import { AuditRepository } from './audit.repository';
import { LoggerService } from '../../shared/logger/logger.service';
import { httpFetch, HttpTimeoutError } from '../../common/utils/http-client.util';
// import { CircuitBreaker, CircuitBreakerError } from '../../common/utils/circuit-breaker.util';
import { QUEUE_NAME } from '../../common/constants';
import type { AuditJobPayload, AuditResult } from '../../common/types';
import type { Logger } from 'pino';

@Injectable()
export class AuditProcessor implements OnModuleInit, OnModuleDestroy {
  private worker!: Worker;
  private readonly log: Logger;
  // private readonly circuitBreakers = new Map<string, CircuitBreaker>();
  private readonly concurrency: number;
  private readonly requestTimeout: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelay: number;
  // private readonly cbThreshold: number;
  // private readonly cbTimeout: number;
  private readonly connectTimeout: number;

  public constructor(
    private readonly auditRepository: AuditRepository,
    private readonly loggerService: LoggerService,
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.log = this.loggerService.child('AuditProcessor');
    this.concurrency = this.configService.get<number>('queue.QUEUE_CONCURRENCY', 20);
    this.requestTimeout = this.configService.get<number>('http.REQUEST_TIMEOUT', 20000);
    this.maxRetries = this.configService.get<number>('http.REQUEST_MAX_RETRIES', 3);
    this.retryBaseDelay = this.configService.get<number>('http.REQUEST_RETRY_BASE_DELAY', 1000);
    // this.cbThreshold = this.configService.get<number>('circuitBreaker.CIRCUIT_BREAKER_THRESHOLD', 10);
    // this.cbTimeout = this.configService.get<number>('circuitBreaker.CIRCUIT_BREAKER_TIMEOUT', 30000);
    this.connectTimeout = this.configService.get<number>('redis.REDIS_CONNECT_TIMEOUT', 10000);
  }

  public onModuleInit(): void {
    const redisUrl = this.configService.get<string>('redis.REDIS_URL', 'redis://localhost:6379');

    this.worker = new Worker(
      QUEUE_NAME,
      async (job: Job<AuditJobPayload>) => this.process(job),
      {
        connection: {
          url: redisUrl,
          connectTimeout: this.connectTimeout,
          retryStrategy: (times: number) => {
            const delay = Math.min(times * 100, 3000);
            this.log.warn({ attempt: times, delayMs: delay }, 'Worker reconnecting');
            return delay;
          },
        },
        concurrency: this.concurrency,
        removeOnComplete: { count: 1000 }, // Keep only last 1000
        removeOnFail: { age: 3600 }, // Keep 1 hour for debugging
        lockDuration: 5000, // Lock timeout (fast fail on hangs)
        lockRenewTime: 2000, // Renew every 2s
        maxStalledCount: 1, // Fail after 1 stall
      },
    );

    this.worker.on('completed', (job) => {
      this.log.debug({ jobId: job.id, url: job.data.url }, 'Job completed handler fired');
    });

    this.worker.on('failed', (job, err) => {
      this.log.error(
        { jobId: job?.id, url: job?.data.url, errorName: err.name, errorMsg: err.message },
        'Job failed',
      );
    });

    this.worker.on('error', (err) => {
      this.log.error({ errorName: err.name, errorMsg: err.message }, 'Worker error');
    });

    this.worker.on('stalled', (jobId) => {
      this.log.warn({ jobId }, 'Job stalled — likely timeout');
    });

    this.log.info({ concurrency: this.concurrency }, 'Audit worker started');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    this.log.info('Audit worker stopped gracefully');
  }

  private async process(job: Job<AuditJobPayload>): Promise<void> {
    const { url, requestId } = job.data;
    const jobStartTime = Date.now();

    this.log.info(
      { jobId: job.id, requestId, url, attempt: job.attemptsMade, timestamp: new Date().toISOString() },
      'Worker picked up job',
    );

    try {
      let auditResult: AuditResult;

      try {
        const fetchStartTime = Date.now();
        this.log.debug({ jobId: job.id, url }, 'Starting HTTP fetch');

        const fetchResult = await httpFetch(url, {
          timeoutMs: this.requestTimeout,
          maxRetries: this.maxRetries,
          retryBaseDelayMs: this.retryBaseDelay,
        });

        const fetchElapsedMs = Date.now() - fetchStartTime;
        this.log.debug(
          { jobId: job.id, url, fetchElapsedMs, statusCode: fetchResult.statusCode },
          'HTTP fetch completed',
        );

        const parseStartTime = Date.now();
        auditResult = {
          title: extractTitle(fetchResult.body),
          description: extractDescription(fetchResult.body),
          statusCode: fetchResult.statusCode,
          responseTime: fetchResult.responseTimeMs,
          contentLength: fetchResult.headers['content-length']
            ? parseInt(fetchResult.headers['content-length'], 10)
            : Buffer.byteLength(fetchResult.body, 'utf8'),
          headers: fetchResult.headers,
          https: url.startsWith('https://'),
          reachable: fetchResult.statusCode < 500,
          redirectChain: fetchResult.redirectChain,
          finalUrl: fetchResult.finalUrl,
        };
        const parseElapsedMs = Date.now() - parseStartTime;
        this.log.debug({ jobId: job.id, parseElapsedMs }, 'HTML parsing completed');
      } catch (err) {
        const isTimeout = err instanceof HttpTimeoutError || (err instanceof Error && err.name === 'AbortError');
        const errorElapsedMs = Date.now() - jobStartTime;

        this.log.warn(
          { jobId: job.id, url, isTimeout, errorElapsedMs, errorMsg: err instanceof Error ? err.message : String(err) },
          'HTTP fetch failed',
        );

        auditResult = {
          title: '',
          description: '',
          statusCode: isTimeout ? 504 : 0,
          responseTime: errorElapsedMs,
          contentLength: 0,
          headers: {},
          https: url.startsWith('https://'),
          reachable: false,
        };
      }

      const cacheStartTime = Date.now();
      await this.auditRepository.cacheAudit(url, auditResult);
      const cacheElapsedMs = Date.now() - cacheStartTime;

      const totalElapsedMs = Date.now() - jobStartTime;

      this.log.info(
        {
          jobId: job.id,
          requestId,
          url,
          statusCode: auditResult.statusCode,
          reachable: auditResult.reachable,
          cacheElapsedMs,
          totalElapsedMs,
          timestamp: new Date().toISOString(),
        },
        'Audit job completed',
      );

      // Emit event to notify all waiting requests
      this.eventEmitter.emit('audit.completed', {
        url,
        result: auditResult,
        jobId: job.id,
      });
    } catch (fatalErr) {
      const totalElapsedMs = Date.now() - jobStartTime;
      this.log.error(
        {
          jobId: job.id,
          requestId,
          url,
          totalElapsedMs,
          errorMsg: fatalErr instanceof Error ? fatalErr.message : String(fatalErr),
        },
        'Fatal job error',
      );
      throw fatalErr;
    }
  }

  // private getCircuitBreaker(hostname: string): CircuitBreaker {
  //   if (!this.circuitBreakers.has(hostname)) {
  //     this.circuitBreakers.set(
  //       hostname,
  //       new CircuitBreaker({
  //         name: hostname,
  //         threshold: this.cbThreshold,
  //         timeoutMs: this.cbTimeout,
  //       }),
  //     );
  //   }
  //   return this.circuitBreakers.get(hostname)!;
  // }

  public getWorkerMetrics(): {
    concurrency: number;
    circuitBreakers: Array<{ hostname: string; state: string; failures: number }>;
  } {
    return {
      concurrency: this.concurrency,
      circuitBreakers: [], // Circuit breaker temporarily disabled
    };
  }
}

function extractTitle(html: string): string {
  const match = /<title[^>]*>([^<]*)<\/title>/i.exec(html);
  return match ? match[1].trim().slice(0, 512) : '';
}

function extractDescription(html: string): string {
  const match =
    /<meta\s+(?:[^>]*?\s+)?name=["']description["'][^>]*?\s+content=["']([^"']*)["']/i.exec(
      html,
    ) ??
    /<meta\s+(?:[^>]*?\s+)?content=["']([^"']*)["'][^>]*?\s+name=["']description["']/i.exec(
      html,
    );
  return match ? match[1].trim().slice(0, 1024) : '';
}
