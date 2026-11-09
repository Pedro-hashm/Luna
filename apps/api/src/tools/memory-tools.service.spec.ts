import { MemoryTools } from './memory-tools.service';
import { MemoryService } from '../memory/memory.service';
import { ToolRegistryService } from './tool-registry.service';
import type { ToolExecutionContext } from './types/tool.types';

describe('MemoryTools identity scopes', () => {
  const definitions = new Map<string, { execute: (input: Record<string, unknown>, context: ToolExecutionContext) => Promise<unknown> }>();
  let search: jest.Mock;
  let explicitSave: jest.Mock;
  let explicitForget: jest.Mock;

  beforeEach(() => {
    definitions.clear();
    search = jest.fn().mockResolvedValue({ memory: 'search', items: [] });
    explicitSave = jest.fn().mockResolvedValue({ memory: 'save', items: [], outcome: 'saved' });
    explicitForget = jest.fn().mockResolvedValue({ memory: 'forget', items: [], outcome: 'forgotten' });
    const registry = { register: jest.fn(definition => definitions.set(definition.name, definition)) };
    const memory = { search, explicitSave, explicitForget };
    new MemoryTools(registry as unknown as ToolRegistryService, memory as unknown as MemoryService).onModuleInit();
  });

  const context: ToolExecutionContext = {
    conversationId: '00000000-0000-4000-8000-000000000001',
    currentMessageId: '00000000-0000-4000-8000-000000000002',
    currentDateTime: '2026-11-08T12:00:00-03:00',
    memoryScope: 'discord:42:99',
    messages: [{ id: '00000000-0000-4000-8000-000000000002', role: 'user', content: 'Meu computador é Aurora.' }],
  };

  it('searches only the current Discord identity and rejects attempts to select another scope', async () => {
    await definitions.get('memory_search')!.execute({ query: 'computador' }, context);
    expect(search).toHaveBeenCalledWith('computador', '2026-11-08', 'discord:42:99');
    await expect(definitions.get('memory_search')!.execute({ query: 'computador', scope: 'global' }, context))
      .rejects.toThrow('Só é possível consultar memórias desta pessoa.');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('forces explicit saves and forgets into the current identity scope', async () => {
    await definitions.get('memory_save')!.execute({ scope: 'global' }, context);
    await definitions.get('memory_forget')!.execute({}, context);
    expect(explicitSave).toHaveBeenCalledWith({ scope: 'global' }, context.currentMessageId, context.conversationId, 'discord:42:99');
    expect(explicitForget).toHaveBeenCalledWith(context.currentMessageId, context.conversationId, 'discord:42:99');
  });
});
