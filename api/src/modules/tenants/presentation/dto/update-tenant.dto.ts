import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  TENANT_PLANS,
  TENANT_STATUSES,
  type TenantPlan,
  type TenantStatus,
} from '../../domain/tenant.js';

export class UpdateTenantDto {
  @ApiPropertyOptional({ example: 'Acme Logistics GmbH', minLength: 2, maxLength: 120 })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  @ApiPropertyOptional({ enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: TenantStatus;

  @ApiPropertyOptional({ enum: TENANT_PLANS })
  @IsOptional()
  @IsIn(TENANT_PLANS)
  plan?: TenantPlan;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
