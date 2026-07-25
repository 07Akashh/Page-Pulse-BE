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

  public constructor(
    private readonly configService: ConfigService,
    private readonly cacheService: CacheService,
    private readonly loggerService: LoggerService,
  ) {
    this.log = this.loggerService.child('QueueService');
    this.maxQueueSize = this.configService.get<number>('queue.QUEUE_MAX_SIZE', 500);

    // Reuse the existing Redis connection — BullMQ requires a separate connection
    // per Queue/Worker (ioredis connection state machine conflict)
    const redisUrl = this.configService.get<string>('redis.REDIS_URL', 'redis://localhost:6379');

    this.queue = new Queue(QUEUE_NAME, {
      connection: {
        url: redisUrl,
      },
      defaultJobOptions: {
        // Remove completed jobs after 1000 (prevents Redis bloat)
        removeOnComplete: { count: 1_000 },
        // Keep failed jobs for 24h for debugging
        removeOnFail: { age: 86_400 },
        attempts: this.configService.get<number>('http.REQUEST_MAX_RETRIES', 3),
        backoff: {
          type: 'exponential',
          delay: this.configService.get<number>('http.REQUEST_RETRY_BASE_DELAY', 1_000),
        },
      },
    });
  }

  public async onModuleInit(): Promise<void> {
    this.log.info({ queue: QUEUE_NAME }, 'Queue initialized');
  }

  /**
   * Dispatches an audit job.
   *
   * @returns jobId if dispatched, null if queue is full (caller should return 429)
   */
  public async dispatchAuditJob(
    payload: AuditJobPayload,
    opts?: JobsOptions,
  ): Promise<string | null> {
    // Backpressure check
    const waitingCount = await this.queue.getWaitingCount();
    if (waitingCount >= this.maxQueueSize) {
      this.log.warn({ waitingCount, maxQueueSize: this.maxQueueSize }, 'Queue is full');
      return null;
    }

    // Deduplication: jobId based on URL hash ensures same URL isn't processed twice
    const jobId = this.buildJobId(payload.url);

    const job = await this.queue.add(AUDIT_JOB_NAME, payload, {
      jobId, // BullMQ will ignore duplicate jobId if job is still in queue
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
      // BullMQ uses the same Redis — if CacheService Redis is alive, queue is alive
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
   * Same URL → same ID → BullMQ deduplication handles the rest.
   */
  private buildJobId(url: string): string {
    // Simple but sufficient — URL is already normalized by the validator
    return `audit:${Buffer.from(url).toString('base64url')}`;
  }
}
