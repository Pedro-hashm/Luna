import type { ResearchMode } from './research-task.dto';

export type ResearchSourceType =
  'primary' | 'industry' | 'news' | 'academic' | 'community' | 'other';
export type ResearchEvidenceType =
  'direct' | 'context' | 'indirect' | 'contradiction';

export interface ResearchSource {
  id: string;
  url: string;
  normalizedUrl: string;
  domain: string;
  title: string;
  sourceType: ResearchSourceType;
  rank: number;
  publishedAt?: string;
  retrievedAt: string;
  extractionMethod?: 'static' | 'browser';
  metadata?: Record<string, unknown>;
}

export interface ResearchEvidence {
  id: string;
  sourceId: string;
  text: string;
  location?: string;
  type: ResearchEvidenceType;
  retrievedAt: string;
}

export interface ResearchConflict {
  sourceIds: string[];
  evidenceIds: string[];
  description: string;
}

export interface ResearchResult {
  researchRunId: string;
  status: 'completed' | 'insufficient' | 'failed';
  summaryContext: string;
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  conflicts: ResearchConflict[];
  metadata: {
    mode: ResearchMode;
    rounds: number;
    searchQueries: number;
    sourceCount: number;
    llmCalls: number;
    plannerCombo: string;
    plannerModel?: string;
    plannerInputTokens: number;
    plannerOutputTokens: number;
    latencyMs: number;
    errors: string[];
    verification: 'sufficient' | 'insufficient' | 'conflicting';
  };
}
