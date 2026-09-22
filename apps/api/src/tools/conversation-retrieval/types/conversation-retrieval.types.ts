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
};
