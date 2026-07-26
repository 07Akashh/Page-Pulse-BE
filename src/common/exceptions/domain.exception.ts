import { ERROR_CODES, HTTP_STATUS } from '../constants';
import type { ErrorCode } from '../constants';

/**
 * Base domain exception.
 * All domain errors extend this and specify their error code and HTTP status.
 * GlobalExceptionFilter catches these and formats structured responses.
 */
export abstract class DomainException extends Error {
  public abstract readonly code: ErrorCode;
  public abstract readonly statusCode: number;
  public details?: unknown;

  public constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Queue is at capacity — cannot accept new jobs.
 * Response: HTTP 429 Too Many Requests
 */
export class QueueFullException extends DomainException {
  public readonly code = ERROR_CODES.QUEUE_FULL;
  public readonly statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;

  public constructor(message: string = 'Audit queue is full. Please retry shortly.') {
    super(message);
  }
}

/**
 * Audit request exceeded the timeout window.
 * Response: HTTP 504 Gateway Timeout
 */
export class AuditTimeoutException extends DomainException {
  public readonly code = ERROR_CODES.REQUEST_TIMEOUT;
  public readonly statusCode = HTTP_STATUS.GATEWAY_TIMEOUT;

  public constructor(message: string = 'Audit request exceeded timeout.') {
    super(message);
  }
}

/**
 * Rate limit exceeded for this client/IP.
 * Response: HTTP 429 Too Many Requests
 */
export class RateLimitException extends DomainException {
  public readonly code = ERROR_CODES.RATE_LIMIT_EXCEEDED;
  public readonly statusCode = HTTP_STATUS.TOO_MANY_REQUESTS;

  public constructor(
    message: string = 'Rate limit exceeded. Please try again later.',
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

/**
 * URL validation failed.
 * Response: HTTP 400 Bad Request
 */
export class InvalidUrlException extends DomainException {
  public readonly code = ERROR_CODES.VALIDATION_ERROR;
  public readonly statusCode = HTTP_STATUS.BAD_REQUEST;

  public constructor(message: string = 'Invalid URL format.') {
    super(message);
  }
}

/**
 * URL blocked from auditing (e.g., localhost, internal IPs).
 * Response: HTTP 400 Bad Request
 */
export class BlockedUrlException extends DomainException {
  public readonly code = ERROR_CODES.URL_BLOCKED;
  public readonly statusCode = HTTP_STATUS.BAD_REQUEST;

  public constructor(
    message: string = 'This URL cannot be audited.',
    public readonly reason?: string,
  ) {
    super(message);
    this.details = { reason };
  }
}

/**
 * Audit failed to complete (e.g., network error, unreachable).
 * Response: HTTP 500 Internal Server Error
 */
export class AuditFailedException extends DomainException {
  public readonly code = ERROR_CODES.AUDIT_FAILED;
  public readonly statusCode = HTTP_STATUS.INTERNAL_SERVER_ERROR;

  public constructor(message: string = 'Audit failed. Please try again later.') {
    super(message);
  }
}

/**
 * Service dependency unavailable (Redis, database, etc.).
 * Response: HTTP 503 Service Unavailable
 */
export class ServiceUnavailableException extends DomainException {
  public readonly code = ERROR_CODES.SERVICE_UNAVAILABLE;
  public readonly statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;

  public constructor(
    public readonly reason: string = 'Internal service unavailable',
    message: string = 'Service temporarily unavailable. Please try again later.',
  ) {
    super(message);
    this.details = { reason };
  }
}

/**
 * Circuit breaker is open (too many failures).
 * Response: HTTP 503 Service Unavailable
 */
export class CircuitOpenException extends DomainException {
  public readonly code = ERROR_CODES.CIRCUIT_OPEN;
  public readonly statusCode = HTTP_STATUS.SERVICE_UNAVAILABLE;

  public constructor(
    message: string = 'Too many failures. Please try again later.',
  ) {
    super(message);
  }
}
