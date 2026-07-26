import { HTTP_STATUS, ERROR_CODES } from '../constants';
import type { ErrorCode } from '../constants';

/**
 * Production-grade response formatters.
 * Ensures every response (success or error) follows the correct HTTP status code and envelope.
 */

/** Success response envelope */
export interface SuccessResponse<T = unknown> {
  success: true;
  requestId: string;
  data?: T;
}

/** Error response envelope */
export interface ErrorResponse {
  success: false;
  requestId: string;
  error: {
    code: ErrorCode;
    message: string;
    details?: unknown;
  };
}

/**
 * Formats a successful response.
 * Used to ensure consistent response shape across all endpoints.
 */
export function formatSuccess<T = unknown>(
  requestId: string,
  data?: T,
): SuccessResponse<T> {
  return {
    success: true,
    requestId,
    data,
  };
}

/**
 * Formats an error response.
 * Always called by GlobalExceptionFilter.
 */
export function formatError(
  requestId: string,
  code: ErrorCode,
  message: string,
  details?: unknown,
): ErrorResponse {
  const error: ErrorResponse['error'] = {
    code,
    message,
  };

  if (details) {
    error.details = details;
  }

  return {
    success: false,
    requestId,
    error,
  };
}

/**
 * Maps domain errors to HTTP status codes.
 * Used by GlobalExceptionFilter and custom error handlers.
 */
export function errorToHttpStatus(code: ErrorCode): number {
  const statusMap: Record<ErrorCode, number> = {
    [ERROR_CODES.VALIDATION_ERROR]: HTTP_STATUS.BAD_REQUEST,
    [ERROR_CODES.URL_BLOCKED]: HTTP_STATUS.BAD_REQUEST,
    [ERROR_CODES.AUDIT_FAILED]: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    [ERROR_CODES.RATE_LIMIT_EXCEEDED]: HTTP_STATUS.TOO_MANY_REQUESTS,
    [ERROR_CODES.QUEUE_FULL]: HTTP_STATUS.TOO_MANY_REQUESTS,
    [ERROR_CODES.INTERNAL_ERROR]: HTTP_STATUS.INTERNAL_SERVER_ERROR,
    [ERROR_CODES.SERVICE_UNAVAILABLE]: HTTP_STATUS.SERVICE_UNAVAILABLE,
    [ERROR_CODES.REQUEST_TIMEOUT]: HTTP_STATUS.GATEWAY_TIMEOUT,
    [ERROR_CODES.CIRCUIT_OPEN]: HTTP_STATUS.SERVICE_UNAVAILABLE,
  };

  return statusMap[code] ?? HTTP_STATUS.INTERNAL_SERVER_ERROR;
}

/**
 * Health check response — for /health endpoint.
 */
export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  checks: Record<string, { status: 'ok' | 'error'; details?: string }>;
}

export function formatHealthResponse(
  status: 'healthy' | 'degraded' | 'unhealthy',
  uptime: number,
  checks: Record<string, { status: 'ok' | 'error'; details?: string }>,
): HealthResponse {
  return {
    status,
    timestamp: new Date().toISOString(),
    uptime,
    checks,
  };
}
