import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import helmet from 'helmet';
import type { Server, ServerOptions } from 'socket.io';
import { APP_PREFIX } from './constants.js';
import { ValidationException } from './common/errors/validation.exception.js';
import { configureSwagger } from './swagger.js';

/**
 * Socket.IO adapter sharing the HTTP CORS allow-list with the WebSocket
 * handshake: a browser client on an allowed origin may open the tracking
 * socket, and one on a disallowed origin is refused at the upgrade, before
 * any token is verified.
 */
class CorsIoAdapter extends IoAdapter {
  constructor(
    app: INestApplication,
    private readonly origins: readonly string[],
  ) {
    super(app);
  }

  /**
   * Socket.io's own constructor accepts a partial options object and fills
   * every missing key with its default; the framework's `ServerOptions`
   * type marks those same keys required, so the merge is cast once here —
   * the defaults exist the moment `new Server(...)` runs.
   */
  createIOServer(port: number, options?: Partial<ServerOptions>): Server {
    return super.createIOServer(port, {
      ...options,
      cors: { origin: [...this.origins], credentials: true },
    } as ServerOptions);
  }
}

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

  // Security headers and a strict CORS allow-list read from config. The same
  // allow-list governs the WebSocket handshake (see CorsIoAdapter).
  const corsOrigins = parseCorsOrigins(
    config.getOrThrow<string>('CORS_ORIGINS'),
  );
  app.use(helmet());
  app.enableCors({
    origin: corsOrigins,
    credentials: true,
  });
  app.useWebSocketAdapter(new CorsIoAdapter(app, corsOrigins));

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
