import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { TENANT_PLANS, type TenantPlan } from '../../domain/tenant.js';

export class CreateTenantDto {
  @ApiProperty({ example: 'Acme Logistics', minLength: 2, maxLength: 120 })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;

  @ApiProperty({
    example: 'acme-logistics',
    description: 'URL-safe identifier, unique across the platform.',
  })
  @IsString()
  @MaxLength(60)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, {
    message: 'slug must be lowercase letters, digits and single hyphens',
  })
  slug: string;

  @ApiPropertyOptional({ enum: TENANT_PLANS, default: 'free' })
  @IsOptional()
  @IsIn(TENANT_PLANS)
  plan?: TenantPlan;

  @ApiPropertyOptional({ type: Object, example: { timezone: 'Europe/Berlin' } })
  @IsOptional()
  @IsObject()
  settings?: Record<string, unknown>;
}
