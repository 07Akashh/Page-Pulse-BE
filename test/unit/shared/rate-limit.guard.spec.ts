import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { RateLimitGuard } from '../../../src/common/guards/rate-limit.guard';
import { ERROR_CODES } from '../../../src/common/constants';

const buildContext = (ip = '1.2.3.4', headers: Record<string, string> = {}): ExecutionContext => ({
  switchToHttp: () => ({
    getRequest: () => ({
      headers,
      socket: { remoteAddress: ip },
    }),
    getResponse: () => ({
      setHeader: vi.fn(),
    }),
  }),
}) as unknown as ExecutionContext;

describe('RateLimitGuard', () => {
  let guard: RateLimitGuard;
  let cacheServiceMock: any;
  let configServiceMock: any;

  beforeEach(() => {
    cacheServiceMock = { increment: vi.fn() };

    configServiceMock = {
      get: vi.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'rateLimit.RATE_LIMIT_MAX') return 100;
        if (key === 'rateLimit.RATE_LIMIT_WINDOW_MS') return 3_600_000;
        return def ?? 100;
      }),
    };

    guard = new RateLimitGuard(configServiceMock, cacheServiceMock);
  });

  it('allows request when under limit', async () => {
    cacheServiceMock.increment.mockResolvedValue(50);
    const ctx = buildContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('throws 429 when limit exceeded', async () => {
    cacheServiceMock.increment.mockResolvedValue(101);
    const ctx = buildContext();

    await expect(guard.canActivate(ctx)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(ctx);
    } catch (err) {
      if (err instanceof HttpException) {
        expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
        const body = err.getResponse() as Record<string, unknown>;
        expect((body['error'] as Record<string, string>)['code']).toBe(ERROR_CODES.RATE_LIMIT_EXCEEDED);
      }
    }
  });

  it('fails open when Redis throws (allow request)', async () => {
    cacheServiceMock.increment.mockRejectedValue(new Error('Redis down'));
    const ctx = buildContext();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
  });

  it('uses X-Forwarded-For header for IP extraction', async () => {
    cacheServiceMock.increment.mockResolvedValue(1);
    const ctx = buildContext('10.0.0.1', { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' });
    await guard.canActivate(ctx);

    expect(cacheServiceMock.increment).toHaveBeenCalledWith(
      expect.stringContaining('203.0.113.1'),
      expect.any(Number),
    );
  });
});
