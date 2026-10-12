import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { OnEvent } from '@nestjs/event-emitter';
import type { Server, Socket } from 'socket.io';
import type { TenantPrincipal } from '../../../shared/tenancy/tenant-context.js';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { TenantTransactionService } from '../../../shared/tenancy/tenant-transaction.service.js';
import type { DomainEventEnvelope } from '../../../shared/messaging/event-envelope.js';
import { SessionValidator } from '../../identity/application/session-validator.js';
import {
  isRole,
  roleHasPermission,
  type Role,
} from '../../identity/domain/membership.js';
import { DriversService } from '../../drivers/application/drivers.service.js';
import { RoutingService } from '../../routing/application/routing.service.js';
import { ShipmentsService } from '../../shipments/application/shipments.service.js';
import {
  TrackingService,
  type TrackingActor,
} from '../application/tracking.service.js';
import {
  driverRoom,
  parseRoom,
  routeRoom,
  shipmentRoom,
  tenantRoom,
} from '../domain/room.js';

/** Acknowledgement shape of every client message. */
type Ack =
  | { ok: true; room?: string; accepted?: number; discarded?: unknown[] }
  | { ok: false; error: { code: string; message: string } };

interface LocationUpdateMessage {
  readonly driverId?: string;
  readonly points?: Array<{
    latitude?: unknown;
    longitude?: unknown;
    recordedAt?: unknown;
    speedKmh?: unknown;
    heading?: unknown;
  }>;
}

/**
 * The Socket.IO gateway: live tracking for dispatchers, drivers, and the
 * customer-facing apps.
 *
 * Authentication happens on handshake, not per message: the same
 * {@link SessionValidator} the HTTP guard uses verifies the token and
 * revalidates the membership against the database, so a suspended user's
 * open socket dies on their next connection and never gets a room. Every
 * socket lands in its tenant's room; `room:join` adds a driver, shipment, or
 * route room after the owning module confirms this principal may see that
 * row (a foreign id is refused the same way HTTP answers 404 — no leak).
 *
 * Message handlers open their own tenant transaction (there is no HTTP
 * interceptor here), and the `@OnEvent` handlers below rebroadcast domain
 * events emitted anywhere in the app to the rooms that care. Phase 2 swaps
 * the in-process adapter for the Redis adapter; the surface stays identical.
 */
@WebSocketGateway({ namespace: '/tracking' })
@Injectable()
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  constructor(
    private readonly sessions: SessionValidator,
    private readonly context: TenantContextService,
    private readonly transactions: TenantTransactionService,
    private readonly tracking: TrackingService,
    private readonly shipments: ShipmentsService,
    private readonly drivers: DriversService,
    private readonly routing: RoutingService,
  ) {}

  afterInit(): void {
    this.logger.log('tracking gateway listening on namespace /tracking');
  }

  /**
   * Verifies the handshake token and parks the socket in its tenant room.
   * A socket with no valid session is told why, then disconnected — it can
   * never observe an event or join a room.
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = readHandshakeToken(client);
      const principal = await this.sessions.validate(token);
      client.data['principal'] = principal;
      await client.join(tenantRoom(principal.tenantId));
      // A driver lands in their own room too: the offer feed (`offer:new`)
      // targets `driver:{id}`, and a driver should not have to ask for the
      // room that is already theirs. No driver profile means no room — the
      // membership can exist before the profile row does.
      if (principal.role === 'driver') {
        try {
          const own = await this.transactions.runWithTenant(
            principal.tenantId,
            () => this.drivers.getOwnDriver(principal.tenantId, principal.userId),
          );
          await client.join(driverRoom(own.id));
        } catch {
          // No profile yet: the tenant room alone is still a valid session.
        }
      }
      client.emit('session', {
        tenantId: principal.tenantId,
        role: principal.role,
      });
    } catch (error) {
      client.emit('tracking:error', wsAuthError(error));
      client.disconnect(true);
    }
  }

  handleDisconnect(_client: Socket): void {
    this.logger.debug(
      { sockets: this.server.sockets.sockets.size },
      'socket disconnected',
    );
  }

  /**
   * Joins a room after proving the caller may see its row. Refusals are
   * deliberately identical for "does not exist" and "belongs to another
   * tenant" — the socket never learns which.
   */
  @SubscribeMessage('room:join')
  async onRoomJoin(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: unknown },
  ): Promise<Ack> {
    const principal = principalOf(client);
    if (!principal) {
      return refuse('NOT_AUTHENTICATED', 'The socket has no valid session.');
    }
    const parsed = parseRoom(body?.room);
    if (!parsed) {
      return refuse(
        'ROOM_INVALID',
        'A room is `<kind>:<uuid>` with kind tenant|driver|shipment|route.',
      );
    }

    const actor = toActor(principal);
    try {
      // Every authorization read below goes through a tenant-scoped
      // repository, so the whole check runs inside the tenant transaction:
      // otherwise RLS has no `app.tenant_id` and the facade would 404 even
      // for rows the caller owns.
      await this.transactions.runWithTenant(principal.tenantId, async () => {
        switch (parsed.kind) {
          case 'tenant':
            // Already joined at handshake; a foreign tenant is refused.
            if (parsed.id !== principal.tenantId) {
              throw new Error('foreign tenant');
            }
            break;
          case 'driver':
            if (!(await this.mayObserveDriver(actor, parsed.id))) {
              throw new Error('driver not visible');
            }
            break;
          case 'shipment':
            // The facade scopes by role: customers their own, drivers their
            // assignments, dispatchers everything. Anything else throws 404.
            await this.shipments.get(actor, principal.tenantId, parsed.id);
            break;
          case 'route':
            await this.routing.getRoute(actor, principal.tenantId, parsed.id);
            break;
        }
      });
      await client.join(`${parsed.kind}:${parsed.id}`);
      return { ok: true, room: `${parsed.kind}:${parsed.id}` };
    } catch {
      return refuse('ROOM_FORBIDDEN', 'That resource is not visible to you.');
    }
  }

  @SubscribeMessage('room:leave')
  async onRoomLeave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { room?: unknown },
  ): Promise<Ack> {
    const parsed = parseRoom(body?.room);
    if (!parsed) {
      return refuse('ROOM_INVALID', 'A room is `<kind>:<uuid>`.');
    }
    await client.leave(`${parsed.kind}:${parsed.id}`);
    return { ok: true, room: `${parsed.kind}:${parsed.id}` };
  }

  /**
   * The WebSocket twin of `POST /tracking/locations`: same validation, same
   * discard reasons, same events — the ack reports what was kept so a driver
   * app can flush its offline queue and move on.
   */
  @SubscribeMessage('location:update')
  async onLocationUpdate(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: LocationUpdateMessage,
  ): Promise<Ack> {
    const principal = principalOf(client);
    if (!principal) {
      return refuse('NOT_AUTHENTICATED', 'The socket has no valid session.');
    }
    const points = parsePoints(body);
    if (points === null) {
      return refuse(
        'LOCATION_INVALID',
        'Each point needs finite latitude [-90,90], longitude [-180,180], ' +
          'and a parseable recordedAt timestamp.',
      );
    }
    const driverId =
      typeof body?.driverId === 'string' ? body.driverId : null;

    try {
      // Handlers run outside the HTTP pipeline: establish the principal and
      // open the tenant transaction by hand, exactly as the interceptor
      // would for a REST call.
      return await this.context.runWith(principal, () =>
        this.transactions.inTenantTransaction(async () => {
          const result = await this.tracking.ingest(
            toActor(principal),
            principal.tenantId,
            { driverId, points },
          );
          return {
            ok: true as const,
            accepted: result.accepted,
            discarded: result.discarded,
          };
        }),
      );
    } catch (error) {
      return refuse(
        wsErrorCode(error),
        wsErrorMessage(error, 'Could not store the location update.'),
      );
    }
  }

  /* --------------------------------------------------------------------- *
   * Domain event rebroadcasts. These run in the publisher's context (the
   * transaction that emitted the event) and only touch socket.io rooms —
   * no database access, nothing that can fail the publisher.
   * --------------------------------------------------------------------- */

  @OnEvent('LocationUpdated')
  onLocationUpdated(event: DomainEventEnvelope): void {
    const payload = event.payload;
    const rawDriverId = payload['driverId'];
    if (typeof rawDriverId !== 'string' || rawDriverId.length === 0) {
      return;
    }
    const driverId = rawDriverId;
    const message = {
      driverId,
      latitude: payload['latitude'],
      longitude: payload['longitude'],
      speedKmh: payload['speedKmh'] ?? null,
      heading: payload['heading'] ?? null,
      recordedAt: payload['recordedAt'],
    };
    if (!event.tenantId) {
      return;
    }
    this.emitToRoom(tenantRoom(event.tenantId), 'driver:location', message);
    const shipmentIds = Array.isArray(payload['shipmentIds'])
      ? (payload['shipmentIds'] as unknown[])
      : [];
    for (const shipmentId of shipmentIds) {
      if (typeof shipmentId === 'string') {
        this.emitToRoom(shipmentRoom(shipmentId), 'driver:location', message);
      }
    }
  }

  @OnEvent('ShipmentStatusChanged')
  onShipmentStatusChanged(event: DomainEventEnvelope): void {
    const message = {
      shipmentId: event.aggregateId,
      status: event.payload['toStatus'],
      previousStatus: event.payload['fromStatus'] ?? null,
      occurredAt: event.occurredAt,
    };
    if (event.tenantId) {
      this.emitToRoom(tenantRoom(event.tenantId), 'shipment:status', message);
    }
    this.emitToRoom(
      shipmentRoom(event.aggregateId),
      'shipment:status',
      message,
    );
  }

  @OnEvent('RoutePlanned')
  onRoutePlanned(event: DomainEventEnvelope): void {
    this.routeUpdated(event);
  }

  @OnEvent('RouteReplanned')
  onRouteReplanned(event: DomainEventEnvelope): void {
    this.routeUpdated(event);
  }

  @OnEvent('AssignmentOffered')
  onAssignmentOffered(event: DomainEventEnvelope): void {
    const driverId = event.payload['driverId'];
    if (typeof driverId !== 'string') {
      return;
    }
    this.emitToRoom(driverRoom(driverId), 'offer:new', {
      assignmentId: event.aggregateId,
      shipmentId: event.payload['shipmentId'],
      driverId,
      vehicleId: event.payload['vehicleId'] ?? null,
      pickupAddressId: event.payload['pickupAddressId'] ?? null,
      dropoffAddressId: event.payload['dropoffAddressId'] ?? null,
      expiresAt: event.payload['expiresAt'],
      offeredAt: event.occurredAt,
    });
  }

  private routeUpdated(event: DomainEventEnvelope): void {
    const message = {
      routeId: event.aggregateId,
      driverId: event.payload['driverId'] ?? null,
      planDate: event.payload['planDate'] ?? null,
      stopCount: event.payload['stopCount'] ?? null,
      totalDistanceM: event.payload['totalDistanceM'] ?? null,
      totalDurationS: event.payload['totalDurationS'] ?? null,
      occurredAt: event.occurredAt,
    };
    if (event.tenantId) {
      this.emitToRoom(tenantRoom(event.tenantId), 'route:updated', message);
    }
    this.emitToRoom(routeRoom(event.aggregateId), 'route:updated', message);
  }

  /** One emit, guarded: a dead room is never an error worth logging twice. */
  private emitToRoom(room: string, name: string, payload: unknown): void {
    this.server.to(room).emit(name, payload);
  }

  /** Drivers see their own room; everyone else needs `drivers:read`. */
  private async mayObserveDriver(
    actor: WsActor,
    driverId: string,
  ): Promise<boolean> {
    if (actor.role === 'driver') {
      try {
        const own = await this.drivers.getOwnDriver(
          actor.tenantIdOfContext,
          actor.userId,
        );
        return own.id === driverId;
      } catch {
        return false;
      }
    }
    if (!roleHasPermission(actor.role, 'drivers:read')) {
      return false;
    }
    try {
      await this.drivers.getDriver(actor.tenantIdOfContext, driverId);
      return true;
    } catch {
      return false;
    }
  }
}

/* ----------------------------- helpers ----------------------------- */

function readHandshakeToken(client: Socket): string {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  const query = client.handshake.query as { token?: unknown } | undefined;
  const raw = auth?.token ?? query?.token;
  if (typeof raw === 'string' && raw.length > 0) {
    return raw;
  }
  throw new HttpException(
    { message: 'A Bearer access token is required.', code: 'ACCESS_TOKEN_MISSING' },
    401,
  );
}

function principalOf(client: Socket): TenantPrincipal | null {
  const principal = client.data['principal'] as TenantPrincipal | undefined;
  return principal ?? null;
}

/**
 * The service actor plus the tenant it came from: WS handlers carry the
 * tenant on the principal (there is no request-scoped context service value
 * until `runWith` installs one), so the driver-room check reads it here.
 */
interface WsActor extends TrackingActor {
  readonly tenantIdOfContext: string;
}

function toActor(principal: TenantPrincipal): WsActor {
  const role: unknown = principal.role;
  return {
    userId: principal.userId,
    role: (isRole(role) ? role : 'dispatcher') as Role,
    tenantIdOfContext: principal.tenantId,
  };
}

function refuse(code: string, message: string): Ack {
  return { ok: false, error: { code, message } };
}

/** Maps a thrown Nest exception (from a service) onto an ack error. */
function wsErrorCode(error: unknown): string {
  const body = (error as HttpException | undefined)?.getResponse?.();
  if (body && typeof body === 'object' && typeof (body as { code?: unknown }).code === 'string') {
    return (body as { code: string }).code;
  }
  return 'LOCATION_REJECTED';
}

function wsErrorMessage(error: unknown, fallback: string): string {
  const body = (error as HttpException | undefined)?.getResponse?.();
  if (body && typeof body === 'object' && typeof (body as { message?: unknown }).message === 'string') {
    return (body as { message: string }).message;
  }
  return fallback;
}

/** Handshake failures are HttpExceptions from the SessionValidator. */
function wsAuthError(error: unknown): { code: string; message: string } {
  return {
    code: wsErrorCode(error),
    message: wsErrorMessage(error, 'The session could not be established.'),
  };
}

/**
 * Shape-checks a `location:update` payload. Range and timestamp sanity only
 * — staleness, plausibility and thinning belong to the domain, which has a
 * clock and a predecessor to judge against. Returns `null` when unusable.
 */
function parsePoints(
  body: LocationUpdateMessage | undefined,
): Array<{
  latitude: number;
  longitude: number;
  recordedAt: Date;
  speedKmh: number | null;
  heading: number | null;
}> | null {
  if (!body || !Array.isArray(body.points) || body.points.length === 0) {
    return null;
  }
  const points: Array<{
    latitude: number;
    longitude: number;
    recordedAt: Date;
    speedKmh: number | null;
    heading: number | null;
  }> = [];
  for (const point of body.points) {
    const latitude = point?.latitude;
    const longitude = point?.longitude;
    const recordedAt = point?.recordedAt;
    if (
      typeof latitude !== 'number' ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      typeof longitude !== 'number' ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return null;
    }
    const when = new Date(
      typeof recordedAt === 'string' || typeof recordedAt === 'number'
        ? recordedAt
        : NaN,
    );
    if (Number.isNaN(when.getTime())) {
      return null;
    }
    points.push({
      latitude,
      longitude,
      recordedAt: when,
      speedKmh: typeof point?.speedKmh === 'number' ? point.speedKmh : null,
      heading: typeof point?.heading === 'number' ? point.heading : null,
    });
  }
  return points;
}
