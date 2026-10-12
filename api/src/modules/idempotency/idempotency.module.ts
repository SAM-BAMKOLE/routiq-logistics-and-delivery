import { Module } from '@nestjs/common';
import { IdempotencyService } from './application/idempotency.service.js';

@Module({
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
