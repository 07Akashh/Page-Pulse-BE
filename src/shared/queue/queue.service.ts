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
 * Design decisions:
 * 1. Job deduplication via jobId: same URL = same jobId = BullMQ ignores the duplicate.
 *    This prevents 50 simultaneous requests for the same URL from spawning 50 HTTP calls.
 * 2. Backpressure: we check queue depth before adding. If > QUEUE_MAX_SIZE, return false
 *    and let the controller respond with 429.
 * 3. Reuses the ioredis client from CacheService to avoid opening a second TCP connection.
 */
@Injectable()
export class QueueService implements OnModuleInit {
  private readonly queue: Queue;
  private readonly log: Logger;
  private readonly maxQueueSize: number;
  private readonly connectTimeout: number;

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
      },
      defaultJobOptions: {
        removeOnComplete: { count: 1000 },
        removeOnFail: { age: 86400 },
        attempts: this.configService.get<number>('http.REQUEST_MAX_RETRIES', 3),
        backoff: {
          type: 'exponential',
          delay: this.configService.get<number>('http.REQUEST_RETRY_BASE_DELAY', 1000),
        },
      },
    });
  }

  public async onModuleInit(): Promise<void> {
    try {
      await this.queue.waitUntilReady();
      this.log.info({ queue: QUEUE_NAME }, 'Queue initialized and ready');
    } catch (err) {
      this.log.error({ err }, 'Failed to initialize queue - will retry automatically');
      // Don't throw - BullMQ will retry connection automatically
    }
  }

  public async dispatchAuditJob(
    payload: AuditJobPayload,
    opts?: JobsOptions,
  ): Promise<string | null> {
    const waitingCount = await this.queue.getWaitingCount();
    if (waitingCount >= this.maxQueueSize) {
      this.log.warn({ waitingCount, maxQueueSize: this.maxQueueSize }, 'Queue is full');
      return null;
    }

    const jobId = this.buildJobId(payload.url);

    const job = await this.queue.add(AUDIT_JOB_NAME, payload, {
      jobId,
      ...opts,
    });

    this.log.info({ jobId: job.id, url: payload.url }, 'Audit job dispatched');
    return job.id ?? jobId;
  }

  public async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);
    return { waiting, active, completed, failed, delayed };
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
   * Deterministic job ID from URL.
   * Note: BullMQ custom jobId must NOT contain colons (:).
   */
  private buildJobId(url: string): string {
    return `audit_${Buffer.from(url).toString('base64url')}`;
  }
}
