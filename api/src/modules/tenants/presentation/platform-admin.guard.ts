import {
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

/** Header carrying the platform admin key. */
export const PLATFORM_ADMIN_HEADER = 'x-platform-admin-key';

/**
 * Guards the platform administration API.
 *
 * INTERIM: until the identity module lands, platform admin is proved by a
 * shared secret (`PLATFORM_ADMIN_API_KEY`) rather than a JWT with the
 * `is_platform_admin` claim. The step-4 change is confined to this class: the
 * routes and their contract stay the same, only the proof of admin changes.
 *
 * The comparison is constant-time so the key cannot be recovered by timing.
 */
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = this.config.getOrThrow<string>('PLATFORM_ADMIN_API_KEY');
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers[PLATFORM_ADMIN_HEADER];

    if (typeof provided !== 'string' || !constantTimeEqual(provided, expected)) {
      throw new UnauthorizedException({
        message: 'A valid platform admin key is required.',
        code: 'PLATFORM_ADMIN_KEY_INVALID',
      });
    }

    return true;
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
