import type {
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import {
  Catch,
  HttpException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER, ERROR_CODES, HTTP_STATUS } from '../constants';
import { formatError } from '../utils/response.util';
import { DomainException } from '../exceptions/domain.exception';
import { LoggerService } from '../../shared/logger/logger.service';

/**
 * GlobalExceptionFilter — catches ALL unhandled exceptions and formats responses.
 *
 * CRITICAL RULES:
 * 1. NEVER return errors with HTTP 200 status code
 * 2. Use correct HTTP status codes (429, 504, 400, 500, etc.)
 * 3. NEVER expose stack traces, internal details, or sensitive info
 * 4. All errors returned via GlobalExceptionFilter follow structured format
 *
 * Handles:
 * 1. HttpException (from guards, pipes, custom handlers)
 * 2. Any unknown Error (generic 500)
 *
 * Security: error.message from unknown errors is NOT forwarded to client.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: LoggerService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId =
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? 'unknown';

    const { status, code, message, details } = this.classify(exception);

    // Log full context internally (NOT sent to client)
    const logMsg = `[${req.method} ${req.path}] ${message} (code: ${code})`;

    if (status >= 500) {
      this.logger.error(
        logMsg,
        exception instanceof Error ? exception.stack : undefined,
        'GlobalExceptionFilter',
      );
    } else if (status >= 400) {
      this.logger.warn(logMsg, 'GlobalExceptionFilter');
    }

    // Format and send structured error response
    const errorBody = formatError(requestId, code, message, details);

    res.status(status).json(errorBody);
  }

  private classify(exception: unknown): {
    status: number;
    code: typeof ERROR_CODES[keyof typeof ERROR_CODES];
    message: string;
    details?: unknown;
  } {
    // Domain exceptions (business logic errors)
    if (exception instanceof DomainException) {
      return {
        status: exception.statusCode,
        code: exception.code,
        message: exception.message,
        details: exception.details,
      };
    }

    // HttpException with structured body (from controllers)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();

      // If already formatted by controller, extract info
      if (
        typeof response === 'object' &&
        response !== null &&
        'error' in response
      ) {
        const errorResponse = response as Record<string, unknown>;
        const errorObj = errorResponse['error'] as Record<string, unknown> | undefined;
        if (errorObj && 'code' in errorObj) {
          return {
            status,
            code: (errorObj.code as typeof ERROR_CODES[keyof typeof ERROR_CODES]) ||
              ERROR_CODES.INTERNAL_ERROR,
            message: (errorObj.message as string) || exception.message,
            details: errorObj.details,
          };
        }
      }

      // Map HttpException to error code based on status
      return {
        status,
        code: this.statusToCode(status),
        message: exception.message,
      };
    }

    // Unknown error — never leak stack trace or internals
    return {
      status: HTTP_STATUS.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
    };
  }

  private statusToCode(
    status: number,
  ): typeof ERROR_CODES[keyof typeof ERROR_CODES] {
    const map: Record<number, typeof ERROR_CODES[keyof typeof ERROR_CODES]> = {
      [HTTP_STATUS.BAD_REQUEST]: ERROR_CODES.VALIDATION_ERROR,
      [HTTP_STATUS.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      [HTTP_STATUS.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
      [HTTP_STATUS.GATEWAY_TIMEOUT]: ERROR_CODES.REQUEST_TIMEOUT,
    };
    return map[status] ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
