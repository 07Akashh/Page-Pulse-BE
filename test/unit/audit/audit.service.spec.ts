import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  AuditService,
  QueueFullError,
  AuditTimeoutError,
} from '../../../src/modules/audit/audit.service';
import type { AuditResult } from '../../../src/common/types';

const mockAuditResult: AuditResult = {
  title: 'Example Domain',
  description: 'An example website',
  statusCode: 200,
  responseTime: 320,
  contentLength: 1256,
  headers: { 'content-type': 'text/html' },
  https: true,
  reachable: true,
};

describe('AuditService', () => {
  let auditService: AuditService;
  let auditRepositoryMock: any;
  let queueServiceMock: any;
  let loggerServiceMock: any;
  let configServiceMock: any;

  beforeEach(() => {
    auditRepositoryMock = {
      findCachedAudit: vi.fn(),
      cacheAudit: vi.fn().mockResolvedValue(undefined),
    };

    queueServiceMock = {
      dispatchAuditJob: vi.fn().mockResolvedValue('job-123'),
    };

    const mockChildLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    loggerServiceMock = {
      child: vi.fn().mockReturnValue(mockChildLogger),
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };

    configServiceMock = {
      get: vi.fn().mockImplementation((key: string, defaultVal: unknown) => {
        if (key === 'http.REQUEST_TIMEOUT') return 500;
        return defaultVal;
      }),
    };

    auditService = new AuditService(
      auditRepositoryMock,
      queueServiceMock,
      loggerServiceMock,
      configServiceMock,
    );
  });

  describe('cache hit', () => {
    it('returns cached result with cached:true', async () => {
      auditRepositoryMock.findCachedAudit.mockResolvedValue(mockAuditResult);

      const result = await auditService.auditUrl('https://www.example.com', 'req-123');

      expect(result.success).toBe(true);
      expect(result.cached).toBe(true);
      expect(result.audit).toEqual(mockAuditResult);
      expect(queueServiceMock.dispatchAuditJob).not.toHaveBeenCalled();
    });
  });

  describe('cache miss', () => {
    it('dispatches job and polls for result', async () => {
      auditRepositoryMock.findCachedAudit
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(mockAuditResult);

      const result = await auditService.auditUrl('https://www.example.com', 'req-456');

      expect(result.success).toBe(true);
      expect(result.cached).toBe(false);
      expect(result.audit).toEqual(mockAuditResult);
      expect(queueServiceMock.dispatchAuditJob).toHaveBeenCalledWith(
        expect.objectContaining({ url: 'https://www.example.com', requestId: 'req-456' }),
      );
    });

    it('throws QueueFullError when queue is full', async () => {
      auditRepositoryMock.findCachedAudit.mockResolvedValue(null);
      queueServiceMock.dispatchAuditJob.mockResolvedValue(null);

      await expect(auditService.auditUrl('https://www.example.com', 'req-789')).rejects.toThrow(
        QueueFullError,
      );
    });

    it('throws AuditTimeoutError when result never arrives', async () => {
      auditRepositoryMock.findCachedAudit.mockResolvedValue(null);

      await expect(
        auditService.auditUrl('https://slow.example.com', 'req-timeout'),
      ).rejects.toThrow(AuditTimeoutError);
    }, 10_000);
  });

  describe('request ID propagation', () => {
    it('includes requestId in success response', async () => {
      auditRepositoryMock.findCachedAudit.mockResolvedValue(mockAuditResult);

      const result = await auditService.auditUrl('https://www.example.com', 'my-request-id');
      expect(result.requestId).toBe('my-request-id');
    });
  });
});
