import { Module } from '@nestjs/common';
import { ComplianceService } from './application/compliance.service.js';

@Module({
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
