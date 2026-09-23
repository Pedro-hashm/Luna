import { ResultDeduplicator } from './result-deduplicator.service';
import type { RetrievalCandidate } from './retrieval.types';

const item = (
  id: string,
  content: string,
  metadata: Record<string, unknown> = {},
): RetrievalCandidate => ({ id, content, source: 'conversation_chunk', metadata });

describe('ResultDeduplicator', () => {
  it('removes overlapping chunks while keeping distinct content from the same source', () => {
    const deduplicator = new ResultDeduplicator();
    const result = deduplicator.deduplicate(
      [
        item('1', 'Tokyo Ghoul anime has dark themes and a masked hero.'),
        item('2', 'Tokyo Ghoul anime has dark themes and a masked hero.'),
        item('3', 'The project Nebula 47 uses PostgreSQL and vector search.'),
      ],
      0.85,
    );

    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['1', '3']);
    expect(result.removedIds).toEqual(['2']);
  });

  it('removes the same message range but does not deduplicate on source alone', () => {
    const deduplicator = new ResultDeduplicator();
    const range = { startMessageId: 'start', endMessageId: 'end' };
    const result = deduplicator.deduplicate(
      [item('1', 'Discussion about one topic.', range), item('2', 'Different topic in another message.', range)],
      1,
    );
    expect(result.candidates.map((candidate) => candidate.id)).toEqual(['1']);
  });
});
