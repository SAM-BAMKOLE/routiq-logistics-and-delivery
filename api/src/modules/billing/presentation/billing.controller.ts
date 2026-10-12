import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { BillingService } from '../application/billing.service.js';

@ApiTags('billing')
@Controller('billing')
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
