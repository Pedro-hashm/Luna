export type RetrievalStrategy = 'hybrid' | 'vector-only' | 'lexical-only';

export const RERANKER_MODELS = [
  'cross-encoder/ettin-reranker-17m-v1',
  'qwen3-reranker-0.6b-q8_0',
] as const;

export type RerankerModel = (typeof RERANKER_MODELS)[number];

export type RetrievalCandidate = {
  id: string;
  content: string;
  source: string;
  metadata: Record<string, unknown>;
  vectorScore?: number;
  vectorRank?: number;
  lexicalScore?: number;
  lexicalRank?: number;
  rrfScore?: number;
  rerankerScore?: number;
  retrievalPresence?: string[];
};

export type RetrievalQuery = {
  query?: string;
  filters?: Record<string, unknown>;
  limit: number;
  maxContextTokens: number;
};

export type RetrievalConfig = {
  strategy: RetrievalStrategy;
  vectorTopK: number;
  lexicalTopK: number;
  rrfK: number;
  candidatePoolTopK: number;
  rerankerEnabled: boolean;
  rerankerModel: RerankerModel;
  rerankerTopK: number;
  rerankerThreshold: number;
  deduplicationEnabled: boolean;
  deduplicationThreshold: number;
};

export interface Retriever {
  retrieve(
    query: RetrievalQuery,
    config: { topK: number },
  ): Promise<RetrievalCandidate[]>;
}

export interface Ranker {
  rank(
    query: string,
    candidates: RetrievalCandidate[],
    model: RerankerModel,
  ): Promise<RetrievalCandidate[]>;
}

export interface QueryExpander {
  expand(query: string, config: Record<string, unknown>): Promise<string[]>;
}

export type RetrievalCandidateTrace = {
  id: string;
  source: string;
  contentPreview: string;
  metadata: Record<string, unknown>;
  vectorScore?: number;
  vectorRank?: number;
  lexicalScore?: number;
  lexicalRank?: number;
  rrfScore?: number;
  rerankerScore?: number;
  appearedIn: string[];
  finalRank?: number;
  excludedBy?: 'relevance_threshold' | 'deduplication' | 'reranker_pool_limit' | 'candidate_pool_limit' | 'final_top_k' | 'context_budget';
};

export type RetrievalDiagnostics = {
  query: string | null;
  filters: Record<string, unknown>;
  config: RetrievalConfig;
  stages: Record<string, { count: number; latencyMs: number }>;
  stageResults: Record<string, RetrievalCandidateTrace[]>;
  counts: Record<string, number>;
  reranker: {
    model: RerankerModel | null;
    inputCount: number;
    outputCount: number;
    threshold: number | null;
  };
  candidates: RetrievalCandidateTrace[];
  finalResultCount: number;
  totalLatencyMs: number;
  fallback?: string;
};

export type RetrievalResult = {
  candidates: RetrievalCandidate[];
  diagnostics: RetrievalDiagnostics;
};

export const VECTOR_RETRIEVER = Symbol('VECTOR_RETRIEVER');
export const LEXICAL_RETRIEVER = Symbol('LEXICAL_RETRIEVER');
export const FILTER_RETRIEVER = Symbol('FILTER_RETRIEVER');
export const RERANKER = Symbol('RERANKER');
