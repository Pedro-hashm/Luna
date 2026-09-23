import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { TemporalConsolidationService } from './temporal-consolidation.service';

@Injectable()
export class TemporalConsolidationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TemporalConsolidationScheduler.name);
  private timer?: ReturnType<typeof setInterval>;
  private checking = false;

  constructor(private readonly service: TemporalConsolidationService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.checking) return;
    this.checking = true;
    try {
      await this.service.runScheduled();
    } catch (error) {
      this.logger.error(`Temporal scheduler failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    } finally {
      this.checking = false;
    }
  }
}
