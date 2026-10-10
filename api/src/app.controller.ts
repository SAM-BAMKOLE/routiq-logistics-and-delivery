import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AppInfo, AppService } from './app.service.js';

@ApiTags('operations')
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @ApiOperation({ summary: 'API discovery: version, docs and health links' })
  @ApiOkResponse({ type: AppInfo })
  getInfo(): AppInfo {
    return this.appService.getInfo();
  }
}
