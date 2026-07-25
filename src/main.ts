import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import compression from 'compression';
import pinoHttp from 'pino-http';
import { AppModule } from './app.module';
import { LoggerService } from './shared/logger/logger.service';
import { CORRELATION_ID_HEADER } from './common/constants';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Disable NestJS's default logger — we use Pino
    bufferLogs: true,
  });

  const configService = app.get(ConfigService);
  const loggerService = app.get(LoggerService);

  // Use our Pino logger for NestJS internal logs
  app.useLogger(loggerService);

  const port = configService.get<number>('app.PORT', 3000);
  const nodeEnv = configService.get<string>('app.NODE_ENV', 'development');
  const corsOrigins = configService.get<string>('app.CORS_ORIGINS', '');

  // ---------------------------------------------------------------------------
  // Security
  // ---------------------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: nodeEnv === 'production' ? undefined : false,
    }),
  );

  // Disable x-powered-by header (leaks technology stack)
  app.disable('x-powered-by');

  // ---------------------------------------------------------------------------
  // CORS
  // ---------------------------------------------------------------------------
  const allowedOrigins = corsOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  app.enableCors({
    origin: nodeEnv === 'production' ? allowedOrigins : true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', CORRELATION_ID_HEADER],
    exposedHeaders: [CORRELATION_ID_HEADER, 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'Retry-After'],
    credentials: false,
  });

  // ---------------------------------------------------------------------------
  // Compression
  // ---------------------------------------------------------------------------
  app.use(compression());

  // ---------------------------------------------------------------------------
  // Request logging (pino-http)
  // ---------------------------------------------------------------------------
  app.use(
    pinoHttp({
      logger: loggerService.logger,
      genReqId: (req) => req.headers[CORRELATION_ID_HEADER] as string ?? '',
      customLogLevel: (_req, res, err) => {
        if (err ?? res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res) =>
        `${req.method} ${req.url} ${res.statusCode}`,
      customErrorMessage: (_req, res, err) =>
        `${res.statusCode} - ${err.message}`,
      // Redact sensitive request data from logs
      redact: ['req.headers.authorization', 'req.headers.cookie'],
      // Skip health check noise in production
      autoLogging: {
        ignore: (req) =>
          nodeEnv === 'production' &&
          (req.url === '/health' || req.url === '/ready' || req.url === '/metrics'),
      },
    }),
  );

  // ---------------------------------------------------------------------------
  // API Versioning
  // ---------------------------------------------------------------------------
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v',
    defaultVersion: '1',
  });

  // ---------------------------------------------------------------------------
  // Swagger
  // ---------------------------------------------------------------------------
  if (nodeEnv !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Page Pulse — URL Audit Service')
      .setDescription(
        'Production-ready URL auditing API. Submit any public URL and receive a detailed audit report including HTTP status, response time, title, description, headers, HTTPS status, and reachability.',
      )
      .setVersion(configService.get<string>('app.APP_VERSION', '1.0.0'))
      .addTag('audit', 'URL audit operations')
      .addTag('health', 'Health check endpoints')
      .addServer(`http://localhost:${port}`, 'Local Development')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
        displayRequestDuration: true,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Graceful shutdown
  // ---------------------------------------------------------------------------
  app.enableShutdownHooks();

  process.on('SIGTERM', () => {
    loggerService.log('SIGTERM received — starting graceful shutdown', 'Bootstrap');
  });

  process.on('SIGINT', () => {
    loggerService.log('SIGINT received — starting graceful shutdown', 'Bootstrap');
  });

  // ---------------------------------------------------------------------------
  // Start
  // ---------------------------------------------------------------------------
  await app.listen(port, '0.0.0.0');

  loggerService.log(
    `Page Pulse running on http://0.0.0.0:${port} [${nodeEnv}]`,
    'Bootstrap',
  );

  if (nodeEnv !== 'production') {
    loggerService.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('Fatal bootstrap error:', err);
  process.exit(1);
});
