import { Module } from "@nestjs/common";
import { ConversationController } from "./conversation.controller";
import { ConversationChunkService } from "./conversation-chunk.service";
import { ConversationEmbeddingModule } from "./conversation-embedding.module";
import { ConversationService } from "./conversation.service";
import { SettingsModule } from "../settings/settings.module";
import { UserAgentModule } from "../user-agent/user-agent.module";
import { EvidenceModule } from "../evidence/evidence.module";

@Module({
    imports: [ConversationEmbeddingModule, EvidenceModule, SettingsModule, UserAgentModule],
    controllers: [ConversationController],
    providers: [
        ConversationService,
        ConversationChunkService,
    ],
    exports: [ConversationService, ConversationEmbeddingModule],
})
export class ConversationModule {}
