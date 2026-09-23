import { Module } from '@nestjs/common';
import { ConversationRetrievalTool } from './conversation-retrieval/conversation-retrieval.tool';
import { SettingsModule } from '../settings/settings.module';
import { ToolRegistryService } from './tool-registry.service';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { EvidenceModule } from '../evidence/evidence.module';
import { ConversationContextService } from './conversation-context/conversation-context.service';
import { ConversationContextTool } from './conversation-context/conversation-context.tool';
import { ConversationRetrievalModule } from './conversation-retrieval/conversation-retrieval.module';

@Module({
  imports: [ConversationRetrievalModule, EvidenceModule, SettingsModule],
  controllers: [ToolsController],
  providers: [ToolsService, ToolRegistryService, ConversationRetrievalTool, ConversationContextService, ConversationContextTool],
  exports: [ToolsService, ToolRegistryService],
})
export class ToolsModule {}
