import { ToolArgumentException } from '../types/tool-errors';
import { ConversationContextTool } from './conversation-context.tool';

describe('ConversationContextTool', () => {
  it('exposes only evidence_id and direction to the model', () => {
    const tool = new ConversationContextTool({ register: jest.fn() } as never, { expand: jest.fn() } as never);

    expect(tool.inputSchema).toMatchObject({
      additionalProperties: false,
      properties: {
        evidence_id: { type: 'string' },
        direction: { enum: ['before', 'after', 'both'] },
      },
      required: ['evidence_id', 'direction'],
    });
    expect(Object.keys(tool.inputSchema.properties).sort()).toEqual(['direction', 'evidence_id']);
  });

  it('rejects internal source identifiers in arguments', async () => {
    const expand = jest.fn();
    const tool = new ConversationContextTool({ register: jest.fn() } as never, { expand } as never);

    await expect(Promise.resolve().then(() => tool.execute({ evidence_id: 'ev_1', direction: 'before', chunkId: 'internal' }, { messages: [] })))
      .rejects.toBeInstanceOf(ToolArgumentException);
    expect(expand).not.toHaveBeenCalled();
  });
});
