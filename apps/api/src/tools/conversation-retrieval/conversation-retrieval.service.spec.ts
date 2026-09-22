import { ConversationRetrievalService } from './conversation-retrieval.service';

describe('ConversationRetrievalService', () => {
  it('defaults an omitted scope to auto without excluding other conversations', async () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
    const currentMessageCreatedAt = new Date('2026-09-21T10:01:00.000Z');
    type FindManyInput = {
      where: {
        conversationId?: string | { not: string };
        AND?: unknown;
        conversation?: unknown;
      };
    };
    const findMany = jest
      .fn<Promise<unknown[]>, [FindManyInput]>()
      .mockResolvedValue([]);
    const service = new ConversationRetrievalService(
      {
        message: {
          findUnique: jest.fn().mockResolvedValue({
            conversationId,
            createdAt: currentMessageCreatedAt,
          }),
        },
        conversationChunk: { findMany },
      } as never,
      {} as never,
      {
        getApplicationSettings: jest.fn().mockResolvedValue({
          appTimezone: 'America/Sao_Paulo',
          retrievalDefaultTopK: 8,
          retrievalMaxTopK: 50,
          retrievalDefaultMaxContextTokens: 8000,
          retrievalMaxContextTokens: 20000,
          retrievalIncludeMessages: true,
        }),
      } as never,
    );

    await service.retrieve(
      { dateFrom: '2026-09-21', dateTo: '2026-09-21' },
      {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
    );

    const where = findMany.mock.calls[0]?.[0]?.where;

    expect(where.conversationId).toBeUndefined();
    expect(where.conversation).toEqual({
      messages: {
        some: {
          createdAt: {
            gte: new Date('2026-09-21T03:00:00.000Z'),
            lte: new Date('2026-09-22T02:59:59.999Z'),
          },
        },
      },
    });
    expect(where.AND).toEqual([
      {
        OR: [
          { conversationId: { not: conversationId } },
          {
            conversationId,
            startMessage: {
              OR: [
                { createdAt: { lt: currentMessageCreatedAt } },
                {
                  createdAt: currentMessageCreatedAt,
                  id: { lte: currentMessageId },
                },
              ],
            },
          },
        ],
      },
    ]);
  });

  it('cuts current-conversation content at currentMessageId', async () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    const firstMessageId = 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
    const futureMessageId = 'c75dc7ab-914d-4a91-a8c8-9d8ee46bb0d1';

    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue({
          conversationId,
          createdAt: new Date('2026-09-21T10:01:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: firstMessageId,
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
            id: futureMessageId,
            role: 'assistant',
            content: 'Conteúdo futuro que não pode ser recuperado',
            createdAt: new Date('2026-09-21T10:02:00.000Z'),
          },
        ]),
      },
      conversationChunkSettings: {
        upsert: jest.fn().mockResolvedValue({
          embeddingModel: 'qwen3-embedding:0.6b',
          embeddingDimensions: 1024,
        }),
      },
      $queryRaw: jest.fn().mockResolvedValue([
        {
          id: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
          conversation_id: conversationId,
          content:
            'Mensagem antiga sobre Tokyo Ghoul\nConteúdo futuro que não pode ser recuperado',
          status: 'open',
          token_count: 20,
          start_message_id: firstMessageId,
          end_message_id: futureMessageId,
          score: 0.9,
        },
      ]),
    };
    const embeddings = {
      embed: jest.fn().mockResolvedValue([0.1]),
      toVectorLiteral: jest.fn().mockReturnValue('[0.1]'),
    };
    const settings = {
      getApplicationSettings: jest.fn().mockResolvedValue({
        appTimezone: 'America/Sao_Paulo',
        retrievalDefaultTopK: 8,
        retrievalMaxTopK: 50,
        retrievalDefaultMaxContextTokens: 8000,
        retrievalMaxContextTokens: 20000,
        retrievalIncludeMessages: true,
      }),
    };
    const service = new ConversationRetrievalService(
      prisma as never,
      embeddings as never,
      settings as never,
    );

    const result = await service.retrieve(
      { query: 'tokyo ghoul', scope: 'current_conversation' },
      {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
    );

    expect(result.results).toHaveLength(1);
    expect(result.results[0].content).toContain('Mensagem antiga');
    expect(result.results[0].content).toContain('Procure nesta conversa');
    expect(result.results[0].content).not.toContain('Conteúdo futuro');
    expect(result.results[0].messages).toHaveLength(2);
  });

  it('does not select chunks that begin after the current message', async () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
    const currentMessageCreatedAt = new Date('2026-09-21T10:01:00.000Z');
    type FindManyInput = {
      where: {
        startMessage?: unknown;
        conversationId?: string | { not: string };
      };
    };
    const findMany = jest
      .fn<Promise<unknown[]>, [FindManyInput]>()
      .mockResolvedValue([]);
    const service = new ConversationRetrievalService(
      {
        message: {
          findUnique: jest.fn().mockResolvedValue({
            conversationId,
            createdAt: currentMessageCreatedAt,
          }),
        },
        conversationChunk: { findMany },
      } as never,
      {} as never,
      {
        getApplicationSettings: jest.fn().mockResolvedValue({
          appTimezone: 'America/Sao_Paulo',
          retrievalDefaultTopK: 8,
          retrievalMaxTopK: 50,
          retrievalDefaultMaxContextTokens: 8000,
          retrievalMaxContextTokens: 20000,
          retrievalIncludeMessages: true,
        }),
      } as never,
    );

    await service.retrieve(
      { dateFrom: '2026-09-20', scope: 'current_conversation' },
      {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
    );

    const where = findMany.mock.calls[0]?.[0]?.where;

    expect(where.conversationId).toBe(conversationId);
    expect(where.startMessage).toEqual({
      OR: [
        { createdAt: { lt: currentMessageCreatedAt } },
        {
          createdAt: currentMessageCreatedAt,
          id: { lte: currentMessageId },
        },
      ],
    });
  });

  it('restricts historical scope to conversations other than the runtime conversation', async () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    type FindManyInput = {
      where: {
        conversationId?: string | { not: string };
      };
    };
    const findMany = jest
      .fn<Promise<unknown[]>, [FindManyInput]>()
      .mockResolvedValue([]);
    const service = new ConversationRetrievalService(
      {
        conversationChunk: { findMany },
      } as never,
      {} as never,
      {
        getApplicationSettings: jest.fn().mockResolvedValue({
          appTimezone: 'America/Sao_Paulo',
          retrievalDefaultTopK: 8,
          retrievalMaxTopK: 50,
          retrievalDefaultMaxContextTokens: 8000,
          retrievalMaxContextTokens: 20000,
          retrievalIncludeMessages: true,
        }),
      } as never,
    );

    await service.retrieve(
      { dateFrom: '2026-09-20', scope: 'historical' },
      {
        conversationId,
        currentMessageId: 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e',
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
    );

    expect(findMany.mock.calls[0]?.[0]?.where.conversationId).toEqual({
      not: conversationId,
    });
  });

  it('allows auto scope to return a chunk from another conversation', async () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    const otherConversationId = '8c2d0c4f-d3f1-4f18-98a8-2c33500e0b45';
    const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
    const earlierMessageId = '1f9b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const otherMessageId = 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54';
    const prisma = {
      message: {
        findUnique: jest.fn().mockResolvedValue({
          conversationId,
          createdAt: new Date('2026-09-21T10:01:00.000Z'),
        }),
        findMany: jest.fn().mockResolvedValue([
          {
            id: earlierMessageId,
            role: 'user',
            content: 'Contexto de outro dia que não pode vazar para a busca',
            createdAt: new Date('2026-09-19T10:00:00.000Z'),
          },
          {
            id: otherMessageId,
            role: 'assistant',
            content: 'Contexto antigo sobre Nebula 47',
            createdAt: new Date('2026-09-20T10:00:00.000Z'),
          },
        ]),
      },
      conversationChunk: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
            conversationId: otherConversationId,
            content: 'assistant: Contexto antigo sobre Nebula 47',
            status: 'closed',
            tokenCount: 10,
            startMessageId: earlierMessageId,
            endMessageId: otherMessageId,
          },
        ]),
      },
    };
    const service = new ConversationRetrievalService(
      prisma as never,
      {} as never,
      {
        getApplicationSettings: jest.fn().mockResolvedValue({
          appTimezone: 'America/Sao_Paulo',
          retrievalDefaultTopK: 8,
          retrievalMaxTopK: 50,
          retrievalDefaultMaxContextTokens: 8000,
          retrievalMaxContextTokens: 20000,
          retrievalIncludeMessages: true,
        }),
      } as never,
    );

    const result = await service.retrieve(
      { dateFrom: '2026-09-20', scope: 'auto' },
      {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T10:01:00.000Z',
        messages: [],
      },
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
