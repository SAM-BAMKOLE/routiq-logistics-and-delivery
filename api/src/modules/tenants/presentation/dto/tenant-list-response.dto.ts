import { ApiProperty } from '@nestjs/swagger';
import { TenantResponseDto } from './tenant-response.dto.js';

export class TenantListResponseDto {
  @ApiProperty({ type: [TenantResponseDto] })
  data: TenantResponseDto[];
}
