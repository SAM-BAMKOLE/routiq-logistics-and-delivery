import { Module } from '@nestjs/common';
import { AssetsService } from './application/assets.service.js';

@Module({
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
