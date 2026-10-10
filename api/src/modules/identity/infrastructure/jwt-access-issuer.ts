import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenClaims,
  AccessTokenIssuer,
} from '../application/access-tokens.js';

/**
 * JWT implementation of the {@link AccessTokenIssuer} port. The secret and
 * lifetime come from validated environment (`JWT_ACCESS_SECRET`,
 * `JWT_ACCESS_TTL`); verification rejects expired and foreign tokens alike,
 * and callers map every failure to an identical 401.
 */
@Injectable()
export class JwtAccessIssuer implements AccessTokenIssuer {
  constructor(private readonly jwt: JwtService) {}

  sign(claims: Omit<AccessTokenClaims, 'type'>): Promise<string> {
    return this.jwt.signAsync({ ...claims, type: 'access' });
  }

  async verify(token: string): Promise<AccessTokenClaims> {
    const payload = await this.jwt.verifyAsync<Record<string, unknown>>(token);
    if (
      typeof payload['sub'] !== 'string' ||
      (typeof payload['tid'] !== 'string' && payload['tid'] !== null) ||
      (typeof payload['role'] !== 'string' && payload['role'] !== null) ||
      typeof payload['adm'] !== 'boolean' ||
      payload['type'] !== 'access'
    ) {
      throw new Error('Access token has an unexpected shape.');
    }
    return {
      sub: payload['sub'],
      tid: payload['tid'],
      role: payload['role'],
      adm: payload['adm'],
      type: 'access',
    };
  }
}
