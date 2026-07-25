/**
 * Contract for the cache layer.
 *
 * Programming to an interface (not the concrete CacheService) means:
 * - Easy to swap Redis for Memcached or in-memory in tests
 * - Enforces the Repository pattern boundary
 * - Prevents accidental access to Redis-specific methods in business logic
 */
export interface ICacheService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  increment(key: string, ttlSeconds?: number): Promise<number>;
  ping(): Promise<boolean>;
  getStats(): Promise<CacheStats>;
}

export interface CacheStats {
  hits: number;
  misses: number;
  hitRatio: number;
  keys: number;
  memoryUsedBytes: number;
}

export const CACHE_SERVICE = Symbol('ICacheService');
