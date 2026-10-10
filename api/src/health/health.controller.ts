import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  LivenessStatus,
  ReadinessCheck,
  ReadinessStatus,
} from './health.types.js';

@ApiTags('operations')
@Controller('health')
export class HealthController {
  /**
   * Liveness: the process is up and the event loop is responsive. Used by
   * container orchestrators to decide whether to restart the process.
   */
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): LivenessStatus {
    return { status: 'ok' };
  }

  /**
   * Readiness: the process can serve traffic, i.e. its dependencies are
   * reachable. Dependency checks (Postgres, Redis, queues) are added as those
   * modules land, so the list stays empty for now.
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  ready(): ReadinessStatus {
    const checks: ReadinessCheck[] = [];
    const healthy = checks.every((check) => check.status === 'up');
    return { status: healthy ? 'ok' : 'error', checks };
  }
}
