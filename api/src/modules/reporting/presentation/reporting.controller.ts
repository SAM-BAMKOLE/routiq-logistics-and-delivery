import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('reporting')
@Controller('reporting')
export class ReportingController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
