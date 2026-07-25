import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CacheService } from '../../../src/shared/cache/cache.service';

vi.mock('ioredis', () => {
  const mockRedis = vi.fn().mockImplementation(() => ({
    on: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    quit: vi.fn().mockResolvedValue(undefined),
    get: vi.fn(),
    setex: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    exists: vi.fn(),
    pipeline: vi.fn().mockReturnValue({
      incr: vi.fn().mockReturnThis(),
      expire: vi.fn().mockReturnThis(),
      exec: vi.fn().mockResolvedValue([[null, 1]]),
    }),
    ping: vi.fn().mockResolvedValue('PONG'),
    info: vi.fn().mockResolvedValue('used_memory:1024\r\ndb0:keys=10\r\n'),
  }));
  return { default: mockRedis };
});

describe('CacheService', () => {
  let cacheService: CacheService;
  let redisMock: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    const mockChildLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    };

    const loggerMock = {
      child: vi.fn().mockReturnValue(mockChildLogger),
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
      verbose: vi.fn(),
    };

    const configMock = {
      get: vi.fn().mockImplementation((key: string, def: unknown) => {
        if (key === 'cache.CACHE_TTL') return 300;
        if (key === 'redis.REDIS_URL') return 'redis://localhost:6379';
        return def;
      }),
    };

    cacheService = new CacheService(configMock as any, loggerMock as any);
    redisMock = cacheService.getClient() as unknown as Record<string, ReturnType<typeof vi.fn>>;
  });

  describe('get()', () => {
    it('returns parsed value on cache hit', async () => {
      redisMock['get'].mockResolvedValue(JSON.stringify({ data: 'test' }));
      const result = await cacheService.get<{ data: string }>('key');
      expect(result).toEqual({ data: 'test' });
    });

    it('returns null on cache miss', async () => {
      redisMock['get'].mockResolvedValue(null);
      const result = await cacheService.get('key');
      expect(result).toBeNull();
    });

    it('returns null on Redis error (non-fatal)', async () => {
      redisMock['get'].mockRejectedValue(new Error('Connection refused'));
      const result = await cacheService.get('key');
      expect(result).toBeNull();
    });
  });

  describe('set()', () => {
    it('serializes and stores value', async () => {
      await cacheService.set('key', { data: 'test' }, 60);
      expect(redisMock['setex']).toHaveBeenCalledWith('key', 60, JSON.stringify({ data: 'test' }));
    });

    it('does not throw on Redis error (non-fatal)', async () => {
      redisMock['setex'].mockRejectedValue(new Error('OOM'));
      await expect(cacheService.set('key', 'val')).resolves.not.toThrow();
    });
  });

  describe('del()', () => {
    it('deletes key', async () => {
      await cacheService.del('key');
      expect(redisMock['del']).toHaveBeenCalledWith('key');
    });

    it('handles error gracefully', async () => {
      redisMock['del'].mockRejectedValue(new Error('err'));
      await expect(cacheService.del('key')).resolves.not.toThrow();
    });
  });

  describe('exists()', () => {
    it('returns true when key exists', async () => {
      redisMock['exists'].mockResolvedValue(1);
      expect(await cacheService.exists('key')).toBe(true);
    });

    it('returns false on error', async () => {
      redisMock['exists'].mockRejectedValue(new Error('err'));
      expect(await cacheService.exists('key')).toBe(false);
    });
  });

  describe('ping()', () => {
    it('returns true when Redis responds PONG', async () => {
      redisMock['ping'].mockResolvedValue('PONG');
      expect(await cacheService.ping()).toBe(true);
    });

    it('returns false on error', async () => {
      redisMock['ping'].mockRejectedValue(new Error('Timeout'));
      expect(await cacheService.ping()).toBe(false);
    });
  });

  describe('increment()', () => {
    it('returns incremented count', async () => {
      redisMock['pipeline'].mockReturnValue({
        incr: vi.fn().mockReturnThis(),
        expire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([[null, 5]]),
      });
      const count = await cacheService.increment('rl:1.2.3.4', 3600);
      expect(count).toBe(5);
    });
  });

  describe('getStats()', () => {
    it('returns cache stats', async () => {
      const stats = await cacheService.getStats();
      expect(stats).toHaveProperty('hits');
      expect(stats).toHaveProperty('misses');
      expect(stats).toHaveProperty('memoryUsedBytes', 1024);
      expect(stats).toHaveProperty('keys', 10);
    });

    it('returns fallback stats on error', async () => {
      redisMock['info'].mockRejectedValue(new Error('info error'));
      const stats = await cacheService.getStats();
      expect(stats).toHaveProperty('keys', 0);
    });
  });

  describe('lifecycle', () => {
    it('connects on init and quits on destroy', async () => {
      await cacheService.onModuleInit();
      expect(redisMock['connect']).toHaveBeenCalled();
      await cacheService.onModuleDestroy();
      expect(redisMock['quit']).toHaveBeenCalled();
    });
  });
});
