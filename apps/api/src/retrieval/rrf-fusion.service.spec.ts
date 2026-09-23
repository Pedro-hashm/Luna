import { ReciprocalRankFusion } from './rrf-fusion.service';
import type { RetrievalCandidate } from './retrieval.types';

const candidate = (id: string): RetrievalCandidate => ({
  id,
  content: id,
  source: 'test',
  metadata: {},
});

describe('ReciprocalRankFusion', () => {
  it('combines ranks without comparing vector and lexical score scales', () => {
    const fusion = new ReciprocalRankFusion();
    const results = fusion.fuse(
      [
        { ...candidate('A'), vectorScore: 0.99 },
        { ...candidate('B'), vectorScore: 0.61 },
        { ...candidate('C'), vectorScore: 0.35 },
      ],
      [
        { ...candidate('C'), lexicalScore: 9.2 },
        { ...candidate('A'), lexicalScore: 4.1 },
        { ...candidate('X'), lexicalScore: 2.3 },
      ],
      60,
    );

    expect(results.map((item) => item.id)).toEqual(['A', 'C', 'B', 'X']);
    expect(results[0]).toMatchObject({
      vectorRank: 1,
      lexicalRank: 2,
      retrievalPresence: ['lexical', 'vector'],
    });
    expect(results.find((item) => item.id === 'X')).toMatchObject({
      lexicalRank: 3,
      retrievalPresence: ['lexical'],
    });
    expect(results[0]?.rrfScore).toBeCloseTo(1 / 61 + 1 / 62);
  });

  it('is deterministic when fused scores tie', () => {
    const fusion = new ReciprocalRankFusion();
    const expected = fusion.fuse(
      [candidate('B'), candidate('A')],
      [candidate('A'), candidate('B')],
      60,
    );
    expect(fusion.fuse([candidate('B'), candidate('A')], [candidate('A'), candidate('B')], 60)).toEqual(expected);
    expect(expected.map((item) => item.id)).toEqual(['A', 'B']);
  });
});
