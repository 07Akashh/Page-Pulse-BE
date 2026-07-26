import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';
import { CacheService } from '../cache/cache.service';
import { LoggerService } from '../logger/logger.service';
import type { Logger } from 'pino';
import { QUEUE_NAME, AUDIT_JOB_NAME } from '../../common/constants';
import type { AuditJobPayload } from '../../common/types';

/**
 * QueueService — wraps BullMQ Queue for job dispatch.
 *
 * CRITICAL REFACTOR:
 * 1. REMOVED job deduplication — Each request gets a unique job.
 *    This allows concurrent processing of the same URL by multiple requests.
 * 2. Added unique requestId to jobId to prevent collisions.
 * 3. Job linking via Redis: for cache hits, multiple requests watch the same URL cache key.
 * 4. Backpressure: Check queue depth and reject if full (429 response).
 */
@Injectable()
export class QueueService implements OnModuleInit {
  private readonly queue: Queue;
  private readonly log: Logger;
  private readonly maxQueueSize: number;
  private readonly connectTimeout: number;
  private isReady = false;

  public constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggerService: LoggerService,
  ) {
    this.log = this.loggerService.child('QueueService');
    this.maxQueueSize = this.configService.get<number>('queue.QUEUE_MAX_SIZE', 500);
    this.connectTimeout = this.configService.get<number>('redis.REDIS_CONNECT_TIMEOUT', 10000);

    const redisUrl = this.configService.get<string>('redis.REDIS_URL', 'redis://localhost:6379');

    this.queue = new Queue(QUEUE_NAME, {
      connection: {
        url: redisUrl,
        connectTimeout: this.connectTimeout,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 100, 3000);
          this.log.warn({ attempt: times, delayMs: delay }, 'Redis reconnecting');
          return delay;
        },
      },
      defaultJobOptions: {
        removeOnComplete: true, // Instant cleanup
        removeOnFail: { age: 3600 }, // Keep failed jobs 1 hour for debugging
        attempts: 1, // No retries at queue level (retries happen in processor)
      },
    });

    // Aggressive error handling
    this.queue.on('error', (err) => {
      this.log.error({ err }, 'Queue connection error');
      this.isReady = false;
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.queue.waitUntilReady();
      this.isReady = true;
      this.log.info({ queue: QUEUE_NAME }, 'Queue initialized and ready');
    } catch (err) {
      this.log.error({ err }, 'Failed to initialize queue');
      this.isReady = false;
      // Throw to prevent app startup if Redis is unavailable
      throw err;
    }
  }

  public async dispatchAuditJob(
    payload: AuditJobPayload,
    opts?: JobsOptions,
  ): Promise<string | null> {
    if (!this.isReady) {
      this.log.error('Queue not ready');
      return null;
    }

    try {
      const waitingCount = await this.queue.getWaitingCount();
      const activeCount = await this.queue.getActiveCount();
      const totalPending = waitingCount + activeCount;

      if (totalPending >= this.maxQueueSize) {
        this.log.warn({ waiting: waitingCount, active: activeCount }, 'Queue is full');
        return null;
      }

      // UNIQUE jobId per request — no deduplication!
      // Each request gets its own job even if URL is identical
      const jobId = this.buildJobId(payload.url, payload.requestId);

      const job = await this.queue.add(AUDIT_JOB_NAME, payload, {
        jobId,
        priority: 5, // Medium priority
        ...opts,
      });

      this.log.info(
        { jobId: job.id, url: payload.url, requestId: payload.requestId, pending: totalPending },
        'Audit job dispatched',
      );
      return job.id ?? jobId;
    } catch (err) {
      this.log.error({ err, url: payload.url }, 'Failed to dispatch job');
      return null;
    }
  }

  public async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    try {
      const [waiting, active, completed, failed, delayed] = await Promise.all([
        this.queue.getWaitingCount(),
        this.queue.getActiveCount(),
        this.queue.getCompletedCount(),
        this.queue.getFailedCount(),
        this.queue.getDelayedCount(),
      ]);
      return { waiting, active, completed, failed, delayed };
    } catch (err) {
      this.log.error({ err }, 'Failed to get job counts');
      return { waiting: 0, active: 0, completed: 0, failed: 0, delayed: 0 };
    }
  }

  public async ping(): Promise<boolean> {
    try {
      return this.cacheService.ping();
    } catch {
      return false;
    }
  }

  public async close(): Promise<void> {
    await this.queue.close();
    this.log.info('Queue closed');
  }

  /**
   * UNIQUE job ID per request to prevent deduplication.
   * Combines URL hash + requestId for uniqueness.
   * Note: BullMQ custom jobId must NOT contain colons (:).
   */
  private buildJobId(url: string, requestId: string): string {
    const urlHash = Buffer.from(url).toString('base64url').slice(0, 32);
    const reqHash = Buffer.from(requestId || 'default').toString('base64url').slice(0, 16);
    return `audit_${urlHash}_${reqHash}`;
  }
}
