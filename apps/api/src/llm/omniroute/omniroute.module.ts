import { Module } from '@nestjs/common';
import { OmnirouteService } from './omniroute.service';

@Module({
  providers: [OmnirouteService],
  exports: [OmnirouteService],
})
export class OmnirouteModule {}