import type { ToolExecutionContext, ToolExecutionResult, ToolName } from "./types/tool.types";

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
    ): Promise<ToolExecutionResult>;
};

export type ToolDefinition = Pick<
    RegisteredTool,
    "name" | "description" | "inputSchema"
>;
