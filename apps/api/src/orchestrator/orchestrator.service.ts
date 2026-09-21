import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import type { ChatMessage, LlmResponse } from '../llm/types/types';
import { ObservabilityService } from '../observability/observability.service';
import { SettingsService } from '../settings/settings.service';
import { ToolRegistryService } from '../tools/tool-registry.service';
import { ToolsService } from '../tools/tools.service';
import type { ToolDefinition } from '../tools/tool-registry.types';
import { ORCHESTRATOR_SYSTEM_PROMPT } from './orchestrator.prompt';
import type {
  OrchestratorContext,
  OrchestratorDecision,
  OrchestratorDecisionRecord,
  OrchestratorResult,
  OrchestratorToolExecution,
} from './orchestrator.types';

const DEFAULT_FINAL_INSTRUCTIONS =
  'Responda diretamente à mensagem atual usando o contexto imediato disponível. ' +
  'Não afirme ter consultado fontes que não aparecem no contexto.';

@Injectable()
export class OrchestratorService {
  private readonly logger = new Logger(OrchestratorService.name);

  constructor(
    private readonly llmService: LlmService,
    private readonly settingsService: SettingsService,
    private readonly toolsService: ToolsService,
    private readonly toolRegistry: ToolRegistryService,
    private readonly observabilityService: ObservabilityService,
  ) {}

  async execute(context: OrchestratorContext): Promise<OrchestratorResult> {
    const settings = await this.settingsService.getApplicationSettings();
    const tools = this.toolRegistry.describe();
    const toolExecutions: OrchestratorToolExecution[] = [];
    const decisions: OrchestratorDecisionRecord[] = [];

    for (
      let iteration = 1;
      iteration <= settings.orchestratorMaxIterations;
      iteration += 1
    ) {
      const promptMessages = this.buildPromptMessages(
        context,
        tools,
        toolExecutions,
        iteration,
      );
      const startedAt = new Date();
      const startedAtMs = Date.now();
      let response: LlmResponse;

      try {
        response = await this.llmService.chat({
          combo: settings.orchestratorCombo,
          messages: promptMessages,
          temperature: 0,
        });
      } catch (error) {
        await this.recordDecisionTrace({
          context,
          settings: {
            combo: settings.orchestratorCombo,
          },
          promptMessages,
          startedAt,
          latencyMs: Date.now() - startedAtMs,
          error,
          toolExecutions,
        });
        throw error;
      }

      const latencyMs = Date.now() - startedAtMs;
      const parsed = this.parseDecision(response.content);

      await this.recordDecisionTrace({
        context,
        settings: { combo: settings.orchestratorCombo },
        promptMessages,
        startedAt,
        latencyMs,
        response,
        toolExecutions,
      });

      if (!parsed.decision) {
        decisions.push({
          iteration,
          type: 'finalize',
          status: 'fallback',
        });
        this.logger.warn(
          `Invalid decision protocol at iteration ${iteration}; falling back to finalization.`,
        );

        return this.result(
          context,
          toolExecutions,
          decisions,
          iteration,
          DEFAULT_FINAL_INSTRUCTIONS,
        );
      }

      const decision = parsed.decision;

      if (decision.type === 'finalize') {
        decisions.push({
          iteration,
          type: 'finalize',
          status: 'accepted',
        });

        return this.result(
          context,
          toolExecutions,
          decisions,
          iteration,
          DEFAULT_FINAL_INSTRUCTIONS,
        );
      }

      const toolDecision = this.normalizeToolDecision(
        decision,
        settings.orchestratorToolResultMaxTokens,
        context.conversationId,
      );

      if (toolExecutions.length >= settings.orchestratorMaxToolCalls) {
        decisions.push({
          iteration,
          type: 'safety_limit',
          tool: toolDecision.tool,
          status: 'rejected',
        });

        return this.result(
          context,
          toolExecutions,
          decisions,
          iteration,
          DEFAULT_FINAL_INSTRUCTIONS,
        );
      }

      if (this.hasEquivalentToolExecution(toolExecutions, toolDecision)) {
        decisions.push({
          iteration,
          type: 'tool_call',
          tool: toolDecision.tool,
          status: 'rejected',
        });
        this.logger.warn(
          `Skipping duplicate ${toolDecision.tool} call with unchanged arguments at iteration ${iteration}.`,
        );

        return this.result(
          context,
          toolExecutions,
          decisions,
          iteration,
          DEFAULT_FINAL_INSTRUCTIONS,
        );
      }

      if (!this.toolRegistry.has(toolDecision.tool)) {
        decisions.push({
          iteration,
          type: 'tool_call',
          tool: toolDecision.tool,
          status: 'rejected',
        });
        toolExecutions.push({
          iteration,
          tool: toolDecision.tool,
          arguments: toolDecision.arguments,
          status: 'error',
          error: `Tool ${toolDecision.tool} is not registered.`,
        });
        continue;
      }

      decisions.push({
        iteration,
        type: 'tool_call',
        tool: toolDecision.tool,
        status: 'accepted',
      });
      await this.executeTool(context, iteration, toolDecision, toolExecutions);
    }

    decisions.push({
      iteration: settings.orchestratorMaxIterations,
      type: 'safety_limit',
      status: 'rejected',
    });

    return this.result(
      context,
      toolExecutions,
      decisions,
      settings.orchestratorMaxIterations,
      DEFAULT_FINAL_INSTRUCTIONS,
    );
  }

  private async executeTool(
    context: OrchestratorContext,
    iteration: number,
    decision: Extract<OrchestratorDecision, { type: 'tool_call' }>,
    executions: OrchestratorToolExecution[],
  ): Promise<void> {
    try {
      const execution = await this.toolsService.execute({
        requestId: context.requestId,
        tool: decision.tool,
        input: decision.arguments,
        context: {
          currentConversationId: context.conversationId,
          messages: context.recentMessages,
        },
      });

      executions.push({
        iteration,
        tool: execution.tool,
        arguments: decision.arguments,
        status: 'success',
        result: execution.result,
      });
    } catch (error) {
      executions.push({
        iteration,
        tool: decision.tool,
        arguments: decision.arguments,
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown tool error',
      });
    }
  }

  private hasEquivalentToolExecution(
    executions: OrchestratorToolExecution[],
    decision: Extract<OrchestratorDecision, { type: 'tool_call' }>,
  ): boolean {
    const argumentsKey = this.stableJson(decision.arguments);

    return executions.some(
      (execution) =>
        execution.tool === decision.tool &&
        this.stableJson(execution.arguments) === argumentsKey,
    );
  }

  private normalizeToolDecision(
    decision: Extract<OrchestratorDecision, { type: 'tool_call' }>,
    maxToolResultTokens: number,
    currentConversationId: string,
  ): Extract<OrchestratorDecision, { type: 'tool_call' }> {
    if (decision.tool !== 'conversation_retrieval') {
      return decision;
    }

    const rawConversationId = decision.arguments.conversationId;
    const conversationId =
      typeof rawConversationId === 'string' &&
      this.isUuid(rawConversationId) &&
      rawConversationId.toLowerCase() !== currentConversationId.toLowerCase()
        ? rawConversationId
        : undefined;

    if (rawConversationId !== undefined && !conversationId) {
      this.logger.warn(
        `Ignoring unsafe conversationId from Orchestrator: ${JSON.stringify(rawConversationId)}`,
      );
    }

    const {
      conversationId: _ignoredConversationId,
      ...argumentsWithoutConversationId
    } = decision.arguments;

    const requestedMaxTokens = decision.arguments.maxContextTokens;
    const requestedBudget =
      typeof requestedMaxTokens === 'number' &&
      Number.isInteger(requestedMaxTokens) &&
      requestedMaxTokens > 0
        ? requestedMaxTokens
        : maxToolResultTokens;

    return {
      ...decision,
      arguments: {
        ...argumentsWithoutConversationId,
        ...(conversationId ? { conversationId } : {}),
        // Concatenated chunk content is sufficient for an agentic
        // decision. Structured messages duplicate that content and are
        // intentionally reserved for the explicit test endpoint.
        includeMessages: false,
        maxContextTokens: Math.min(requestedBudget, maxToolResultTokens),
      },
    };
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    );
  }

  private stableJson(value: unknown): string {
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableJson(item)).join(',')}]`;
    }

    if (value && typeof value === 'object') {
      const record = value as Record<string, unknown>;

      return `{${Object.keys(record)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${this.stableJson(record[key])}`)
        .join(',')}}`;
    }

    return JSON.stringify(value) ?? 'undefined';
  }

  private buildPromptMessages(
    context: OrchestratorContext,
    tools: ToolDefinition[],
    toolExecutions: OrchestratorToolExecution[],
    iteration: number,
  ): ChatMessage[] {
    const runtimeState = {
      currentDateTime: context.currentDateTime,
      iteration,
      currentConversationExcludedFromRetrieval: true,
      maxToolCallsReached: false,
      toolCallsExecuted: toolExecutions.length,
      toolExecutions: toolExecutions.map((execution) => ({
        tool: execution.tool,
        arguments: execution.arguments,
        status: execution.status,
        result: execution.result,
        error: execution.error,
      })),
    };

    return [
      { role: 'system', content: ORCHESTRATOR_SYSTEM_PROMPT },
      {
        role: 'system',
        content: `Registered tools:\n${JSON.stringify(tools)}`,
      },
      {
        role: 'system',
        content:
          'Operational state for this iteration. The latest user message is the current request.\n' +
          JSON.stringify(runtimeState),
      },
      ...context.recentMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    ];
  }

  private parseDecision(content: string): {
    decision?: OrchestratorDecision;
  } {
    const json = this.extractDecisionJson(content);

    if (!json) {
      return {};
    }

    try {
      const parsed = JSON.parse(json) as unknown;

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
      }

      const value = parsed as Record<string, unknown>;

      if (value.type === 'finalize') {
        return {
          decision: {
            type: 'finalize',
          },
        };
      }

      if (
        value.type === 'tool_call' &&
        typeof value.tool === 'string' &&
        value.tool.trim() &&
        value.arguments &&
        typeof value.arguments === 'object' &&
        !Array.isArray(value.arguments)
      ) {
        return {
          decision: {
            type: 'tool_call',
            tool: value.tool.trim(),
            arguments: value.arguments as Record<string, unknown>,
          },
        };
      }
    } catch {
      return {};
    }

    return {};
  }

  private extractDecisionJson(content: string): string | undefined {
    const start = content.search(/\{\s*"type"/u);

    if (start < 0) {
      return undefined;
    }

    let depth = 0;
    let quoted = false;
    let escaped = false;

    for (let index = start; index < content.length; index += 1) {
      const character = content[index];

      if (quoted) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          quoted = false;
        }
        continue;
      }

      if (character === '"') {
        quoted = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;

        if (depth === 0) {
          return content.slice(start, index + 1);
        }
      }
    }

    return undefined;
  }

  private async recordDecisionTrace(input: {
    context: OrchestratorContext;
    settings: { combo: string };
    promptMessages: ChatMessage[];
    startedAt: Date;
    latencyMs: number;
    response?: LlmResponse;
    error?: unknown;
    toolExecutions: OrchestratorToolExecution[];
  }): Promise<void> {
    const estimatedInputTokens = this.estimateMessagesTokens(
      input.promptMessages,
    );
    const estimatedOutputTokens = input.response
      ? this.estimateTokens(input.response.content)
      : 0;
    const responseUsage = input.response?.usage;

    await this.observabilityService.recordTrace({
      requestId: input.context.requestId,
      conversationId: input.context.conversationId,
      kind: 'llm',
      status: input.error ? this.traceStatus(input.error) : 'success',
      combo: input.settings.combo,
      model: input.response?.model,
      inputTokens: responseUsage?.inputTokens ?? estimatedInputTokens,
      outputTokens: responseUsage?.outputTokens ?? estimatedOutputTokens,
      totalTokens:
        responseUsage?.totalTokens ??
        estimatedInputTokens + estimatedOutputTokens,
      estimatedInputTokens,
      estimatedOutputTokens,
      latencyMs: input.latencyMs,
      stageDurations: { orchestratorDecision: input.latencyMs },
      contextSnapshot: this.contextSnapshot(
        input.context,
        input.toolExecutions,
      ),
      errorMessage: input.error
        ? input.error instanceof Error
          ? input.error.message
          : 'Unknown Orchestrator error'
        : undefined,
      startedAt: input.startedAt,
      completedAt: new Date(),
    });
  }

  private contextSnapshot(
    context: OrchestratorContext,
    toolExecutions: OrchestratorToolExecution[],
  ) {
    const immediateTokens = this.estimateMessagesTokens(context.recentMessages);
    const toolText = JSON.stringify(toolExecutions);
    const toolTokens = this.estimateTokens(toolText);

    return {
      immediate: {
        messages: context.recentMessages,
        tokens: immediateTokens,
      },
      memory: { items: context.memory.items, tokens: 0 },
      tools: { items: toolExecutions, tokens: toolTokens },
      totalTokens: immediateTokens + toolTokens,
    };
  }

  private result(
    context: OrchestratorContext,
    toolExecutions: OrchestratorToolExecution[],
    decisions: OrchestratorDecisionRecord[],
    iterationCount: number,
    finalInstructions: string,
  ): OrchestratorResult {
    return {
      context,
      toolExecutions,
      decisions,
      iterationCount,
      finalInstructions,
    };
  }

  private estimateMessagesTokens(messages: ChatMessage[]): number {
    return messages.reduce(
      (total, message) =>
        total + this.estimateTokens(`${message.role}: ${message.content}`),
      0,
    );
  }

  private estimateTokens(content: string): number {
    return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
  }

  private traceStatus(error: unknown): 'error' | 'timeout' {
    const message = error instanceof Error ? error.message.toLowerCase() : '';

    return message.includes('timeout') || message.includes('etimedout')
      ? 'timeout'
      : 'error';
  }
}
