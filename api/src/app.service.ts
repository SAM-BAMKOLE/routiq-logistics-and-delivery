import { Injectable } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export class AppInfo {
  @ApiProperty({ example: 'LDMS API' })
  name: string;

  @ApiProperty({ example: '0.1.0' })
  version: string;

  @ApiProperty({ example: '/docs' })
  docs: string;

  @ApiProperty({ example: '/health/live' })
  liveness: string;

  @ApiProperty({ example: '/health/ready' })
  readiness: string;
}

@Injectable()
export class AppService {
  getInfo(): AppInfo {
    return {
      name: 'LDMS API',
      version: '0.1.0',
      docs: '/docs',
      liveness: '/health/live',
      readiness: '/health/ready',
    };
  }
}
