import type { MessageRole } from '@prisma/client';

export interface ConversationMessageResponse {
  id: string;
  role: MessageRole;
  content: string;
  model: string | null;
  createdAt: string;
  inputMode: 'text' | 'voice' | null;
  outputMode: 'text' | 'voice' | null;
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
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetailResponse {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessageResponse[];
}
