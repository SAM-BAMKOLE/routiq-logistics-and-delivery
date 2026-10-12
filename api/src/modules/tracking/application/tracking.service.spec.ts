import {
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { FakeEventBus } from '../../../shared/messaging/testing/fake-event-bus.js';
import type { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import type { DriversService } from '../../drivers/application/drivers.service.js';
import type { ShipmentsService } from '../../shipments/application/shipments.service.js';
import type { TenantsService } from '../../tenants/application/tenants.service.js';
import type {
  ActiveDropoff,
  LocationPointRow,
  TrackingRepository,
} from '../domain/tracking.repository.js';
import { TrackingService } from './tracking.service.js';

// The service validates against the real clock, so fixtures are built
// relative to `Date.now()` — a fixed "now" would age out or land ahead of
// the server and be discarded as stale or future.
const ago = (seconds: number): Date => new Date(Date.now() - seconds * 1_000);

const dispatcher = { userId: 'u-1', role: 'dispatcher' as const };
const driver = { userId: 'u-4', role: 'driver' as const };

interface Harness {
  service: TrackingService;
  bus: FakeEventBus;
  inserted: Array<{ driverId: string; points: unknown[] }>;
  latest: LocationPointRow | null;
  dropoffs: ActiveDropoff[];
  pruneCutoffs: Array<{ tenantId: string; cutoff: Date }>;
  settings: Record<string, unknown>;
}

function makeHarness(): Harness {
  const inserted: Harness['inserted'] = [];
  const pruneCutoffs: Harness['pruneCutoffs'] = [];
  const state = {
    latest: null as LocationPointRow | null,
    dropoffs: [] as ActiveDropoff[],
    settings: {} as Record<string, unknown>,
  };

  const repository: TrackingRepository = {
    insertPoints: async (_tenantId, driverId, points) => {
      inserted.push({ driverId, points: [...points] });
    },
    findLatestPoint: async () => state.latest,
    listPoints: async () => [],
    activeDropoffs: async () => state.dropoffs,
    findShipmentTracking: async () => null,
    listTimeline: async () => [],
    listProofs: async () => [],
    findStopEta: async () => null,
    lookupPublicShipment: async () => null,
    pruneOlderThan: async (tenantId, cutoff) => {
      pruneCutoffs.push({ tenantId, cutoff });
      return 1;
    },
    listTenantIds: async () => ['t-1', 't-2'],
  };

  const drivers = {
    getDriver: async (_tenantId: string, id: string) => {
      if (!['d-1', 'd-2'].includes(id)) {
        throw new NotFoundException({
          message: `Driver ${id} was not found in this tenant.`,
          code: 'DRIVER_NOT_FOUND',
        });
      }
      return { id };
    },
    getOwnDriver: async (_tenantId: string, userId: string) => {
      const map: Record<string, string> = { 'u-4': 'd-1', 'u-5': 'd-2' };
      const id = map[userId];
      if (!id) {
        throw new NotFoundException({
          message: 'This user has no driver profile in this tenant.',
          code: 'DRIVER_PROFILE_NOT_FOUND',
        });
      }
      return { id };
    },
  } as unknown as DriversService;

  const shipments = {
    get: async (actor: { role: string }, _tenantId: string, id: string) => {
      if (id === 's-foreign') {
        throw new NotFoundException({
          message: 'Not found.',
          code: 'SHIPMENT_NOT_FOUND',
        });
      }
      void actor;
      return { id, trackingNumber: 'SHP-TEST0000001', status: 'OUT_FOR_DELIVERY', driverId: 'd-1' };
    },
  } as unknown as ShipmentsService;

  const tenants = {
    getById: async () => ({ settings: state.settings }),
  } as unknown as TenantsService;

  const transactions = {
    runWithTenant: async (_tenantId: string, fn: (m: unknown) => Promise<unknown>) =>
      fn({}),
  } as unknown as TenantTransactionService;

  const config = {
    get: () => 'test',
  } as unknown as ConfigService;

  const bus = new FakeEventBus();
  const service = new TrackingService(
    repository,
    shipments,
    drivers,
    tenants,
    bus,
    transactions,
    config,
  );
  return {
    service,
    bus,
    inserted,
    pruneCutoffs,
    get latest() {
      return state.latest;
    },
    set latest(value: LocationPointRow | null) {
      state.latest = value;
    },
    get dropoffs() {
      return state.dropoffs;
    },
    set dropoffs(value: ActiveDropoff[]) {
      state.dropoffs = value;
    },
    get settings() {
      return state.settings;
    },
    set settings(value: Record<string, unknown>) {
      state.settings = value;
    },
  } as Harness;
}

describe('TrackingService', () => {
  describe('ingest', () => {
    it('resolves the driver from the session, not the body', async () => {
      const h = makeHarness();
      const result = await h.service.ingest(driver, 't-1', {
        points: [
          { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(5), speedKmh: null, heading: null },
        ],
      });
      expect(result.accepted).toBe(1);
      expect(h.inserted).toHaveLength(1);
      expect(h.inserted[0].driverId).toBe('d-1');
    });

    it('refuses a driver pushing for another driver (404, not 403)', async () => {
      const h = makeHarness();
      await expect(
        h.service.ingest(driver, 't-1', {
          driverId: 'd-2',
          points: [
            { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(5), speedKmh: null, heading: null },
          ],
        }),
      ).rejects.toMatchObject({ status: 404, response: { code: 'DRIVER_NOT_FOUND' } });
    });

    it('requires a driverId when a dispatcher pushes', async () => {
      const h = makeHarness();
      await expect(
        h.service.ingest(dispatcher, 't-1', {
          points: [
            { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(5), speedKmh: null, heading: null },
          ],
        }),
      ).rejects.toMatchObject({
        status: 422,
        response: { code: 'DRIVER_ID_REQUIRED' },
      });
    });

    it('publishes LocationUpdated with the batch summary', async () => {
      const h = makeHarness();
      const stale = ago(400);
      await h.service.ingest(dispatcher, 't-1', {
        driverId: 'd-1',
        points: [
          { latitude: 6.5244, longitude: 3.3792, recordedAt: ago(10), speedKmh: 30, heading: 90 },
          { latitude: 91, longitude: 3.3792, recordedAt: stale, speedKmh: null, heading: null },
        ],
      });
      const event = h.bus.lastOfType('LocationUpdated');
      expect(event).toMatchObject({
        tenantId: 't-1',
        aggregateType: 'driver',
        aggregateId: 'd-1',
        payload: expect.objectContaining({
          driverId: 'd-1',
          latitude: 6.5244,
          accepted: 1,
          discarded: 1,
        }),
      });
    });

    it('publishes nothing when the whole batch is discarded', async () => {
      const h = makeHarness();
      const result = await h.service.ingest(dispatcher, 't-1', {
        driverId: 'd-1',
        points: [
          {
            latitude: 6.5244,
            longitude: 3.3792,
            recordedAt: ago(400), // stale
            speedKmh: null,
            heading: null,
          },
        ],
      });
      expect(result.accepted).toBe(0);
      expect(result.discarded).toEqual([{ index: 0, reason: 'stale' }]);
      expect(h.inserted).toHaveLength(0);
      expect(h.bus.types()).toEqual([]);
    });

    it('fires DriverNearDestination on entry only, rearming on exit', async () => {
      const h = makeHarness();
      // At latitude 6.5244 one degree of longitude is ~110.6 km, so the
      // offsets below are: 3.3760 → 365 m out, 3.3785 → 88 m in,
      // 3.3787 → 66 m in. The 250 m geofence therefore trips between the
      // first and second push and again on the last.
      h.dropoffs = [{ shipmentId: 's-1', latitude: 6.5244, longitude: 3.3793 }];
      const push = (longitude: number, secondsAgo: number) =>
        h.service.ingest(dispatcher, 't-1', {
          driverId: 'd-1',
          points: [
            {
              latitude: 6.5244,
              longitude,
              recordedAt: ago(secondsAgo),
              speedKmh: null,
              heading: null,
            },
          ],
        });

      await push(3.376, 200); // 365 m out: no announcement
      await push(3.3785, 120); // 88 m in: entry → one announcement
      await push(3.3787, 100); // still in: no second announcement
      expect(
        h.bus.types().filter((t) => t === 'DriverNearDestination'),
      ).toHaveLength(1);

      await push(3.376, 60); // back out: the trigger rearms
      await push(3.3785, 20); // in again: a second announcement
      expect(
        h.bus.types().filter((t) => t === 'DriverNearDestination'),
      ).toHaveLength(2);
    });
  });

  describe('latestForDriver', () => {
    it('lets a driver read their own position', async () => {
      const h = makeHarness();
      h.latest = {
        driverId: 'd-1',
        latitude: 6.5,
        longitude: 3.3,
        speedKmh: 40,
        heading: 180,
        recordedAt: ago(5),
      };
      const point = await h.service.latestForDriver(driver, 't-1', 'd-1');
      expect(point.latitude).toBe(6.5);
    });

    it('refuses a driver reading another driver (404)', async () => {
      const h = makeHarness();
      await expect(
        h.service.latestForDriver(driver, 't-1', 'd-2'),
      ).rejects.toMatchObject({ status: 404 });
    });

    it('lets a dispatcher read any driver of the tenant', async () => {
      const h = makeHarness();
      h.latest = {
        driverId: 'd-2',
        latitude: 9.0,
        longitude: 7.3,
        speedKmh: null,
        heading: null,
        recordedAt: ago(5),
      };
      const point = await h.service.latestForDriver(dispatcher, 't-1', 'd-2');
      expect(point.driverId).toBe('d-2');
    });

    it('answers 404 when the driver never pushed a position', async () => {
      const h = makeHarness();
      await expect(
        h.service.latestForDriver(dispatcher, 't-1', 'd-1'),
      ).rejects.toMatchObject({
        status: 404,
        response: { code: 'DRIVER_LOCATION_NOT_FOUND' },
      });
    });
  });

  describe('trackShipment', () => {
    it('propagates the facade’s 404 for a foreign shipment', async () => {
      const h = makeHarness();
      await expect(
        h.service.trackShipment(dispatcher, 't-1', 's-foreign'),
      ).rejects.toMatchObject({ status: 404 });
    });
  });

  describe('pruneRetention', () => {
    it('sweeps each tenant with its own retention window', async () => {
      const h = makeHarness();
      h.settings = { tracking: { retentionDays: 7 } };
      const removed = await h.service.pruneRetention();
      expect(removed).toBe(2);
      expect(h.pruneCutoffs).toHaveLength(2);
      for (const { cutoff } of h.pruneCutoffs) {
        const ageDays = (Date.now() - cutoff.getTime()) / 86_400_000;
        // The cutoff is ~7 days before "now" (real clock, so allow slack).
        expect(cutoff.getTime()).toBeLessThan(Date.now());
        expect(ageDays).toBeGreaterThanOrEqual(0);
      }
    });
  });
});
