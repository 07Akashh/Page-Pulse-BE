import { z } from 'zod';

/**
 * Zod schema that validates ALL environment variables at startup.
 * If any required variable is missing or malformed, the app will
 * refuse to start with a descriptive error — fail fast, fail loud.
 *
 * Why Zod over @nestjs/config's built-in validation?
 * - Composable schemas
 * - Superior error messages with field paths
 * - Runtime type narrowing (the parsed object is fully typed)
 */
const envSchema = z.object({
  // Application
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_NAME: z.string().min(1).default('page-pulse'),
  APP_VERSION: z.string().min(1).default('1.0.0'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid URL').default('redis://localhost:6379'),
  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  // Cache
  CACHE_TTL: z.coerce.number().int().positive().default(300),

  // Rate Limiting
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(3_600_000),

  // Queue
  QUEUE_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(20),
  QUEUE_MAX_SIZE: z.coerce.number().int().positive().default(500),

  // HTTP Client
  REQUEST_TIMEOUT: z.coerce.number().int().positive().default(8_000),
  REQUEST_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
  REQUEST_RETRY_BASE_DELAY: z.coerce.number().int().positive().default(1_000),

  // Circuit Breaker
  CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(5),
  CIRCUIT_BREAKER_TIMEOUT: z.coerce.number().int().positive().default(60_000),

  // Logging
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // CORS
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Called by @nestjs/config's validate option.
 * Throws a descriptive ZodError if validation fails.
 */
export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const formatted = result.error.errors
      .map((e) => `  ${e.path.join('.')}: ${e.message}`)
      .join('\n');
    throw new Error(`Environment validation failed:\n${formatted}`);
  }

  return result.data;
}
