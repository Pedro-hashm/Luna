import { ConversationRetrievalService } from './conversation-retrieval.service';
import type { RetrievalCandidate, RetrievalDiagnostics } from '../../retrieval/retrieval.types';

const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
const otherConversationId = '8c2d0c4f-d3f1-4f18-98a8-2c33500e0b45';

const settings = {
  appTimezone: 'America/Sao_Paulo',
  retrievalDefaultTopK: 8,
  retrievalMaxTopK: 50,
  retrievalDefaultMaxContextTokens: 8000,
  retrievalMaxContextTokens: 20000,
  retrievalIncludeMessages: true,
  retrievalStrategy: 'hybrid',
  retrievalVectorTopK: 30,
  retrievalLexicalTopK: 30,
  retrievalRrfK: 60,
  retrievalCandidatePoolTopK: 30,
  retrievalRerankerEnabled: false,
  retrievalRerankerModel: 'cross-encoder/ettin-reranker-17m-v1',
  retrievalRerankerTopK: 30,
  retrievalRerankerThreshold: 0.05,
  retrievalDeduplicationEnabled: true,
  retrievalDeduplicationThreshold: 0.85,
};

const diagnostics: RetrievalDiagnostics = {
  query: null,
  filters: {},
  config: {
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
  },
  stages: {},
  counts: {},
  reranker: { model: null, inputCount: 0, outputCount: 0, threshold: null },
  candidates: [],
  finalResultCount: 0,
  totalLatencyMs: 0,
};

function candidate(
  id: string,
  chunkConversationId: string,
  content: string,
  startMessageId: string,
  endMessageId: string,
): RetrievalCandidate {
  return {
    id,
    content,
    source: 'conversation_chunk',
    metadata: {
      conversationId: chunkConversationId,
      status: 'closed',
      tokenCount: 20,
      startMessageId,
      endMessageId,
    },
    vectorScore: 0.9,
  };
}

function makeService(input: {
  candidates?: RetrievalCandidate[];
  messages?: Array<{ id: string; role: string; content: string; createdAt: Date }>;
  messageCreatedAt?: Date;
} = {}) {
  const message = {
    findUnique: jest.fn().mockResolvedValue({
      conversationId,
      createdAt: input.messageCreatedAt ?? new Date('2026-09-21T10:01:00.000Z'),
    }),
    findMany: jest.fn().mockResolvedValue(input.messages ?? []),
  };
  const retrievalEngine = {
    retrieve: jest.fn().mockResolvedValue({
      candidates: input.candidates ?? [],
      diagnostics,
    }),
  };
  const service = new ConversationRetrievalService(
    { message } as never,
    { getApplicationSettings: jest.fn().mockResolvedValue(settings) } as never,
    retrievalEngine as never,
  );
  return { service, message, retrievalEngine };
}

describe('ConversationRetrievalService', () => {
  it('runs a date-only request through filters without sending an embedding query', async () => {
    const { service, retrievalEngine } = makeService();
    const currentMessageCreatedAt = new Date('2026-09-21T10:01:00.000Z');

    const result = await service.retrieve(
      { dateFrom: '2026-09-21', dateTo: '2026-09-21' },
      {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
    );

    expect(result.results).toEqual([]);
    expect(retrievalEngine.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        query: undefined,
        limit: 8,
        maxContextTokens: 8000,
        filters: expect.objectContaining({
          dateFrom: new Date('2026-09-21T03:00:00.000Z'),
          dateTo: new Date('2026-09-22T02:59:59.999Z'),
          runtimeConversationId: conversationId,
          currentMessageId,
          currentMessageCreatedAt,
        }),
      }),
      expect.objectContaining({ strategy: 'hybrid', vectorTopK: 30 }),
    );
  });

  it('passes current-conversation filters and preserves message provenance', async () => {
    const startMessageId = 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const { service, retrievalEngine } = makeService({
      candidates: [
        candidate(
          '20e6de7d-8da0-4c13-af19-8c1e641c2707',
          conversationId,
          'Indexed content about Tokyo Ghoul',
          startMessageId,
          currentMessageId,
        ),
      ],
      messages: [
        {
          id: startMessageId,
          role: 'user',
          content: 'Mensagem antiga sobre Tokyo Ghoul',
          createdAt: new Date('2026-09-21T10:00:00.000Z'),
        },
        {
          id: currentMessageId,
          role: 'user',
          content: 'Procure nesta conversa',
          createdAt: new Date('2026-09-21T10:01:00.000Z'),
        },
        {
          id: 'c75dc7ab-914d-4a91-a8c8-9d8ee46bb0d1',
          role: 'assistant',
          content: 'Conteúdo futuro que não pode ser recuperado',
          createdAt: new Date('2026-09-21T10:02:00.000Z'),
        },
      ],
    });

    const result = await service.retrieve(
      { query: 'tokyo ghoul', scope: 'current_conversation' },
      { conversationId, currentMessageId, messages: [] },
    );

    expect(retrievalEngine.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'tokyo ghoul',
        filters: expect.objectContaining({
          includeConversationId: conversationId,
          currentMessageId,
        }),
      }),
      expect.any(Object),
    );
    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.content).toContain('Mensagem antiga');
    expect(result.results[0]?.content).toContain('Procure nesta conversa');
    expect(result.results[0]?.content).not.toContain('Conteúdo futuro');
    expect(result.results[0]?.messages).toHaveLength(2);
    expect(result.__conversationDiagnostics).toMatchObject({
      scope: 'current_conversation',
      counts: { retrievalCandidates: 1, returnedResults: 1, excludedCandidates: 0 },
      references: [expect.objectContaining({
        conversationId,
        chunkId: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
        startMessageId,
        endMessageId: currentMessageId,
        messageIds: [startMessageId, currentMessageId],
        dates: ['2026-09-21'],
      })],
      candidates: [
        expect.objectContaining({
          chunkId: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
          outcome: 'returned',
          sourceMessageCount: 2,
          returnedMessageCount: 2,
        }),
      ],
    });
  });

  it('excludes the runtime conversation for historical-only retrieval', async () => {
    const { service, retrievalEngine } = makeService();
    await service.retrieve(
      { dateFrom: '2026-09-20', scope: 'historical' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(retrievalEngine.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({
        query: undefined,
        filters: expect.objectContaining({ excludeConversationId: conversationId }),
      }),
      expect.any(Object),
    );
  });

  it('allows auto scope to return a relevant result from another conversation', async () => {
    const startMessageId = '1f9b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const endMessageId = 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const { service } = makeService({
      candidates: [
        candidate(
          '20e6de7d-8da0-4c13-af19-8c1e641c2707',
          otherConversationId,
          'assistant: Contexto antigo sobre Nebula 47',
          startMessageId,
          endMessageId,
        ),
      ],
      messages: [
        {
          id: startMessageId,
          role: 'user',
          content: 'Contexto de outro dia que não pode vazar para a busca',
          createdAt: new Date('2026-09-19T10:00:00.000Z'),
        },
        {
          id: endMessageId,
          role: 'assistant',
          content: 'Contexto antigo sobre Nebula 47',
          createdAt: new Date('2026-09-20T10:00:00.000Z'),
        },
      ],
    });

    const result = await service.retrieve(
      { dateFrom: '2026-09-20', scope: 'auto' },
      { conversationId, currentMessageId, messages: [] },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0]?.conversationId).toBe(otherConversationId);
    expect(result.results[0]?.content).toContain('Nebula 47');
    expect(result.results[0]?.content).not.toContain('não pode vazar');
    expect(result.results[0]?.messages).toHaveLength(1);
    expect(result.results[0]?.timeRange).toEqual({
      start: '2026-09-20T07:00:00.000-03:00',
      end: '2026-09-20T07:00:00.000-03:00',
      timeZone: 'America/Sao_Paulo',
    });
  });
});
