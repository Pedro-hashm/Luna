import { BadRequestException, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ObservabilityService } from "../observability/observability.service";
import { ToolRegistryService } from "./tool-registry.service";
import type {
    ExecuteToolRequest,
    ExecuteToolResponse,
    ToolContextMessage,
    ToolExecutionContext,
    ToolName,
} from "./types/tool.types";

@Injectable()
export class ToolsService {
    constructor(
        private readonly toolRegistry: ToolRegistryService,
        private readonly observabilityService: ObservabilityService,
    ) {}

    async execute(request: ExecuteToolRequest): Promise<ExecuteToolResponse> {
        if (!this.toolRegistry.has(request.tool)) {
            throw new BadRequestException(
                `Unknown tool: ${request.tool || "(missing)"}`,
            );
        }

        const tool = request.tool as ToolName;
        const rawInput = this.asRecord(request.input);
        const context = this.normalizeContext(
            request.context,
            this.optionalString(rawInput.currentConversationId),
        );
        const input = {
            ...rawInput,
        };
        const startedAt = new Date();
        const startedAtMs = Date.now();
        const requestId = request.requestId ?? randomUUID();
        const estimatedInputTokens = this.estimateTokens(
            context.messages.map((message) => `${message.role}: ${message.content}`).join("\n") +
                (typeof input.query === "string" ? `\nquery: ${input.query}` : ""),
        );

        try {
            const result = await this.toolRegistry.execute(tool, input, context);
            const resultText = result.results
                .map((item) => `${item.content}\n${item.tailContent ?? ""}`)
                .join("\n");
            const estimatedOutputTokens = this.estimateTokens(resultText);
            const relatedConversationIds = [
                ...new Set(result.results.map((item) => item.conversationId)),
            ];

            await this.observabilityService.recordTrace({
                requestId,
                conversationId: context.currentConversationId,
                kind: "tool",
                status: "success",
                toolName: tool,
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                totalTokens: estimatedInputTokens + estimatedOutputTokens,
                estimatedInputTokens,
                estimatedOutputTokens,
                latencyMs: Date.now() - startedAtMs,
                stageDurations: { execution: Date.now() - startedAtMs },
                contextSnapshot: {
                    immediate: {
                        messages: context.messages,
                        tokens: this.estimateTokens(
                            context.messages
                                .map((message) => `${message.role}: ${message.content}`)
                                .join("\n"),
                        ),
                    },
                    memory: { items: [], tokens: 0 },
                    tools: {
                        items: [
                            {
                                name: tool,
                                input,
                                resultCount: result.results.length,
                            },
                        ],
                        tokens: estimatedOutputTokens,
                    },
                    relatedConversationIds,
                    totalTokens: estimatedInputTokens + estimatedOutputTokens,
                },
                startedAt,
                completedAt: new Date(),
            });

            return { tool, context, result };
        } catch (error) {
            await this.observabilityService.recordTrace({
                requestId,
                conversationId: context.currentConversationId,
                kind: "tool",
                status: this.traceStatus(error),
                toolName: tool,
                inputTokens: estimatedInputTokens,
                totalTokens: estimatedInputTokens,
                estimatedInputTokens,
                latencyMs: Date.now() - startedAtMs,
                stageDurations: { execution: Date.now() - startedAtMs },
                contextSnapshot: {
                    immediate: { messages: context.messages, tokens: estimatedInputTokens },
                    tools: { items: [{ name: tool, input }], tokens: 0 },
                    totalTokens: estimatedInputTokens,
                },
                errorMessage: error instanceof Error ? error.message : "unknown error",
                startedAt,
                completedAt: new Date(),
            });
            throw error;
        }
    }

    private normalizeContext(
        context: ExecuteToolRequest["context"],
        inputConversationId?: string,
    ): ToolExecutionContext {
        if (!context) {
            return {
                currentConversationId: inputConversationId,
                messages: [],
            };
        }

        return {
            currentConversationId:
                context.currentConversationId ?? inputConversationId,
            messages: Array.isArray(context.messages) ? context.messages : [],
        };
    }

    private asRecord(value: unknown): Record<string, unknown> {
        if (!value) {
            return {};
        }

        if (typeof value !== "object" || Array.isArray(value)) {
            throw new BadRequestException("Tool input must be an object");
        }

        return value as Record<string, unknown>;
    }

    private optionalString(value: unknown): string | undefined {
        return typeof value === "string" ? value : undefined;
    }

    private estimateTokens(content: string): number {
        return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
    }

    private traceStatus(error: unknown): "error" | "timeout" {
        const message = error instanceof Error ? error.message.toLowerCase() : "";

        return message.includes("timeout") || message.includes("etimedout")
            ? "timeout"
            : "error";
    }
}
