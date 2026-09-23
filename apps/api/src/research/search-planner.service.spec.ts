import {
  parseSearchPlan,
  SearchPlannerService,
} from './search-planner.service';
import type { OmnirouteService } from '../llm/omniroute/omniroute.service';
import type { ResearchRuntimeConfig } from './research-config.service';

const valid = JSON.stringify({
  action: 'search',
  intention: 'Find official specifications',
  queries: [
    {
      query: 'RTX 4060 official specifications',
      purpose: 'Identify GPU details',
    },
  ],
  preferredSourceTypes: ['primary'],
  needsRecency: false,
  maxSources: 5,
});

describe('parseSearchPlan', () => {
  it('parses a strict, bounded JSON plan', () => {
    expect(parseSearchPlan(valid, 3, 5, true)).toMatchObject({
      action: 'search',
      queries: [{ query: 'RTX 4060 official specifications' }],
      maxSources: 5,
    });
  });

  it('rejects prose, invalid actions, and excess queries', () => {
    expect(() =>
      parseSearchPlan(`Here is your plan: ${valid}`, 3, 5, true),
    ).toThrow('valid JSON');
    expect(() =>
      parseSearchPlan(
        JSON.stringify({ ...JSON.parse(valid), action: 'finish' }),
        3,
        5,
        true,
      ),
    ).toThrow('Initial planner action');
    expect(() => parseSearchPlan(valid, 0, 5, true)).toThrow('query count');
  });
});

describe('SearchPlannerService', () => {
  const config = {
    combo: 'local-reasoning',
    mode: 'quick',
    recency: 'auto',
    maxQueries: 3,
    maxSources: 5,
    plannerTimeoutMs: 50,
  } as unknown as ResearchRuntimeConfig;

  it('limits quick research to one search query', async () => {
    const chat = jest.fn().mockResolvedValue({
      content: JSON.stringify({
        action: 'search',
        intention: 'Find the capital',
        queries: [
          { query: 'Australia capital official', purpose: 'Official source' },
          { query: 'Australia capital encyclopedia', purpose: 'Cross-check' },
        ],
        preferredSourceTypes: ['primary'],
        needsRecency: false,
        maxSources: 5,
      }),
      model: 'local',
    });
    const planner = new SearchPlannerService({
      chat,
    } as unknown as OmnirouteService);
    const outcome = await planner.initial(
      { question: 'Capital of Australia?' },
      config,
      AbortSignal.timeout(1_000),
    );
    expect(outcome.plan.queries).toEqual([
      { query: 'Australia capital official', purpose: 'Official source' },
    ]);
  });

  it('requests enough output for reasoning and rejects an empty completion explicitly', async () => {
    const chat = jest.fn().mockResolvedValue({
      content: '',
      model: 'local',
      usage: { inputTokens: 10, outputTokens: 500 },
    });
    const planner = new SearchPlannerService({
      chat,
    } as unknown as OmnirouteService);
    await expect(
      planner.initial(
        { question: 'Capital of Australia?' },
        config,
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow('Planner returned empty content');
    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        combo: 'local-reasoning',
        maxTokens: 2_400,
        reasoningEffort: 'none',
      }),
    );
  });

  it('passes a bounded abort signal through to OmniRoute', async () => {
    const chat = jest.fn().mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => reject(new Error('Planner aborted')),
            { once: true },
          );
        }),
    );
    const planner = new SearchPlannerService({
      chat,
    } as unknown as OmnirouteService);
    await expect(
      planner.initial(
        { question: 'Capital of Australia?' },
        { ...config, plannerTimeoutMs: 1 },
        AbortSignal.timeout(1_000),
      ),
    ).rejects.toThrow('Planner aborted');
  });
});
