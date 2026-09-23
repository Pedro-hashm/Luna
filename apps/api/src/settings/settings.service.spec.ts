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
      temporalConsolidationEnabled: false, temporalConsolidationDefaultCombo: null,
      temporalConsolidationFallbackCombo: null, temporalConsolidationStartTime: '04:30',
      temporalConsolidationEndTime: '08:30',
      researchEnabled: true, researchSearchOrchestratorCombo: 'local-reasoning',
      researchDefaultMode: 'quick', researchDefaultRecency: 'auto',
      researchMaxSources: 5, researchMaxRounds: 2, researchMaxQueries: 3,
      researchSearchProvider: 'searxng', researchExtractionProvider: 'static-with-browser-fallback',
      researchCacheEnabled: true, researchBrowserFallbackEnabled: true,
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

  it('persists the temporal consolidation toggle in both directions', async () => {
    const { service, update } = harness();

    const enabled = await service.updateSettings({ application: { temporalConsolidationEnabled: true } });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: { temporalConsolidationEnabled: true } }));
    expect(enabled.application.temporalConsolidationEnabled).toBe(true);

    const disabled = await service.updateSettings({ application: { temporalConsolidationEnabled: false } });
    expect(disabled.application.temporalConsolidationEnabled).toBe(false);
  });

  it('saves optional combos and a valid local processing window', async () => {
    const { service, update } = harness();

    const result = await service.updateSettings({ application: {
      temporalConsolidationDefaultCombo: '  local-configured  ',
      temporalConsolidationFallbackCombo: 'paid-configured',
      temporalConsolidationStartTime: '05:15',
      temporalConsolidationEndTime: '09:45',
    } });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: {
      temporalConsolidationDefaultCombo: 'local-configured',
      temporalConsolidationFallbackCombo: 'paid-configured',
      temporalConsolidationStartTime: '05:15',
      temporalConsolidationEndTime: '09:45',
    } }));
    expect(result.application.temporalConsolidationFallbackCombo).toBe('paid-configured');

    const cleared = await service.updateSettings({ application: { temporalConsolidationFallbackCombo: null } });
    expect(cleared.application.temporalConsolidationFallbackCombo).toBeNull();
  });

  it('rejects invalid temporal consolidation settings', async () => {
    const { service } = harness();

    await expect(service.updateSettings({ application: {
      temporalConsolidationEnabled: 'true' as unknown as boolean,
    } })).rejects.toThrow('temporalConsolidationEnabled must be a boolean');
    await expect(service.updateSettings({ application: {
      temporalConsolidationDefaultCombo: '',
    } })).rejects.toThrow('temporalConsolidationDefaultCombo must be a non-empty string');
    await expect(service.updateSettings({ application: {
      temporalConsolidationStartTime: '24:00',
    } })).rejects.toThrow('temporalConsolidationStartTime must be a time in HH:mm format');
  });

  it('persists the independent research combo and research toggle', async () => {
    const { service, update } = harness();
    const changed = await service.updateSettings({ application: {
      researchSearchOrchestratorCombo: ' paid-general ',
      researchEnabled: false,
      researchDefaultRecency: 'week',
    } });
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({ data: {
      researchSearchOrchestratorCombo: 'paid-general',
      researchEnabled: false,
      researchDefaultRecency: 'week',
    } }));
    expect(changed.application.researchSearchOrchestratorCombo).toBe('paid-general');
    expect(changed.application.researchEnabled).toBe(false);
    expect(changed.application.llmCombo).toBe('local-general');
  });

  it('rejects unsupported providers and unbounded research limits', async () => {
    const { service } = harness();
    await expect(service.updateSettings({ application: { researchSearchProvider: 'unknown' } }))
      .rejects.toThrow('researchSearchProvider must be one of: searxng');
    await expect(service.updateSettings({ application: { researchMaxRounds: 100 } }))
      .rejects.toThrow('researchMaxRounds must be an integer between 1 and 5');
  });
});
