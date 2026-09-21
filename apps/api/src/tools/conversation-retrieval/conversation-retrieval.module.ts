import { Module } from "@nestjs/common";
import { ConversationEmbeddingModule } from "../../conversation/conversation-embedding.module";
import { ConversationRetrievalService } from "./conversation-retrieval.service";

@Module({
    imports: [ConversationEmbeddingModule],
    providers: [ConversationRetrievalService],
    exports: [ConversationRetrievalService],
})
export class ConversationRetrievalModule {}
