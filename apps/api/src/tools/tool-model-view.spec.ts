import { toToolExecutionModelView } from './tool-model-view';

describe('toToolExecutionModelView', () => {
  it('removes runtime identifiers from arguments and retrieval results', () => {
    const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
    const messageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
    const chunkId = '20e6de7d-8da0-4c13-af19-8c1e641c2707';

    const view = toToolExecutionModelView({
      tool: 'conversation_retrieval',
      arguments: {
        query: 'tokyo ghoul',
        conversationId,
        currentMessageId: messageId,
        requestId: '7a55c36d-7c1b-44e1-a7a3-3ed3e1dc94da',
      },
      status: 'success',
      result: {
        query: 'tokyo ghoul',
        results: [
          {
            conversationId,
            chunkId,
            status: 'open',
            score: 0.9,
            content: 'user: Tokyo Ghoul',
            startMessageId: messageId,
            endMessageId: messageId,
            tokenCount: 5,
            timeRange: {
              start: '2026-09-21T09:00:00.000-03:00',
              end: '2026-09-21T09:00:00.000-03:00',
              timeZone: 'America/Sao_Paulo',
            },
            messages: [
              {
                id: messageId,
                role: 'user',
                content: 'Tokyo Ghoul',
                createdAt: new Date('2026-09-21T12:00:00.000Z'),
              },
            ],
          },
        ],
      },
    });

    const serialized = JSON.stringify(view);

    expect(view.arguments).toEqual({ query: 'tokyo ghoul' });
    expect(serialized).not.toContain(conversationId);
    expect(serialized).not.toContain(messageId);
    expect(serialized).not.toContain(chunkId);
    expect(serialized).toContain('Tokyo Ghoul');
    expect(serialized).toContain('America/Sao_Paulo');
  });

  it('keeps conversation_context results limited to public Evidence and message content', () => {
    const view = toToolExecutionModelView({
      tool: 'conversation_context',
      arguments: { evidence_id: 'ev_1', direction: 'before' },
      status: 'success',
      result: {
        evidence_id: 'ev_1',
        direction: 'before',
        resultCount: 1,
        results: [{ date: '2026-09-12', role: 'user', content: 'Falamos do Nebula 47.' }],
        __evidenceDiagnostics: {
          event: 'evidence.resolve', evidenceId: 'ev_1', direction: 'before',
          referenceCount: 1, resultCount: 1, latencyMs: 3,
        },
      },
    });
    const serialized = JSON.stringify(view);

    expect(serialized).toContain('ev_1');
    expect(serialized).toContain('Falamos do Nebula 47.');
    expect(serialized).not.toContain('conversation-internal-id');
    expect(serialized).not.toContain('chunk-internal-id');
    expect(serialized).not.toContain('message-internal-id');
    expect(serialized).not.toContain('referenceCount');
  });

  it('shows temporal successor evidence without exposing message IDs', () => {
    const view = toToolExecutionModelView({
      tool: 'conversation_retrieval',
      arguments: { query: 'nome atual' },
      status: 'success',
      result: {
        query: 'nome atual',
        temporalMode: 'current',
        results: [{
          conversationId: '9b137f99-72b2-4da3-85d3-164e3a80e57a',
          chunkId: '20e6de7d-8da0-4c13-af19-8c1e641c2707',
          status: 'closed', score: 0.9, content: 'Nebula 47',
          startMessageId: 'old-message-id', endMessageId: 'old-message-id',
          tokenCount: 3,
          timeRange: { start: '2026-09-12T10:00:00-03:00', end: '2026-09-12T10:00:00-03:00', timeZone: 'America/Sao_Paulo' },
          temporalChanges: [{
            predecessorMessageId: 'old-message-id', subject: 'nome do projeto',
            type: 'SUPERSEDES', oldValue: 'Nebula 47', newValue: 'Nebula 48', chainComplete: true,
            successors: [{ messageId: 'new-message-id', role: 'user', content: 'Agora é Nebula 48', createdAt: '2026-09-19T10:00:00-03:00', type: 'SUPERSEDES', newValue: 'Nebula 48' }],
          }],
        }],
      },
    });
    const serialized = JSON.stringify(view);
    expect(serialized).toContain('Nebula 48');
    expect(serialized).toContain('superseded');
    expect(serialized).not.toContain('old-message-id');
    expect(serialized).not.toContain('new-message-id');
  });
});
