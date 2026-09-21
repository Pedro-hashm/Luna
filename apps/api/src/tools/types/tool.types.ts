import type {
  ConversationRetrievalInput,
  ConversationRetrievalResult,
} from '../conversation-retrieval/types/conversation-retrieval.types';

export const TOOL_NAMES = ['conversation_retrieval'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolContextMessage = {
  id?: string;
  role: string;
  content: string;
  createdAt?: string;
};

export type ToolExecutionContext = {
  // Runtime-owned values. They are intentionally kept out of every
  // LLM-visible tool schema and are injected by the caller.
  conversationId?: string;
  currentMessageId?: string;
  currentDateTime?: string;
  messages: ToolContextMessage[];
};

export type ToolExecutionError = {
  status: 'error';
  errorType: 'INVALID_ARGUMENT' | 'RUNTIME_CONTEXT' | 'TRANSIENT' | 'TECHNICAL';
  tool: string;
  argument?: string;
  message: string;
  modelRetryable: boolean;
};

export type ExecuteToolRequest = {
  tool: string;
  input?: ConversationRetrievalInput | Record<string, unknown>;
  context?: ToolExecutionContext;
  requestId?: string;
};

export type ExecuteToolResponse = {
  tool: ToolName;
  context: ToolExecutionContext;
  result: ConversationRetrievalResult;
};
