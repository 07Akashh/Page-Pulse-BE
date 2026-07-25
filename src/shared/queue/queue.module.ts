import { Global, Module } from '@nestjs/common';
import { QueueService } from './queue.service';

/**
 * Global queue module.
 *
 * The Worker (AuditProcessor) is NOT registered here — it lives in AuditModule
 * because it's audit-domain logic. This module only owns the Queue (dispatch side).
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
