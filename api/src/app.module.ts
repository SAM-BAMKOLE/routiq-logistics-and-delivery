import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { HealthModule } from './health/health.module.js';
import { validate } from './config/env.validation.js';

@Module({
  imports: [
    // Validates the environment at boot: the app refuses to start with
    // missing or malformed configuration.
    ConfigModule.forRoot({
      isGlobal: true,
      validate,
      cache: true,
    }),
    // Structured JSON logs with a request ID on every line, so a single
    // request can be traced end to end.
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        pinoHttp: {
          level: config.getOrThrow<string>('LOG_LEVEL'),
          // Reuse an inbound x-request-id when the caller provides one.
          genReqId: (req) => {
            const header = req.headers['x-request-id'];
            if (typeof header === 'string' && header.length > 0) {
              return header;
            }
            return randomUUID();
          },
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
            ],
            censor: '[redacted]',
          },
        },
      }),
    }),
    HealthModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
