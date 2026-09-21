import type {
    ConversationRetrievalInput,
    ConversationRetrievalResult,
} from "../conversation-retrieval/types/conversation-retrieval.types";

export const TOOL_NAMES = ["conversation_retrieval"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolContextMessage = {
    id?: string;
    role: string;
    content: string;
    createdAt?: string;
};

export type ToolExecutionContext = {
    currentConversationId?: string;
    messages: ToolContextMessage[];
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
