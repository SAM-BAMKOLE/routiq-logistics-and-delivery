import { Module } from '@nestjs/common';
import { HardeningService } from './application/hardening.service.js';

@Module({
  providers: [HardeningService],
  exports: [HardeningService],
})
export class HardeningModule {}
