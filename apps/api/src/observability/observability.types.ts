export type ObservabilityMessage = {
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
};

export type ContextPart = {
  tokens: number;
  messages?: ObservabilityMessage[];
  items?: unknown[];
};

export type ContextSnapshot = {
  immediate?: ContextPart;
  memory?: ContextPart;
  tools?: ContextPart;
  system?: ContextPart;
  orchestrator?: ContextPart;
  totalTokens?: number;
  [key: string]: unknown;
};

export type RecordTraceInput = {
  requestId?: string;
  conversationId?: string;
  responseMessageId?: string;
  kind: 'llm' | 'tool';
  status: 'success' | 'error' | 'timeout';
  toolName?: string;
  combo?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedInputTokens?: number;
  estimatedOutputTokens?: number;
  latencyMs: number;
  stageDurations?: Record<string, number>;
  contextSnapshot?: ContextSnapshot;
  errorMessage?: string;
  startedAt: Date;
  completedAt?: Date;
};

export type ObservabilityMetrics = {
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
};

export type ConversationInspector = {
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
    context: ContextSnapshot;
    errorMessage: string | null;
    createdAt: string;
  }>;
};
