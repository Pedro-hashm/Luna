import type { MessageRole, TemporalConsolidationRun, TemporalRelationType } from '@prisma/client';

export type TemporalTrigger = 'manual' | 'scheduled';
export type TemporalRunStatus = 'running' | 'completed' | 'cancelled' | 'failed';

export type TemporalMessage = {
  id: string;
  conversationId: string;
  role: MessageRole;
  content: string;
  createdAt: Date;
};

export type ProposedTemporalRelation = {
  predecessorMessageId: string;
  successorMessageId: string;
  type: TemporalRelationType;
  subject: string;
  oldValue: string;
  newValue: string;
  confidence: number;
  reason: string;
  predecessorExcerpt: string;
  successorExcerpt: string;
};

export type RejectedTemporalRelation = {
  successorMessageId: string;
  predecessorMessageId?: string;
  reason: string;
};

export type TemporalRunOutcome = {
  run: TemporalConsolidationRun;
};

export type TemporalRunMetrics = {
  messagesScanned: number;
  chunksScanned: number;
  candidatesDetected: number;
  llmCalls: number;
  historicalRetrievalCalls: number;
  relationsProposed: number;
  relationsCreated: number;
  relationsRejected: number;
  relationsSkipped: number;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  retryCount: number;
  errorCount: number;
  candidateDetectionLatencyMs: number;
  llmLatencyMs: number;
  historicalRetrievalLatencyMs: number;
  validationLatencyMs: number;
  persistenceLatencyMs: number;
  rejectionReasons: Record<string, number>;
  actualCombo: string | null;
  provider: string | null;
  model: string | null;
};

export function emptyTemporalRunMetrics(): TemporalRunMetrics {
  return {
    messagesScanned: 0,
    chunksScanned: 0,
    candidatesDetected: 0,
    llmCalls: 0,
    historicalRetrievalCalls: 0,
    relationsProposed: 0,
    relationsCreated: 0,
    relationsRejected: 0,
    relationsSkipped: 0,
    fallbackUsed: false,
    fallbackReason: null,
    retryCount: 0,
    errorCount: 0,
    candidateDetectionLatencyMs: 0,
    llmLatencyMs: 0,
    historicalRetrievalLatencyMs: 0,
    validationLatencyMs: 0,
    persistenceLatencyMs: 0,
    rejectionReasons: {},
    actualCombo: null,
    provider: null,
    model: null,
  };
}
