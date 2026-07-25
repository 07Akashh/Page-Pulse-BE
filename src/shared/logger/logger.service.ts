import { Injectable, type LoggerService as NestLoggerService } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pino, { type Logger } from 'pino';
import type { Env } from '../config/env.validation';

@Injectable()
export class LoggerService implements NestLoggerService {
  public readonly logger: Logger;

  public constructor(private readonly configService: ConfigService) {
    const level = this.configService.get<Env['LOG_LEVEL']>('app.LOG_LEVEL', 'info');
    const isDev = this.configService.get<string>('app.NODE_ENV') !== 'production';

    this.logger = pino({
      level,
      transport: isDev
        ? {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'SYS:standard',
              ignore: 'pid,hostname',
            },
          }
        : undefined,
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', '*.password', '*.token'],
        censor: '[REDACTED]',
      },
      serializers: {
        err: pino.stdSerializers.err,
        req: pino.stdSerializers.req,
        res: pino.stdSerializers.res,
      },
      base: {
        app: this.configService.get<string>('app.APP_NAME', 'page-pulse'),
        version: this.configService.get<string>('app.APP_VERSION', '1.0.0'),
        env: this.configService.get<string>('app.NODE_ENV', 'development'),
      },
    });
  }

  public child(context: string): Logger {
    return this.logger.child({ context });
  }

  public log(message: string, context?: string): void {
    this.logger.info({ context }, message);
  }

  public error(message: string, trace?: string, context?: string): void {
    this.logger.error({ context, trace }, message);
  }

  public warn(message: string, context?: string): void {
    this.logger.warn({ context }, message);
  }

  public debug(message: string, context?: string): void {
    this.logger.debug({ context }, message);
  }

  public verbose(message: string, context?: string): void {
    this.logger.trace({ context }, message);
  }
}
