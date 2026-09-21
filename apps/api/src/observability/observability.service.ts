import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ContextPart,
  ContextSnapshot,
  ConversationInspector,
  ObservabilityMetrics,
  RecordTraceInput,
} from './observability.types';

@Injectable()
export class ObservabilityService {
  private readonly logger = new Logger(ObservabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordTrace(input: RecordTraceInput): Promise<void> {
    try {
      await this.prisma.observabilityTrace.create({
        data: {
          requestId: input.requestId,
          conversationId: input.conversationId,
          responseMessageId: input.responseMessageId,
          kind: input.kind,
          status: input.status,
          toolName: input.toolName,
          combo: input.combo,
          model: input.model,
          inputTokens: input.inputTokens ?? 0,
          outputTokens: input.outputTokens ?? 0,
          totalTokens: input.totalTokens ?? 0,
          estimatedInputTokens: input.estimatedInputTokens ?? 0,
          estimatedOutputTokens: input.estimatedOutputTokens ?? 0,
          latencyMs: Math.max(0, Math.round(input.latencyMs)),
          stageDurations: input.stageDurations as
            Prisma.InputJsonValue | undefined,
          contextSnapshot: input.contextSnapshot as
            Prisma.InputJsonValue | undefined,
          errorMessage: input.errorMessage,
          startedAt: input.startedAt,
          completedAt: input.completedAt,
        },
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Unable to persist observability trace: ${reason}`);
    }
  }

  async getMetrics(
    fromValue?: string,
    toValue?: string,
  ): Promise<ObservabilityMetrics> {
    const to = this.parseDate(toValue) ?? new Date();
    const from =
      this.parseDate(fromValue) ??
      new Date(to.getTime() - 14 * 24 * 60 * 60 * 1000);

    const traces = await this.prisma.observabilityTrace.findMany({
      where: { createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'desc' },
    });
    const llmTraces = traces.filter((trace) => trace.kind === 'llm');
    const toolTraces = traces.filter((trace) => trace.kind === 'tool');
    const successfulOrFailed = traces.filter(
      (trace) => trace.status !== 'timeout',
    );
    const averageLatencyMs = this.average(
      llmTraces.map((trace) => trace.latencyMs),
    );
    const dayMap = new Map<
      string,
      {
        requests: number;
        inputTokens: number;
        outputTokens: number;
        latency: number[];
        errors: number;
      }
    >();
    const stageMap = new Map<string, number[]>();
    const modelMap = new Map<
      string,
      {
        combo: string;
        model: string;
        requests: number;
        latency: number[];
        inputTokens: number;
        outputTokens: number;
      }
    >();

    for (const trace of traces) {
      const day = this.dayKey(trace.createdAt);
      const daily = dayMap.get(day) ?? {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        latency: [],
        errors: 0,
      };
      daily.requests += 1;
      daily.inputTokens += trace.inputTokens;
      daily.outputTokens += trace.outputTokens;
      daily.latency.push(trace.latencyMs);
      if (trace.status !== 'success') {
        daily.errors += 1;
      }
      dayMap.set(day, daily);

      const stages = this.asNumberMap(trace.stageDurations);
      for (const [stage, duration] of Object.entries(stages)) {
        const values = stageMap.get(stage) ?? [];
        values.push(duration);
        stageMap.set(stage, values);
      }

      const modelKey = `${trace.combo ?? '—'}::${trace.model ?? '—'}`;
      const model = modelMap.get(modelKey) ?? {
        combo: trace.combo ?? '—',
        model: trace.model ?? '—',
        requests: 0,
        latency: [],
        inputTokens: 0,
        outputTokens: 0,
      };
      model.requests += 1;
      model.latency.push(trace.latencyMs);
      model.inputTokens += trace.inputTokens;
      model.outputTokens += trace.outputTokens;
      modelMap.set(modelKey, model);
    }

    return {
      period: {
        from: from.toISOString(),
        to: to.toISOString(),
        timeZone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
      },
      summary: {
        requests: traces.length,
        llmRequests: llmTraces.length,
        toolCalls: toolTraces.length,
        inputTokens: successfulOrFailed.reduce(
          (sum, trace) => sum + trace.inputTokens,
          0,
        ),
        outputTokens: successfulOrFailed.reduce(
          (sum, trace) => sum + trace.outputTokens,
          0,
        ),
        totalTokens: successfulOrFailed.reduce(
          (sum, trace) => sum + trace.totalTokens,
          0,
        ),
        averageLatencyMs,
        errors: traces.filter((trace) => trace.status === 'error').length,
        timeouts: traces.filter((trace) => trace.status === 'timeout').length,
      },
      byDay: [...dayMap.entries()]
        .sort(([first], [second]) => first.localeCompare(second))
        .map(([date, value]) => ({
          date,
          requests: value.requests,
          inputTokens: value.inputTokens,
          outputTokens: value.outputTokens,
          averageLatencyMs: this.average(value.latency),
          errors: value.errors,
        })),
      byStage: [...stageMap.entries()]
        .map(([stage, values]) => ({
          stage,
          totalMs: Math.round(values.reduce((sum, value) => sum + value, 0)),
          averageMs: this.average(values),
        }))
        .sort((first, second) => second.totalMs - first.totalMs),
      byModel: [...modelMap.values()]
        .map((value) => ({
          combo: value.combo,
          model: value.model,
          requests: value.requests,
          averageLatencyMs: this.average(value.latency),
          inputTokens: value.inputTokens,
          outputTokens: value.outputTokens,
        }))
        .sort((first, second) => second.requests - first.requests),
      recent: traces.slice(0, 24).map((trace) => ({
        id: trace.id,
        conversationId: trace.conversationId,
        kind: trace.kind,
        status: trace.status,
        toolName: trace.toolName,
        combo: trace.combo,
        model: trace.model,
        latencyMs: trace.latencyMs,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        createdAt: trace.createdAt.toISOString(),
        responseMessageId: trace.responseMessageId,
        errorMessage: trace.errorMessage,
      })),
    };
  }

  async getConversationInspector(
    conversationId: string,
  ): Promise<ConversationInspector> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} was not found`,
      );
    }

    const traces = await this.prisma.observabilityTrace.findMany({
      where: { conversationId },
      include: {
        responseMessage: {
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const firstMessage = conversation.messages[0];
    const lastMessage = conversation.messages.at(-1);
    const toolTraces = traces.filter((trace) => trace.kind === 'tool');
    const memoriesRecovered = toolTraces.reduce(
      (sum, trace) => sum + this.contextMemoryCount(trace.contextSnapshot),
      0,
    );
    const relatedConversationIds = new Set<string>();
    for (const trace of toolTraces) {
      const snapshot = this.asObject(trace.contextSnapshot);
      const ids = snapshot?.relatedConversationIds;
      if (Array.isArray(ids)) {
        for (const id of ids) {
          if (typeof id === 'string' && id !== conversationId) {
            relatedConversationIds.add(id);
          }
        }
      }
    }

    return {
      conversation: {
        id: conversation.id,
        title: conversation.title ?? 'Nova conversa',
        createdAt: conversation.createdAt.toISOString(),
        updatedAt: conversation.updatedAt.toISOString(),
      },
      statistics: {
        messageCount: conversation.messages.length,
        tokenCount: this.estimateTokens(
          conversation.messages.map((message) => message.content).join('\n'),
        ),
        durationMs:
          firstMessage && lastMessage
            ? Math.max(
                0,
                lastMessage.createdAt.getTime() -
                  firstMessage.createdAt.getTime(),
              )
            : 0,
        toolsUsed: toolTraces.length,
        memoriesRecovered,
        relatedConversations: relatedConversationIds.size,
      },
      responses: traces.map((trace) => ({
        traceId: trace.id,
        responseMessageId: trace.responseMessageId,
        response: trace.responseMessage
          ? {
              id: trace.responseMessage.id,
              role: trace.responseMessage.role,
              content: trace.responseMessage.content,
              createdAt: trace.responseMessage.createdAt.toISOString(),
            }
          : null,
        kind: trace.kind,
        status: trace.status,
        toolName: trace.toolName,
        combo: trace.combo,
        model: trace.model,
        inputTokens: trace.inputTokens,
        outputTokens: trace.outputTokens,
        totalTokens: trace.totalTokens,
        estimatedInputTokens: trace.estimatedInputTokens,
        estimatedOutputTokens: trace.estimatedOutputTokens,
        latencyMs: trace.latencyMs,
        stages: this.asNumberMap(trace.stageDurations),
        context: this.asContextSnapshot(trace.contextSnapshot),
        errorMessage: trace.errorMessage,
        createdAt: trace.createdAt.toISOString(),
      })),
    };
  }

  private parseDate(value?: string): Date | undefined {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  private dayKey(date: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: process.env.APP_TIMEZONE ?? 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private average(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    return Math.round(
      values.reduce((sum, value) => sum + value, 0) / values.length,
    );
  }

  private estimateTokens(content: string): number {
    return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
  }

  private asNumberMap(value: unknown): Record<string, number> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(value).filter(
        ([, entry]) => typeof entry === 'number' && Number.isFinite(entry),
      ),
    ) as Record<string, number>;
  }

  private asObject(value: unknown): Record<string, unknown> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    return value as Record<string, unknown>;
  }

  private asContextSnapshot(value: unknown): ContextSnapshot {
    const source = this.asObject(value);

    if (!source) {
      return {};
    }

    const snapshot = { ...source } as ContextSnapshot;
    const system = this.asObject(source.system);
    const items = system?.items;

    if (!Array.isArray(items)) {
      return snapshot;
    }

    const legacyInstructions = items
      .map((item) => this.asObject(item))
      .filter(
        (item): item is Record<string, unknown> =>
          typeof item?.finalInstructions === 'string',
      )
      .map((item) => ({
        type: 'operational_guidance',
        label: 'Instruções operacionais',
        content: item.finalInstructions as string,
      }));

    if (legacyInstructions.length === 0) {
      return snapshot;
    }

    const existingOrchestrator = this.asObject(source.orchestrator) as
      ContextPart | undefined;
    const legacyTokens = typeof system?.tokens === 'number' ? system.tokens : 0;
    snapshot.orchestrator = {
      items: [...(existingOrchestrator?.items ?? []), ...legacyInstructions],
      tokens: existingOrchestrator?.tokens ?? legacyTokens,
    };

    const currentSystemItems = items.filter((item) => {
      const object = this.asObject(item);
      return typeof object?.finalInstructions !== 'string';
    });

    if (currentSystemItems.length > 0) {
      snapshot.system = {
        ...system,
        items: currentSystemItems,
      } as ContextPart;
    } else {
      delete snapshot.system;
    }

    return snapshot;
  }

  private contextMemoryCount(value: unknown): number {
    const snapshot = this.asObject(value);
    const memory = this.asObject(snapshot?.memory);
    const items = memory?.items;
    return Array.isArray(items) ? items.length : 0;
  }
}
