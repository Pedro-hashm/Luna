export const CONVERSATION_RETRIEVAL_SCOPES = [
  'auto',
  'current_conversation',
  'historical',
] as const;

export type ConversationRetrievalScope =
  (typeof CONVERSATION_RETRIEVAL_SCOPES)[number];

export type ConversationRetrievalInput = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  scope?: ConversationRetrievalScope;
  maxContextTokens?: number;
  includeMessages?: boolean;
};

export type ConversationRetrievalMessage = {
  id: string;
  role: string;
  content: string;
  createdAt: Date;
};

/**
 * System-generated provenance for the messages that support one retrieved
 * result. Values are rendered in the configured application timezone, rather
 * than leaking the database's canonical UTC representation to the model.
 */
export type ConversationRetrievalTimeRange = {
  start: string;
  end: string;
  timeZone: string;
};

export type ConversationRetrievalItem = {
  conversationId: string;
  chunkId: string;
  status: 'open' | 'closed';
  score: number;
  content: string;
  tailContent?: string;
  startMessageId: string;
  endMessageId: string;
  tokenCount: number;
  timeRange: ConversationRetrievalTimeRange;
  messages?: ConversationRetrievalMessage[];
};

export type ConversationRetrievalResult = {
  query: string | null;
  results: ConversationRetrievalItem[];
  /** Internal trace payload. ToolsService removes this before model-facing output. */
  __retrievalDiagnostics?: import('../../../retrieval/retrieval.types').RetrievalDiagnostics;
  /** Conversation adapter decisions; kept out of the model-facing tool result. */
  __conversationDiagnostics?: ConversationRetrievalDiagnostics;
};

export type ConversationRetrievalDiagnostics = {
  scope: ConversationRetrievalScope;
  dateFrom: string | null;
  dateTo: string | null;
  maxContextTokens: number;
  includeMessages: boolean;
  stages: {
    messageExpansion: { count: number; latencyMs: number };
    resultAssembly: { count: number; latencyMs: number };
  };
  counts: {
    retrievalCandidates: number;
    returnedResults: number;
    excludedCandidates: number;
  };
  candidates: Array<{
    chunkId: string;
    outcome: 'returned' | 'excluded';
    reason?:
      | 'outside_current_message_visibility'
      | 'source_message_missing'
      | 'no_message_in_date_range'
      | 'context_budget';
    sourceMessageCount: number;
    returnedMessageCount: number;
    resultTokens?: number;
  }>;
};
