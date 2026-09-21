import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConversationModule } from './conversation/conversation.module';
import { LlmModule } from './llm/llm.module';
import { PrismaModule } from './prisma/prisma.module';
import { ToolsModule } from './tools/tools.module';
import { SettingsModule } from './settings/settings.module';
import { ObservabilityModule } from './observability/observability.module';

@Module({
  imports: [PrismaModule, SettingsModule, ObservabilityModule, LlmModule, ConversationModule, ToolsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
