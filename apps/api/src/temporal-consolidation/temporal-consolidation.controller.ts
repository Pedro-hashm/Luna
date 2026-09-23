import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { TemporalConsolidationService } from './temporal-consolidation.service';

@Controller('temporal-consolidation')
export class TemporalConsolidationController {
  constructor(private readonly service: TemporalConsolidationService) {}

  @Get('status')
  getStatus() {
    return this.service.getStatus();
  }

  @Get('runs')
  getRuns() {
    return this.service.getRuns();
  }

  @Get('runs/:id')
  async getRun(@Param('id') id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(id)) {
      throw new BadRequestException('Invalid temporal run ID');
    }
    const run = await this.service.getRun(id);
    if (!run) throw new NotFoundException('Temporal run was not found');
    return run;
  }

  @Post('run')
  runManual(@Body() input: { dryRun?: unknown } = {}) {
    if (input?.dryRun !== undefined && typeof input.dryRun !== 'boolean') {
      throw new BadRequestException('dryRun must be a boolean');
    }
    return this.service.runManual({ dryRun: input?.dryRun as boolean | undefined });
  }
}
