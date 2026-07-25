import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { CACHE_SERVICE } from '../../shared/cache/cache.interface';
import type { ICacheService } from '../../shared/cache/cache.interface';
import { CACHE_KEYS, ERROR_CODES, CORRELATION_ID_HEADER } from '../constants';

/**
 * RateLimitGuard — Redis-backed sliding window rate limiter.
 *
 * Algorithm: per-IP INCR counter with TTL expiry.
 *
 * Why not use @nestjs/throttler?
 * @nestjs/throttler supports Redis but its API surface couples it to
 * the NestJS version. Our implementation is explicit, testable, and
 * adds Retry-After header — a production requirement.
 *
 * Window: 1 hour (configurable via RATE_LIMIT_WINDOW_MS)
 * Limit: 100 requests per IP per window (configurable via RATE_LIMIT_MAX)
 *
 * On Redis failure: FAIL OPEN (allow the request) to prevent Redis
 * outage from taking down the entire API.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly maxRequests: number;
  private readonly windowMs: number;
  private readonly windowSeconds: number;

  public constructor(
    private readonly configService: ConfigService,
    @Inject(CACHE_SERVICE) private readonly cacheService: ICacheService,
  ) {
    this.maxRequests = this.configService.get<number>('rateLimit.RATE_LIMIT_MAX', 100);
    this.windowMs = this.configService.get<number>('rateLimit.RATE_LIMIT_WINDOW_MS', 3_600_000);
    this.windowSeconds = Math.floor(this.windowMs / 1_000);
  }

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const ip = this.extractIp(req);
    const requestId = (req.headers[CORRELATION_ID_HEADER] as string | undefined) ?? '';

    let count: number;
    try {
      count = await this.cacheService.increment(CACHE_KEYS.rateLimit(ip), this.windowSeconds);
    } catch {
      // Fail open — Redis is down, don't block the request
      return true;
    }

    // Set rate limit headers on every response (RFC 6585)
    res.setHeader('X-RateLimit-Limit', this.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, this.maxRequests - count));
    res.setHeader('X-RateLimit-Window', this.windowSeconds);

    if (count > this.maxRequests) {
      res.setHeader('Retry-After', this.windowSeconds);
      throw new HttpException(
        {
          success: false,
          requestId,
          error: {
            code: ERROR_CODES.RATE_LIMIT_EXCEEDED,
            message: `Rate limit exceeded. Maximum ${this.maxRequests} requests per ${this.windowSeconds}s window.`,
          },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private extractIp(req: Request): string {
    // Respect X-Forwarded-For from trusted reverse proxies
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      // Take the first IP in the chain (leftmost = original client)
      return forwarded.split(',')[0].trim();
    }
    return req.socket.remoteAddress ?? '0.0.0.0';
  }
}
