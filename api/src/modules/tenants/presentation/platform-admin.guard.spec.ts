import {
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { PlatformAdminGuard } from './platform-admin.guard.js';

describe('PlatformAdminGuard', () => {
  const KEY = 'test-platform-admin-key';

  function guardFor(): PlatformAdminGuard {
    const config = {
      getOrThrow: (key: string) => {
        if (key === 'PLATFORM_ADMIN_API_KEY') return KEY;
        throw new Error(`Missing ${key}`);
      },
    } as unknown as ConfigService;
    return new PlatformAdminGuard(config);
  }

  function contextWithKey(headerValue?: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: headerValue === undefined ? {} : { 'x-platform-admin-key': headerValue },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  it('admits a request carrying the correct key', () => {
    expect(guardFor().canActivate(contextWithKey(KEY))).toBe(true);
  });

  it('rejects a request with a wrong key', () => {
    expect(() => guardFor().canActivate(contextWithKey('wrong'))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a request without a key', () => {
    expect(() => guardFor().canActivate(contextWithKey())).toThrow(
      UnauthorizedException,
    );
  });

  it('emits the stable PLATFORM_ADMIN_KEY_INVALID code', () => {
    try {
      guardFor().canActivate(contextWithKey('wrong'));
      throw new Error('expected the guard to reject');
    } catch (error) {
      const body = (error as UnauthorizedException).getResponse();
      expect(body).toMatchObject({ code: 'PLATFORM_ADMIN_KEY_INVALID' });
    }
  });
});