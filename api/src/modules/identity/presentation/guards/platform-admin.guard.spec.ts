import {
  ForbiddenException,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { AccessTokenIssuer } from '../../application/access-tokens.js';
import { PlatformAdminGuard } from './platform-admin.guard.js';

function requestWith(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: authHeader ? { authorization: authHeader } : {},
      }),
    }),
  } as unknown as ExecutionContext;
}

function guardFor(adm: boolean | 'invalid'): PlatformAdminGuard {
  const issuer: AccessTokenIssuer = {
    sign: async () => 'token',
    verify: async () => {
      if (adm === 'invalid') {
        throw new Error('bad token');
      }
      return { sub: 'u-1', tid: null, role: null, adm, type: 'access' as const };
    },
  };
  return new PlatformAdminGuard(issuer);
}

describe('PlatformAdminGuard', () => {
  it('admits a platform admin and sets no tenant context', async () => {
    await expect(guardFor(true).canActivate(requestWith('Bearer valid'))).resolves.toBe(
      true,
    );
  });

  it('rejects missing and invalid tokens with 401', async () => {
    await expect(guardFor(true).canActivate(requestWith())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      guardFor('invalid').canActivate(requestWith('Bearer bogus')),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects authenticated non-admins with 403', async () => {
    const error = await guardFor(false)
      .canActivate(requestWith('Bearer valid'))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'PLATFORM_ADMIN_REQUIRED',
    });
  });
});
