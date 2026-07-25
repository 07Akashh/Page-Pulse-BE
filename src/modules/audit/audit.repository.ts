import { Injectable } from '@nestjs/common';
import { CacheService } from '../../shared/cache/cache.service';
import { LoggerService } from '../../shared/logger/logger.service';
import { CACHE_KEYS } from '../../common/constants';
import type { IAuditRepository } from './interfaces/audit-repository.interface';
import type { AuditResult } from '../../common/types';
import type { Logger } from 'pino';

@Injectable()
export class AuditRepository implements IAuditRepository {
  private readonly log: Logger;

  public constructor(
    private readonly cacheService: CacheService,
    private readonly loggerService: LoggerService,
  ) {
    this.log = this.loggerService.child('AuditRepository');
  }

  public async findCachedAudit(url: string): Promise<AuditResult | null> {
    const key = CACHE_KEYS.audit(url);
    const cached = await this.cacheService.get<AuditResult>(key);

    if (cached) {
      this.log.debug({ key, url }, 'Cache hit');
    } else {
      this.log.debug({ key, url }, 'Cache miss');
    }

    return cached;
  }

  public async cacheAudit(url: string, result: AuditResult): Promise<void> {
    const key = CACHE_KEYS.audit(url);
    await this.cacheService.set(key, result);
    this.log.debug({ key, url }, 'Audit cached');
  }

  public async invalidate(url: string): Promise<void> {
    const key = CACHE_KEYS.audit(url);
    await this.cacheService.del(key);
    this.log.info({ key, url }, 'Audit cache invalidated');
  }
}
