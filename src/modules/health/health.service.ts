import { Injectable } from '@nestjs/common';
import { CacheService } from '../../shared/cache/cache.service';
import { QueueService } from '../../shared/queue/queue.service';
import { LoggerService } from '../../shared/logger/logger.service';

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptime: number;
  checks: {
    redis: CheckResult;
    queue: CheckResult;
    memory: CheckResult;
  };
}

interface CheckResult {
  status: 'ok' | 'fail';
  latencyMs?: number;
  detail?: string;
}

@Injectable()
export class HealthService {
  private readonly startTime = Date.now();

  public constructor(
    private readonly cacheService: CacheService,
    private readonly queueService: QueueService,
    _loggerService: LoggerService,
  ) {}

  public async getHealth(): Promise<HealthStatus> {
    const [redisCheck, queueCheck, memoryCheck] = await Promise.all([
      this.checkRedis(),
      this.checkQueue(),
      this.checkMemory(),
    ]);

    const allOk = redisCheck.status === 'ok' && queueCheck.status === 'ok' && memoryCheck.status === 'ok';
    const anyFail = redisCheck.status === 'fail' || queueCheck.status === 'fail';

    return {
      status: allOk ? 'ok' : anyFail ? 'down' : 'degraded',
      timestamp: new Date().toISOString(),
      uptime: Math.floor((Date.now() - this.startTime) / 1_000),
      checks: {
        redis: redisCheck,
        queue: queueCheck,
        memory: memoryCheck,
      },
    };
  }

  public getLiveness(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  public async getReadiness(): Promise<HealthStatus> {
    return this.getHealth();
  }

  private async checkRedis(): Promise<CheckResult> {
    const start = Date.now();
    try {
      const alive = await this.cacheService.ping();
      return alive
        ? { status: 'ok', latencyMs: Date.now() - start }
        : { status: 'fail', detail: 'Redis ping returned false' };
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      return { status: 'fail', detail: e };
    }
  }

  private async checkQueue(): Promise<CheckResult> {
    try {
      const alive = await this.queueService.ping();
      const counts = await this.queueService.getJobCounts();
      return alive
        ? { status: 'ok', detail: `waiting=${counts.waiting} active=${counts.active}` }
        : { status: 'fail', detail: 'Queue ping failed' };
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err);
      return { status: 'fail', detail: e };
    }
  }

  private checkMemory(): CheckResult {
    const mem = process.memoryUsage();
    const rssMb = Math.round(mem.rss / 1024 / 1024);
    const heapUsedMb = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(mem.heapTotal / 1024 / 1024);

    const status = rssMb < 512 ? 'ok' : 'fail';
    return {
      status,
      detail: `rss=${rssMb}MB heap=${heapUsedMb}/${heapTotalMb}MB`,
    };
  }
}
