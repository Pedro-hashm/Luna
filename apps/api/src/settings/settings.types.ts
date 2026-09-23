import type { RetrievalStrategy, RerankerModel } from "../retrieval/retrieval.types";

export type ApplicationSettingsResponse = {
    llmCombo: string;
    orchestratorCombo: string;
    appTimezone: string;
  llmTemperature: number | null;
  llmMaxTokens: number | null;
  immediateContextMaxTokens: number;
  orchestratorMaxIterations: number;
  orchestratorMaxToolCalls: number;
  orchestratorToolResultMaxTokens: number;
  retrievalDefaultTopK: number;
    retrievalMaxTopK: number;
    retrievalDefaultMaxContextTokens: number;
    retrievalMaxContextTokens: number;
    retrievalIncludeMessages: boolean;
    retrievalStrategy: RetrievalStrategy;
    retrievalVectorTopK: number;
    retrievalLexicalTopK: number;
    retrievalRrfK: number;
    retrievalCandidatePoolTopK: number;
    retrievalRerankerEnabled: boolean;
    retrievalRerankerModel: RerankerModel;
    retrievalRerankerTopK: number;
    retrievalRerankerThreshold: number;
  retrievalDeduplicationEnabled: boolean;
  retrievalDeduplicationThreshold: number;
  conversationEvidenceEnabled: boolean;
};

export type ConversationChunkSettingsResponse = {
    maxTokens: number;
    overlapTokens: number;
    embeddingRefreshTokens: number;
    embeddingModel: string;
    embeddingDimensions: number;
};

export type SettingsResponse = {
    application: ApplicationSettingsResponse;
    conversationChunks: ConversationChunkSettingsResponse;
};

export type UpdateSettingsRequest = {
    application?: Partial<ApplicationSettingsResponse>;
    conversationChunks?: Partial<ConversationChunkSettingsResponse>;
};
