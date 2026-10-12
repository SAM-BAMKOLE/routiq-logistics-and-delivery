import { Module } from '@nestjs/common';
import { GeofencingService } from './application/geofencing.service.js';

@Module({
  providers: [GeofencingService],
  exports: [GeofencingService],
})
export class GeofencingModule {}
