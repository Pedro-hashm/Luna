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
  temporalConsolidationEnabled: boolean;
  temporalConsolidationDefaultCombo: string | null;
  temporalConsolidationFallbackCombo: string | null;
  temporalConsolidationStartTime: string;
  temporalConsolidationEndTime: string;
  researchEnabled: boolean;
  researchSearchOrchestratorCombo: string;
  researchDefaultMode: 'quick' | 'deep';
  researchDefaultRecency: 'auto' | 'day' | 'week' | 'month' | 'year';
  researchMaxSources: number;
  researchMaxRounds: number;
  researchMaxQueries: number;
  researchSearchProvider: string;
  researchExtractionProvider: string;
  researchCacheEnabled: boolean;
  researchBrowserFallbackEnabled: boolean;
  voiceEnabled: boolean;
  voiceDefaultMode: 'wake' | 'live';
  voiceProfileId: string;
  voiceTtsEngine: 'kokoro' | 'qwen' | 'qwen-fast' | 'f5' | 'fish';
  fishAudioReferenceId: string;
  voiceResponseMode: 'concise' | 'normal';
  voiceMaxSentences: number;
  voiceMaxWords: number;
  voiceBargeInEnabled: boolean;
  voiceTtsStreamingEnabled: boolean;
  voiceSpeed: number;
  wakeEnabled: boolean;
  wakeKeyword: string;
  wakeModel: string;
  wakeThreshold: number;
  wakeVerifierEnabled: boolean;
  wakeVerifierModel: string | null;
  wakeVerifierThreshold: number;
  sttProvider: 'speaches';
  ttsProvider: 'kokoro' | 'qwen' | 'qwen-fast' | 'f5' | 'fish';
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
