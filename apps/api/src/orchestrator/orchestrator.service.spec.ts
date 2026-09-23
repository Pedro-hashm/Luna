import type { LlmRequest } from '../llm/dto/llm-request.dto';
import type { LlmResponse } from '../llm/types/types';
import type {
  ExecuteToolRequest,
  ExecuteToolResponse,
} from '../tools/types/tool.types';
import { ToolArgumentException } from '../tools/types/tool-errors';
import type { OrchestratorContext } from './orchestrator.types';
import { OrchestratorService } from './orchestrator.service';

const conversationId = '9b137f99-72b2-4da3-85d3-164e3a80e57a';
const currentMessageId = 'b8a78b2f-408a-4d5c-a87d-2d3c252a118e';
const chunkId = '20e6de7d-8da0-4c13-af19-8c1e641c2707';

describe('OrchestratorService', () => {
  it('uses auto for an unlocated memory request, injects runtime context, and keeps IDs out of later prompts', async () => {
    const harness = createHarness([
      llmResponse(
        JSON.stringify({
          type: 'tool_call',
          tool: 'conversation_retrieval',
          arguments: {
            query: 'projeto secreto Nebula 47',
            searchCurrentConversation: true,
            conversationId: 'malformed-id-from-model',
          },
        }),
      ),
      llmResponse('{"type":"finalize"}'),
    ]);
    harness.execute.mockResolvedValue(toolResponse());

    await harness.service.execute(orchestratorContext());

    expect(harness.execute).toHaveBeenCalledWith({
      requestId: '7a55c36d-7c1b-44e1-a7a3-3ed3e1dc94da',
      tool: 'conversation_retrieval',
      input: {
        query: 'projeto secreto Nebula 47',
        scope: 'auto',
        includeMessages: false,
        maxContextTokens: 5000,
      },
      context: {
        conversationId,
        currentMessageId,
        currentDateTime: '2026-09-21T12:00:00.000Z',
        messages: orchestratorContext().recentMessages,
      },
    });

    const nextPrompt = JSON.stringify(harness.chat.mock.calls[1]?.[0].messages);
    const firstPrompt = JSON.stringify(
      harness.chat.mock.calls[0]?.[0].messages,
    );

    expect(firstPrompt).toContain('scope=auto');
    expect(firstPrompt).toContain('Nunca escolha esse escopo apenas porque');
    expect(nextPrompt).not.toContain(conversationId);
    expect(nextPrompt).not.toContain(currentMessageId);
    expect(nextPrompt).not.toContain(chunkId);
    expect(nextPrompt).toContain('Tokyo Ghoul é uma série');
  });

  it('returns structured semantic validation feedback to the model', async () => {
    const harness = createHarness([
      llmResponse(
        JSON.stringify({
          type: 'tool_call',
          tool: 'conversation_retrieval',
          arguments: { query: 42 },
        }),
      ),
      llmResponse('{"type":"finalize"}'),
    ]);
    harness.execute.mockRejectedValue(
      new ToolArgumentException('query', 'query must be a string'),
    );

    await harness.service.execute(orchestratorContext());

    const nextPrompt = JSON.stringify(harness.chat.mock.calls[1]?.[0].messages);

    expect(harness.execute).toHaveBeenCalledTimes(1);
    expect(nextPrompt).toContain('INVALID_ARGUMENT');
    expect(nextPrompt).toContain('query must be a string');
    expect(nextPrompt).toContain('\\"modelRetryable\\":true');
  });

  it('retries a transient read-only tool failure in the runtime, not through another model iteration', async () => {
    const harness = createHarness([
      llmResponse(
        JSON.stringify({
          type: 'tool_call',
          tool: 'conversation_retrieval',
          arguments: { query: 'tokyo ghoul' },
        }),
      ),
      llmResponse('{"type":"finalize"}'),
    ]);
    harness.execute
      .mockRejectedValueOnce(new Error('ETIMEDOUT'))
      .mockResolvedValueOnce(toolResponse());

    await harness.service.execute(orchestratorContext());

    expect(harness.execute).toHaveBeenCalledTimes(2);
    expect(harness.chat).toHaveBeenCalledTimes(2);
  });

  it('uses dates already present in Evidence without calling a tool', async () => {
    const context = orchestratorContext();
    context.input = 'Em que dia falamos disso?';
    context.recentMessages = [
      {
        id: currentMessageId,
        role: 'assistant',
        content: 'Sobre o Nebula 47, discutimos as regras.',
        createdAt: '2026-09-21T12:00:00.000Z',
        evidence: [{ evidence_id: 'ev_1', date_from: '2026-09-12', date_to: '2026-09-12', dates: ['2026-09-12'] }],
      },
      {
        id: 'current-user-message',
        role: 'user',
        content: context.input,
        createdAt: '2026-09-21T12:01:00.000Z',
      },
    ];
    const harness = createHarness([llmResponse('{"type":"finalize"}')], true);

    await harness.service.execute(context);

    expect(harness.execute).not.toHaveBeenCalled();
    const prompt = harness.chat.mock.calls[0]?.[0].messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).toContain('"evidence_id":"ev_1"');
    expect(prompt).toContain('"dates":["2026-09-12"]');
    expect(prompt).toContain('conversation_context');
    expect(prompt).not.toContain(conversationId);
    expect(prompt).not.toContain(chunkId);
  });

  it('persists the exact ordered prompt sent to the Orchestrator', async () => {
    const harness = createHarness([llmResponse('{"type":"finalize"}')]);

    await harness.service.execute(orchestratorContext());

    const sentMessages = harness.chat.mock.calls[0]?.[0].messages;
    expect(harness.recordTrace).toHaveBeenCalledWith(expect.objectContaining({
      contextSnapshot: expect.objectContaining({
        promptTarget: 'orchestrator',
        promptIteration: 1,
        promptMessages: sentMessages,
      }),
    }));
  });

  it.each([
    ['o que falamos antes?', 'before'],
    ['e depois?', 'after'],
    ['me mostra o contexto em volta', 'both'],
  ])('uses conversation_context direction %s', async (question, direction) => {
    const context = orchestratorContext();
    context.input = question;
    const harness = createHarness([
      llmResponse(JSON.stringify({ type: 'tool_call', tool: 'conversation_context', arguments: { evidence_id: 'ev_1', direction } })),
      llmResponse('{"type":"finalize"}'),
    ], true);
    harness.execute.mockResolvedValue(contextToolResponse(direction));

    await harness.service.execute(context);

    expect(harness.execute).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'conversation_context',
      input: { evidence_id: 'ev_1', direction },
    }));
  });

  it('does not expose or execute conversation_context when Evidence is disabled', async () => {
    const harness = createHarness([
      llmResponse(JSON.stringify({ type: 'tool_call', tool: 'conversation_context', arguments: { evidence_id: 'ev_1', direction: 'before' } })),
    ]);

    const result = await harness.service.execute(orchestratorContext());

    expect(harness.execute).not.toHaveBeenCalled();
    expect(result.toolExecutions[0]?.status).toBe('error');
    const prompt = harness.chat.mock.calls[0]?.[0].messages.map((message) => message.content).join('\n') ?? '';
    expect(prompt).not.toContain('conversation_context');
  });
});

function createHarness(decisions: LlmResponse[], evidenceEnabled = false) {
  const chat = jest.fn<Promise<LlmResponse>, [LlmRequest]>();
  const execute = jest.fn<Promise<ExecuteToolResponse>, [ExecuteToolRequest]>();
  const recordTrace = jest.fn().mockResolvedValue(undefined);

  for (const decision of decisions) {
    chat.mockResolvedValueOnce(decision);
  }

  const service = new OrchestratorService(
    { chat } as never,
    {
      getApplicationSettings: jest.fn().mockResolvedValue({
        orchestratorCombo: 'local-general',
        orchestratorMaxIterations: 4,
        orchestratorMaxToolCalls: 4,
        orchestratorToolResultMaxTokens: 5000,
        conversationEvidenceEnabled: evidenceEnabled,
      }),
    } as never,
    { execute } as never,
    {
      describe: jest.fn().mockReturnValue([
        {
          name: 'conversation_retrieval',
          description: 'Recupera contexto histórico.',
          inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { query: { type: 'string' } },
          },
        },
        {
          name: 'conversation_context',
          description: 'Expande uma Evidence existente.',
          inputSchema: { type: 'object', additionalProperties: false, properties: { evidence_id: { type: 'string' }, direction: { type: 'string', enum: ['before', 'after', 'both'] } } },
        },
      ]),
      has: jest.fn().mockReturnValue(true),
    } as never,
    { recordTrace } as never,
  );

  return { service, chat, execute, recordTrace };
}

function contextToolResponse(direction: string): ExecuteToolResponse {
  return {
    tool: 'conversation_context',
    context: { messages: [] },
    result: {
      evidence_id: 'ev_1',
      direction: direction as 'before' | 'after' | 'both',
      resultCount: 1,
      results: [{ date: '2026-09-12', role: 'user', content: 'Comentamos o Nebula 47.' }],
    },
  };
}

function llmResponse(content: string): LlmResponse {
  return { content, model: 'test-model' };
}

function orchestratorContext(): OrchestratorContext {
  return {
    requestId: '7a55c36d-7c1b-44e1-a7a3-3ed3e1dc94da',
    input: 'Já falamos sobre Tokyo Ghoul?',
    conversationId,
    currentMessageId,
    currentDateTime: '2026-09-21T12:00:00.000Z',
    recentMessages: [
      {
        id: currentMessageId,
        role: 'user',
        content: 'Já falamos sobre Tokyo Ghoul?',
        createdAt: '2026-09-21T12:00:00.000Z',
      },
    ],
    memory: { items: [] },
    preferences: {},
    runtime: {},
  };
}

function toolResponse(): ExecuteToolResponse {
  return {
    tool: 'conversation_retrieval',
    context: {
      conversationId,
      currentMessageId,
      currentDateTime: '2026-09-21T12:00:00.000Z',
      messages: [],
    },
    result: {
      query: 'tokyo ghoul',
      results: [
        {
          conversationId,
          chunkId,
          status: 'closed',
          score: 0.9,
          content: 'assistant: Tokyo Ghoul é uma série.',
          startMessageId: currentMessageId,
          endMessageId: currentMessageId,
          tokenCount: 10,
          timeRange: {
            start: '2026-09-21T09:00:00.000-03:00',
            end: '2026-09-21T09:00:00.000-03:00',
            timeZone: 'America/Sao_Paulo',
          },
        },
      ],
    },
  };
}
