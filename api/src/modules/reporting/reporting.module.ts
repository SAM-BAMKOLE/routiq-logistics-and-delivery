import { Module } from '@nestjs/common';
import { ReportingService } from './application/reporting.service.js';
import { ReportingController } from './presentation/reporting.controller.js';

@Module({
  providers: [ReportingService],
  controllers: [ReportingController],
  exports: [ReportingService],
})
export class ReportingModule {}
