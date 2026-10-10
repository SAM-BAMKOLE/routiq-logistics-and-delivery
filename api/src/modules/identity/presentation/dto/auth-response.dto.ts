import { ApiProperty } from '@nestjs/swagger';
import type {
  ActiveTenant,
  AuthResult,
  PublicUser,
} from '../../application/auth.service.js';

export class AuthUserDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty()
  isPlatformAdmin: boolean;

  static from(user: PublicUser): AuthUserDto {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      isPlatformAdmin: user.isPlatformAdmin,
    };
  }
}

export class AuthTenantDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  role: string;

  static from(tenant: ActiveTenant): AuthTenantDto {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      role: tenant.role,
    };
  }
}

/** Token pair plus who and where it is scoped to. */
export class AuthResponseDto {
  @ApiProperty({ description: 'Short-lived JWT for the Authorization header.' })
  accessToken: string;

  @ApiProperty({ description: 'Opaque token for /auth/refresh and /auth/logout.' })
  refreshToken: string;

  @ApiProperty({ example: 900, description: 'Access-token lifetime in seconds.' })
  expiresIn: number;

  @ApiProperty({ type: AuthUserDto })
  user: AuthUserDto;

  @ApiProperty({ type: AuthTenantDto, nullable: true })
  tenant: AuthTenantDto | null;

  static from(result: AuthResult): AuthResponseDto {
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresIn: result.expiresIn,
      user: AuthUserDto.from(result.user),
      tenant: result.tenant ? AuthTenantDto.from(result.tenant) : null,
    };
  }
}
