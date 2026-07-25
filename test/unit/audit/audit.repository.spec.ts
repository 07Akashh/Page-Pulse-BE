import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AuditRepository } from '../../../src/modules/audit/audit.repository';
import type { AuditResult } from '../../../src/common/types';

const mockAuditResult: AuditResult = {
  title: 'Test',
  description: 'Desc',
  statusCode: 200,
  responseTime: 100,
  contentLength: 500,
  headers: {},
  https: true,
  reachable: true,
};

describe('AuditRepository', () => {
  let repository: AuditRepository;
  let cacheServiceMock: any;
  let loggerServiceMock: any;

  beforeEach(() => {
    cacheServiceMock = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };

    const mockChildLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    loggerServiceMock = {
      child: vi.fn().mockReturnValue(mockChildLogger),
    };

    repository = new AuditRepository(cacheServiceMock, loggerServiceMock);
  });

  describe('findCachedAudit', () => {
    it('returns result on cache hit', async () => {
      cacheServiceMock.get.mockResolvedValue(mockAuditResult);
      const res = await repository.findCachedAudit('https://www.example.com');
      expect(res).toEqual(mockAuditResult);
    });

    it('returns null on cache miss', async () => {
      cacheServiceMock.get.mockResolvedValue(null);
      const res = await repository.findCachedAudit('https://www.example.com');
      expect(res).toBeNull();
    });
  });

  describe('cacheAudit', () => {
    it('saves audit to cache service', async () => {
      await repository.cacheAudit('https://www.example.com', mockAuditResult);
      expect(cacheServiceMock.set).toHaveBeenCalledWith(
        expect.stringContaining('cache:audit:'),
        mockAuditResult,
      );
    });
  });

  describe('invalidate', () => {
    it('deletes entry from cache', async () => {
      await repository.invalidate('https://www.example.com');
      expect(cacheServiceMock.del).toHaveBeenCalled();
    });
  });
});
