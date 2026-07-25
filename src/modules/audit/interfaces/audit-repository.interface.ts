import type { AuditResult } from '../../../common/types';

/** Contract for the audit repository */
export interface IAuditRepository {
  findCachedAudit(url: string): Promise<AuditResult | null>;
  cacheAudit(url: string, result: AuditResult): Promise<void>;
  invalidate(url: string): Promise<void>;
}

export const AUDIT_REPOSITORY = Symbol('IAuditRepository');
