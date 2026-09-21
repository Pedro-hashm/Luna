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
  });
});
