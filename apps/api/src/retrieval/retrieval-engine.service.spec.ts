import { RetrievalEngine } from './retrieval-engine.service';
import { ReciprocalRankFusion } from './rrf-fusion.service';
import { ResultDeduplicator } from './result-deduplicator.service';
import { RetrievalResultCompiler } from './result-compiler.service';
import type {
  RetrievalCandidate,
  RetrievalConfig,
  RetrievalQuery,
  Retriever,
  RerankerModel,
} from './retrieval.types';

const candidate = (id: string, content = id): RetrievalCandidate => ({
  id,
  content,
  source: 'conversation_chunk',
  metadata: {},
});

const config = (overrides: Partial<RetrievalConfig> = {}): RetrievalConfig => ({
  strategy: 'hybrid',
  vectorTopK: 30,
  lexicalTopK: 30,
  rrfK: 60,
  candidatePoolTopK: 30,
  rerankerEnabled: false,
  rerankerModel: 'cross-encoder/ettin-reranker-17m-v1',
  rerankerTopK: 30,
  rerankerThreshold: 0.05,
  deduplicationEnabled: true,
  deduplicationThreshold: 0.85,
  ...overrides,
});

const engineFor = (
  vector: jest.Mocked<Retriever>,
  lexical: jest.Mocked<Retriever>,
  filtered: jest.Mocked<Retriever>,
  ranker: { rank: jest.Mock },
) =>
  new RetrievalEngine(
    vector,
    lexical,
    filtered,
    new ReciprocalRankFusion(),
    ranker as never,
    new ResultDeduplicator(),
    new RetrievalResultCompiler(),
  );

const query: RetrievalQuery = {
  query: 'Tokyo Ghoul',
  filters: { dateFrom: new Date('2026-09-22T00:00:00.000Z') },
  limit: 5,
  maxContextTokens: 1000,
};

describe('RetrievalEngine', () => {
  it('runs vector, lexical, RRF, reranking, threshold, deduplication and final selection', async () => {
    const vector = { retrieve: jest.fn().mockResolvedValue([
      candidate('A', 'Tokyo Ghoul is a dark fantasy manga.'),
      candidate('B', 'Nebula 47 uses PostgreSQL for vector retrieval.'),
      candidate('C', 'Tokyo Ghoul is a dark fantasy manga.'),
    ]) } as jest.Mocked<Retriever>;
    const lexical = { retrieve: jest.fn().mockResolvedValue([
      candidate('A', 'Tokyo Ghoul is a dark fantasy manga.'),
      candidate('B', 'Nebula 47 uses PostgreSQL for vector retrieval.'),
      candidate('C', 'Tokyo Ghoul is a dark fantasy manga.'),
    ]) } as jest.Mocked<Retriever>;
    const filtered = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const ranker = {
      rank: jest.fn(async (_query: string, items: RetrievalCandidate[]) =>
        items
          .map((item) => ({ ...item, rerankerScore: ({ A: 0.9, B: 0.8, C: 0.85 } as Record<string, number>)[item.id] }))
          .sort((left, right) => (right.rerankerScore ?? 0) - (left.rerankerScore ?? 0)),
      ),
    };
    const engine = engineFor(vector, lexical, filtered, ranker);

    const result = await engine.retrieve({ ...query, limit: 1 }, config({
      candidatePoolTopK: 3,
      rerankerEnabled: true,
      rerankerTopK: 3,
      rerankerThreshold: 0.5,
    }));

    expect(vector.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Tokyo Ghoul', limit: 1 }),
      { topK: 30 },
    );
    expect(lexical.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'Tokyo Ghoul', limit: 1 }),
      { topK: 30 },
    );
    expect(ranker.rank).toHaveBeenCalledWith('Tokyo Ghoul', expect.any(Array), 'cross-encoder/ettin-reranker-17m-v1');
    expect(ranker.rank.mock.calls[0]?.[1]).toHaveLength(3);
    expect(result.candidates.map((item) => item.id)).toEqual(['A']);
    expect(result.diagnostics.counts).toMatchObject({
      fusion: 3,
      relevanceFilterBefore: 3,
      relevanceFilter: 3,
      deduplicationBefore: 3,
      deduplication: 2,
      final: 1,
    });
    expect(result.diagnostics.candidates.find((item) => item.id === 'C')?.excludedBy).toBe('deduplication');
    expect(result.diagnostics.candidates.find((item) => item.id === 'B')?.excludedBy).toBe('final_top_k');
    expect(result.diagnostics.stageResults.vector.map((item) => item.id)).toEqual(['A', 'B', 'C']);
    expect(result.diagnostics.stageResults.vector[0]?.contentPreview).toBe('Tokyo Ghoul is a dark fantasy manga.');
    expect(result.diagnostics.stageResults.lexical.map((item) => item.id)).toEqual(['A', 'B', 'C']);
    expect(result.diagnostics.stageResults.fusion).toHaveLength(3);
    expect(result.diagnostics.stageResults.reranker[0]).toMatchObject({ id: 'A', rerankerScore: 0.9 });
    expect(result.diagnostics.stageResults.relevance_filter).toHaveLength(3);
    expect(result.diagnostics.stageResults.deduplication).toHaveLength(2);
    expect(result.diagnostics.stageResults.final).toHaveLength(1);
  });

  it('can return no results for unrelated Tokyo Ghoul candidates below threshold', async () => {
    const unrelated = [candidate('1', 'Receita de pão de fermentação natural.'), candidate('2', 'Agenda de reunião sobre orçamento.')];
    const vector = { retrieve: jest.fn().mockResolvedValue(unrelated) } as jest.Mocked<Retriever>;
    const lexical = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const filtered = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const ranker = {
      rank: jest.fn(async (_query: string, items: RetrievalCandidate[]) => {
        return items.map((item) => ({ ...item, rerankerScore: 0.01 }));
      }),
    };

    const result = await engineFor(vector, lexical, filtered, ranker).retrieve(
      { ...query, query: 'Falamos sobre Tokyo Ghoul hoje?' },
      config({ strategy: 'vector-only', rerankerEnabled: true, rerankerThreshold: 0.05 }),
    );

    expect(result.candidates).toEqual([]);
    expect(result.diagnostics.counts.relevanceFilter).toBe(0);
    expect(result.diagnostics.candidates[0]?.excludedBy).toBe('relevance_threshold');
  });

  it('uses date filters without requiring an embedding query', async () => {
    const vector = { retrieve: jest.fn() } as jest.Mocked<Retriever>;
    const lexical = { retrieve: jest.fn() } as jest.Mocked<Retriever>;
    const filtered = { retrieve: jest.fn().mockResolvedValue([candidate('today', 'Discussed the launch.')]) } as jest.Mocked<Retriever>;
    const ranker = { rank: jest.fn() };
    const engine = engineFor(vector, lexical, filtered, ranker);

    const result = await engine.retrieve(
      { query: undefined, filters: { dateFrom: new Date('2026-09-22T00:00:00.000Z') }, limit: 5, maxContextTokens: 100 },
      config(),
    );

    expect(filtered.retrieve).toHaveBeenCalled();
    expect(vector.retrieve).not.toHaveBeenCalled();
    expect(lexical.retrieve).not.toHaveBeenCalled();
    expect(ranker.rank).not.toHaveBeenCalled();
    expect(result.candidates.map((item) => item.id)).toEqual(['today']);
  });

  it('switches the selected reranker through configuration', async () => {
    const vector = { retrieve: jest.fn().mockResolvedValue([candidate('x')]) } as jest.Mocked<Retriever>;
    const lexical = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const filtered = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const ranker = {
      rank: jest.fn(async (_query: string, items: RetrievalCandidate[], _model: RerankerModel) => {
        return items.map((item) => ({ ...item, rerankerScore: 0.8 }));
      }),
    };
    await engineFor(vector, lexical, filtered, ranker).retrieve(query, config({
      strategy: 'vector-only',
      rerankerEnabled: true,
      rerankerModel: 'qwen3-reranker-0.6b-q8_0',
    }));
    expect(ranker.rank.mock.calls[0]?.[2]).toBe('qwen3-reranker-0.6b-q8_0');
    expect(lexical.retrieve).not.toHaveBeenCalled();
  });

  it('compiles selected evidence within the context token budget', async () => {
    const vector = { retrieve: jest.fn().mockResolvedValue([candidate('large', 'evidence '.repeat(100))]) } as jest.Mocked<Retriever>;
    const lexical = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const filtered = { retrieve: jest.fn().mockResolvedValue([]) } as jest.Mocked<Retriever>;
    const ranker = { rank: jest.fn() };
    const result = await engineFor(vector, lexical, filtered, ranker).retrieve(
      { ...query, limit: 5, maxContextTokens: 10 },
      config({ strategy: 'vector-only' }),
    );

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]?.content.length).toBeLessThanOrEqual(40);
    expect(result.candidates[0]?.content.endsWith('…')).toBe(true);
  });
});
