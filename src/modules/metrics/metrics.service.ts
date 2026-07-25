import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';
import { CacheService } from '../../shared/cache/cache.service';
import { QueueService } from '../../shared/queue/queue.service';

@Injectable()
export class MetricsService implements OnModuleInit {
  public readonly registry: Registry;

  public readonly httpRequestsTotal: Counter<string>;
  public readonly httpRequestDuration: Histogram<string>;

  public readonly auditTotal: Counter<string>;
  public readonly auditDuration: Histogram<string>;
  public readonly auditCacheHits: Counter<string>;
  public readonly auditCacheMisses: Counter<string>;
  public readonly auditTimeouts: Counter<string>;
  public readonly auditErrors: Counter<string>;

  public readonly queueDepth: Gauge<string>;
  public readonly queueActive: Gauge<string>;
  public readonly queueFailed: Gauge<string>;

  public readonly rateLimitHits: Counter<string>;

  public constructor(
    _cacheService: CacheService,
    private readonly queueService: QueueService,
  ) {
    this.registry = new Registry();

    collectDefaultMetrics({ register: this.registry, prefix: 'pagepulse_node_' });

    this.httpRequestsTotal = new Counter({
      name: 'pagepulse_http_requests_total',
      help: 'Total HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
      registers: [this.registry],
    });

    this.httpRequestDuration = new Histogram({
      name: 'pagepulse_http_request_duration_ms',
      help: 'HTTP request duration in milliseconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [10, 50, 100, 200, 500, 1000, 2000, 5000, 10000],
      registers: [this.registry],
    });

    this.auditTotal = new Counter({
      name: 'pagepulse_audits_total',
      help: 'Total audit requests processed',
      labelNames: ['status'],
      registers: [this.registry],
    });

    this.auditDuration = new Histogram({
      name: 'pagepulse_audit_duration_ms',
      help: 'Audit duration in milliseconds',
      buckets: [100, 500, 1000, 2000, 4000, 8000, 15000],
      registers: [this.registry],
    });

    this.auditCacheHits = new Counter({
      name: 'pagepulse_audit_cache_hits_total',
      help: 'Audit cache hits',
      registers: [this.registry],
    });

    this.auditCacheMisses = new Counter({
      name: 'pagepulse_audit_cache_misses_total',
      help: 'Audit cache misses',
      registers: [this.registry],
    });

    this.auditTimeouts = new Counter({
      name: 'pagepulse_audit_timeouts_total',
      help: 'Audit timeout count',
      registers: [this.registry],
    });

    this.auditErrors = new Counter({
      name: 'pagepulse_audit_errors_total',
      help: 'Audit error count',
      labelNames: ['error_type'],
      registers: [this.registry],
    });

    this.queueDepth = new Gauge({
      name: 'pagepulse_queue_waiting',
      help: 'Jobs waiting in queue',
      registers: [this.registry],
    });

    this.queueActive = new Gauge({
      name: 'pagepulse_queue_active',
      help: 'Jobs actively being processed',
      registers: [this.registry],
    });

    this.queueFailed = new Gauge({
      name: 'pagepulse_queue_failed',
      help: 'Failed jobs in queue',
      registers: [this.registry],
    });

    this.rateLimitHits = new Counter({
      name: 'pagepulse_rate_limit_hits_total',
      help: 'Number of rate-limited requests',
      labelNames: ['ip'],
      registers: [this.registry],
    });
  }

  public onModuleInit(): void {
    setInterval(() => void this.refreshQueueMetrics(), 15_000);
  }

  public async getMetrics(): Promise<string> {
    await this.refreshQueueMetrics();
    return this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }

  private async refreshQueueMetrics(): Promise<void> {
    try {
      const counts = await this.queueService.getJobCounts();
      this.queueDepth.set(counts.waiting);
      this.queueActive.set(counts.active);
      this.queueFailed.set(counts.failed);
    } catch {
      // Non-fatal
    }
  }
}
