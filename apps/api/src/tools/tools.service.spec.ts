import { ToolsService } from './tools.service';

describe('ToolsService observability', () => {
  it('persists the exact tool input, returned evidence, and retrieval trace', async () => {
    const diagnostics = {
      query: 'where did we discuss search?',
      filters: { dateFrom: '2026-09-01T00:00:00.000Z' },
      config: { strategy: 'hybrid' },
      stages: { vector: { count: 1, latencyMs: 4 } },
      stageResults: { vector: [{ id: 'chunk-1', contentPreview: 'We chose PostgreSQL FTS.', vectorRank: 1 }] },
      counts: { final: 1 },
      reranker: { model: null, inputCount: 0, outputCount: 0, threshold: null },
      candidates: [{ id: 'chunk-1', source: 'conversation_chunk', contentPreview: 'We chose PostgreSQL FTS.' }],
      finalResultCount: 1,
      totalLatencyMs: 5,
    };
    const toolResult = {
      query: 'where did we discuss search?',
      results: [{ chunkId: 'chunk-1', content: 'We chose PostgreSQL FTS.' }],
    };
    Object.defineProperty(toolResult, '__retrievalDiagnostics', {
      value: diagnostics,
      enumerable: false,
    });
    const conversationDiagnostics = {
      scope: 'historical',
      counts: { retrievalCandidates: 1, returnedResults: 1, excludedCandidates: 0 },
    };
    Object.defineProperty(toolResult, '__conversationDiagnostics', {
      value: conversationDiagnostics,
      enumerable: false,
    });

    const registry = {
      has: jest.fn().mockReturnValue(true),
      execute: jest.fn().mockResolvedValue(toolResult),
    };
    const observability = { recordTrace: jest.fn().mockResolvedValue(undefined) };
    const service = new ToolsService(
      registry as never,
      observability as never,
      {} as never,
    );

    const response = await service.execute({
      tool: 'conversation_retrieval',
      input: { query: 'where did we discuss search?' },
      context: { currentDateTime: '2026-09-22T12:00:00-03:00', messages: [] },
    });

    expect(response.result).toEqual(toolResult);
    expect(response.result).not.toHaveProperty('__retrievalDiagnostics');
    expect(response.result).not.toHaveProperty('__conversationDiagnostics');
    expect(observability.recordTrace).toHaveBeenCalledWith(
      expect.objectContaining({
        contextSnapshot: expect.objectContaining({
          tools: expect.objectContaining({
            items: [
              expect.objectContaining({
                name: 'conversation_retrieval',
                input: { query: 'where did we discuss search?' },
                result: toolResult,
                retrieval: diagnostics,
                conversationRetrieval: conversationDiagnostics,
              }),
            ],
          }),
        }),
      }),
    );
  });

  it('records Evidence resolution diagnostics and keeps them out of the returned tool result', async () => {
    const result = {
      evidence_id: 'ev_3',
      direction: 'before',
      resultCount: 1,
      results: [{ date: '2026-09-12', role: 'user', content: 'Contexto anterior.' }],
    };
    Object.defineProperty(result, '__evidenceDiagnostics', {
      value: {
        event: 'evidence.resolve', evidenceId: 'ev_3', direction: 'before',
        referenceCount: 2, resultCount: 1, latencyMs: 12,
      },
      enumerable: false,
    });
    const registry = { has: jest.fn().mockReturnValue(true), execute: jest.fn().mockResolvedValue(result) };
    const observability = { recordTrace: jest.fn().mockResolvedValue(undefined) };
    const service = new ToolsService(registry as never, observability as never, {} as never);

    const response = await service.execute({
      tool: 'conversation_context',
      input: { evidence_id: 'ev_3', direction: 'before' },
      context: { currentDateTime: '2026-09-22T12:00:00-03:00', messages: [] },
    });

    expect(response.result).not.toHaveProperty('__evidenceDiagnostics');
    expect(JSON.stringify(response.result)).not.toContain('referenceCount');
    expect(observability.recordTrace).toHaveBeenCalledWith(expect.objectContaining({
      stageDurations: expect.objectContaining({ 'evidence.resolve': 12 }),
      contextSnapshot: expect.objectContaining({
        tools: expect.objectContaining({ items: [expect.objectContaining({
          evidenceResolve: expect.objectContaining({
            event: 'evidence.resolve', evidenceId: 'ev_3', direction: 'before',
            referenceCount: 2, resultCount: 1, latencyMs: 12,
          }),
        })] }),
      }),
    }));
  });
});
