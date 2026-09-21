import {
    BadRequestException,
    Injectable,
    OnModuleInit,
} from "@nestjs/common";
import { ToolRegistryService } from "../tool-registry.service";
import type { RegisteredTool } from "../tool-registry.types";
import type { ToolExecutionContext } from "../types/tool.types";
import { ConversationRetrievalService } from "./conversation-retrieval.service";
import type {
    ConversationRetrievalInput,
    ConversationRetrievalResult,
} from "./types/conversation-retrieval.types";

@Injectable()
export class ConversationRetrievalTool
    implements RegisteredTool, OnModuleInit
{
    readonly name = "conversation_retrieval" as const;
    readonly description =
        "Recupera conteúdo de conversas antigas por semântica, período ou conversa específica. " +
        "Não use para o contexto recente da conversa atual, que já está disponível.";
    readonly inputSchema = {
        type: "object" as const,
        additionalProperties: false,
        properties: {
            query: {
                type: "string",
                description:
                    "Consulta semântica opcional, por exemplo 'jogos' ou 'projeto Luna'.",
            },
            conversationId: {
                type: "string",
                description:
                    "UUID opcional para restringir a busca a uma conversa específica.",
            },
            dateFrom: {
                type: "string",
                description:
                    "Data ISO opcional de início; YYYY-MM-DD usa o fuso da aplicação.",
            },
            dateTo: {
                type: "string",
                description:
                    "Data ISO opcional de fim; YYYY-MM-DD usa o fuso da aplicação.",
            },
            topK: {
                type: "integer",
                description: "Quantidade máxima de chunks candidatos.",
            },
            maxContextTokens: {
                type: "integer",
                description: "Orçamento máximo do conteúdo recuperado.",
            },
            includeMessages: {
                type: "boolean",
                description:
                    "Inclui mensagens estruturadas além do conteúdo dos chunks.",
            },
        },
    };

    constructor(
        private readonly registry: ToolRegistryService,
        private readonly retrievalService: ConversationRetrievalService,
    ) {}

    onModuleInit(): void {
        this.registry.register(this);
    }

    async execute(
        input: Record<string, unknown>,
        context: ToolExecutionContext,
    ): Promise<ConversationRetrievalResult> {
        const normalized = this.normalizeInput(input);

        return this.retrievalService.retrieve({
            ...normalized,
            currentConversationId: context.currentConversationId,
        });
    }

    private normalizeInput(
        input: Record<string, unknown>,
    ): ConversationRetrievalInput {
        const allowed = new Set([
            "query",
            "conversationId",
            "dateFrom",
            "dateTo",
            "topK",
            "maxContextTokens",
            "includeMessages",
            // Accepted only for the existing test endpoint. The execution
            // context remains the authoritative source for this value.
            "currentConversationId",
        ]);

        for (const key of Object.keys(input)) {
            if (!allowed.has(key)) {
                throw new BadRequestException(
                    `conversation_retrieval does not accept ${key}`,
                );
            }
        }

        return {
            query: this.optionalString(input.query, "query"),
            conversationId: this.optionalString(
                input.conversationId,
                "conversationId",
            ),
            dateFrom: this.optionalString(input.dateFrom, "dateFrom"),
            dateTo: this.optionalString(input.dateTo, "dateTo"),
            topK: this.optionalInteger(input.topK, "topK"),
            maxContextTokens: this.optionalInteger(
                input.maxContextTokens,
                "maxContextTokens",
            ),
            includeMessages: this.optionalBoolean(
                input.includeMessages,
                "includeMessages",
            ),
        };
    }

    private optionalString(value: unknown, field: string): string | undefined {
        if (value === undefined) {
            return undefined;
        }

        if (typeof value !== "string") {
            throw new BadRequestException(`${field} must be a string`);
        }

        return value;
    }

    private optionalInteger(value: unknown, field: string): number | undefined {
        if (value === undefined) {
            return undefined;
        }

        if (typeof value !== "number" || !Number.isInteger(value)) {
            throw new BadRequestException(`${field} must be an integer`);
        }

        return value;
    }

    private optionalBoolean(
        value: unknown,
        field: string,
    ): boolean | undefined {
        if (value === undefined) {
            return undefined;
        }

        if (typeof value !== "boolean") {
            throw new BadRequestException(`${field} must be a boolean`);
        }

        return value;
    }
}
