import { ToolArgumentException } from '../types/tool-errors';
import { ConversationRetrievalTool } from './conversation-retrieval.tool';

describe('ConversationRetrievalTool', () => {
  const context = {
    conversationId: '9b137f99-72b2-4da3-85d3-164e3a80e57a',
    currentMessageId: 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e',
    currentDateTime: '2026-09-21T12:00:00.000Z',
    messages: [],
  };

  it('exposes semantic scope without runtime identifiers', async () => {
    const registry = { register: jest.fn() };
    const retrievalService = { retrieve: jest.fn() };
    const tool = new ConversationRetrievalTool(
      registry as never,
      retrievalService as never,
    );

    expect(tool.inputSchema.properties).not.toHaveProperty('conversationId');
    expect(tool.inputSchema.properties).not.toHaveProperty('currentMessageId');
    expect(tool.inputSchema.properties).not.toHaveProperty(
      'searchCurrentConversation',
    );
    expect(tool.inputSchema.properties).toHaveProperty('scope');

    await expect(
      tool.execute(
        { query: 'tokyo ghoul', conversationId: context.conversationId },
        context,
      ),
    ).rejects.toBeInstanceOf(ToolArgumentException);
  });

  it('accepts the explicit scopes and rejects an invalid scope', async () => {
    const registry = { register: jest.fn() };
    const retrievalService = {
      retrieve: jest.fn().mockResolvedValue({ query: 'nebula', results: [] }),
    };
    const tool = new ConversationRetrievalTool(
      registry as never,
      retrievalService as never,
    );

    await tool.execute({ query: 'nebula', scope: 'auto' }, context);
    await tool.execute(
      { query: 'nebula', scope: 'current_conversation' },
      context,
    );
    await tool.execute({ query: 'nebula', scope: 'historical' }, context);

    expect(retrievalService.retrieve).toHaveBeenLastCalledWith(
      {
        query: 'nebula',
        dateFrom: undefined,
        dateTo: undefined,
        scope: 'historical',
        maxContextTokens: undefined,
        includeMessages: undefined,
      },
      context,
    );
    await expect(
      tool.execute({ query: 'nebula', scope: 'unknown' }, context),
    ).rejects.toBeInstanceOf(ToolArgumentException);
  });
});
