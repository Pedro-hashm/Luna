import { SettingsService } from './settings.service';

describe('SettingsService Conversation Evidence setting', () => {
  function harness() {
    let application = {
      id: 1, llmCombo: 'local-general', orchestratorCombo: 'local-general', appTimezone: 'America/Sao_Paulo',
      llmTemperature: null, llmMaxTokens: null, immediateContextMaxTokens: 32000,
      orchestratorMaxIterations: 4, orchestratorMaxToolCalls: 3, orchestratorToolResultMaxTokens: 1000,
      retrievalDefaultTopK: 8, retrievalMaxTopK: 50, retrievalDefaultMaxContextTokens: 8000,
      retrievalMaxContextTokens: 20000, retrievalIncludeMessages: true, retrievalStrategy: 'hybrid',
      retrievalVectorTopK: 30, retrievalLexicalTopK: 30, retrievalRrfK: 60, retrievalCandidatePoolTopK: 30,
      retrievalRerankerEnabled: false, retrievalRerankerModel: 'cross-encoder/ettin-reranker-17m-v1',
      retrievalRerankerTopK: 30, retrievalRerankerThreshold: 8, retrievalDeduplicationEnabled: true,
      retrievalDeduplicationThreshold: 0.85, conversationEvidenceEnabled: false,
    };
    const update = jest.fn().mockImplementation(({ data }) => {
      application = { ...application, ...data };
      return Promise.resolve(application);
    });
    const prisma = {
      applicationSettings: {
        update,
        upsert: jest.fn().mockImplementation(() => Promise.resolve(application)),
      },
      conversationChunkSettings: {
        upsert: jest.fn().mockResolvedValue({
          maxTokens: 4000, overlapTokens: 800, embeddingRefreshTokens: 1000,
          embeddingModel: 'qwen3-embedding:0.6b', embeddingDimensions: 1024,
        }),
      },
    };
    return { service: new SettingsService(prisma as never), update };
  }

  it('persists both ON and OFF updates and returns the saved state', async () => {
    const { service, update } = harness();

    const enabled = await service.updateSettings({ application: { conversationEvidenceEnabled: true } });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { conversationEvidenceEnabled: true } }));
    expect(enabled.application.conversationEvidenceEnabled).toBe(true);

    const disabled = await service.updateSettings({ application: { conversationEvidenceEnabled: false } });
    expect(disabled.application.conversationEvidenceEnabled).toBe(false);
  });

  it('rejects a non-boolean value', async () => {
    const { service } = harness();

    await expect(service.updateSettings({
      application: { conversationEvidenceEnabled: 'true' as unknown as boolean },
    })).rejects.toThrow('conversationEvidenceEnabled must be a boolean');
  });
});
