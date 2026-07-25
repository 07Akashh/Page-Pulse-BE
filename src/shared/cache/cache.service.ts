import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { ICacheService, CacheStats } from './cache.interface';
import { LoggerService } from '../logger/logger.service';
import type { Logger } from 'pino';

@Injectable()
export class CacheService implements ICacheService, OnModuleInit, OnModuleDestroy {
  private readonly redis: Redis;
  private readonly log: Logger;
  private readonly defaultTtl: number;

  private hitCount = 0;
  private missCount = 0;

  public constructor(
    private readonly configService: ConfigService,
    private readonly loggerService: LoggerService,
  ) {
    this.log = this.loggerService.child('CacheService');
    this.defaultTtl = this.configService.get<number>('cache.CACHE_TTL', 300);

    const redisUrl = this.configService.get<string>('redis.REDIS_URL', 'redis://localhost:6379');

    this.redis = new Redis(redisUrl, {
      retryStrategy: (times: number) => {
        if (times > 10) {
          this.log.error({ attempt: times }, 'Redis connection failed after max retries');
          return null;
        }
        const delay = Math.min(times * 100, 3_000);
        this.log.warn({ attempt: times, delayMs: delay }, 'Redis retry');
        return delay;
      },
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
    });

    this.redis.on('error', (err: Error) => {
      this.log.error({ err }, 'Redis error');
    });

    this.redis.on('connect', () => {
      this.log.info('Redis connected');
    });

    this.redis.on('reconnecting', () => {
      this.log.warn('Redis reconnecting');
    });
  }

  public async onModuleInit(): Promise<void> {
    await this.redis.connect();
  }

  public async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
    this.log.info('Redis connection closed');
  }

  public async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      if (raw === null) {
        this.missCount++;
        return null;
      }
      this.hitCount++;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.log.error({ err, key }, 'Cache GET failed');
      this.missCount++;
      return null;
    }
  }

  public async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    try {
      const ttl = ttlSeconds ?? this.defaultTtl;
      const serialized = JSON.stringify(value);
      await this.redis.setex(key, ttl, serialized);
    } catch (err) {
      this.log.error({ err, key }, 'Cache SET failed');
    }
  }

  public async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (err) {
      this.log.error({ err, key }, 'Cache DEL failed');
    }
  }

  public async exists(key: string): Promise<boolean> {
    try {
      const count = await this.redis.exists(key);
      return count > 0;
    } catch (err) {
      this.log.error({ err, key }, 'Cache EXISTS failed');
      return false;
    }
  }

  public async increment(key: string, ttlSeconds?: number): Promise<number> {
    const pipeline = this.redis.pipeline();
    pipeline.incr(key);
    if (ttlSeconds) {
      pipeline.expire(key, ttlSeconds, 'NX');
    }
    const results = await pipeline.exec();
    const count = results?.[0]?.[1];
    return typeof count === 'number' ? count : 1;
  }

  public async ping(): Promise<boolean> {
    try {
      const result = await this.redis.ping();
      return result === 'PONG';
    } catch {
      return false;
    }
  }

  public async getStats(): Promise<CacheStats> {
    try {
      const memInfo = await this.redis.info('memory');
      const dbInfo = await this.redis.info('keyspace');

      const usedMemory = this.extractInfoValue(memInfo, 'used_memory');
      const dbKeys = this.extractDbKeys(dbInfo);

      const total = this.hitCount + this.missCount;
      const hitRatio = total > 0 ? this.hitCount / total : 0;

      return {
        hits: this.hitCount,
        misses: this.missCount,
        hitRatio: Math.round(hitRatio * 100) / 100,
        keys: dbKeys,
        memoryUsedBytes: usedMemory,
      };
    } catch (err) {
      this.log.error({ err }, 'Failed to get cache stats');
      return {
        hits: this.hitCount,
        misses: this.missCount,
        hitRatio: 0,
        keys: 0,
        memoryUsedBytes: 0,
      };
    }
  }

  private extractInfoValue(info: string, key: string): number {
    const match = new RegExp(`${key}:(\\d+)`).exec(info);
    return match ? parseInt(match[1], 10) : 0;
  }

  private extractDbKeys(info: string): number {
    const match = /db\d+:keys=(\d+)/.exec(info);
    return match ? parseInt(match[1], 10) : 0;
  }

  public getClient(): Redis {
    return this.redis;
  }
}
