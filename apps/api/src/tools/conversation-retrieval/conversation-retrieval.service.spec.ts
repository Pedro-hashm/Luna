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
  stageResults: {},
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
  settings?: Record<string, unknown>;
  relations?: Array<{
    predecessorMessageId: string;
    successorMessageId: string;
    type: 'SUPERSEDES' | 'CORRECTS';
    subject: string;
    oldValue: string;
    newValue: string;
    successorMessage: { id: string; conversationId: string; role: string; content: string; createdAt: Date };
  }>;
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
  const temporalRelation = {
    findMany: jest.fn().mockImplementation(async ({ where }: { where: { predecessorMessageId: { in: string[] } } }) =>
      (input.relations ?? []).filter((relation) =>
        where.predecessorMessageId.in.includes(relation.predecessorMessageId),
      ).map((relation) => {
        const predecessor = input.messages?.find((message) => message.id === relation.predecessorMessageId)
          ?? input.relations?.find((other) => other.successorMessageId === relation.predecessorMessageId)?.successorMessage;
        return {
          ...relation,
          predecessorMessage: {
            role: predecessor?.role ?? 'user',
            content: predecessor?.content ?? relation.oldValue,
          },
        };
      })),
  };
  const service = new ConversationRetrievalService(
    { message, temporalRelation } as never,
    { getApplicationSettings: jest.fn().mockResolvedValue({ ...settings, ...input.settings }) } as never,
    retrievalEngine as never,
  );
  return { service, message, retrievalEngine, temporalRelation };
}

describe('ConversationRetrievalService', () => {
  it('runs a generic period overview through filters without semantic ranking', async () => {
    const { service, retrievalEngine } = makeService();
    const currentMessageCreatedAt = new Date('2026-09-21T10:01:00.000Z');

    const result = await service.retrieve(
      { query: 'discussões', dateFrom: '2026-09-21', dateTo: '2026-09-21' },
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

  const oldId = '1f9b4d43-82a8-416e-8cb6-8b6640c2ad54';
  const middleId = 'a98b4d43-82a8-416e-8cb6-8b6640c2ad54';
  const latestId = 'c75dc7ab-914d-4a91-a8c8-9d8ee46bb0d1';
  const oldMessage = {
    id: oldId,
    role: 'user',
    content: 'O projeto se chama Nebula 47.',
    createdAt: new Date('2026-09-12T10:00:00.000Z'),
  };
  const temporalCandidate = candidate(
    '20e6de7d-8da0-4c13-af19-8c1e641c2707',
    otherConversationId,
    'user: O projeto se chama Nebula 47.',
    oldId,
    oldId,
  );
  const relations = [
    {
      predecessorMessageId: oldId, successorMessageId: middleId,
      type: 'SUPERSEDES' as const, subject: 'nome do projeto',
      oldValue: 'Nebula 47', newValue: 'Nebula 48',
      successorMessage: {
        id: middleId, conversationId: otherConversationId, role: 'user',
        content: 'Mudamos o nome. Agora é Nebula 48.',
        createdAt: new Date('2026-09-19T10:00:00.000Z'),
      },
    },
    {
      predecessorMessageId: middleId, successorMessageId: latestId,
      type: 'SUPERSEDES' as const, subject: 'nome do projeto',
      oldValue: 'Nebula 48', newValue: 'Nebula 49',
      successorMessage: {
        id: latestId, conversationId: otherConversationId, role: 'user',
        content: 'Mudamos de novo. Agora é Nebula 49.',
        createdAt: new Date('2026-09-22T10:00:00.000Z'),
      },
    },
  ];

  it('resolves the latest successor after ranking in current mode and keeps Evidence provenance', async () => {
    const { service, temporalRelation } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations,
    });
    const result = await service.retrieve(
      { query: 'nome atual', temporalMode: 'current' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.content).toContain('Nebula 47');
    expect(result.results[0]?.temporalChanges?.[0]).toMatchObject({
      oldValue: 'Nebula 47', newValue: 'Nebula 49',
      successors: [expect.objectContaining({ messageId: latestId, content: expect.stringContaining('Nebula 49') })],
    });
    expect(result.__conversationDiagnostics?.references).toContainEqual(
      expect.objectContaining({ messageIds: [latestId] }),
    );
    expect(temporalRelation.findMany).toHaveBeenCalled();
  });

  it('returns the visible evolution in both mode', async () => {
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations,
    });
    const result = await service.retrieve(
      { query: 'evolução do nome', temporalMode: 'both' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges?.[0].successors.map((step) => step.newValue))
      .toEqual(['Nebula 48', 'Nebula 49']);
  });

  it('preserves historical results and bypasses temporal reads when disabled', async () => {
    const enabled = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations,
    });
    const historical = await enabled.service.retrieve(
      { query: 'nome antigo', temporalMode: 'historical' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(historical.results[0]?.content).toContain('Nebula 47');
    expect(historical.results[0]?.temporalChanges).toBeUndefined();
    expect(enabled.temporalRelation.findMany).not.toHaveBeenCalled();

    const disabled = makeService({
      settings: { temporalConsolidationEnabled: false },
      candidates: [temporalCandidate], messages: [oldMessage], relations,
    });
    const plain = await disabled.service.retrieve(
      { query: 'nome atual' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(plain.results[0]?.temporalChanges).toBeUndefined();
    expect(plain.temporalMode).toBeUndefined();
    expect(disabled.temporalRelation.findMany).not.toHaveBeenCalled();
  });

  it('does not expose a successor after an explicit date window', async () => {
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations,
    });
    const result = await service.retrieve(
      { query: 'nome em setembro', dateTo: '2026-09-15', temporalMode: 'current' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges).toBeUndefined();
  });

  it('does not expose a later message from the active conversation', async () => {
    const laterId = 'df84044b-5bc0-47b4-9fc4-52f82894c853';
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [candidate(
        'f0e6de7d-8da0-4c13-af19-8c1e641c2707',
        conversationId, oldMessage.content, oldId, oldId,
      )],
      messages: [
        oldMessage,
        { id: currentMessageId, role: 'user', content: 'Qual o nome?', createdAt: new Date('2026-09-21T10:01:00.000Z') },
        { id: laterId, role: 'user', content: 'Agora é Nebula 48', createdAt: new Date('2026-09-21T10:02:00.000Z') },
      ],
      relations: [{
        predecessorMessageId: oldId, successorMessageId: laterId,
        type: 'SUPERSEDES', subject: 'nome do projeto',
        oldValue: 'Nebula 47', newValue: 'Nebula 48',
        successorMessage: {
          id: laterId, conversationId, role: 'user', content: 'Agora é Nebula 48',
          createdAt: new Date('2026-09-21T10:02:00.000Z'),
        },
      }],
    });
    const result = await service.retrieve(
      { query: 'nome atual', temporalMode: 'current' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('Nebula 48');
  });

  it('does not label an assertion hidden by the context budget', async () => {
    const longOldMessage = {
      ...oldMessage,
      content: `${'Unrelated background. '.repeat(20)} Nebula 47`,
    };
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [candidate(
        'd0e6de7d-8da0-4c13-af19-8c1e641c2707',
        otherConversationId,
        `user: ${longOldMessage.content}`,
        oldId, oldId,
      )],
      messages: [longOldMessage],
      relations: [relations[0]],
    });
    const result = await service.retrieve(
      { query: 'name', maxContextTokens: 40, includeMessages: false },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.content).not.toContain('Nebula 47');
    expect(result.results[0]?.temporalChanges).toBeUndefined();
  });

  it('stops a chain when a later change concerns a different fact', async () => {
    const unrelated = {
      predecessorMessageId: middleId, successorMessageId: latestId,
      type: 'CORRECTS' as const, subject: 'banco de dados do projeto',
      oldValue: 'PostgreSQL', newValue: 'SQLite',
      successorMessage: {
        id: latestId, conversationId: otherConversationId, role: 'user',
        content: 'Na verdade usamos SQLite.',
        createdAt: new Date('2026-09-22T10:00:00.000Z'),
      },
    };
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage],
      relations: [relations[0], unrelated],
    });
    const result = await service.retrieve(
      { query: 'nome atual', temporalMode: 'current' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges?.[0]).toMatchObject({
      subject: 'nome do projeto', newValue: 'Nebula 48',
      successors: [expect.objectContaining({ messageId: middleId })],
    });
    expect(JSON.stringify(result.results[0]?.temporalChanges)).not.toContain('SQLite');
  });

  it('accepts a same-timestamp successor ordered before the active message', async () => {
    const sameTime = new Date('2026-09-21T10:01:00.000Z');
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [candidate(
        'e0e6de7d-8da0-4c13-af19-8c1e641c2707',
        conversationId, `user: ${oldMessage.content}`, oldId, oldId,
      )],
      messages: [
        oldMessage,
        { id: middleId, role: 'user', content: 'Agora é Nebula 48.', createdAt: sameTime },
        { id: currentMessageId, role: 'user', content: 'Qual o nome?', createdAt: sameTime },
      ],
      relations: [{
        ...relations[0],
        successorMessage: {
          ...relations[0].successorMessage,
          conversationId,
          createdAt: sameTime,
        },
      }],
    });
    const result = await service.retrieve(
      { query: 'nome atual' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges?.[0].newValue).toBe('Nebula 48');
  });

  it('does not attach a hidden predecessor when another visible message has the same value', async () => {
    const visibleId = '10000000-0000-4000-8000-000000000001';
    const hiddenId = '10000000-0000-4000-8000-000000000002';
    const visible = {
      id: visibleId, role: 'user',
      content: `Projeto B se chama Nebula 47. ${'Contexto de outro projeto. '.repeat(9)}`,
      createdAt: new Date('2026-09-11T10:00:00.000Z'),
    };
    const hidden = {
      id: hiddenId, role: 'user', content: 'Projeto A se chama Nebula 47.',
      createdAt: new Date('2026-09-12T10:00:00.000Z'),
    };
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [candidate(
        'c0e6de7d-8da0-4c13-af19-8c1e641c2707', otherConversationId,
        `user: ${visible.content}\nuser: ${hidden.content}`, visibleId, hiddenId,
      )],
      messages: [visible, hidden],
      relations: [{
        predecessorMessageId: hiddenId, successorMessageId: latestId,
        type: 'SUPERSEDES', subject: 'nome do projeto A',
        oldValue: 'Nebula 47', newValue: 'Nebula 48',
        successorMessage: {
          id: latestId, conversationId: otherConversationId, role: 'user',
          content: 'O projeto A agora se chama Nebula 48.',
          createdAt: new Date('2026-09-19T10:00:00.000Z'),
        },
      }],
    });
    const result = await service.retrieve(
      { query: 'Nebula 47', maxContextTokens: 70, includeMessages: false },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.content).toContain('Nebula 47');
    expect(result.results[0]?.content).not.toContain('Projeto A se chama');
    expect(result.results[0]?.temporalChanges).toBeUndefined();
  });

  it('does not bridge different subjects that happen to share the same value', async () => {
    const crossSubject = [
      { ...relations[0], newValue: 'SQLite', subject: 'nome do projeto',
        successorMessage: { ...relations[0].successorMessage, content: 'O nome agora é SQLite.' } },
      { ...relations[1], oldValue: 'SQLite', newValue: 'MySQL',
        subject: 'banco do projeto',
        successorMessage: { ...relations[1].successorMessage, content: 'Mudamos o banco para MySQL.' } },
    ];
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations: crossSubject,
    });
    const result = await service.retrieve(
      { query: 'nome atual' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges?.[0].newValue).toBe('SQLite');
    expect(result.results[0]?.temporalChanges?.[0].successors).toHaveLength(1);
  });

  it('marks a bounded chain as incomplete instead of claiming the last loaded step is current', async () => {
    const chain = Array.from({ length: 9 }, (_, index) => {
      const previousId = index === 0 ? oldId : `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
      const nextId = `20000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
      return {
        predecessorMessageId: previousId, successorMessageId: nextId,
        type: 'SUPERSEDES' as const, subject: 'nome do projeto',
        oldValue: index === 0 ? 'Nebula 47' : `Name ${index}`,
        newValue: `Name ${index + 1}`,
        successorMessage: {
          id: nextId, conversationId: otherConversationId, role: 'user',
          content: `Agora é Name ${index + 1}.`,
          createdAt: new Date(Date.UTC(2026, 8, 13 + index, 10)),
        },
      };
    });
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [temporalCandidate], messages: [oldMessage], relations: chain,
    });
    const result = await service.retrieve(
      { query: 'nome atual' },
      { conversationId, currentMessageId, messages: [] },
    );
    expect(result.results[0]?.temporalChanges?.[0].chainComplete).toBe(false);
  });

  it('caps the serialized temporal payload inside the reserved context budget', async () => {
    const oldMessages = Array.from({ length: 14 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      role: 'user',
      content: `O projeto ${index} se chama Nome ${index}.`,
      createdAt: new Date(Date.UTC(2026, 8, 1 + index, 10)),
    }));
    const manyRelations = oldMessages.map((message, index) => ({
      predecessorMessageId: message.id,
      successorMessageId: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      type: 'SUPERSEDES' as const,
      subject: `nome do projeto ${index}`,
      oldValue: `Nome ${index}`,
      newValue: `Novo Nome ${index}`,
      successorMessage: {
        id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        conversationId: otherConversationId, role: 'user',
        content: `Mudamos o nome do projeto ${index}. Agora é Novo Nome ${index}.`,
        createdAt: new Date(Date.UTC(2026, 8, 16 + index, 10)),
      },
    }));
    const { service } = makeService({
      settings: { temporalConsolidationEnabled: true },
      candidates: [candidate(
        'b0e6de7d-8da0-4c13-af19-8c1e641c2707', otherConversationId,
        oldMessages.map((message) => `user: ${message.content}`).join('\n'),
        oldMessages[0].id, oldMessages[oldMessages.length - 1].id,
      )],
      messages: oldMessages,
      relations: manyRelations,
    });
    const result = await service.retrieve(
      { query: 'nomes', maxContextTokens: 1_000, includeMessages: false },
      { conversationId, currentMessageId, messages: [] },
    );
    const changes = result.results[0]?.temporalChanges ?? [];
    expect(changes.length).toBeGreaterThan(0);
    expect(changes.length).toBeLessThan(oldMessages.length);
    const projectedSize = changes.reduce((size, change) => size + JSON.stringify({
      status: 'superseded', subject: change.subject, type: change.type,
      oldValue: change.oldValue, newValue: change.newValue,
      chainComplete: change.chainComplete,
      successors: change.successors.map(({ role, content, createdAt, type, newValue }) =>
        ({ role, content, createdAt, type, newValue })),
    }).length + 32, 0);
    expect(projectedSize).toBeLessThanOrEqual(1_000);
  });
});
