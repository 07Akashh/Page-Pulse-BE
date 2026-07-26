import { registerAs } from '@nestjs/config';
import type { Env } from './env.validation';

/**
 * Typed configuration factory.
 *
 * Using registerAs() creates a namespaced config token, which means:
 * - inject with @Inject(appConfig.KEY) for strong typing
 * - avoids magic string lookups scattered across the codebase
 * - each concern (redis, queue, etc.) can be injected independently
 */
export const appConfig = registerAs(
  'app',
  (): Pick<Env, 'NODE_ENV' | 'PORT' | 'APP_NAME' | 'APP_VERSION' | 'LOG_LEVEL' | 'CORS_ORIGINS'> => ({
    NODE_ENV: (process.env['NODE_ENV'] as Env['NODE_ENV']) ?? 'development',
    PORT: Number(process.env['PORT'] ?? 3000),
    APP_NAME: process.env['APP_NAME'] ?? 'page-pulse',
    APP_VERSION: process.env['APP_VERSION'] ?? '1.0.0',
    LOG_LEVEL: (process.env['LOG_LEVEL'] as Env['LOG_LEVEL']) ?? 'info',
    CORS_ORIGINS: process.env['CORS_ORIGINS'] ?? 'http://localhost:3000',
  }),
);

export const redisConfig = registerAs(
  'redis',
  (): Pick<Env, 'REDIS_URL' | 'REDIS_HOST' | 'REDIS_PORT' | 'REDIS_CONNECT_TIMEOUT'> => ({
    REDIS_URL: process.env['REDIS_URL'] ?? 'redis://localhost:6379',
    REDIS_HOST: process.env['REDIS_HOST'] ?? 'localhost',
    REDIS_PORT: Number(process.env['REDIS_PORT'] ?? 6379),
    REDIS_CONNECT_TIMEOUT: Number(process.env['REDIS_CONNECT_TIMEOUT'] ?? 10000),
  }),
);

export const cacheConfig = registerAs(
  'cache',
  (): Pick<Env, 'CACHE_TTL'> => ({
    CACHE_TTL: Number(process.env['CACHE_TTL'] ?? 300),
  }),
);

export const rateLimitConfig = registerAs(
  'rateLimit',
  (): Pick<Env, 'RATE_LIMIT_MAX' | 'RATE_LIMIT_WINDOW_MS'> => ({
    RATE_LIMIT_MAX: Number(process.env['RATE_LIMIT_MAX'] ?? 100),
    RATE_LIMIT_WINDOW_MS: Number(process.env['RATE_LIMIT_WINDOW_MS'] ?? 3600000),
  }),
);

export const queueConfig = registerAs(
  'queue',
  (): Pick<Env, 'QUEUE_CONCURRENCY' | 'QUEUE_MAX_SIZE'> => ({
    QUEUE_CONCURRENCY: Number(process.env['QUEUE_CONCURRENCY'] ?? 20),
    QUEUE_MAX_SIZE: Number(process.env['QUEUE_MAX_SIZE'] ?? 500),
  }),
);

export const httpConfig = registerAs(
  'http',
  (): Pick<Env, 'REQUEST_TIMEOUT' | 'REQUEST_MAX_RETRIES' | 'REQUEST_RETRY_BASE_DELAY'> => ({
    // Note: httpFetch caps these values internally to prevent slow requests
    // REQUEST_TIMEOUT is capped at 5000ms per attempt
    // REQUEST_MAX_RETRIES is capped at 1 (only retry on network errors, not timeout)
    REQUEST_TIMEOUT: Number(process.env['REQUEST_TIMEOUT'] ?? 5000),
    REQUEST_MAX_RETRIES: Number(process.env['REQUEST_MAX_RETRIES'] ?? 1),
    REQUEST_RETRY_BASE_DELAY: Number(process.env['REQUEST_RETRY_BASE_DELAY'] ?? 200),
  }),
);

export const circuitBreakerConfig = registerAs(
  'circuitBreaker',
  (): Pick<Env, 'CIRCUIT_BREAKER_THRESHOLD' | 'CIRCUIT_BREAKER_TIMEOUT'> => ({
    CIRCUIT_BREAKER_THRESHOLD: Number(process.env['CIRCUIT_BREAKER_THRESHOLD'] ?? 10),
    CIRCUIT_BREAKER_TIMEOUT: Number(process.env['CIRCUIT_BREAKER_TIMEOUT'] ?? 30000),
  }),
);

/** All config namespaces collected for easy registration in ConfigModule */
export const allConfigs = [
  appConfig,
  redisConfig,
  cacheConfig,
  rateLimitConfig,
  queueConfig,
  httpConfig,
  circuitBreakerConfig,
];
