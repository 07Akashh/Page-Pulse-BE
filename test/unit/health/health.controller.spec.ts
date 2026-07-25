import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthController } from '../../../src/modules/health/health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  let healthServiceMock: any;

  beforeEach(() => {
    healthServiceMock = {
      getLiveness: vi.fn(),
      getReadiness: vi.fn(),
    };

    controller = new HealthController(healthServiceMock);
  });

  describe('GET /health', () => {
    it('returns status ok', () => {
      healthServiceMock.getLiveness.mockReturnValue({ status: 'ok', timestamp: '2024-01-01T00:00:00Z' });
      const result = controller.liveness();
      expect(result.status).toBe('ok');
    });
  });

  describe('GET /ready', () => {
    it('returns health when all checks pass', async () => {
      healthServiceMock.getReadiness.mockResolvedValue({
        status: 'ok',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 100,
        checks: {
          redis: { status: 'ok' },
          queue: { status: 'ok' },
          memory: { status: 'ok' },
        },
      });

      const result = await controller.readiness();
      expect((result as { status: string }).status).toBe('ok');
    });

    it('throws 503 when status is down', async () => {
      const { HttpException } = await import('@nestjs/common');
      healthServiceMock.getReadiness.mockResolvedValue({
        status: 'down',
        timestamp: '2024-01-01T00:00:00Z',
        uptime: 0,
        checks: {
          redis: { status: 'fail', detail: 'Connection refused' },
          queue: { status: 'ok' },
          memory: { status: 'ok' },
        },
      });

      await expect(controller.readiness()).rejects.toThrow(HttpException);
    });
  });
});
