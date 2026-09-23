export const RESEARCH_MODES = ['quick', 'deep'] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

export const RESEARCH_RECENCIES = [
  'auto',
  'day',
  'week',
  'month',
  'year',
  'any',
] as const;
export type ResearchRecency = (typeof RESEARCH_RECENCIES)[number];

export interface ResearchTask {
  question: string;
  mode?: ResearchMode;
  recency?: ResearchRecency;
  conversationId?: string;
  messageId?: string;
  requestId?: string;
  /** A short, relevant context excerpt, not the entire conversation history. */
  conversationContext?: string;
  maxSources?: number;
  maxRounds?: number;
  maxQueries?: number;
  signal?: AbortSignal;
}
