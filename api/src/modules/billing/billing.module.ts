import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './infrastructure/bill.orm-entity.js';
import { BILL_REPOSITORY } from './domain/bill.repository.js';
import { TypeOrmBillRepository } from './infrastructure/typeorm-bill.repository.js';
import { BillingService } from './application/billing.service.js';
import { BillingController } from './presentation/billing.controller.js';

@Module({
  imports: [TypeOrmModule.forFeature([Bill])],
  providers: [
    {
      provide: BILL_REPOSITORY,
      useClass: TypeOrmBillRepository,
    },
    BillingService,
  ],
  controllers: [BillingController],
  exports: [BillingService],
})
export class BillingModule {}
