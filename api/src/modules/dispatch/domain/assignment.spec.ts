import {
  Assignment,
  AssignmentDomainError,
} from './assignment.js';

function expectDomainError(fn: () => void, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (error: unknown) {
    caught = error;
  }
  expect((caught as AssignmentDomainError).code).toBe(code);
}

function offer(expiresAt = new Date(Date.now() + 15 * 60_000)): Assignment {
  const assignment = Assignment.offer({
    id: 'as-1',
    tenantId: 't-1',
    shipmentId: 's-1',
    driverId: 'd-1',
    vehicleId: 'v-1',
    expiresAt,
  });
  // The application layer publishes AssignmentOffered immediately after the
  // insert, so later transitions in these tests model a fresh queue.
  assignment.pullDomainEvents();
  return assignment;
}

describe('Assignment aggregate', () => {
  it('starts offered, live, and unresponded', () => {
    const assignment = offer();
    expect(assignment.status).toBe('offered');
    expect(assignment.isLive).toBe(true);
    expect(assignment.respondedAt).toBeNull();
    expect(assignment.reason).toBeNull();
  });

  it('raises AssignmentOffered when the offer is created', () => {
    const expiresAt = new Date('2026-01-01T10:15:00Z');
    const assignment = Assignment.offer({
      id: 'as-1',
      tenantId: 't-1',
      shipmentId: 's-1',
      driverId: 'd-1',
      vehicleId: 'v-1',
      expiresAt,
    });

    const events = assignment.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('AssignmentOffered');
    expect(events[0].payload).toMatchObject({
      assignmentId: 'as-1',
      shipmentId: 's-1',
      driverId: 'd-1',
      vehicleId: 'v-1',
      expiresAt: expiresAt.toISOString(),
    });
  });

  it('accepts: stamps the response, holds the pair, raises DriverAssigned', () => {
    const assignment = offer();
    assignment.accept();

    expect(assignment.status).toBe('accepted');
    expect(assignment.isLive).toBe(true);
    expect(assignment.respondedAt).toBeInstanceOf(Date);

    const events = assignment.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('DriverAssigned');
    expect(events[0].payload).toMatchObject({
      assignmentId: 'as-1',
      shipmentId: 's-1',
      driverId: 'd-1',
      vehicleId: 'v-1',
    });
    // Drained: a second pull is empty, so nothing publishes twice.
    expect(assignment.pullDomainEvents()).toEqual([]);
  });

  it('rejects with a reason and raises AssignmentRejected', () => {
    const assignment = offer();
    assignment.reject('too far');

    expect(assignment.status).toBe('rejected');
    expect(assignment.isLive).toBe(false);
    expect(assignment.reason).toBe('too far');
    expect(assignment.pullDomainEvents()[0].type).toBe('AssignmentRejected');
    expect(assignment.pullDomainEvents()).toEqual([]);
  });

  it('expires an overdue offer and raises AssignmentExpired', () => {
    const assignment = offer(new Date(Date.now() - 1_000));
    expect(assignment.isOverdue(new Date())).toBe(true);
    expect(offer().isOverdue(new Date())).toBe(false);

    assignment.expire();
    expect(assignment.status).toBe('expired');
    expect(assignment.pullDomainEvents()[0].type).toBe('AssignmentExpired');
  });

  it('cancels a pending offer and an accepted job, raising AssignmentCancelled', () => {
    const pending = offer();
    pending.cancel('dispatcher changed plans');
    expect(pending.status).toBe('cancelled');
    expect(pending.reason).toBe('dispatcher changed plans');
    expect(pending.pullDomainEvents()[0].type).toBe('AssignmentCancelled');

    const accepted = offer();
    accepted.accept();
    accepted.pullDomainEvents();
    accepted.cancel();
    expect(accepted.status).toBe('cancelled');
    expect(accepted.isLive).toBe(false);
  });

  it('guards the lifecycle: terminal assignments cannot move', () => {
    const rejected = offer();
    rejected.reject();
    expectDomainError(() => rejected.accept(), 'ASSIGNMENT_NOT_OFFERED');
    expectDomainError(() => rejected.expire(), 'ASSIGNMENT_NOT_OFFERED');
    expectDomainError(() => rejected.cancel(), 'ASSIGNMENT_NOT_LIVE');

    const accepted = offer();
    accepted.accept();
    expectDomainError(() => accepted.reject(), 'ASSIGNMENT_NOT_OFFERED');
  });

  it('rehydrates with its persisted state and drains nothing', () => {
    const assignment = Assignment.rehydrate({
      id: 'as-2',
      tenantId: 't-1',
      shipmentId: 's-2',
      driverId: 'd-2',
      vehicleId: null,
      status: 'accepted',
      offeredAt: new Date('2026-01-01T10:00:00Z'),
      expiresAt: new Date('2026-01-01T10:15:00Z'),
      respondedAt: new Date('2026-01-01T10:05:00Z'),
      reason: null,
      createdAt: new Date('2026-01-01T10:00:00Z'),
      updatedAt: new Date('2026-01-01T10:05:00Z'),
    });
    expect(assignment.status).toBe('accepted');
    expect(assignment.vehicleId).toBeNull();
    expect(assignment.pullDomainEvents()).toEqual([]);
  });
});
