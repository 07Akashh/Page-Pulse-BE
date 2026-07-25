import type {
  ExceptionFilter,
  ArgumentsHost,
} from '@nestjs/common';
import {
  Catch,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CORRELATION_ID_HEADER, ERROR_CODES } from '../constants';
import { LoggerService } from '../../shared/logger/logger.service';

/**
 * GlobalExceptionFilter — catches ALL unhandled exceptions.
 *
 * Contract: NEVER expose stack traces or internal error details.
 * Every error response has the same envelope shape.
 *
 * Handles:
 * 1. HttpException (from guards, pipes, explicit throws)
 * 2. ZodError (if somehow bypasses the pipe — belt-and-suspenders)
 * 3. Any unknown Error
 *
 * Security note: error.message from unknown errors is NOT forwarded —
 * it might contain file paths, DB queries, or internal hostnames.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  public constructor(private readonly logger: LoggerService) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request>();
    const res = ctx.getResponse<Response>();

    const requestId =
      (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? '';

    const { status, code, message } = this.classify(exception);

    // Log the full error internally (including stack trace — just not in the response)
    if (status >= 500) {
      this.logger.error(
        `Unhandled exception: ${message}`,
        exception instanceof Error ? exception.stack : undefined,
        'GlobalExceptionFilter',
      );
    } else {
      this.logger.warn(message, 'GlobalExceptionFilter');
    }

    // If the HttpException body already has our structured format, pass it through
    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (
        typeof body === 'object' &&
        body !== null &&
        'success' in body &&
        (body as Record<string, unknown>)['success'] === false
      ) {
        res.status(status).json({ ...body, requestId });
        return;
      }
    }

    res.status(status).json({
      success: false,
      requestId,
      error: { code, message },
    });
  }

  private classify(exception: unknown): {
    status: number;
    code: string;
    message: string;
  } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      return {
        status,
        code: this.statusToCode(status),
        message: exception.message,
      };
    }

    // Unknown error — return generic 500, never leak internals
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'An unexpected error occurred. Please try again later.',
    };
  }

  private statusToCode(status: number): string {
    const map: Record<number, string> = {
      400: ERROR_CODES.VALIDATION_ERROR,
      429: ERROR_CODES.RATE_LIMIT_EXCEEDED,
      503: ERROR_CODES.SERVICE_UNAVAILABLE,
      504: ERROR_CODES.REQUEST_TIMEOUT,
    };
    return map[status] ?? ERROR_CODES.INTERNAL_ERROR;
  }
}
