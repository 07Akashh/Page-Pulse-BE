import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditController } from '../../../src/modules/audit/audit.controller';
import { QueueFullError, AuditTimeoutError } from '../../../src/modules/audit/audit.service';
import { ERROR_CODES } from '../../../src/common/constants';
import type { AuditResult } from '../../../src/common/types';

const mockRequest = {
  headers: { 'x-request-id': 'test-req-id' },
};

const mockAuditResult: AuditResult = {
  title: 'Example Domain',
  description: '',
  statusCode: 200,
  responseTime: 320,
  contentLength: 1256,
  headers: {},
  https: true,
  reachable: true,
};

describe('AuditController', () => {
  let controller: AuditController;
  let auditServiceMock: any;

  beforeEach(() => {
    auditServiceMock = {
      auditUrl: vi.fn(),
    };

    controller = new AuditController(auditServiceMock as any);
  });

  describe('POST /api/v1/audit', () => {
    it('returns successful audit response', async () => {
      auditServiceMock.auditUrl.mockResolvedValue({
        success: true,
        requestId: 'test-req-id',
        cached: false,
        audit: mockAuditResult,
      });

      const result = await controller.audit(
        { url: 'https://example.com' },
        mockRequest as never,
      );

      expect(result).toMatchObject({
        success: true,
        requestId: 'test-req-id',
        cached: false,
        audit: mockAuditResult,
      });
    });

    it('returns cached response when audit is cached', async () => {
      auditServiceMock.auditUrl.mockResolvedValue({
        success: true,
        requestId: 'test-req-id',
        cached: true,
        audit: mockAuditResult,
      });

      const result = await controller.audit({ url: 'https://example.com' }, mockRequest as never);
      expect(result).toMatchObject({ cached: true, success: true });
    });

    it('returns QUEUE_FULL error when queue is full', async () => {
      auditServiceMock.auditUrl.mockRejectedValue(new QueueFullError('Queue is full'));

      const result = await controller.audit({ url: 'https://example.com' }, mockRequest as never);
      expect(result).toMatchObject({
        success: false,
        error: { code: ERROR_CODES.QUEUE_FULL },
      });
    });

    it('returns REQUEST_TIMEOUT error on audit timeout', async () => {
      auditServiceMock.auditUrl.mockRejectedValue(new AuditTimeoutError('Timed out'));

      const result = await controller.audit({ url: 'https://example.com' }, mockRequest as never);
      expect(result).toMatchObject({
        success: false,
        error: { code: ERROR_CODES.REQUEST_TIMEOUT },
      });
    });

    it('re-throws unknown errors for GlobalExceptionFilter', async () => {
      auditServiceMock.auditUrl.mockRejectedValue(new Error('Unexpected'));

      await expect(
        controller.audit({ url: 'https://example.com' }, mockRequest as never),
      ).rejects.toThrow('Unexpected');
    });
  });
});
