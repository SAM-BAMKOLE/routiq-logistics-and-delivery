import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { APP_PREFIX } from './constants.js';
import { ValidationException } from './common/errors/validation.exception.js';
import { configureSwagger } from './swagger.js';

/**
 * Applies the HTTP pipeline to a freshly created application.
 *
 * Shared by `main.ts` and the end-to-end test harness so that tests exercise
 * the exact same prefix, pipes, filters, CORS rules and Swagger setup as the
 * real server.
 */
export function configureApp(
  app: INestApplication,
  config: ConfigService,
): INestApplication {
  app.setGlobalPrefix(APP_PREFIX, {
    // Operational endpoints live at the root, not under /api/v1.
    // Note: wildcards use path-to-regexp v8 syntax (Express 5).
    exclude: ['health/{*path}', 'metrics', 'docs'],
  });

  // Security headers and a strict CORS allow-list read from config.
  app.use(helmet());
  app.enableCors({
    origin: parseCorsOrigins(config.getOrThrow<string>('CORS_ORIGINS')),
    credentials: true,
  });

  // Transform payloads into DTOs, strip unknown fields (per the API
  // conventions), and surface validation failures as field-level
  // problem+json responses.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      exceptionFactory: (errors) => new ValidationException(errors),
    }),
  );

  configureSwagger(app);
  app.enableShutdownHooks();
  return app;
}

function parseCorsOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}
