import { Module } from "@nestjs/common";
import { ConversationRetrievalModule } from "./conversation-retrieval/conversation-retrieval.module";
import { ConversationRetrievalTool } from "./conversation-retrieval/conversation-retrieval.tool";
import { ToolRegistryService } from "./tool-registry.service";
import { ToolsController } from "./tools.controller";
import { ToolsService } from "./tools.service";

@Module({
    imports: [ConversationRetrievalModule],
    controllers: [ToolsController],
    providers: [ToolsService, ToolRegistryService, ConversationRetrievalTool],
    exports: [ToolsService, ToolRegistryService],
})
export class ToolsModule {}
