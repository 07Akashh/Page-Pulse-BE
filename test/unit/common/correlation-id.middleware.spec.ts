import { describe, it, expect, vi } from 'vitest';
import { CorrelationIdMiddleware } from '../../../src/common/middlewares/correlation-id.middleware';
import type { Request, Response, NextFunction } from 'express';

describe('CorrelationIdMiddleware', () => {
  it('preserves existing header when present', () => {
    const middleware = new CorrelationIdMiddleware();
    const req = { headers: { 'x-request-id': 'custom-id-123' } } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);

    expect(req.headers['x-request-id']).toBe('custom-id-123');
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', 'custom-id-123');
    expect(next).toHaveBeenCalled();
  });

  it('generates new UUID when header is missing', () => {
    const middleware = new CorrelationIdMiddleware();
    const req = { headers: {} } as unknown as Request;
    const res = { setHeader: vi.fn() } as unknown as Response;
    const next: NextFunction = vi.fn();

    middleware.use(req, res, next);

    const generatedId = req.headers['x-request-id'];
    expect(typeof generatedId).toBe('string');
    expect((generatedId as string).length).toBeGreaterThan(10);
    expect(res.setHeader).toHaveBeenCalledWith('x-request-id', generatedId);
    expect(next).toHaveBeenCalled();
  });
});
