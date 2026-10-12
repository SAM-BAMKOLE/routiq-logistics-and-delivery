import { Injectable, Inject } from '@nestjs/common';
import { BILL_REPOSITORY, BillRepository } from '../domain/bill.repository.js';

@Injectable()
export class BillingService {
  constructor(
    @Inject(BILL_REPOSITORY)
    private readonly bills: BillRepository,
  ) {}
}
