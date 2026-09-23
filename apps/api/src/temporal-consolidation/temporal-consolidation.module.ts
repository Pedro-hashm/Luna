import { Module } from '@nestjs/common';
import { LlmModule } from '../llm/llm.module';
import { ConversationRetrievalModule } from '../tools/conversation-retrieval/conversation-retrieval.module';
import { TemporalConsolidationController } from './temporal-consolidation.controller';
import { TemporalConsolidationScheduler } from './temporal-consolidation.scheduler';
import { TemporalConsolidationService } from './temporal-consolidation.service';

@Module({
  imports: [LlmModule, ConversationRetrievalModule],
  controllers: [TemporalConsolidationController],
  providers: [TemporalConsolidationService, TemporalConsolidationScheduler],
  exports: [TemporalConsolidationService],
})
export class TemporalConsolidationModule {}
