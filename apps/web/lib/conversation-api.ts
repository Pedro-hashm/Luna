export type ConversationMessageRole = "system" | "user" | "assistant" | "tool";

export interface ConversationMessage {
  id: string;
  role: ConversationMessageRole;
  content: string;
  model: string | null;
  createdAt: string;
}

export interface SendMessageResponse {
  conversationId: string;
  messages: ConversationMessage[];
}

export interface ConversationListItem {
  id: string;
  title: string;
  preview: string;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationDetail {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ConversationMessage[];
}

export interface ConversationRetrievalMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
}

export interface ConversationRetrievalResult {
  query: string | null;
  results: Array<{
    conversationId: string;
    chunkId: string;
    status: "open" | "closed";
    score: number;
    content: string;
    tailContent?: string;
    startMessageId: string;
    endMessageId: string;
    tokenCount: number;
    timeRange: {
      start: string;
      end: string;
      timeZone: string;
    };
    messages?: ConversationRetrievalMessage[];
  }>;
}

export interface ToolContextMessage {
  id?: string;
  role: ConversationMessageRole;
  content: string;
  createdAt?: string;
}

export type ConversationRetrievalScope =
  | "auto"
  | "current_conversation"
  | "historical";

export interface ExecuteToolResponse {
  tool: "conversation_retrieval";
  context: {
    conversationId?: string;
    currentMessageId?: string;
    currentDateTime?: string;
    messages: ToolContextMessage[];
  };
  result: ConversationRetrievalResult;
}

export interface ApplicationSettings {
  voiceEnabled: boolean;
  voiceDefaultMode: "wake" | "live";
  voiceProfileId: string;
  voiceTtsEngine: "kokoro" | "qwen" | "qwen-fast" | "f5" | "fish";
  fishAudioReferenceId: string;
  voiceResponseMode: "concise" | "normal";
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
  sttProvider: string;
  ttsProvider: string;
  llmCombo: string;
  orchestratorCombo: string;
  researchEnabled: boolean;
  researchSearchOrchestratorCombo: string;
  researchDefaultMode: "quick" | "deep";
  researchDefaultRecency: "auto" | "day" | "week" | "month" | "year";
  researchMaxSources: number;
  researchMaxRounds: number;
  researchMaxQueries: number;
  researchSearchProvider: string;
  researchExtractionProvider: string;
  researchCacheEnabled: boolean;
  researchBrowserFallbackEnabled: boolean;
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
  retrievalStrategy: "hybrid" | "vector-only" | "lexical-only";
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
}

export interface TemporalConsolidationRun {
  id: string;
  trigger: "manual" | "scheduled" | string;
  status: "running" | "completed" | "cancelled" | "failed" | string;
  currentPhase?: string | null;
  currentPhaseStartedAt?: string | null;
  progressUpdatedAt?: string | null;
  phaseDurationsMs?: Record<string, number>;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string | null;
  defaultCombo?: string | null;
  fallbackCombo?: string | null;
  actualCombo?: string | null;
  provider?: string | null;
  model?: string | null;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  messagesScanned?: number;
  chunksScanned?: number;
  candidatesDetected?: number;
  llmCalls?: number;
  historicalRetrievalCalls?: number;
  relationsProposed?: number;
  relationsCreated?: number;
  relationsRejected?: number;
  relationsSkipped?: number;
  retryCount?: number;
  errorCount?: number;
  errorMessage?: string | null;
}

export interface TemporalConsolidationStatus {
  enabled: boolean;
  running: boolean;
  activeRun: TemporalConsolidationRun | null;
  latestRun: TemporalConsolidationRun | null;
  checkpoint: { lastMessageCreatedAt: string | null; lastMessageId: string | null } | null;
}

export interface TemporalConsolidationRunDetails extends TemporalConsolidationRun {
  hasMore?: boolean;
  proposed?: Array<{
    predecessorMessageId: string;
    successorMessageId: string;
    type: "SUPERSEDES" | "CORRECTS";
    subject: string;
    oldValue: string;
    newValue: string;
    confidence: number;
    reason: string;
    predecessorExcerpt: string;
    successorExcerpt: string;
  }>;
  rejected?: Array<{
    successorMessageId: string;
    predecessorMessageId?: string;
    reason: string;
  }>;
}

export type RerankerModel =
  | "cross-encoder/ettin-reranker-17m-v1"
  | "qwen3-reranker-0.6b-q8_0";

export interface RerankerModelStatus {
  id: RerankerModel;
  installed: boolean;
  loaded: boolean;
  status: "not_installed" | "downloading" | "installed" | "loading" | "loaded" | "failed";
  error?: string;
  bytes?: number;
}

export interface RerankerModelsResponse {
  available: boolean;
  models: RerankerModelStatus[];
}

export interface RerankerComparisonResponse {
  query: string;
  threshold: number;
  runs: Array<{
    model: RerankerModel;
    latencyMs: number;
    aboveThreshold: number;
    results: Array<{ index: number; score: number | undefined }>;
  }>;
}

export interface ConversationChunkSettings {
  maxTokens: number;
  overlapTokens: number;
  embeddingRefreshTokens: number;
  embeddingModel: string;
  embeddingDimensions: number;
}

export interface SettingsResponse {
  application: ApplicationSettings;
  conversationChunks: ConversationChunkSettings;
}

export interface ObservabilityMetrics {
  period: { from: string; to: string; timeZone: string };
  summary: {
    requests: number;
    llmRequests: number;
    toolCalls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    averageLatencyMs: number;
    errors: number;
    timeouts: number;
  };
  byDay: Array<{
    date: string;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    averageLatencyMs: number;
    errors: number;
  }>;
  byStage: Array<{ stage: string; totalMs: number; averageMs: number }>;
  byModel: Array<{
    combo: string;
    model: string;
    requests: number;
    averageLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
  }>;
  recent: Array<{
    id: string;
    conversationId: string | null;
    kind: string;
    status: string;
    toolName: string | null;
    combo: string | null;
    model: string | null;
    latencyMs: number;
    inputTokens: number;
    outputTokens: number;
    createdAt: string;
    responseMessageId: string | null;
    errorMessage: string | null;
  }>;
}

export interface ContextPart {
  tokens: number;
  messages?: Array<{
    id?: string;
    role: string;
    content: string;
    createdAt?: string;
    evidence?: Array<{
      evidence_id: string;
      date_from: string;
      date_to: string;
      dates: string[];
    }>;
  }>;
  items?: unknown[];
}

export interface PromptMessage {
  role: string;
  content: string;
}

export interface ConversationInspector {
  conversation: {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
  };
  statistics: {
    messageCount: number;
    tokenCount: number;
    durationMs: number;
    toolsUsed: number;
    memoriesRecovered: number;
    relatedConversations: number;
  };
  responses: Array<{
    traceId: string;
    responseMessageId: string | null;
    response: {
      id: string;
      role: string;
      content: string;
      createdAt: string;
    } | null;
    kind: string;
    status: string;
    toolName: string | null;
    combo: string | null;
    model: string | null;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedInputTokens: number;
    estimatedOutputTokens: number;
    latencyMs: number;
    stages: Record<string, number>;
    context: {
      immediate?: ContextPart;
      memory?: ContextPart;
      tools?: ContextPart;
      system?: ContextPart;
      orchestrator?: ContextPart;
      promptTarget?: "orchestrator" | "luna";
      promptIteration?: number;
      promptMessages?: PromptMessage[];
      totalTokens?: number;
      [key: string]: unknown;
    };
    errorMessage: string | null;
    createdAt: string;
  }>;
}

export interface ResearchEvent {
  id: string;
  sequence: number;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface ResearchSource {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  sourceType: string;
  rank: number | null;
  publishedAt: string | null;
  retrievedAt: string;
  extractionMethod: string | null;
  metadata: Record<string, unknown> | null;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  text: string;
  location: string | null;
  type: string;
  createdAt: string;
}

export interface ResearchRunView {
  id: string;
  conversationId: string | null;
  messageId: string | null;
  requestId: string | null;
  question: string;
  status: string;
  mode: string;
  plannerCombo: string;
  summaryContext: string | null;
  metadata: Record<string, unknown> | null;
  startedAt: string;
  completedAt: string | null;
  events: ResearchEvent[];
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
}

export class ConversationApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConversationApiError";
  }
}

export async function sendConversationMessage(input: {
  content: string;
  conversationId?: string;
}): Promise<SendMessageResponse> {
  const endpoint = input.conversationId
    ? `/api/conversation/${encodeURIComponent(input.conversationId)}/messages`
    : "/api/conversation/messages";

  return requestJson<SendMessageResponse>(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: input.content }),
  });
}

export async function getConversations(): Promise<ConversationListItem[]> {
  return requestJson<ConversationListItem[]>("/api/conversation");
}

export async function getConversation(
  conversationId: string,
): Promise<ConversationDetail> {
  return requestJson<ConversationDetail>(
    `/api/conversation/${encodeURIComponent(conversationId)}`,
  );
}

export async function executeConversationRetrieval(input: {
  query?: string;
  conversationId?: string;
  currentMessageId?: string;
  currentDateTime?: string;
  dateFrom?: string;
  dateTo?: string;
  scope?: ConversationRetrievalScope;
  messages: ToolContextMessage[];
}): Promise<ExecuteToolResponse> {
  return requestJson<ExecuteToolResponse>("/api/tools/execute", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tool: "conversation_retrieval",
      input: {
        query: input.query,
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        scope: input.scope,
        includeMessages: true,
      },
      context: {
        conversationId: input.conversationId,
        currentMessageId: input.currentMessageId,
        currentDateTime: input.currentDateTime,
        messages: input.messages,
      },
    }),
  });
}

export async function getSettings(): Promise<SettingsResponse> {
  return requestJson<SettingsResponse>("/api/settings");
}

export async function updateSettings(
  settings: SettingsResponse,
): Promise<SettingsResponse> {
  return requestJson<SettingsResponse>("/api/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getTemporalConsolidationStatus(): Promise<TemporalConsolidationStatus> {
  return requestJson<TemporalConsolidationStatus>("/api/temporal-consolidation/status");
}

export async function getTemporalConsolidationRuns(): Promise<TemporalConsolidationRun[]> {
  return requestJson<TemporalConsolidationRun[]>("/api/temporal-consolidation/runs");
}

export async function getTemporalConsolidationRun(id: string): Promise<TemporalConsolidationRunDetails> {
  return requestJson<TemporalConsolidationRunDetails>(`/api/temporal-consolidation/runs/${encodeURIComponent(id)}`);
}

export async function runTemporalConsolidation(dryRun: boolean): Promise<{ run: TemporalConsolidationRun }> {
  return requestJson<{ run: TemporalConsolidationRun }>("/api/temporal-consolidation/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ dryRun }),
  });
}

export async function getRerankerModels(): Promise<RerankerModelsResponse> {
  return requestJson<RerankerModelsResponse>("/api/retrieval/rerankers");
}

export async function downloadRerankerModel(
  model: RerankerModel,
): Promise<{ status: string; model: RerankerModel }> {
  return requestJson<{ status: string; model: RerankerModel }>(
    `/api/retrieval/rerankers/${encodeURIComponent(model)}/download`,
    { method: "POST" },
  );
}

export async function compareRerankers(input: {
  query: string;
  documents: string[];
  threshold: number;
}): Promise<RerankerComparisonResponse> {
  return requestJson<RerankerComparisonResponse>("/api/retrieval/rerankers/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function getObservabilityMetrics(input?: {
  from?: string;
  to?: string;
}): Promise<ObservabilityMetrics> {
  const params = new URLSearchParams();
  if (input?.from) params.set("from", input.from);
  if (input?.to) params.set("to", input.to);
  const query = params.toString();

  return requestJson<ObservabilityMetrics>(
    `/api/observability/metrics${query ? `?${query}` : ""}`,
  );
}

export async function getConversationInspector(
  conversationId: string,
): Promise<ConversationInspector> {
  return requestJson<ConversationInspector>(
    `/api/observability/conversations/${encodeURIComponent(conversationId)}`,
  );
}

export async function getConversationResearchRuns(
  conversationId: string,
): Promise<{ runs: ResearchRunView[] }> {
  return requestJson<{ runs: ResearchRunView[] }>(
    `/api/research/conversations/${encodeURIComponent(conversationId)}/runs`,
  );
}

export async function getResearchRun(runId: string): Promise<ResearchRunView> {
  return requestJson<ResearchRunView>(
    `/api/research/runs/${encodeURIComponent(runId)}`,
  );
}

async function requestJson<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint, init);

  const payload: unknown = await response.json().catch(() => undefined);

  if (!response.ok) {
    throw new ConversationApiError(messageFromPayload(payload));
  }

  return payload as T;
}

function messageFromPayload(payload: unknown): string {
  if (typeof payload === "object" && payload !== null && "message" in payload) {
    const message = payload.message;
    if (typeof message === "string") {
      return message;
    }
    if (Array.isArray(message) && typeof message[0] === "string") {
      return message[0];
    }
  }

  return "Não foi possível enviar a mensagem. Tente novamente em instantes.";
}
