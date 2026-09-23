import type { ConversationEvidenceReference } from '../tools/conversation-retrieval/types/conversation-retrieval.types';

export const CONVERSATION_CONTEXT_DIRECTIONS = ['before', 'after', 'both'] as const;
export type ConversationContextDirection = (typeof CONVERSATION_CONTEXT_DIRECTIONS)[number];

export type PublicConversationEvidence = {
  evidence_id: string;
  date_from: string;
  date_to: string;
  dates: string[];
};

export type ConversationContextResult = {
  evidence_id: string;
  direction: ConversationContextDirection;
  results: Array<{ date: string; role: string; content: string }>;
  resultCount: number;
  /** Internal diagnostics removed from the model-facing result. */
  __evidenceDiagnostics?: {
    event: 'evidence.resolve';
    evidenceId: string;
    direction: ConversationContextDirection;
    referenceCount: number;
    resultCount: number;
    latencyMs: number;
  };
};

export type StoredConversationEvidenceReference = ConversationEvidenceReference;
