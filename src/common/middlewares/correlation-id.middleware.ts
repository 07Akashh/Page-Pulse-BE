import type { NestMiddleware } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { CORRELATION_ID_HEADER } from '../constants';

/**
 * CorrelationIdMiddleware — injects a unique request ID into every request.
 *
 * Priority order:
 * 1. Use incoming x-request-id header (from client or upstream proxy)
 * 2. Fall back to a fresh UUID v4
 *
 * The ID is:
 * - Stored on req.headers so downstream code can read it
 * - Echoed back in the response header for client-side tracing
 * - Picked up by pino-http for automatic log correlation
 *
 * This must run FIRST in the middleware chain, before the request logger.
 */
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  public use(req: Request, res: Response, next: NextFunction): void {
    const existingId = req.headers[CORRELATION_ID_HEADER];
    const requestId =
      typeof existingId === 'string' && existingId.length > 0 ? existingId : uuidv4();

    // Normalize: always a single string (never an array)
    req.headers[CORRELATION_ID_HEADER] = requestId;

    // Echo back so clients can correlate their logs
    res.setHeader(CORRELATION_ID_HEADER, requestId);

    next();
  }
}
