import { Module } from '@nestjs/common';
import { RateLimitsService } from './application/rate-limits.service.js';

@Module({
  providers: [RateLimitsService],
  exports: [RateLimitsService],
})
export class RateLimitsModule {}
