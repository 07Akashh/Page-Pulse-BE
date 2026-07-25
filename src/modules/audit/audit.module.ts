import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { AuditRepository } from './audit.repository';
import { AuditProcessor } from './audit.processor';
import { AUDIT_REPOSITORY } from './interfaces/audit-repository.interface';

/**
 * AuditModule — self-contained feature module.
 *
 * Owns everything related to URL auditing:
 * - Controller (HTTP interface)
 * - Service (business orchestration)
 * - Repository (cache persistence)
 * - Processor (BullMQ worker)
 *
 * Imports nothing from other feature modules.
 * Uses globals: CacheModule, QueueModule, LoggerModule, ConfigModule.
 */
@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    AuditRepository,
    AuditProcessor,
    // Bind interface token to concrete implementation
    {
      provide: AUDIT_REPOSITORY,
      useExisting: AuditRepository,
    },
  ],
  exports: [AuditService],
})
export class AuditModule {}
