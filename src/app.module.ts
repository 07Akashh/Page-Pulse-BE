import { Module, type MiddlewareConsumer, type NestModule, type RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

// Shared modules (global)
import { ConfigModule } from './shared/config/config.module';
import { LoggerModule } from './shared/logger/logger.module';
import { CacheModule } from './shared/cache/cache.module';
import { QueueModule } from './shared/queue/queue.module';

// Feature modules
import { AuditModule } from './modules/audit/audit.module';
import { HealthModule } from './modules/health/health.module';
import { MetricsModule } from './modules/metrics/metrics.module';

// Common infrastructure
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RateLimitGuard } from './common/guards/rate-limit.guard';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware';

/**
 * AppModule — root module.
 *
 * Architectural rules enforced here:
 * 1. Shared modules are @Global() — imported once, available everywhere
 * 2. Feature modules are independent — they don't import each other
 * 3. GlobalExceptionFilter and RateLimitGuard are app-wide via APP_FILTER/APP_GUARD
 *    (NestJS multi-provider pattern — DI-friendly unlike useGlobalFilters())
 * 4. CorrelationIdMiddleware is applied to all routes, runs first
 */
@Module({
  imports: [
    // Shared global modules — order matters for DI resolution
    ConfigModule,   // Must be first — everything depends on config
    LoggerModule,   // Second — everything logs
    CacheModule,    // Third — rate limit guard needs this
    QueueModule,    // Fourth — audit module needs this

    // Feature modules
    AuditModule,
    HealthModule,
    MetricsModule,
  ],
  providers: [
    // Global exception filter — catches all unhandled errors
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // Global rate limit guard — applied to all routes
    {
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
  ],
})
export class AppModule implements NestModule {
  public configure(consumer: MiddlewareConsumer): void {
    // Apply correlation ID middleware to ALL routes, first in chain
    consumer
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: 'GET' as unknown as RequestMethod })
      .apply(CorrelationIdMiddleware)
      .forRoutes({ path: '*', method: 'POST' as unknown as RequestMethod });
  }
}
