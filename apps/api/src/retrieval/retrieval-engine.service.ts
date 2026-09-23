import { Inject, Injectable, Logger } from '@nestjs/common';
import { FILTER_RETRIEVER, LEXICAL_RETRIEVER, RERANKER, VECTOR_RETRIEVER } from './retrieval.types';
import type {
  RetrievalCandidate,
  RetrievalCandidateTrace,
  RetrievalConfig,
  RetrievalDiagnostics,
  RetrievalQuery,
  RetrievalResult,
  Retriever,
  Ranker,
} from './retrieval.types';
import { ReciprocalRankFusion } from './rrf-fusion.service';
import { ResultDeduplicator } from './result-deduplicator.service';
import { RetrievalResultCompiler } from './result-compiler.service';

@Injectable()
export class RetrievalEngine {
  private readonly logger = new Logger(RetrievalEngine.name);

  constructor(
    @Inject(VECTOR_RETRIEVER) private readonly vectorRetriever: Retriever,
    @Inject(LEXICAL_RETRIEVER) private readonly lexicalRetriever: Retriever,
    @Inject(FILTER_RETRIEVER) private readonly filterRetriever: Retriever,
    private readonly fusion: ReciprocalRankFusion,
    @Inject(RERANKER) private readonly ranker: Ranker,
    private readonly deduplicator: ResultDeduplicator,
    private readonly compiler: RetrievalResultCompiler,
  ) {}

  async retrieve(
    query: RetrievalQuery,
    config: RetrievalConfig,
  ): Promise<RetrievalResult> {
    const startedAt = Date.now();
    const diagnostics: RetrievalDiagnostics = {
      query: query.query ?? null,
      filters: query.filters ?? {},
      config: { ...config },
      stages: {},
      stageResults: {},
      counts: {},
      reranker: {
        model: config.rerankerEnabled && query.query ? config.rerankerModel : null,
        inputCount: 0,
        outputCount: 0,
        threshold: config.rerankerEnabled && query.query ? config.rerankerThreshold : null,
      },
      candidates: [],
      finalResultCount: 0,
      totalLatencyMs: 0,
    };
    let allPipelineCandidates: RetrievalCandidate[] = [];
    const candidatePoolExcluded = new Set<string>();
    const rerankerPoolExcluded = new Set<string>();

    const stage = async <T>(
      name: string,
      work: () => Promise<T>,
      count: (result: T) => number,
    ): Promise<T> => {
      const stageStartedAt = Date.now();
      this.logger.log(JSON.stringify({ event: `retrieval.${name}.started` }));
      try {
        const result = await work();
        const latencyMs = Date.now() - stageStartedAt;
        const resultCount = count(result);
        diagnostics.stages[name] = { count: resultCount, latencyMs };
        diagnostics.counts[name] = resultCount;
        this.logger.log(
          JSON.stringify({
            event: `retrieval.${name}.completed`,
            count: resultCount,
            latencyMs,
          }),
        );
        return result;
      } catch (error) {
        const latencyMs = Date.now() - stageStartedAt;
        diagnostics.stages[name] = { count: 0, latencyMs };
        diagnostics.counts[name] = 0;
        diagnostics.fallback = `${name}_failed`;
        this.logger.error(
          JSON.stringify({
            event: `retrieval.${name}.failed`,
            latencyMs,
            error: error instanceof Error ? error.message : 'unknown error',
          }),
        );
        throw error;
      }
    };

    this.logger.log(
      JSON.stringify({
        event: 'retrieval.request',
        queryLength: query.query?.length ?? 0,
        strategy: query.query ? config.strategy : 'filters-only',
        filters: query.filters ?? {},
        configuration: config,
      }),
    );

    try {
      let candidates: RetrievalCandidate[];

      if (!query.query) {
        candidates = await stage(
          'filtered',
          () => this.filterRetriever.retrieve(query, { topK: config.candidatePoolTopK }),
          (result) => result.length,
        );
        candidates = candidates.map((candidate, index) => ({
          ...candidate,
          vectorRank: undefined,
          lexicalRank: index + 1,
          retrievalPresence: ['filters'],
        }));
        diagnostics.stageResults.filtered = this.traceCandidates(candidates);
        diagnostics.stageResults.candidate_pool = this.traceCandidates(candidates);
        diagnostics.stages.candidate_pool = { count: candidates.length, latencyMs: 0 };
        diagnostics.counts.candidatePool = candidates.length;
        allPipelineCandidates = [...candidates];
      } else {
        const [vectorResults, lexicalResults] = await Promise.all([
          config.strategy === 'lexical-only'
            ? Promise.resolve([])
            : stage(
                'vector',
                () => this.vectorRetriever.retrieve(query, { topK: config.vectorTopK }),
                (result) => result.length,
              ),
          config.strategy === 'vector-only'
            ? Promise.resolve([])
            : stage(
                'lexical',
                () => this.lexicalRetriever.retrieve(query, { topK: config.lexicalTopK }),
                (result) => result.length,
              ),
        ]);

        diagnostics.stageResults.vector = this.traceCandidates(vectorResults);
        diagnostics.stageResults.lexical = this.traceCandidates(lexicalResults);

        const fusionStartedAt = Date.now();
        if (config.strategy === 'vector-only') {
          candidates = vectorResults.map((candidate, index) => ({
            ...candidate,
            vectorRank: candidate.vectorRank ?? index + 1,
            retrievalPresence: ['vector'],
          }));
        } else if (config.strategy === 'lexical-only') {
          candidates = lexicalResults.map((candidate, index) => ({
            ...candidate,
            lexicalRank: candidate.lexicalRank ?? index + 1,
            retrievalPresence: ['lexical'],
          }));
        } else {
          candidates = this.fusion.fuse(
            vectorResults,
            lexicalResults,
            config.rrfK,
          );
        }

        const poolSelectionStartedAt = Date.now();
        const fusedCount = candidates.length;
        diagnostics.stageResults.fusion = this.traceCandidates(candidates);
        allPipelineCandidates = [...candidates];
        for (const candidate of candidates.slice(config.candidatePoolTopK)) {
          candidatePoolExcluded.add(candidate.id);
        }
        candidates = candidates.slice(0, config.candidatePoolTopK);
        diagnostics.stageResults.candidate_pool = this.traceCandidates(candidates);
        diagnostics.stages.candidate_pool = {
          count: candidates.length,
          latencyMs: Date.now() - poolSelectionStartedAt,
        };
        diagnostics.counts.candidatePool = candidates.length;
        diagnostics.stages.fusion = {
          count: candidates.length,
          latencyMs: Date.now() - fusionStartedAt,
        };
        diagnostics.counts.fusion = candidates.length;
        diagnostics.counts.fusionUnique = fusedCount;
        this.logger.log(
          JSON.stringify({
            event: config.strategy === 'hybrid' ? 'retrieval.rrf.completed' : 'retrieval.ranking.selected',
            uniqueCandidates: fusedCount,
            selectedPool: candidates.length,
            latencyMs: diagnostics.stages.fusion.latencyMs,
            strategy: config.strategy,
          }),
        );
      }

      let rerankerScores = new Map<string, number>();

      if (query.query && config.rerankerEnabled && candidates.length > 0) {
        const rerankerInput = candidates.slice(0, config.rerankerTopK);
        diagnostics.stageResults.reranker_input = this.traceCandidates(rerankerInput);
        diagnostics.reranker.inputCount = rerankerInput.length;
        const ranked = await stage(
          'reranker',
          () => this.ranker.rank(query.query!, rerankerInput, config.rerankerModel),
          (result) => result.length,
        );
        diagnostics.reranker.outputCount = ranked.length;
        rerankerScores = new Map(
          ranked.flatMap((candidate) =>
            candidate.rerankerScore === undefined
              ? []
              : [[candidate.id, candidate.rerankerScore] as [string, number]],
          ),
        );
        diagnostics.stageResults.reranker = this.traceCandidates(ranked);
        for (const candidate of candidates.slice(config.rerankerTopK)) {
          rerankerPoolExcluded.add(candidate.id);
        }
        candidates = ranked;
      } else {
        diagnostics.stageResults.reranker_input = [];
        diagnostics.stageResults.reranker = [];
        diagnostics.stages.reranker = { count: 0, latencyMs: 0 };
        diagnostics.counts.reranker = 0;
      }

      const beforeThreshold = candidates.length;
      const relevanceFilterStartedAt = Date.now();
      const thresholdRejected = new Set<string>();
      if (config.rerankerEnabled && query.query) {
        candidates = candidates.filter((candidate) => {
          const score = candidate.rerankerScore;
          const accepted = score !== undefined && score >= config.rerankerThreshold;
          if (!accepted) thresholdRejected.add(candidate.id);
          return accepted;
        });
      }
      diagnostics.stages.relevance_filter = {
        count: candidates.length,
        latencyMs: Date.now() - relevanceFilterStartedAt,
      };
      diagnostics.stageResults.relevance_filter = this.traceCandidates(candidates);
      diagnostics.counts.relevanceFilterBefore = beforeThreshold;
      diagnostics.counts.relevanceFilter = candidates.length;
      this.logger.log(
        JSON.stringify({
          event: 'retrieval.relevance_filter.completed',
          before: beforeThreshold,
          after: candidates.length,
          threshold: config.rerankerEnabled ? config.rerankerThreshold : null,
          latencyMs: diagnostics.stages.relevance_filter.latencyMs,
        }),
      );

      const beforeDedup = candidates.length;
      const deduplicationStartedAt = Date.now();
      const deduplicated = config.deduplicationEnabled
        ? this.deduplicator.deduplicate(candidates, config.deduplicationThreshold)
        : { candidates, removedIds: [] };
      candidates = deduplicated.candidates;
      const dedupRemoved = new Set(deduplicated.removedIds);
      diagnostics.stages.deduplication = {
        count: candidates.length,
        latencyMs: Date.now() - deduplicationStartedAt,
      };
      diagnostics.stageResults.deduplication = this.traceCandidates(candidates);
      diagnostics.counts.deduplicationBefore = beforeDedup;
      diagnostics.counts.deduplication = candidates.length;
      this.logger.log(
        JSON.stringify({
          event: 'retrieval.dedup.completed',
          before: beforeDedup,
          after: candidates.length,
          removed: deduplicated.removedIds.length,
          latencyMs: diagnostics.stages.deduplication.latencyMs,
        }),
      );

      const compilerStartedAt = Date.now();
      const compiled = this.compiler.compile(
        candidates,
        query.limit,
        query.maxContextTokens,
      );
      const finalRanks = new Map(
        compiled.candidates.map((candidate, index) => [candidate.id, index + 1]),
      );
      const reasons = new Map(compiled.excludedBy);
      for (const id of candidatePoolExcluded) reasons.set(id, 'candidate_pool_limit');
      for (const id of rerankerPoolExcluded) reasons.set(id, 'reranker_pool_limit');
      for (const id of thresholdRejected) reasons.set(id, 'relevance_threshold');
      for (const id of dedupRemoved) reasons.set(id, 'deduplication');
      diagnostics.candidates = allPipelineCandidates.map((candidate): RetrievalCandidateTrace => ({
        id: candidate.id,
        source: candidate.source,
        contentPreview: this.contentPreview(candidate.content),
        metadata: { ...candidate.metadata },
        vectorScore: candidate.vectorScore,
        vectorRank: candidate.vectorRank,
        lexicalScore: candidate.lexicalScore,
        lexicalRank: candidate.lexicalRank,
        rrfScore: candidate.rrfScore,
        rerankerScore: rerankerScores.get(candidate.id) ?? candidate.rerankerScore,
        appearedIn: candidate.retrievalPresence ?? [],
        finalRank: finalRanks.get(candidate.id),
        excludedBy: reasons.get(candidate.id) as RetrievalCandidateTrace['excludedBy'],
      }));
      diagnostics.finalResultCount = compiled.candidates.length;
      diagnostics.stageResults.final = this.traceCandidates(compiled.candidates);
      diagnostics.counts.final = compiled.candidates.length;
      diagnostics.stages.final = {
        count: compiled.candidates.length,
        latencyMs: Date.now() - compilerStartedAt,
      };
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      this.logger.log(
        JSON.stringify({
          event: 'retrieval.completed',
          finalResultCount: diagnostics.finalResultCount,
          totalLatencyMs: diagnostics.totalLatencyMs,
        }),
      );

      return { candidates: compiled.candidates, diagnostics };
    } catch (error) {
      diagnostics.totalLatencyMs = Date.now() - startedAt;
      if (error && typeof error === 'object') {
        Object.assign(error, { retrievalDiagnostics: diagnostics });
      }
      throw error;
    }
  }

  private traceCandidates(
    candidates: RetrievalCandidate[],
  ): RetrievalCandidateTrace[] {
    return candidates.map((candidate) => ({
      id: candidate.id,
      source: candidate.source,
      contentPreview: this.contentPreview(candidate.content),
      metadata: { ...candidate.metadata },
      vectorScore: candidate.vectorScore,
      vectorRank: candidate.vectorRank,
      lexicalScore: candidate.lexicalScore,
      lexicalRank: candidate.lexicalRank,
      rrfScore: candidate.rrfScore,
      rerankerScore: candidate.rerankerScore,
      appearedIn: candidate.retrievalPresence ?? [],
    }));
  }

  private contentPreview(content: string): string {
    const maxCharacters = 600;
    return content.length > maxCharacters
      ? `${content.slice(0, maxCharacters)}…`
      : content;
  }
}
