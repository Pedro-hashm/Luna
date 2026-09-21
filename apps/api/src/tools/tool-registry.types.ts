import type { ConversationRetrievalResult } from "./conversation-retrieval/types/conversation-retrieval.types";
import type { ToolExecutionContext, ToolName } from "./types/tool.types";

export type ToolInputSchema = {
    type: "object";
    properties: Record<string, unknown>;
    additionalProperties?: boolean;
};

export type RegisteredTool = {
    name: ToolName;
    description: string;
    inputSchema: ToolInputSchema;
    execute(
        input: Record<string, unknown>,
        context: ToolExecutionContext,
    ): Promise<ConversationRetrievalResult>;
};

export type ToolDefinition = Pick<
    RegisteredTool,
    "name" | "description" | "inputSchema"
>;
