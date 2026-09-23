import { SearchOrchestratorService } from './search-orchestrator.service';
import { ResearchEvidenceService } from './evidence/research-evidence.service';
import { SourceService } from './sources/source.service';
import type { ResearchRuntimeConfig } from './research-config.service';
import type { ResearchConfigService } from './research-config.service';
import type { SearchPlannerService } from './search-planner.service';
import type { WebSearchTool } from './tools/web-search.tool';
import type { WebExtractTool } from './tools/web-extract.tool';
import type { ResearchRunService } from './research-run.service';

const config: ResearchRuntimeConfig = {
  enabled: true,
  combo: 'local-reasoning',
  mode: 'deep',
  recency: 'auto',
  maxSources: 5,
  maxRounds: 2,
  maxQueries: 2,
  searchProvider: 'searxng',
  extractionProvider: 'static-with-browser-fallback',
  cacheEnabled: true,
  browserFallbackEnabled: false,
  timeoutMs: 20_000,
  plannerTimeoutMs: 5_000,
  searchTimeoutMs: 2_000,
  extractTimeoutMs: 2_000,
  extractMaxBytes: 100_000,
};

function setup(
  overrides: {
    mode?: 'quick' | 'deep';
    searchError?: boolean;
    plannerError?: boolean;
    noResults?: boolean;
  } = {},
) {
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];
  const runs = {
    create: jest.fn().mockResolvedValue('00000000-0000-0000-0000-000000000001'),
    event: jest
      .fn()
      .mockImplementation(
        (_runId: string, type: string, data: Record<string, unknown>) => {
          events.push({ type, data });
          return Promise.resolve();
        },
      ),
    source: jest.fn().mockResolvedValue(undefined),
    evidence: jest.fn().mockResolvedValue(undefined),
    complete: jest.fn().mockResolvedValue(undefined),
  };
  const planner = {
    initial: overrides.plannerError
      ? jest.fn().mockRejectedValue(new Error('OmniRoute unavailable'))
      : jest.fn().mockResolvedValue({
          plan: {
            action: 'search',
            intention: 'Find answer',
            queries: [{ query: 'first question', purpose: 'initial' }],
            preferredSourceTypes: [],
            needsRecency: false,
            maxSources: 5,
          },
          model: 'local',
          inputTokens: 50,
          outputTokens: 30,
          prompt: 'prompt',
        }),
    followUp: jest.fn().mockResolvedValue({
      plan: {
        action: 'search_more',
        intention: 'Find another source',
        queries: [{ query: 'second question', purpose: 'independence' }],
        preferredSourceTypes: [],
        needsRecency: false,
        maxSources: 5,
      },
      model: 'local',
      inputTokens: 30,
      outputTokens: 20,
      prompt: 'prompt',
    }),
  };
  const search = {
    search: overrides.searchError
      ? jest.fn().mockRejectedValue(new Error('SearXNG unavailable'))
      : jest.fn().mockImplementation((query: string) =>
          Promise.resolve({
            provider: 'searxng',
            query,
            fromCache: false,
            latencyMs: 5,
            results: overrides.noResults
              ? []
              : [
                  {
                    id: `sr_${query}`,
                    title: query.includes('first')
                      ? 'Canberra capital Australia official'
                      : 'Australia capital Canberra encyclopedia',
                    url: query.includes('first')
                      ? 'https://example.com/capital'
                      : 'https://other.com/capital',
                    domain: query.includes('first')
                      ? 'example.com'
                      : 'other.com',
                    snippet: 'Canberra is the capital city of Australia.',
                    rank: 1,
                    retrievedAt: '2026-09-23T00:00:00.000Z',
                    searchEngine: 'test',
                    query,
                  },
                ],
          }),
        ),
  };
  const extract = {
    extract: jest.fn().mockImplementation((url: string) =>
      Promise.resolve({
        url,
        normalizedUrl: url,
        finalUrl: url,
        title: 'Capital of Australia',
        text: url.includes('other.com')
          ? 'The Australian Capital Territory contains Canberra, where the federal parliament meets and national agencies are based.'
          : "Canberra is the capital city of Australia. It is the seat of government and the country's national capital.",
        retrievedAt: '2026-09-23T00:00:00.000Z',
        extractionMethod: 'static',
        contentType: 'text/html',
        wordCount: 21,
      }),
    ),
  };
  const orchestrator = new SearchOrchestratorService(
    {
      resolve: jest
        .fn()
        .mockResolvedValue({ ...config, mode: overrides.mode ?? config.mode }),
    } as unknown as ResearchConfigService,
    planner as unknown as SearchPlannerService,
    search as unknown as WebSearchTool,
    extract as unknown as WebExtractTool,
    new SourceService(),
    new ResearchEvidenceService(),
    runs as unknown as ResearchRunService,
  );
  return { orchestrator, events, runs, planner, search, extract };
}

describe('SearchOrchestratorService', () => {
  it('runs bounded deep research with a second round and linked evidence', async () => {
    const { orchestrator, events, planner, search, runs } = setup();
    const result = await orchestrator.run({
      question: 'What is the capital of Australia?',
    });
    expect(result.status).toBe('completed');
    expect(result.metadata).toMatchObject({
      rounds: 2,
      searchQueries: 2,
      llmCalls: 2,
      plannerCombo: 'local-reasoning',
    });
    expect(result.sources).toHaveLength(2);
    expect(result.evidence.length).toBeGreaterThanOrEqual(2);
    expect(
      result.evidence.every((item) =>
        result.sources.some((source) => source.id === item.sourceId),
      ),
    ).toBe(true);
    expect(planner.followUp).toHaveBeenCalledTimes(1);
    expect(search.search).toHaveBeenCalledTimes(2);
    expect(events[0].type).toBe('research.started');
    expect(events.at(-1)?.type).toBe('research.completed');
    expect(runs.complete).toHaveBeenCalledWith(
      result.researchRunId,
      'completed',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('does one round in quick mode even when evidence is insufficient', async () => {
    const { orchestrator, planner } = setup({ mode: 'quick', noResults: true });
    const result = await orchestrator.run({
      question: 'What is the capital of Australia?',
    });
    expect(result.metadata.rounds).toBe(1);
    expect(result.status).toBe('insufficient');
    expect(planner.followUp).not.toHaveBeenCalled();
  });

  it('marks a run insufficient when excerpts come from only one non-primary domain', async () => {
    const { orchestrator } = setup({ mode: 'quick' });
    const result = await orchestrator.run({
      question: 'What is the capital of Australia?',
    });
    expect(result.evidence.length).toBeGreaterThan(0);
    expect(result.metadata.verification).toBe('insufficient');
    expect(result.status).toBe('insufficient');
  });

  it('records search failure and preserves a failed run', async () => {
    const { orchestrator, events, runs } = setup({
      mode: 'quick',
      searchError: true,
    });
    const result = await orchestrator.run({
      question: 'What is the capital of Australia?',
    });
    expect(result.status).toBe('failed');
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(['research.search.failed', 'research.failed']),
    );
    expect(runs.complete).toHaveBeenCalledWith(
      result.researchRunId,
      'failed',
      expect.any(String),
      expect.any(Object),
    );
  });

  it('falls back to the question as a query when planner fails', async () => {
    const { orchestrator, events, search } = setup({
      mode: 'quick',
      plannerError: true,
    });
    const result = await orchestrator.run({
      question: 'What is the capital of Australia?',
    });
    expect(result.metadata.errors[0]).toContain('OmniRoute unavailable');
    expect(search.search).toHaveBeenCalledTimes(1);
    expect(events.map((event) => event.type)).toContain(
      'research.planner.failed',
    );
  });
});
