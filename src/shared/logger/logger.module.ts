import { Global, Module } from '@nestjs/common';
import { LoggerService } from './logger.service';

/**
 * Global logger module.
 *
 * Exported globally so every module can inject LoggerService
 * without re-importing this module.
 */
@Global()
@Module({
  providers: [LoggerService],
  exports: [LoggerService],
})
export class LoggerModule {}
