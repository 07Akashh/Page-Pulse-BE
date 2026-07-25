import { Global, Module } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CACHE_SERVICE } from './cache.interface';

/**
 * Global cache module.
 *
 * Provides both:
 * - CacheService (concrete class, for internal use within this module)
 * - CACHE_SERVICE token (interface-bound, for injection in other modules)
 *
 * This double-registration allows other modules to depend on the
 * ICacheService interface rather than the concrete class.
 */
@Global()
@Module({
  providers: [
    CacheService,
    {
      provide: CACHE_SERVICE,
      useExisting: CacheService,
    },
  ],
  exports: [CacheService, CACHE_SERVICE],
})
export class CacheModule {}
