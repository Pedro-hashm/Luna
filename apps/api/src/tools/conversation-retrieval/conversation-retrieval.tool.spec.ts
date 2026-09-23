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
        temporalMode: undefined,
        maxContextTokens: undefined,
        includeMessages: undefined,
      },
      context,
    );
    await expect(
      tool.execute({ query: 'nebula', scope: 'unknown' }, context),
    ).rejects.toBeInstanceOf(ToolArgumentException);
  });

  it('normalizes null date bounds to omitted optional filters', async () => {
    const registry = { register: jest.fn() };
    const retrievalService = {
      retrieve: jest.fn().mockResolvedValue({
        query: 'Nebula 47 data dia conversa',
        results: [],
      }),
    };
    const tool = new ConversationRetrievalTool(
      registry as never,
      retrievalService as never,
    );

    expect(tool.inputSchema.properties.dateFrom.type).toEqual([
      'string',
      'null',
    ]);
    expect(tool.inputSchema.properties.dateTo.type).toEqual([
      'string',
      'null',
    ]);

    await tool.execute(
      {
        query: 'Nebula 47 data dia conversa',
        scope: 'auto',
        dateTo: null,
        dateFrom: null,
        includeMessages: false,
        maxContextTokens: 5000,
      },
      context,
    );

    expect(retrievalService.retrieve).toHaveBeenCalledWith(
      {
        query: 'Nebula 47 data dia conversa',
        scope: 'auto',
        temporalMode: undefined,
        dateFrom: undefined,
        dateTo: undefined,
        includeMessages: false,
        maxContextTokens: 5000,
      },
      context,
    );
  });

  it('still rejects non-string date bounds', async () => {
    const tool = new ConversationRetrievalTool(
      { register: jest.fn() } as never,
      { retrieve: jest.fn() } as never,
    );

    await expect(
      tool.execute({ query: 'nebula', dateFrom: 20260923 }, context),
    ).rejects.toBeInstanceOf(ToolArgumentException);
  });

  it('accepts temporal intent independently of conversation scope', async () => {
    const retrievalService = {
      retrieve: jest.fn().mockResolvedValue({ query: 'nebula', results: [] }),
    };
    const tool = new ConversationRetrievalTool(
      { register: jest.fn() } as never,
      retrievalService as never,
    );
    await tool.execute({ query: 'nebula', scope: 'auto', temporalMode: 'both' }, context);
    expect(retrievalService.retrieve).toHaveBeenCalledWith(
      expect.objectContaining({ scope: 'auto', temporalMode: 'both' }),
      context,
    );
    await expect(tool.execute({ query: 'nebula', temporalMode: 'future' }, context))
      .rejects.toBeInstanceOf(ToolArgumentException);
  });
});
