import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { MEMBERSHIP_STATUSES, ROLES } from '../../domain/membership.js';
import type { Role } from '../../domain/membership.js';
import type { TenantMember } from '../../application/users.service.js';

export class InviteUserDto {
  @ApiProperty({ example: 'dispatcher@acme.example' })
  @IsEmail()
  @MaxLength(320)
  email: string;

  @ApiProperty({ enum: ROLES })
  @IsIn(ROLES)
  role: Role;

  @ApiPropertyOptional({ example: 'Amina Diallo' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  name?: string;
}

export class UpdateMembershipDto {
  @ApiPropertyOptional({ enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: Role;

  @ApiPropertyOptional({
    enum: ['active', 'suspended'],
    description: 'Reactivation and suspension. Invitation state is owned by the invite flow.',
  })
  @IsOptional()
  @IsIn(MEMBERSHIP_STATUSES.filter((status) => status !== 'invited'))
  status?: 'active' | 'suspended';
}

export class TenantMemberDto {
  @ApiProperty({ format: 'uuid' })
  userId: string;

  @ApiProperty()
  email: string;

  @ApiProperty({ nullable: true })
  name: string | null;

  @ApiProperty({ format: 'uuid' })
  membershipId: string;

  @ApiProperty({ enum: ROLES })
  role: Role;

  @ApiProperty()
  membershipStatus: string;

  static from(member: TenantMember): TenantMemberDto {
    return { ...member };
  }
}

export class TenantMemberListDto {
  @ApiProperty({ type: [TenantMemberDto] })
  data: TenantMemberDto[];
}
