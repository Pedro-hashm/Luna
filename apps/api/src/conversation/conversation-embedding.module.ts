import { Module } from "@nestjs/common";
import { ConversationEmbeddingService } from "./conversation-embedding.service";

@Module({
    providers: [ConversationEmbeddingService],
    exports: [ConversationEmbeddingService],
})
export class ConversationEmbeddingModule {}
