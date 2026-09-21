import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { ConversationService } from "./conversation.service";
import { SendMessageDto } from "./dto/send-message.dto";
import type {
    ConversationDetailResponse,
    ConversationListItemResponse,
    SendMessageResponse,
} from "./types/conversation-response";

@Controller("conversation")
export class ConversationController {
    constructor(private readonly conversationService: ConversationService) {}

    @Get()
    listConversations(): Promise<ConversationListItemResponse[]> {
        return this.conversationService.listConversations();
    }

    @Get(":conversationId")
    getConversation(
        @Param("conversationId") conversationId: string,
    ): Promise<ConversationDetailResponse> {
        return this.conversationService.getConversation(conversationId);
    }

    @Post("messages")
    createConversation(
        @Body() { content }: SendMessageDto,
    ): Promise<SendMessageResponse> {
        return this.conversationService.createConversationWithMessage(content);
    }

    @Post(":conversationId/messages")
    addMessage(
        @Param("conversationId") conversationId: string,
        @Body() { content }: SendMessageDto,
    ): Promise<SendMessageResponse> {
        return this.conversationService.addMessageToConversation(
            conversationId,
            content,
        );
    }
}
