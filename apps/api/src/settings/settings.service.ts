import { BadRequestException, Injectable } from "@nestjs/common";
import { Prisma, type ApplicationSettings } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import type {
    ApplicationSettingsResponse,
    ConversationChunkSettingsResponse,
    SettingsResponse,
    UpdateSettingsRequest,
} from "./settings.types";
import { RERANKER_MODELS } from "../retrieval/retrieval.types";

@Injectable()
export class SettingsService {
    constructor(private readonly prisma: PrismaService) {}

    async getApplicationSettings(): Promise<ApplicationSettings> {
        return this.prisma.applicationSettings.upsert({
            where: { id: 1 },
            update: {},
            create: {
                id: 1,
                llmCombo: process.env.LLM_COMBO ?? "local-general",
                orchestratorCombo:
                    process.env.ORCHESTRATOR_COMBO ?? "local-general",
                appTimezone: process.env.APP_TIMEZONE ?? "America/Sao_Paulo",
            },
        });
    }

    async getSettings(): Promise<SettingsResponse> {
        const [application, conversationChunks] = await Promise.all([
            this.getApplicationSettings(),
            this.prisma.conversationChunkSettings.upsert({
                where: { id: 1 },
                update: {},
                create: { id: 1 },
            }),
        ]);

        return {
            application: this.toApplicationResponse(application),
            conversationChunks: {
                maxTokens: conversationChunks.maxTokens,
                overlapTokens: conversationChunks.overlapTokens,
                embeddingRefreshTokens: conversationChunks.embeddingRefreshTokens,
                embeddingModel: conversationChunks.embeddingModel,
                embeddingDimensions: conversationChunks.embeddingDimensions,
            },
        };
    }

    async updateSettings(input: UpdateSettingsRequest): Promise<SettingsResponse> {
        if (input.application) {
            await this.prisma.applicationSettings.update({
                where: { id: 1 },
                data: this.applicationUpdateData(input.application),
            });
        }

        if (input.conversationChunks) {
            await this.prisma.conversationChunkSettings.update({
                where: { id: 1 },
                data: await this.chunkUpdateData(input.conversationChunks),
            });
        }

        return this.getSettings();
    }

    private applicationUpdateData(
        input: Partial<ApplicationSettingsResponse>,
    ): Prisma.ApplicationSettingsUpdateInput {
        const data: Prisma.ApplicationSettingsUpdateInput = {};

        if (input.llmCombo !== undefined) {
            data.llmCombo = this.requiredText(input.llmCombo, "llmCombo");
        }

        if (input.orchestratorCombo !== undefined) {
            data.orchestratorCombo = this.requiredText(
                input.orchestratorCombo,
                "orchestratorCombo",
            );
        }

        if (input.appTimezone !== undefined) {
            const timezone = this.requiredText(input.appTimezone, "appTimezone");

            try {
                new Intl.DateTimeFormat("en-US", { timeZone: timezone });
            } catch {
                throw new BadRequestException(
                    `appTimezone is not a valid IANA timezone: ${timezone}`,
                );
            }

            data.appTimezone = timezone;
        }

        if (input.llmTemperature !== undefined) {
            data.llmTemperature = this.optionalNumber(
                input.llmTemperature,
                "llmTemperature",
                0,
                2,
            );
        }

        if (input.llmMaxTokens !== undefined) {
            data.llmMaxTokens = this.optionalInteger(
                input.llmMaxTokens,
                "llmMaxTokens",
                1,
                100_000,
            );
        }

        if (input.immediateContextMaxTokens !== undefined) {
            data.immediateContextMaxTokens = this.requiredInteger(
                input.immediateContextMaxTokens,
                "immediateContextMaxTokens",
                1,
                200_000,
            );
        }

        if (input.orchestratorMaxIterations !== undefined) {
            data.orchestratorMaxIterations = this.requiredInteger(
                input.orchestratorMaxIterations,
                "orchestratorMaxIterations",
                1,
                20,
            );
        }

        if (input.orchestratorMaxToolCalls !== undefined) {
            data.orchestratorMaxToolCalls = this.requiredInteger(
                input.orchestratorMaxToolCalls,
                "orchestratorMaxToolCalls",
                1,
                20,
            );
        }

        if (input.orchestratorToolResultMaxTokens !== undefined) {
            data.orchestratorToolResultMaxTokens = this.requiredInteger(
                input.orchestratorToolResultMaxTokens,
                "orchestratorToolResultMaxTokens",
                1,
                100_000,
            );
        }

        if (input.retrievalDefaultTopK !== undefined) {
            data.retrievalDefaultTopK = this.requiredInteger(
                input.retrievalDefaultTopK,
                "retrievalDefaultTopK",
                1,
                100,
            );
        }

        if (input.retrievalMaxTopK !== undefined) {
            data.retrievalMaxTopK = this.requiredInteger(
                input.retrievalMaxTopK,
                "retrievalMaxTopK",
                1,
                100,
            );
        }

        if (input.retrievalDefaultMaxContextTokens !== undefined) {
            data.retrievalDefaultMaxContextTokens = this.requiredInteger(
                input.retrievalDefaultMaxContextTokens,
                "retrievalDefaultMaxContextTokens",
                1,
                100_000,
            );
        }

        if (input.retrievalMaxContextTokens !== undefined) {
            data.retrievalMaxContextTokens = this.requiredInteger(
                input.retrievalMaxContextTokens,
                "retrievalMaxContextTokens",
                1,
                100_000,
            );
        }

        if (input.retrievalIncludeMessages !== undefined) {
            if (typeof input.retrievalIncludeMessages !== "boolean") {
                throw new BadRequestException(
                    "retrievalIncludeMessages must be a boolean",
                );
            }

            data.retrievalIncludeMessages = input.retrievalIncludeMessages;
        }

        if (input.retrievalStrategy !== undefined) {
            if (!['hybrid', 'vector-only', 'lexical-only'].includes(input.retrievalStrategy)) {
                throw new BadRequestException(
                    "retrievalStrategy must be hybrid, vector-only, or lexical-only",
                );
            }
            data.retrievalStrategy = input.retrievalStrategy;
        }

        if (input.retrievalVectorTopK !== undefined) {
            data.retrievalVectorTopK = this.requiredInteger(input.retrievalVectorTopK, "retrievalVectorTopK", 1, 200);
        }

        if (input.retrievalLexicalTopK !== undefined) {
            data.retrievalLexicalTopK = this.requiredInteger(input.retrievalLexicalTopK, "retrievalLexicalTopK", 1, 200);
        }

        if (input.retrievalRrfK !== undefined) {
            data.retrievalRrfK = this.requiredInteger(input.retrievalRrfK, "retrievalRrfK", 1, 1000);
        }

        if (input.retrievalCandidatePoolTopK !== undefined) {
            data.retrievalCandidatePoolTopK = this.requiredInteger(input.retrievalCandidatePoolTopK, "retrievalCandidatePoolTopK", 1, 300);
        }

        if (input.retrievalRerankerEnabled !== undefined) {
            if (typeof input.retrievalRerankerEnabled !== "boolean") {
                throw new BadRequestException("retrievalRerankerEnabled must be a boolean");
            }
            data.retrievalRerankerEnabled = input.retrievalRerankerEnabled;
        }

        if (input.retrievalRerankerModel !== undefined) {
            if (!RERANKER_MODELS.includes(input.retrievalRerankerModel)) {
                throw new BadRequestException("retrievalRerankerModel is not supported");
            }
            data.retrievalRerankerModel = input.retrievalRerankerModel;
        }

        if (input.retrievalRerankerTopK !== undefined) {
            data.retrievalRerankerTopK = this.requiredInteger(input.retrievalRerankerTopK, "retrievalRerankerTopK", 1, 300);
        }

        if (input.retrievalRerankerThreshold !== undefined) {
            data.retrievalRerankerThreshold = this.optionalNumber(input.retrievalRerankerThreshold, "retrievalRerankerThreshold", -100, 100) as number;
        }

        if (input.retrievalDeduplicationEnabled !== undefined) {
            if (typeof input.retrievalDeduplicationEnabled !== "boolean") {
                throw new BadRequestException("retrievalDeduplicationEnabled must be a boolean");
            }
            data.retrievalDeduplicationEnabled = input.retrievalDeduplicationEnabled;
        }

        if (input.retrievalDeduplicationThreshold !== undefined) {
            data.retrievalDeduplicationThreshold = this.optionalNumber(input.retrievalDeduplicationThreshold, "retrievalDeduplicationThreshold", 0, 1) as number;
        }

        if (input.conversationEvidenceEnabled !== undefined) {
            if (typeof input.conversationEvidenceEnabled !== "boolean") {
                throw new BadRequestException("conversationEvidenceEnabled must be a boolean");
            }
            data.conversationEvidenceEnabled = input.conversationEvidenceEnabled;
        }

        if (input.temporalConsolidationEnabled !== undefined) {
            if (typeof input.temporalConsolidationEnabled !== "boolean") {
                throw new BadRequestException("temporalConsolidationEnabled must be a boolean");
            }
            data.temporalConsolidationEnabled = input.temporalConsolidationEnabled;
        }

        if (input.temporalConsolidationDefaultCombo !== undefined) {
            data.temporalConsolidationDefaultCombo = this.optionalText(
                input.temporalConsolidationDefaultCombo,
                "temporalConsolidationDefaultCombo",
            );
        }

        if (input.temporalConsolidationFallbackCombo !== undefined) {
            data.temporalConsolidationFallbackCombo = this.optionalText(
                input.temporalConsolidationFallbackCombo,
                "temporalConsolidationFallbackCombo",
            );
        }

        if (input.temporalConsolidationStartTime !== undefined) {
            data.temporalConsolidationStartTime = this.requiredTime(
                input.temporalConsolidationStartTime,
                "temporalConsolidationStartTime",
            );
        }

        if (input.temporalConsolidationEndTime !== undefined) {
            data.temporalConsolidationEndTime = this.requiredTime(
                input.temporalConsolidationEndTime,
                "temporalConsolidationEndTime",
            );
        }

        if (input.researchEnabled !== undefined) {
            data.researchEnabled = this.requiredBoolean(input.researchEnabled, "researchEnabled");
        }
        if (input.researchSearchOrchestratorCombo !== undefined) {
            data.researchSearchOrchestratorCombo = this.requiredText(input.researchSearchOrchestratorCombo, "researchSearchOrchestratorCombo");
        }
        if (input.researchDefaultMode !== undefined) {
            data.researchDefaultMode = this.requiredChoice(input.researchDefaultMode, "researchDefaultMode", ["quick", "deep"]);
        }
        if (input.researchDefaultRecency !== undefined) {
            data.researchDefaultRecency = this.requiredChoice(input.researchDefaultRecency, "researchDefaultRecency", ["auto", "day", "week", "month", "year"]);
        }
        if (input.researchMaxSources !== undefined) {
            data.researchMaxSources = this.requiredInteger(input.researchMaxSources, "researchMaxSources", 1, 20);
        }
        if (input.researchMaxRounds !== undefined) {
            data.researchMaxRounds = this.requiredInteger(input.researchMaxRounds, "researchMaxRounds", 1, 5);
        }
        if (input.researchMaxQueries !== undefined) {
            data.researchMaxQueries = this.requiredInteger(input.researchMaxQueries, "researchMaxQueries", 1, 8);
        }
        if (input.researchSearchProvider !== undefined) {
            data.researchSearchProvider = this.requiredChoice(input.researchSearchProvider, "researchSearchProvider", ["searxng"]);
        }
        if (input.researchExtractionProvider !== undefined) {
            data.researchExtractionProvider = this.requiredChoice(input.researchExtractionProvider, "researchExtractionProvider", ["static-with-browser-fallback"]);
        }
        if (input.researchCacheEnabled !== undefined) {
            data.researchCacheEnabled = this.requiredBoolean(input.researchCacheEnabled, "researchCacheEnabled");
        }
        if (input.researchBrowserFallbackEnabled !== undefined) {
            data.researchBrowserFallbackEnabled = this.requiredBoolean(input.researchBrowserFallbackEnabled, "researchBrowserFallbackEnabled");
        }

        return data;
    }

    private async chunkUpdateData(
        input: Partial<ConversationChunkSettingsResponse>,
    ): Promise<Prisma.ConversationChunkSettingsUpdateInput> {
        const data: Prisma.ConversationChunkSettingsUpdateInput = {};

        if (input.maxTokens !== undefined) {
            data.maxTokens = this.requiredInteger(input.maxTokens, "maxTokens", 1, 100_000);
        }

        if (input.overlapTokens !== undefined) {
            data.overlapTokens = this.requiredInteger(
                input.overlapTokens,
                "overlapTokens",
                0,
                100_000,
            );
        }

        if (input.embeddingRefreshTokens !== undefined) {
            data.embeddingRefreshTokens = this.requiredInteger(
                input.embeddingRefreshTokens,
                "embeddingRefreshTokens",
                1,
                100_000,
            );
        }

        if (input.embeddingModel !== undefined) {
            data.embeddingModel = this.requiredText(
                input.embeddingModel,
                "embeddingModel",
            );
        }

        if (input.embeddingDimensions !== undefined && input.embeddingDimensions !== 1024) {
            throw new BadRequestException(
                "embeddingDimensions is fixed at 1024 by the vector schema",
            );
        }

        const current = this.prisma.conversationChunkSettings.findUnique({
            where: { id: 1 },
            select: {
                maxTokens: true,
                overlapTokens: true,
                embeddingRefreshTokens: true,
            },
        });

        return this.withChunkConstraints(data, current);
    }

    private async withChunkConstraints(
        data: Prisma.ConversationChunkSettingsUpdateInput,
        currentPromise: Promise<{
            maxTokens: number;
            overlapTokens: number;
            embeddingRefreshTokens: number;
        } | null>,
    ): Promise<Prisma.ConversationChunkSettingsUpdateInput> {
        const current = await currentPromise;
        const maxTokens = this.numberFromUpdate(
            data.maxTokens,
            current?.maxTokens ?? 4000,
        );
        const overlapTokens = this.numberFromUpdate(
            data.overlapTokens,
            current?.overlapTokens ?? 800,
        );
        const embeddingRefreshTokens = this.numberFromUpdate(
            data.embeddingRefreshTokens,
            current?.embeddingRefreshTokens ?? 1000,
        );

        if (overlapTokens >= maxTokens) {
            throw new BadRequestException(
                "overlapTokens must be lower than maxTokens",
            );
        }

        return {
            ...data,
            maxTokens,
            overlapTokens,
            embeddingRefreshTokens,
        };
    }

    private numberFromUpdate(value: unknown, fallback: number): number {
        return typeof value === "number" ? value : fallback;
    }

    private requiredText(value: string, field: string): string {
        if (typeof value !== "string" || !value.trim()) {
            throw new BadRequestException(`${field} must be a non-empty string`);
        }

        return value.trim();
    }

    private requiredBoolean(value: unknown, field: string): boolean {
        if (typeof value !== "boolean") {
            throw new BadRequestException(`${field} must be a boolean`);
        }
        return value;
    }

    private requiredChoice<T extends string>(value: unknown, field: string, choices: readonly T[]): T {
        if (typeof value !== "string" || !choices.includes(value as T)) {
            throw new BadRequestException(`${field} must be one of: ${choices.join(", ")}`);
        }
        return value as T;
    }

    private optionalText(value: string | null, field: string): string | null {
        if (value === null) return null;
        return this.requiredText(value, field);
    }

    private requiredTime(value: string, field: string): string {
        if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/u.test(value)) {
            throw new BadRequestException(`${field} must be a time in HH:mm format`);
        }
        return value;
    }

    private requiredInteger(
        value: number,
        field: string,
        minimum: number,
        maximum: number,
    ): number {
        if (
            !Number.isInteger(value) ||
            value < minimum ||
            value > maximum
        ) {
            throw new BadRequestException(
                `${field} must be an integer between ${minimum} and ${maximum}`,
            );
        }

        return value;
    }

    private optionalNumber(
        value: number | null,
        field: string,
        minimum: number,
        maximum: number,
    ): number | null {
        if (value === null) {
            return null;
        }

        if (
            typeof value !== "number" ||
            !Number.isFinite(value) ||
            value < minimum ||
            value > maximum
        ) {
            throw new BadRequestException(
                `${field} must be null or a number between ${minimum} and ${maximum}`,
            );
        }

        return value;
    }

    private optionalInteger(
        value: number | null,
        field: string,
        minimum: number,
        maximum: number,
    ): number | null {
        if (value === null) {
            return null;
        }

        return this.requiredInteger(value, field, minimum, maximum);
    }

    private toApplicationResponse(
        settings: ApplicationSettings,
    ): ApplicationSettingsResponse {
        return {
            llmCombo: settings.llmCombo,
            orchestratorCombo: settings.orchestratorCombo,
            appTimezone: settings.appTimezone,
            llmTemperature: settings.llmTemperature,
            llmMaxTokens: settings.llmMaxTokens,
            immediateContextMaxTokens: settings.immediateContextMaxTokens,
            orchestratorMaxIterations: settings.orchestratorMaxIterations,
            orchestratorMaxToolCalls: settings.orchestratorMaxToolCalls,
            orchestratorToolResultMaxTokens:
                settings.orchestratorToolResultMaxTokens,
            retrievalDefaultTopK: settings.retrievalDefaultTopK,
            retrievalMaxTopK: settings.retrievalMaxTopK,
            retrievalDefaultMaxContextTokens:
                settings.retrievalDefaultMaxContextTokens,
            retrievalMaxContextTokens: settings.retrievalMaxContextTokens,
            retrievalIncludeMessages: settings.retrievalIncludeMessages,
            retrievalStrategy: settings.retrievalStrategy as ApplicationSettingsResponse["retrievalStrategy"],
            retrievalVectorTopK: settings.retrievalVectorTopK,
            retrievalLexicalTopK: settings.retrievalLexicalTopK,
            retrievalRrfK: settings.retrievalRrfK,
            retrievalCandidatePoolTopK: settings.retrievalCandidatePoolTopK,
            retrievalRerankerEnabled: settings.retrievalRerankerEnabled,
            retrievalRerankerModel: settings.retrievalRerankerModel as ApplicationSettingsResponse["retrievalRerankerModel"],
            retrievalRerankerTopK: settings.retrievalRerankerTopK,
            retrievalRerankerThreshold: settings.retrievalRerankerThreshold,
            retrievalDeduplicationEnabled: settings.retrievalDeduplicationEnabled,
            retrievalDeduplicationThreshold: settings.retrievalDeduplicationThreshold,
            conversationEvidenceEnabled: settings.conversationEvidenceEnabled,
            temporalConsolidationEnabled: settings.temporalConsolidationEnabled,
            temporalConsolidationDefaultCombo: settings.temporalConsolidationDefaultCombo,
            temporalConsolidationFallbackCombo: settings.temporalConsolidationFallbackCombo,
            temporalConsolidationStartTime: settings.temporalConsolidationStartTime,
            temporalConsolidationEndTime: settings.temporalConsolidationEndTime,
            researchEnabled: settings.researchEnabled,
            researchSearchOrchestratorCombo: settings.researchSearchOrchestratorCombo,
            researchDefaultMode: settings.researchDefaultMode as ApplicationSettingsResponse["researchDefaultMode"],
            researchDefaultRecency: settings.researchDefaultRecency as ApplicationSettingsResponse["researchDefaultRecency"],
            researchMaxSources: settings.researchMaxSources,
            researchMaxRounds: settings.researchMaxRounds,
            researchMaxQueries: settings.researchMaxQueries,
            researchSearchProvider: settings.researchSearchProvider,
            researchExtractionProvider: settings.researchExtractionProvider,
            researchCacheEnabled: settings.researchCacheEnabled,
            researchBrowserFallbackEnabled: settings.researchBrowserFallbackEnabled,
        };
    }
}
