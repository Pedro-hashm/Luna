import { ConversationChunkRetrievalProvider } from './conversation-chunk-retrieval.provider';
import type { RetrievalQuery } from '../../retrieval/retrieval.types';

const row = {
  id: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
  conversation_id: '9b137f99-72b2-4da3-85d3-164e3a80e57a',
  content: 'Projeto Nebula 47 usa PostgreSQL.',
  status: 'closed' as const,
  token_count: 20,
  start_message_id: 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54',
  end_message_id: 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e',
  score: 0.91,
};

describe('ConversationChunkRetrievalProvider', () => {
  it('returns vector candidates with ranks and applies scope, time and topK filters', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([row]);
    const provider = new ConversationChunkRetrievalProvider(
      {
        conversationChunkSettings: {
          upsert: jest.fn().mockResolvedValue({
            embeddingModel: 'qwen3-embedding:0.6b',
            embeddingDimensions: 1024,
          }),
        },
        $queryRaw,
      } as never,
      {
        embed: jest.fn().mockResolvedValue([0.1, 0.2]),
        toVectorLiteral: jest.fn().mockReturnValue('[0.1,0.2]'),
      } as never,
    );
    const query: RetrievalQuery = {
      query: 'Nebula 47',
      limit: 5,
      maxContextTokens: 1000,
      filters: {
        includeConversationId: row.conversation_id,
        dateFrom: new Date('2026-09-20T00:00:00.000Z'),
        currentMessageId: row.end_message_id,
        currentMessageCreatedAt: new Date('2026-09-21T10:00:00.000Z'),
        runtimeConversationId: row.conversation_id,
      },
    };

    const candidates = await provider.retrieveVector(query, 30);
    const sql = $queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      id: row.id,
      vectorScore: 0.91,
      vectorRank: 1,
      source: 'conversation_chunk',
    });
    expect(sql.sql).toContain('embedding" IS NOT NULL');
    expect(sql.sql).toContain('conversation_id" =');
    expect(sql.sql).toContain('date_range_message');
    expect(sql.values).toContain(30);
    expect(sql.values).toContain(row.conversation_id);
  });

  it('uses full text plus exact phrase matching for names and project identifiers', async () => {
    const $queryRaw = jest.fn().mockResolvedValue([row]);
    const provider = new ConversationChunkRetrievalProvider(
      { $queryRaw } as never,
      {} as never,
    );
    const candidates = await provider.retrieveLexical(
      {
        query: 'Nebula 47',
        limit: 2,
        maxContextTokens: 1000,
        filters: { excludeConversationId: '9b137f99-72b2-4da3-85d3-164e3a80e57a' },
      },
      30,
    );
    const sql = $queryRaw.mock.calls[0]?.[0] as { sql: string; values: unknown[] };

    expect(candidates[0]).toMatchObject({ lexicalScore: 0.91, lexicalRank: 1 });
    expect(sql.sql).toContain('websearch_to_tsquery');
    expect(sql.sql).toContain('position(lower(');
    expect(sql.sql).toContain('conversation_id" <>');
    expect(sql.values).toContain('Nebula 47');
    expect(sql.values).toContain(30);
  });
});
