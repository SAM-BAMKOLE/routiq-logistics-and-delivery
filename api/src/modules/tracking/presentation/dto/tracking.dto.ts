import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * One point of `POST /tracking/locations` (and the `location:update`
 * WebSocket message, which shares the shape). Range checks mirror the
 * domain's `out_of_range` rule so a malformed body is a 422 before it ever
 * reaches validation; staleness, plausibility and thinning stay in the
 * domain, where they have a clock and a predecessor to judge against.
 */
export class LocationPointDto {
  @ApiProperty({ minimum: -90, maximum: 90, example: 6.5244 })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @ApiProperty({ minimum: -180, maximum: 180, example: 3.3792 })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  @ApiProperty({
    description: 'When the fix was taken (ISO-8601), not when it arrived.',
    example: '2026-10-11T09:15:00.000Z',
  })
  @IsDateString()
  recordedAt: string;

  @ApiPropertyOptional({ minimum: 0, maximum: 500, example: 42.5 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(500)
  speedKmh?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 360, example: 180 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(360)
  heading?: number;
}

/** Body of `POST /tracking/locations`: a batch from one device. */
export class PushLocationsDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Driver the positions belong to. Drivers omit it (their own profile ' +
      'is resolved from the session); dispatchers may push on behalf of ' +
      'a driver by naming them.',
  })
  @IsOptional()
  @IsUUID()
  driverId?: string;

  @ApiProperty({
    type: [LocationPointDto],
    description:
      'Points in any order — an offline device flushes its backlog on ' +
      'reconnect. The server sorts them before validating.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => LocationPointDto)
  points: LocationPointDto[];
}

/** Query of `GET /drivers/:id/locations`: a thinned window of history. */
export class LocationHistoryQueryDto {
  @ApiPropertyOptional({
    description: 'Exclusive upper cursor: only points recorded before it.',
  })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(500)
  limit?: number;
}

/** Body of the `room:join` / `room:leave` WebSocket messages. */
export class RoomMessageDto {
  @ApiProperty({
    example: 'shipment:3f1d2a60-8f3e-4a2c-9a1b-0c9d8e7f6a5b',
    description: 'Room name: `<kind>:<uuid>`, kind in tenant|driver|shipment|route.',
  })
  @IsString()
  @MaxLength(100)
  room: string;
}
