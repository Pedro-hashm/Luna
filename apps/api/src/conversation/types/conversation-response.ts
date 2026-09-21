import type { MessageRole } from "@prisma/client";

export interface ConversationMessageResponse {
    id: string;
    role: MessageRole;
    content: string;
    model: string | null;
    createdAt: Date;
}

export interface SendMessageResponse {
    conversationId: string;
    messages: ConversationMessageResponse[];
}

export interface ConversationListItemResponse {
    id: string;
    title: string;
    preview: string;
    messageCount: number;
    createdAt: Date;
    updatedAt: Date;
}

export interface ConversationDetailResponse {
    id: string;
    title: string;
    createdAt: Date;
    updatedAt: Date;
    messages: ConversationMessageResponse[];
}
