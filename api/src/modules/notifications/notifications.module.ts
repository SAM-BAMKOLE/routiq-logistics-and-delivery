import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { EMAIL_LOG_REPOSITORY } from './application/email-log.repository.js';
import { EMAIL_PORT } from './application/email.port.js';
import { IdentityEmailsListener } from './application/identity-emails.listener.js';
import { NotificationsService } from './application/notifications.service.js';
import { ShipmentEmailsListener } from './application/shipment-emails.listener.js';
import { TemplatesService } from './application/templates.service.js';
import { ConsoleEmailAdapter } from './infrastructure/console-email.adapter.js';
import { EmailLogOrmEntity } from './infrastructure/email-log.orm-entity.js';
import { GmailSmtpAdapter } from './infrastructure/gmail-smtp-email.adapter.js';
import { InMemoryEmailAdapter } from './infrastructure/in-memory-email.adapter.js';
import { TypeOrmEmailLogRepository } from './infrastructure/typeorm-email-log.repository.js';

/**
 * Notifications module: renders templates, guards the daily quota, dedupes
 * by event id, sends through the `EmailPort`, and records every attempt in
 * `email_log`. It has no HTTP surface — its drivers are domain events
 * (`@OnEvent` listeners) from Shipments and Identity.
 *
 * The transport is chosen by `EMAIL_ADAPTER`: `gmail` (Nodemailer over
 * smtp.gmail.com), `console` (local development), or `memory` (tests —
 * the default whenever `NODE_ENV=test`). Selecting `gmail` without
 * `SMTP_USER`/`SMTP_PASSWORD` fails at boot, by design.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([EmailLogOrmEntity]),
    TenantsModule,
    CustomersModule,
  ],
  providers: [
    TemplatesService,
    NotificationsService,
    TypeOrmEmailLogRepository,
    { provide: EMAIL_LOG_REPOSITORY, useClass: TypeOrmEmailLogRepository },
    // Always constructed so specs can grab the mailbox (`app.get(...)`)
    // even when another transport is active; only wired to EMAIL_PORT
    // when it is the selected adapter.
    InMemoryEmailAdapter,
    {
      provide: EMAIL_PORT,
      inject: [ConfigService, InMemoryEmailAdapter],
      useFactory: (config: ConfigService, memory: InMemoryEmailAdapter) => {
        const adapter =
          config.get<string>('EMAIL_ADAPTER') ??
          (config.get<string>('NODE_ENV') === 'test' ? 'memory' : 'console');
        switch (adapter) {
          case 'gmail':
            return new GmailSmtpAdapter(config);
          case 'memory':
            return memory;
          case 'console':
            return new ConsoleEmailAdapter();
          default:
            throw new Error(
              `Unknown EMAIL_ADAPTER "${adapter}"; expected gmail, console, or memory.`,
            );
        }
      },
    },
    ShipmentEmailsListener,
    IdentityEmailsListener,
  ],
  exports: [NotificationsService, InMemoryEmailAdapter, EMAIL_LOG_REPOSITORY],
})
export class NotificationsModule {}
