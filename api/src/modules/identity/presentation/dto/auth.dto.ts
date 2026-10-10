import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'dispatcher@acme.example' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ minLength: 1 })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Tenant to log into. Defaults to the first active membership.',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;
}

export class RefreshDto {
  @ApiProperty({ description: 'Opaque refresh token from login or refresh.' })
  @IsString()
  @MinLength(1)
  refreshToken: string;
}

export class SwitchTenantDto {
  @ApiProperty({ description: 'Opaque refresh token from login or refresh.' })
  @IsString()
  @MinLength(1)
  refreshToken: string;

  @ApiProperty({
    format: 'uuid',
    description: 'Membership target: must be active and belong to the caller.',
  })
  @IsUUID()
  tenantId: string;
}

export class LogoutDto {
  @ApiProperty({ description: 'Opaque refresh token to revoke.' })
  @IsString()
  @MinLength(1)
  refreshToken: string;
}

export class AcceptInviteDto {
  @ApiProperty({ description: 'Single-use invitation token.' })
  @IsString()
  @MinLength(1)
  token: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(1024)
  password: string;
}
