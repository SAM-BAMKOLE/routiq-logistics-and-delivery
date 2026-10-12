import { Injectable, Inject } from '@nestjs/common';
import { BILL_REPOSITORY } from '../domain/bill.repository.js';
import type { BillRepository } from '../domain/bill.repository.js';

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILL_REPOSITORY)
    private readonly bills: BillRepository,
  ) {}
}
