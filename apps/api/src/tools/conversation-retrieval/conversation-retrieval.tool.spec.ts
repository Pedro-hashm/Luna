import { ToolArgumentException } from '../types/tool-errors';
import { ConversationRetrievalTool } from './conversation-retrieval.tool';

describe('ConversationRetrievalTool', () => {
  const context = {
    conversationId: '9b137f99-72b2-4da3-85d3-164e3a80e57a',
    currentMessageId: 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e',
    currentDateTime: '2026-09-21T12:00:00.000Z',
    messages: [],
  };

  it('does not expose runtime identifiers in its schema or accept them as input', async () => {
    const registry = { register: jest.fn() };
    const retrievalService = { retrieve: jest.fn() };
    const tool = new ConversationRetrievalTool(
      registry as never,
      retrievalService as never,
    );

    expect(tool.inputSchema.properties).not.toHaveProperty('conversationId');
    expect(tool.inputSchema.properties).not.toHaveProperty('currentMessageId');
    expect(tool.inputSchema.properties).toHaveProperty(
      'searchCurrentConversation',
    );

    await expect(
      tool.execute(
        { query: 'tokyo ghoul', conversationId: context.conversationId },
        context,
      ),
    ).rejects.toBeInstanceOf(ToolArgumentException);
  });
});
