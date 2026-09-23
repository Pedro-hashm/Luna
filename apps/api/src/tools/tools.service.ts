import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ObservabilityService } from '../observability/observability.service';
import { SettingsService } from '../settings/settings.service';
import { formatApplicationDateTime } from '../time/application-time';
import { ToolRegistryService } from './tool-registry.service';
import type {
  ExecuteToolRequest,
  ExecuteToolResponse,
  ToolExecutionContext,
} from './types/tool.types';

@Injectable()
export class ToolsService {
  constructor(
    private readonly toolRegistry: ToolRegistryService,
    private readonly observabilityService: ObservabilityService,
    private readonly settingsService: SettingsService,
  ) {}

  async execute(request: ExecuteToolRequest): Promise<ExecuteToolResponse> {
    if (!this.toolRegistry.has(request.tool)) {
      throw new BadRequestException(
        `Unknown tool: ${request.tool || '(missing)'}`,
      );
    }

    const tool = request.tool;
    const rawInput = this.asRecord(request.input);
    const context = await this.normalizeContext(request.context);
    const input = {
      ...rawInput,
    };
    const startedAt = new Date();
    const startedAtMs = Date.now();
    const requestId = request.requestId ?? randomUUID();
    const estimatedInputTokens = this.estimateTokens(
      context.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join('\n') +
        (typeof input.query === 'string' ? `\nquery: ${input.query}` : ''),
    );

    try {
      const result = await this.toolRegistry.execute(tool, input, context);
      const retrievalDiagnostics = result.__retrievalDiagnostics;
      const conversationDiagnostics = result.__conversationDiagnostics;
      const modelFacingResult = { ...result };
      delete modelFacingResult.__retrievalDiagnostics;
      delete modelFacingResult.__conversationDiagnostics;
      const resultText = result.results
        .map((item) => `${item.content}\n${item.tailContent ?? ''}`)
        .join('\n');
      const estimatedOutputTokens = this.estimateTokens(resultText);
      const relatedConversationIds = [
        ...new Set(result.results.map((item) => item.conversationId)),
      ];

      await this.observabilityService.recordTrace({
        requestId,
        conversationId: context.conversationId,
        kind: 'tool',
        status: 'success',
        toolName: tool,
        inputTokens: estimatedInputTokens,
        outputTokens: estimatedOutputTokens,
        totalTokens: estimatedInputTokens + estimatedOutputTokens,
        estimatedInputTokens,
        estimatedOutputTokens,
        latencyMs: Date.now() - startedAtMs,
        stageDurations: {
          execution: Date.now() - startedAtMs,
          ...this.retrievalStageDurations(retrievalDiagnostics),
          ...this.conversationStageDurations(conversationDiagnostics),
        },
        contextSnapshot: {
          immediate: {
            messages: context.messages,
            tokens: this.estimateTokens(
              context.messages
                .map((message) => `${message.role}: ${message.content}`)
                .join('\n'),
            ),
          },
          memory: { items: [], tokens: 0 },
          tools: {
            items: [
              {
                name: tool,
                status: 'success',
                input,
                result: modelFacingResult,
                resultCount: result.results.length,
                retrieval: retrievalDiagnostics,
                conversationRetrieval: conversationDiagnostics,
              },
            ],
            tokens: estimatedOutputTokens,
          },
          relatedConversationIds,
          totalTokens: estimatedInputTokens + estimatedOutputTokens,
        },
        startedAt,
        completedAt: new Date(),
      });

      return { tool, context, result: modelFacingResult };
    } catch (error) {
      const retrievalDiagnostics = this.retrievalDiagnosticsFromError(error);
      await this.observabilityService.recordTrace({
        requestId,
        conversationId: context.conversationId,
        kind: 'tool',
        status: this.traceStatus(error),
        toolName: tool,
        inputTokens: estimatedInputTokens,
        totalTokens: estimatedInputTokens,
        estimatedInputTokens,
        latencyMs: Date.now() - startedAtMs,
        stageDurations: {
          execution: Date.now() - startedAtMs,
          ...this.retrievalStageDurations(retrievalDiagnostics),
        },
        contextSnapshot: {
          immediate: {
            messages: context.messages,
            tokens: estimatedInputTokens,
          },
          tools: {
          items: [
            {
              name: tool,
              status: this.traceStatus(error),
              input,
              error: error instanceof Error ? error.message : 'unknown error',
              retrieval: retrievalDiagnostics,
            },
          ],
            tokens: 0,
          },
          totalTokens: estimatedInputTokens,
        },
        errorMessage: error instanceof Error ? error.message : 'unknown error',
        startedAt,
        completedAt: new Date(),
      });
      throw error;
    }
  }

  private retrievalStageDurations(
    diagnostics:
      | NonNullable<ExecuteToolResponse['result']['__retrievalDiagnostics']>
      | undefined,
  ): Record<string, number> {
    if (!diagnostics?.stages) return {};
    return Object.fromEntries(
      Object.entries(diagnostics.stages).map(([stage, value]) => [
        `retrieval.${stage}`,
        value.latencyMs,
      ]),
    );
  }

  private conversationStageDurations(
    diagnostics:
      | NonNullable<ExecuteToolResponse['result']['__conversationDiagnostics']>
      | undefined,
  ): Record<string, number> {
    if (!diagnostics?.stages) return {};
    return Object.fromEntries(
      Object.entries(diagnostics.stages).map(([stage, value]) => [
        `conversation_retrieval.${stage}`,
        value.latencyMs,
      ]),
    );
  }

  private retrievalDiagnosticsFromError(error: unknown) {
    if (!error || typeof error !== 'object' || !('retrievalDiagnostics' in error)) {
      return undefined;
    }
    return error.retrievalDiagnostics as NonNullable<
      ExecuteToolResponse['result']['__retrievalDiagnostics']
    >;
  }

  private async normalizeContext(
    context: ExecuteToolRequest['context'],
  ): Promise<ToolExecutionContext> {
    const suppliedCurrentDateTime = this.optionalString(
      context?.currentDateTime,
    );
    const settings = suppliedCurrentDateTime
      ? undefined
      : await this.settingsService.getApplicationSettings();

    return {
      conversationId: this.optionalString(context?.conversationId),
      currentMessageId: this.optionalString(context?.currentMessageId),
      currentDateTime:
        suppliedCurrentDateTime ??
        formatApplicationDateTime(new Date(), settings!.appTimezone),
      messages: Array.isArray(context?.messages) ? context.messages : [],
    };
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (!value) {
      return {};
    }

    if (typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Tool input must be an object');
    }

    return value as Record<string, unknown>;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
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
