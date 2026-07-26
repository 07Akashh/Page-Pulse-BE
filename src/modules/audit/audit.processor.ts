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
        },
        concurrency: this.concurrency,
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 86400 },
      },
    );

    this.worker.on('completed', (job) => {
      this.log.info({ jobId: job.id, url: job.data.url }, 'Audit job completed');
    });

    this.worker.on('failed', (job, err) => {
      this.log.error(
        { jobId: job?.id, url: job?.data.url, err },
        'Audit job failed',
      );
    });

    this.worker.on('error', (err) => {
      this.log.error({ err }, 'Worker error');
    });

    this.log.info({ concurrency: this.concurrency }, 'Audit worker started');
  }

  public async onModuleDestroy(): Promise<void> {
    await this.worker.close();
    this.log.info('Audit worker stopped gracefully');
  }

  private async process(job: Job<AuditJobPayload>): Promise<void> {
    const { url, requestId } = job.data;
    const startTime = Date.now();

    this.log.info({ jobId: job.id, requestId, url, attempt: job.attemptsMade }, 'Processing audit job');

    try {
      // const hostname = new URL(url).hostname;
      // const circuitBreaker = this.getCircuitBreaker(hostname); // Temporarily disabled

      let auditResult: AuditResult;

      try {
        // Temporarily disable circuit breaker to debug
        const fetchResult = await httpFetch(url, {
          timeoutMs: this.requestTimeout,
          maxRetries: this.maxRetries,
          retryBaseDelayMs: this.retryBaseDelay,
        });

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
      } catch (err) {
        // Circuit breaker temporarily disabled
        // if (err instanceof CircuitBreakerError) {
        //   this.log.warn(
        //     { jobId: job.id, url, resetInMs: err.resetInMs },
        //     'Circuit breaker open — fast failing audit',
        //   );
        //   auditResult = {
        //     title: '',
        //     description: '',
        //     statusCode: 503,
        //     responseTime: Date.now() - startTime,
        //     contentLength: 0,
        //     headers: {},
        //     https: url.startsWith('https://'),
        //     reachable: false,
        //   };
        // } else {
          const isTimeout = err instanceof HttpTimeoutError || (err instanceof Error && err.name === 'AbortError');
          const elapsed = Date.now() - startTime;

          this.log.warn({ jobId: job.id, url, isTimeout, err }, 'HTTP fetch failed during audit — recording unreachable result');

          auditResult = {
            title: '',
            description: '',
            statusCode: isTimeout ? 504 : 0,
            responseTime: elapsed,
            contentLength: 0,
            headers: {},
            https: url.startsWith('https://'),
            reachable: false,
          };
        // }
      }

      await this.auditRepository.cacheAudit(url, auditResult);

      this.log.info(
        {
          jobId: job.id,
          requestId,
          url,
          statusCode: auditResult.statusCode,
          reachable: auditResult.reachable,
          responseTimeMs: Date.now() - startTime,
        },
        'Audit completed',
      );

      // Emit event to notify waiting requests
      this.eventEmitter.emit('audit.completed', {
        url,
        result: auditResult,
        jobId: job.id,
      });
    } catch (fatalErr) {
      this.log.error({ jobId: job.id, requestId, url, fatalErr }, 'Fatal audit worker error');
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
