/** BullMQ queue name */
export const QUEUE_NAME = 'audit-queue';

/** BullMQ job name within the queue */
export const AUDIT_JOB_NAME = 'audit-url';

/** Redis key prefixes — prevents key collisions across concerns */
export const CACHE_KEYS = {
  /** Audit result: cache:audit:<base64url-encoded-url> */
  audit: (url: string): string => `cache:audit:${Buffer.from(url).toString('base64url')}`,
  /** Rate limit: rl:<ip>:<window-start-unix-minute> */
  rateLimit: (ip: string): string => `rl:${ip}`,
} as const;

/** HTTP status codes used across the app */
export const HTTP_STATUS = {
  OK: 200,
  BAD_REQUEST: 400,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT: 504,
} as const;

/** Correlation ID header name */
export const CORRELATION_ID_HEADER = 'x-request-id';

/** User-Agent string for outgoing HTTP requests */
export const USER_AGENT = 'PagePulse/1.0 (URL Audit Service)';

/** Error codes returned in structured error responses */
export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  URL_BLOCKED: 'URL_BLOCKED',
  AUDIT_FAILED: 'AUDIT_FAILED',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  QUEUE_FULL: 'QUEUE_FULL',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  REQUEST_TIMEOUT: 'REQUEST_TIMEOUT',
  CIRCUIT_OPEN: 'CIRCUIT_OPEN',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
