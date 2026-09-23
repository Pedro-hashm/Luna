import { ensureRegisteredWebCitations } from './web-citations';
import type { OrchestratorToolExecution } from '../orchestrator/orchestrator.types';

const executions = [
  {
    iteration: 1,
    tool: 'web_research',
    arguments: { question: 'test' },
    status: 'success',
    result: {
      researchRunId: 'run-1',
      status: 'completed',
      summaryContext: '',
      sources: [
        {
          id: 'src_1',
          url: 'https://example.org/fact',
          title: 'Original',
          domain: 'example.org',
        },
      ],
      evidence: [
        { id: 'ev_1', sourceId: 'src_1', text: 'Fact', type: 'direct' },
      ],
      conflicts: [],
      metadata: {},
    },
  },
] as unknown as OrchestratorToolExecution[];

describe('ensureRegisteredWebCitations', () => {
  it('removes invented links and supplies a registered source if needed', () => {
    const answer = ensureRegisteredWebCitations(
      'Fact [fabricated](https://unknown.example/x).',
      executions,
    );
    expect(answer).not.toContain('https://unknown.example/x');
    expect(answer).toContain('[Original](https://example.org/fact)');
  });

  it('keeps valid source links without duplicating them', () => {
    const answer = ensureRegisteredWebCitations(
      'Fact [Original](https://example.org/fact).',
      executions,
    );
    expect(answer).toBe('Fact [Original](https://example.org/fact).');
  });

  it('removes an unregistered bare URL', () => {
    const answer = ensureRegisteredWebCitations(
      'Leia https://unknown.example/x.',
      executions,
    );
    expect(answer).not.toContain('https://unknown.example/x');
    expect(answer).toContain('[Original](https://example.org/fact)');
  });
});
