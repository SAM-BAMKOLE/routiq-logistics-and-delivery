import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { validate } from '../../src/config/env.validation.js';
import { DatabaseModule } from '../../src/database/database.module.js';
import { OutboxRelayService } from '../../src/modules/outbox/application/outbox-relay.service.js';
import { OutboxService } from '../../src/modules/outbox/application/outbox.service.js';
import { EVENT_BUS, type EventBus } from '../../src/shared/messaging/event-bus.js';
import {
  createEnvelope,
  type DomainEventEnvelope,
} from '../../src/shared/messaging/event-envelope.js';
import { MessagingModule } from '../../src/shared/messaging/messaging.module.js';
import { TenancyModule } from '../../src/shared/tenancy/tenancy.module.js';
import {
  createOwnerDataSource,
  ensureSchema,
} from './helpers/database.js';
import { readDatabaseState } from './helpers/state.js';

/** A listener the test can script to fail, so the relay has work to retry. */
@Injectable()
class ProbeListener {
  readonly seen: Array<{ eventId: string; tenantId: string | null }> = [];
  failNext = 0;

  @OnEvent('OutboxProbe', { suppressErrors: false })
  async handle(event: DomainEventEnvelope<{ note?: string }>): Promise<void> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw new Error('probe listener is down');
    }
    this.seen.push({ eventId: event.id, tenantId: event.tenantId });
  }
}

/**
 * The outbox against the real database: the bus persists before delivering,
 * the relay claims work across tenants (its table is global), and it retries a
 * failed delivery with the attempt recorded.
 */
describe('Outbox (integration)', () => {
  let app: INestApplication;
  let bus: EventBus;
  let relay: OutboxRelayService;
  let outbox: OutboxService;
  let probe: ProbeListener;
  let owner: DataSource;
  let appDb: DataSource;

  let tenantA: string;
  let tenantB: string;

  beforeAll(async () => {
    await ensureSchema();
    owner = await createOwnerDataSource();

    const tenants = (await owner.query(
      `INSERT INTO tenants (name, slug) VALUES ($1, $2), ($3, $4) RETURNING id`,
      ['Outbox A', `outbox-a-${randomUUID()}`, 'Outbox B', `outbox-b-${randomUUID()}`],
    )) as Array<{ id: string }>;
    [tenantA, tenantB] = tenants.map((row) => row.id);

    process.env.DATABASE_URL = readDatabaseState().appUrl;
    process.env.JWT_ACCESS_SECRET = 'integration-test-access-secret-min-32-chars';

    // The outbox table is global and shared across the whole run; this suite
    // asserts exact claim counts, so start from an empty table.
    await owner.query('DELETE FROM outbox_messages');

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate }),
        DatabaseModule,
        TenancyModule,
        MessagingModule,
      ],
      providers: [ProbeListener],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();

    bus = app.get(EVENT_BUS);
    relay = app.get(OutboxRelayService);
    outbox = app.get(OutboxService);
    probe = app.get(ProbeListener);
    appDb = app.get(DataSource);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    if (appDb?.isInitialized) {
      await appDb.destroy();
    }
    if (owner?.isInitialized) {
      await owner.destroy();
    }
  });

  it('persists an event and delivers it inline', async () => {
    const event = createEnvelope({
      type: 'OutboxProbe',
      tenantId: tenantA,
      aggregateType: 'Shipment',
      aggregateId: randomUUID(),
      payload: {},
    });

    await bus.publish(event);

    expect(probe.seen.map((entry) => entry.eventId)).toContain(event.id);
    const row = await appDb.query(
      `SELECT status, processed_at FROM outbox_messages WHERE event_id = $1`,
      [event.id],
    );
    expect(row[0].status).toBe('processed');
    expect(row[0].processed_at).not.toBeNull();
  });

  it('retries a failed inline delivery through the relay', async () => {
    probe.failNext = 1;
    const event = createEnvelope({
      type: 'OutboxProbe',
      tenantId: tenantA,
      aggregateType: 'Shipment',
      aggregateId: randomUUID(),
      payload: {},
    });

    await bus.publish(event);

    // The inline attempt failed: the row is pending and holds the attempt.
    const pending = await appDb.query(
      `SELECT status, attempts FROM outbox_messages WHERE event_id = $1`,
      [event.id],
    );
    expect(pending[0]).toMatchObject({ status: 'pending', attempts: 1 });
    expect(probe.seen.map((entry) => entry.eventId)).not.toContain(event.id);

    // Make it due now and let the relay deliver it.
    await owner.query(
      `UPDATE outbox_messages SET available_at = now() WHERE event_id = $1`,
      [event.id],
    );
    const result = await relay.relayOnce();

    expect(result.delivered).toBe(1);
    expect(probe.seen.map((entry) => entry.eventId)).toContain(event.id);
    const done = await appDb.query(
      `SELECT status FROM outbox_messages WHERE event_id = $1`,
      [event.id],
    );
    expect(done[0].status).toBe('processed');
  });

  it('claims pending work across tenants and for a global event', async () => {
    const forA = createEnvelope({
      type: 'OutboxProbe',
      tenantId: tenantA,
      aggregateType: 'Shipment',
      aggregateId: randomUUID(),
      payload: {},
    });
    const forB = createEnvelope({
      type: 'OutboxProbe',
      tenantId: tenantB,
      aggregateType: 'Shipment',
      aggregateId: randomUUID(),
      payload: {},
    });
    const global = createEnvelope({
      type: 'OutboxProbe',
      tenantId: null,
      aggregateType: 'User',
      aggregateId: randomUUID(),
      payload: {},
    });

    await outbox.append(forA);
    await outbox.append(forB);
    await outbox.append(global);

    const result = await relay.relayOnce();

    expect(result.claimed).toBe(3);
    expect(result.delivered).toBe(3);
    const ids = probe.seen.map((entry) => entry.eventId);
    expect(ids).toEqual(expect.arrayContaining([forA.id, forB.id, global.id]));
  });
});
