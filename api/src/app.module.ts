import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'node:crypto';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HttpExceptionFilter } from './common/errors/http-exception.filter.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';
import { CustomersModule } from './modules/customers/customers.module.js';
import { DriversModule } from './modules/drivers/drivers.module.js';
import { FleetModule } from './modules/fleet/fleet.module.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { PricingModule } from './modules/pricing/pricing.module.js';
import { ShipmentsModule } from './modules/shipments/shipments.module.js';
import { DispatchModule } from './modules/dispatch/dispatch.module.js';
import { RoutingModule } from './modules/routing/routing.module.js';
import { TrackingModule } from './modules/tracking/tracking.module.js';
import { ProofOfDeliveryModule } from './modules/proof-of-delivery/proof-of-delivery.module.js';
import { BillingModule } from './modules/billing/billing.module.js';
import { ReportingModule } from './modules/reporting/reporting.module.js';
import { OutboxModule } from './modules/outbox/outbox.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { RateLimitsModule } from './modules/ratelimits/rate-limits.module.js';
import { GeofencingModule } from './modules/geofencing/geofencing.module.js';
import { AssetsModule } from './modules/assets/assets.module.js';
import { ComplianceModule } from './modules/compliance/compliance.module.js';
import { TenantsModule } from './modules/tenants/tenants.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { MessagingModule } from './shared/messaging/messaging.module.js';
import { TenancyModule } from './shared/tenancy/tenancy.module.js';
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
    // The database (as the restricted runtime role) must exist before the
    // tenancy kernel wires its transaction adapter to the DataSource.
    DatabaseModule,
    TenancyModule,
    // The event-bus port (global) must be registered before modules that
    // publish or listen; NotificationsModule subscribes to its events.
    MessagingModule,
    HealthModule,
    IdentityModule,
    TenantsModule,
    CustomersModule,
    FleetModule,
    DriversModule,
    PricingModule,
    ShipmentsModule,
    DispatchModule,
    RoutingModule,
    NotificationsModule,
    TrackingModule,
    ProofOfDeliveryModule,
    BillingModule,
    ReportingModule,
    OutboxModule,
    IdempotencyModule,
    RateLimitsModule,
    GeofencingModule,
    AssetsModule,
    ComplianceModule,
    // Rate limiting for the anonymous surfaces (public tracking, OTP
    // verification). The default is deliberately generous — it only exists
    // to stop a scrape; the two endpoints named above tighten it with
    // `@Throttle`, and the guard answers 429 with a Retry-After header.
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 300 }],
    }),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
