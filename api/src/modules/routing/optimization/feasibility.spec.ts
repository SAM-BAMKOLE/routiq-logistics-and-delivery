import { bestVehicleFor, evaluateRoute, probeStop } from './feasibility.js';
import { gridProblem } from './testing/grid-problem.fixture.js';

describe('evaluateRoute', () => {
  it('schedules a feasible tour: depart, serve, wait for the window, return', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1' }],
      stops: [{ id: 's1', x: 1, y: 0, earliest: 100, latest: 150 }],
    });
    const evaluation = evaluateRoute(problem, problem.vehicles[0], [0]);
    expect(evaluation.feasible).toBe(true);
    expect(evaluation.distanceMeters).toBe(2); // out and back
    const [stop] = evaluation.stops;
    expect(stop.arrivalSeconds).toBe(1);
    expect(stop.waitSeconds).toBe(99); // window opens at 100
    expect(stop.departureSeconds).toBe(100);
    expect(evaluation.returnSeconds).toBe(101);
    expect(evaluation.durationSeconds).toBe(101);
  });

  it('reports capacity violations before window and shift violations', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', weight: 5, shiftEnd: 10 }],
      stops: [
        { id: 's1', x: 50, y: 0, weight: 9, latest: 1 },
      ],
    });
    const evaluation = evaluateRoute(problem, problem.vehicles[0], [0]);
    expect(evaluation.feasible).toBe(false);
    expect(evaluation.reason).toBe('capacity_exceeded');
  });

  it('rejects stops whose window has closed on arrival', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1' }],
      stops: [{ id: 's1', x: 10, y: 0, latest: 5 }],
    });
    const evaluation = evaluateRoute(problem, problem.vehicles[0], [0]);
    expect(evaluation.feasible).toBe(false);
    expect(evaluation.reason).toBe('time_window_infeasible');
  });

  it('rejects tours that cannot return inside the shift', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', shiftEnd: 5 }],
      stops: [{ id: 's1', x: 10, y: 0 }],
    });
    const evaluation = evaluateRoute(problem, problem.vehicles[0], [0]);
    expect(evaluation.feasible).toBe(false);
    expect(evaluation.reason).toBe('shift_exceeded');
  });

  it('accumulates demand across the tour and checks volume too', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', weight: 10, volume: 3 }],
      stops: [
        { id: 's1', x: 1, y: 0, weight: 4, volume: 1 },
        { id: 's2', x: 2, y: 0, weight: 4, volume: 1 },
        { id: 's3', x: 3, y: 0, weight: 1, volume: 1.5 },
      ],
    });
    expect(
      evaluateRoute(problem, problem.vehicles[0], [0, 1]).feasible,
    ).toBe(true);
    expect(
      evaluateRoute(problem, problem.vehicles[0], [0, 1, 2]).reason,
    ).toBe('capacity_exceeded');
  });
});

describe('bestVehicleFor', () => {
  it('prefers the smallest adequate vehicle, tie-broken by id', () => {
    const problem = gridProblem({
      vehicles: [
        { id: 'big', weight: 100 },
        { id: 'small', weight: 10 },
        { id: 'smaller', weight: 5 },
      ],
      stops: [{ id: 's1', x: 1, y: 0, weight: 3 }],
    });
    const best = bestVehicleFor(problem, [0]);
    expect(best?.vehicle.id).toBe('smaller');
  });

  it('returns null when nothing fits', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'tiny', weight: 1 }],
      stops: [{ id: 's1', x: 1, y: 0, weight: 3 }],
    });
    expect(bestVehicleFor(problem, [0])).toBeNull();
  });
});

describe('probeStop', () => {
  it('attributes an oversized stop to capacity', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', weight: 5 }],
      stops: [{ id: 's1', x: 1, y: 0, weight: 50 }],
    });
    expect(probeStop(problem, 0)).toBe('capacity_exceeded');
  });

  it('attributes a closed window to time windows', () => {
    const problem = gridProblem({
      vehicles: [{ id: 'v1', shiftEnd: 50 }],
      stops: [{ id: 's1', x: 10, y: 0, latest: 5 }], // arrival at 10 is late
    });
    expect(probeStop(problem, 0)).toBe('time_window_infeasible');
  });

  it('falls back to no_feasible_vehicle when there is no fleet at all', () => {
    const problem = gridProblem({
      vehicles: [],
      stops: [{ id: 's1', x: 1, y: 0 }],
    });
    expect(probeStop(problem, 0)).toBe('no_feasible_vehicle');
  });
});
