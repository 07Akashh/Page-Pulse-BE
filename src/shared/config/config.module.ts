import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { allConfigs } from './configuration';
import { validateEnv } from './env.validation';

/**
 * Global config module — imported once in AppModule, available everywhere.
 *
 * @Global() means no other module needs to import this explicitly.
 * ConfigService is available for injection throughout the application.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      // Load .env file in non-production environments
      envFilePath: process.env['NODE_ENV'] === 'production' ? undefined : '.env',
      load: allConfigs,
      validate: validateEnv,
      // Cache parsed config to avoid re-reading process.env on every access
      cache: true,
      expandVariables: true,
    }),
  ],
  exports: [NestConfigModule],
})
export class ConfigModule {}
