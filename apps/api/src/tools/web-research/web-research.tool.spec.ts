import { WebResearchRegisteredTool } from './web-research.tool';

describe('WebResearchRegisteredTool', () => {
  const settings = {
    researchEnabled: true,
    researchDefaultMode: 'quick',
    researchDefaultRecency: 'auto',
    researchMaxSources: 5,
    researchMaxRounds: 2,
    researchMaxQueries: 3,
  };

  function harness(overrides: Record<string, unknown> = {}) {
    const run = jest
      .fn()
      .mockResolvedValue({ researchRunId: 'run-1', status: 'completed' });
    const tool = new WebResearchRegisteredTool(
      { register: jest.fn() } as never,
      { run } as never,
      {
        getApplicationSettings: jest
          .fn()
          .mockResolvedValue({ ...settings, ...overrides }),
      } as never,
    );
    return { tool, run };
  }

  it('passes only a short relevant conversation excerpt and runtime identifiers', async () => {
    const { tool, run } = harness();
    await tool.execute(
      { question: 'Quanto custa a RTX 5090?' },
      {
        requestId: 'request-1',
        conversationId: 'conversation-1',
        currentMessageId: 'message-3',
        messages: [
          { id: 'message-1', role: 'user', content: 'Falando da RTX 5090' },
          { id: 'message-2', role: 'assistant', content: 'Certo.' },
          { id: 'message-3', role: 'user', content: 'E quanto custa?' },
        ],
      },
    );
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        question: 'Quanto custa a RTX 5090?',
        mode: 'quick',
        recency: 'auto',
        maxSources: 5,
        maxRounds: 2,
        maxQueries: 3,
        requestId: 'request-1',
        conversationId: 'conversation-1',
        messageId: 'message-3',
        conversationContext: 'user: Falando da RTX 5090\nassistant: Certo.',
      }),
    );
  });

  it('does not call the research service when disabled or given runtime-owned arguments', async () => {
    const disabled = harness({ researchEnabled: false });
    await expect(
      disabled.tool.execute({ question: 'Hoje?' }, { messages: [] }),
    ).rejects.toThrow('Pesquisa na Web está desativada');
    expect(disabled.run).not.toHaveBeenCalled();

    const enabled = harness();
    await expect(
      enabled.tool.execute(
        { question: 'Hoje?', conversationId: 'forged' },
        { messages: [] },
      ),
    ).rejects.toThrow('web_research does not accept conversationId');
    expect(enabled.run).not.toHaveBeenCalled();
  });
});
