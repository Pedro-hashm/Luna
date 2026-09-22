import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SettingsModule } from '../settings/settings.module';
import { ObservabilityController } from './observability.controller';
import { ObservabilityService } from './observability.service';

@Global()
@Module({
  imports: [PrismaModule, SettingsModule],
  controllers: [ObservabilityController],
  providers: [ObservabilityService],
  exports: [ObservabilityService],
})
export class ObservabilityModule {}
