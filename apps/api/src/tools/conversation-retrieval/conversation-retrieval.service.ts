import { Injectable, Logger } from '@nestjs/common';
import { ConversationChunkStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { RetrievalEngine } from '../../retrieval/retrieval-engine.service';
import type { RetrievalConfig, RetrievalCandidate } from '../../retrieval/retrieval.types';
import { SettingsService } from '../../settings/settings.service';
import { formatApplicationDateTime } from '../../time/application-time';
import {
  ToolArgumentException,
  ToolRuntimeContextException,
} from '../types/tool-errors';
import type { ToolExecutionContext } from '../types/tool.types';
import type {
  ConversationRetrievalInput,
  ConversationEvidenceReference,
  ConversationRetrievalItem,
  ConversationRetrievalMessage,
  ConversationRetrievalResult,
  ConversationRetrievalScope,
  ConversationRetrievalTimeRange,
} from './types/conversation-retrieval.types';

type NormalizedInput = {
  query?: string;
  scope: ConversationRetrievalScope;
  runtimeConversationId?: string;
  currentMessageId?: string;
  currentMessageCreatedAt?: Date;
  dateFrom?: Date;
  dateTo?: Date;
  topK: number;
  maxContextTokens: number;
  includeMessages: boolean;
  timeZone: string;
};

type ChunkCandidate = {
  id: string;
  conversationId: string;
  content: string;
  status: ConversationChunkStatus;
  tokenCount: number;
  startMessageId: string;
  endMessageId: string;
  score: number;
};

type CandidateMessages = {
  range: ConversationRetrievalMessage[];
  tail: ConversationRetrievalMessage[];
  indexedContent?: string;
  exclusionReason?:
    | 'outside_current_message_visibility'
    | 'source_message_missing'
    | 'no_message_in_date_range';
};

@Injectable()
export class ConversationRetrievalService {
  private readonly logger = new Logger(ConversationRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly retrievalEngine: RetrievalEngine,
  ) {}

  async retrieve(
    input: ConversationRetrievalInput,
    context: ToolExecutionContext,
  ): Promise<ConversationRetrievalResult> {
    const applicationSettings =
      await this.settingsService.getApplicationSettings();
    const normalized = await this.normalizeInput(
      input,
      context,
      applicationSettings,
    );

    if (!normalized.query && !normalized.dateFrom && !normalized.dateTo) {
      throw new ToolArgumentException(
        'query',
        'conversation_retrieval needs a query, dateFrom, or dateTo',
      );
    }

    const retrievalConfig = this.retrievalConfiguration(applicationSettings);
    const retrieval = await this.retrievalEngine.retrieve(
      {
        query: normalized.query,
        filters: this.toRetrievalFilters(normalized),
        limit: normalized.topK,
        maxContextTokens: normalized.maxContextTokens,
      },
      retrievalConfig,
    );
    const candidates = retrieval.candidates.map((candidate) =>
      this.toChunkCandidate(candidate),
    );

    const expansion = await this.expandCandidates(candidates, normalized);
    const results = expansion.results;
    const conversationDiagnostics = {
      scope: normalized.scope,
      dateFrom: normalized.dateFrom?.toISOString() ?? null,
      dateTo: normalized.dateTo?.toISOString() ?? null,
      maxContextTokens: normalized.maxContextTokens,
      includeMessages: normalized.includeMessages,
      stages: {
        messageExpansion: expansion.messageExpansion,
        resultAssembly: expansion.resultAssembly,
      },
      references: expansion.references,
      counts: {
        retrievalCandidates: candidates.length,
        returnedResults: results.length,
        excludedCandidates: expansion.candidates.filter(
          (candidate) => candidate.outcome === 'excluded',
        ).length,
      },
      candidates: expansion.candidates,
    };

    this.logger.log(
      `Retrieved ${results.length} conversation chunk(s) using ${
        normalized.query ? retrievalConfig.strategy : 'filters-only'
      } strategy (query=${JSON.stringify(normalized.query ?? null)}, ` +
        `dateFrom=${normalized.dateFrom?.toISOString() ?? 'null'}, ` +
        `dateTo=${normalized.dateTo?.toISOString() ?? 'null'}, ` +
        `scope=${normalized.scope}, ` +
        `timeZone=${normalized.timeZone}, ` +
        `vectorTopK=${retrievalConfig.vectorTopK}, ` +
        `lexicalTopK=${retrievalConfig.lexicalTopK}, ` +
        `reranker=${retrievalConfig.rerankerEnabled ? retrievalConfig.rerankerModel : 'disabled'})`,
    );

    const result: ConversationRetrievalResult = {
      query: normalized.query ?? null,
      results,
    };
    Object.defineProperty(result, '__retrievalDiagnostics', {
      value: retrieval.diagnostics,
      enumerable: false,
    });
    Object.defineProperty(result, '__conversationDiagnostics', {
      value: conversationDiagnostics,
      enumerable: false,
    });
    return result;
  }

  private retrievalConfiguration(settings: {
    retrievalStrategy: string;
    retrievalVectorTopK: number;
    retrievalLexicalTopK: number;
    retrievalRrfK: number;
    retrievalCandidatePoolTopK: number;
    retrievalRerankerEnabled: boolean;
    retrievalRerankerModel: string;
    retrievalRerankerTopK: number;
    retrievalRerankerThreshold: number;
    retrievalDeduplicationEnabled: boolean;
    retrievalDeduplicationThreshold: number;
  }): RetrievalConfig {
    return {
      strategy: settings.retrievalStrategy as RetrievalConfig['strategy'],
      vectorTopK: settings.retrievalVectorTopK,
      lexicalTopK: settings.retrievalLexicalTopK,
      rrfK: settings.retrievalRrfK,
      candidatePoolTopK: settings.retrievalCandidatePoolTopK,
      rerankerEnabled: settings.retrievalRerankerEnabled,
      rerankerModel: settings.retrievalRerankerModel as RetrievalConfig['rerankerModel'],
      rerankerTopK: settings.retrievalRerankerTopK,
      rerankerThreshold: settings.retrievalRerankerThreshold,
      deduplicationEnabled: settings.retrievalDeduplicationEnabled,
      deduplicationThreshold: settings.retrievalDeduplicationThreshold,
    };
  }

  private toRetrievalFilters(input: NormalizedInput): Record<string, unknown> {
    return {
      includeConversationId:
        input.scope === 'current_conversation'
          ? input.runtimeConversationId
          : undefined,
      excludeConversationId:
        input.scope === 'historical'
          ? input.runtimeConversationId
          : undefined,
      runtimeConversationId:
        input.scope !== 'historical' ? input.runtimeConversationId : undefined,
      currentMessageId:
        input.scope !== 'historical' ? input.currentMessageId : undefined,
      currentMessageCreatedAt:
        input.scope !== 'historical' ? input.currentMessageCreatedAt : undefined,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
    };
  }

  private toChunkCandidate(candidate: RetrievalCandidate): ChunkCandidate {
    const metadata = candidate.metadata;
    return {
      id: candidate.id,
      conversationId: String(metadata.conversationId),
      content: candidate.content,
      status: metadata.status as ConversationChunkStatus,
      tokenCount: Number(metadata.tokenCount),
      startMessageId: String(metadata.startMessageId),
      endMessageId: String(metadata.endMessageId),
      score:
        candidate.rerankerScore ??
        candidate.rrfScore ??
        candidate.vectorScore ??
        candidate.lexicalScore ??
        1,
    };
  }

  private async normalizeInput(
    input: ConversationRetrievalInput,
    context: ToolExecutionContext,
    settings: {
      appTimezone: string;
      retrievalDefaultTopK: number;
      retrievalMaxTopK: number;
      retrievalDefaultMaxContextTokens: number;
      retrievalMaxContextTokens: number;
      retrievalIncludeMessages: boolean;
    },
  ): Promise<NormalizedInput> {
    const query = this.normalizeOptionalText(input.query);
    const runtimeConversationId = this.normalizeOptionalText(
      context.conversationId,
    );
    const currentMessageId = this.normalizeOptionalText(
      context.currentMessageId,
    );
    let currentMessageCreatedAt: Date | undefined;
    const scope = input.scope ?? 'auto';

    if (runtimeConversationId) {
      this.assertRuntimeUuid(runtimeConversationId, 'conversationId');
    }

    if (currentMessageId) {
      this.assertRuntimeUuid(currentMessageId, 'currentMessageId');
    }

    if (scope === 'current_conversation') {
      if (!runtimeConversationId || !currentMessageId) {
        throw new ToolRuntimeContextException(
          'Current-conversation retrieval requires conversationId and currentMessageId from the runtime.',
        );
      }

      const currentMessage = await this.prisma.message.findUnique({
        where: { id: currentMessageId },
        select: { conversationId: true, createdAt: true },
      });

      if (
        !currentMessage ||
        currentMessage.conversationId !== runtimeConversationId
      ) {
        throw new ToolRuntimeContextException(
          'currentMessageId does not belong to the runtime conversation.',
        );
      }

      currentMessageCreatedAt = currentMessage.createdAt;
    } else if (scope === 'auto' && runtimeConversationId && currentMessageId) {
      const currentMessage = await this.prisma.message.findUnique({
        where: { id: currentMessageId },
        select: { conversationId: true, createdAt: true },
      });

      if (currentMessage?.conversationId === runtimeConversationId) {
        currentMessageCreatedAt = currentMessage.createdAt;
      }
    }

    const dateFrom = this.parseDate(
      input.dateFrom,
      'dateFrom',
      false,
      settings.appTimezone,
    );
    const dateTo = this.parseDate(
      input.dateTo,
      'dateTo',
      true,
      settings.appTimezone,
    );

    if (dateFrom && dateTo && dateFrom > dateTo) {
      throw new ToolArgumentException(
        'dateFrom',
        'dateFrom must be before dateTo',
      );
    }

    const topK = settings.retrievalDefaultTopK;
    const maxContextTokens =
      input.maxContextTokens ?? settings.retrievalDefaultMaxContextTokens;

    if (
      !Number.isInteger(topK) ||
      topK < 1 ||
      topK > settings.retrievalMaxTopK
    ) {
      throw new ToolRuntimeContextException(
        'Configured retrievalDefaultTopK is outside the allowed range.',
      );
    }

    if (
      !Number.isInteger(maxContextTokens) ||
      maxContextTokens < 1 ||
      maxContextTokens > settings.retrievalMaxContextTokens
    ) {
      throw new ToolArgumentException(
        'maxContextTokens',
        `maxContextTokens must be an integer between 1 and ${settings.retrievalMaxContextTokens}`,
      );
    }

    if (
      input.includeMessages !== undefined &&
      typeof input.includeMessages !== 'boolean'
    ) {
      throw new ToolArgumentException(
        'includeMessages',
        'includeMessages must be a boolean',
      );
    }

    return {
      query,
      scope,
      runtimeConversationId,
      currentMessageId,
      currentMessageCreatedAt,
      dateFrom,
      dateTo,
      topK,
      maxContextTokens,
      includeMessages:
        input.includeMessages ?? settings.retrievalIncludeMessages,
      timeZone: settings.appTimezone,
    };
  }

  private async expandCandidates(
    candidates: ChunkCandidate[],
    input: NormalizedInput,
  ): Promise<{
    results: ConversationRetrievalItem[];
    messageExpansion: { count: number; latencyMs: number };
    resultAssembly: { count: number; latencyMs: number };
    candidates: Array<{
      chunkId: string;
      outcome: 'returned' | 'excluded';
      reason?:
        | 'outside_current_message_visibility'
        | 'source_message_missing'
        | 'no_message_in_date_range'
        | 'context_budget';
      sourceMessageCount: number;
      returnedMessageCount: number;
      resultTokens?: number;
    }>;
    references: ConversationEvidenceReference[];
  }> {
    const expansionStartedAt = Date.now();
    const expanded = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        messages: await this.loadCandidateMessages(candidate, input),
      })),
    );
    const messageExpansion = {
      count: expanded.length,
      latencyMs: Date.now() - expansionStartedAt,
    };
    const assemblyStartedAt = Date.now();
    const results: ConversationRetrievalItem[] = [];
    const candidateDiagnostics: Array<{
      chunkId: string;
      outcome: 'returned' | 'excluded';
      reason?:
        | 'outside_current_message_visibility'
        | 'source_message_missing'
        | 'no_message_in_date_range'
        | 'context_budget';
      sourceMessageCount: number;
      returnedMessageCount: number;
      resultTokens?: number;
    }> = [];
    const references: ConversationEvidenceReference[] = [];
    const seenMessageIds = new Set<string>();
    let remainingTokens = input.maxContextTokens;

    for (const { candidate, messages } of expanded) {
      if (remainingTokens <= 0) {
        candidateDiagnostics.push({
          chunkId: candidate.id,
          outcome: 'excluded',
          reason: 'context_budget',
          sourceMessageCount: messages.range.length,
          returnedMessageCount: 0,
        });
        continue;
      }

      // A chunk can be selected from a conversation that has a matching date,
      // while this particular chunk has no message inside that window. Never
      // return its indexed text as evidence for a date-bounded retrieval.
      if (messages.range.length === 0) {
        candidateDiagnostics.push({
          chunkId: candidate.id,
          outcome: 'excluded',
          reason: messages.exclusionReason ?? 'source_message_missing',
          sourceMessageCount: 0,
          returnedMessageCount: 0,
        });
        continue;
      }

      const rendered = this.renderWithinBudget(
        candidate,
        messages,
        remainingTokens,
      );

      if (!rendered) {
        candidateDiagnostics.push({
          chunkId: candidate.id,
          outcome: 'excluded',
          reason: 'context_budget',
          sourceMessageCount: messages.range.length,
          returnedMessageCount: 0,
        });
        continue;
      }

      const resultTokens = this.estimateTokens(
        [rendered.content, rendered.tailContent].filter(Boolean).join('\n'),
      );
      remainingTokens -= resultTokens;

      const result: ConversationRetrievalItem = {
        conversationId: candidate.conversationId,
        chunkId: candidate.id,
        status: candidate.status,
        score: candidate.score,
        content: rendered.content,
        tailContent: rendered.tailContent,
        startMessageId: candidate.startMessageId,
        endMessageId: candidate.endMessageId,
        tokenCount: candidate.tokenCount,
        timeRange: this.describeTimeRange(messages.range, input.timeZone),
      };

      if (input.includeMessages) {
        let returnedMessageCount = 0;
        result.messages = messages.range
          .filter((message) => {
            if (seenMessageIds.has(message.id)) {
              return false;
            }

            seenMessageIds.add(message.id);
            returnedMessageCount += 1;
            return true;
          })
          .map((message) => ({ ...message }));
        candidateDiagnostics.push({
          chunkId: candidate.id,
          outcome: 'returned',
          sourceMessageCount: messages.range.length,
          returnedMessageCount,
          resultTokens,
        });
      } else {
        candidateDiagnostics.push({
          chunkId: candidate.id,
          outcome: 'returned',
          sourceMessageCount: messages.range.length,
          returnedMessageCount: 0,
          resultTokens,
        });
      }

      results.push(result);
      const firstSourceMessage = messages.range[0];
      const lastSourceMessage = messages.range[messages.range.length - 1];
      references.push({
        conversationId: candidate.conversationId,
        chunkId: candidate.id,
        startMessageId: firstSourceMessage.id,
        endMessageId: lastSourceMessage.id,
        messageIds: messages.range.map((message) => message.id),
        startAt: firstSourceMessage.createdAt.toISOString(),
        endAt: lastSourceMessage.createdAt.toISOString(),
        dates: [...new Set(messages.range.map((message) =>
          formatApplicationDateTime(message.createdAt, input.timeZone).slice(0, 10),
        ))].sort(),
      });
    }

    return {
      results,
      messageExpansion,
      resultAssembly: {
        count: results.length,
        latencyMs: Date.now() - assemblyStartedAt,
      },
      candidates: candidateDiagnostics,
      references,
    };
  }

  private async loadCandidateMessages(
    candidate: ChunkCandidate,
    input: NormalizedInput,
  ): Promise<CandidateMessages> {
    const all = await this.prisma.message.findMany({
      where: { conversationId: candidate.conversationId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
      },
    });
    const visible =
      input.scope !== 'historical' &&
      candidate.conversationId === input.runtimeConversationId
        ? this.messagesUpToCurrentMessage(all, input.currentMessageId)
        : all;
    const startIndex = visible.findIndex(
      (message) => message.id === candidate.startMessageId,
    );
    const endIndex = visible.findIndex(
      (message) => message.id === candidate.endMessageId,
    );

    if (startIndex < 0) {
      return {
        range: [],
        tail: [],
        exclusionReason:
          input.scope !== 'historical' &&
          candidate.conversationId === input.runtimeConversationId
            ? 'outside_current_message_visibility'
            : 'source_message_missing',
        indexedContent:
          input.scope !== 'historical' &&
          candidate.conversationId === input.runtimeConversationId
            ? ''
            : undefined,
      };
    }

    const indexedEnd = endIndex >= startIndex ? endIndex + 1 : visible.length;
    const indexedMessages = visible.slice(startIndex, indexedEnd);
    const isOpen = candidate.status === ConversationChunkStatus.open;
    const range = visible.slice(
      startIndex,
      isOpen || endIndex < startIndex ? visible.length : indexedEnd,
    );
    const tail =
      isOpen && endIndex >= startIndex ? visible.slice(indexedEnd) : [];
    const hasDateFilter =
      input.dateFrom !== undefined || input.dateTo !== undefined;
    const resultRange = hasDateFilter
      ? this.restrictToDateRange(range, input)
      : range;

    return {
      range: resultRange,
      exclusionReason:
        resultRange.length === 0 && hasDateFilter
          ? 'no_message_in_date_range'
          : undefined,
      // For a date-bounded request the complete visible range is rebuilt from
      // matching messages below. Keeping a separate tail would either duplicate
      // messages or reintroduce content outside the requested period.
      tail: hasDateFilter ? [] : tail,
      indexedContent: hasDateFilter
        ? resultRange.map((message) => this.formatMessage(message)).join('\n')
        : input.scope !== 'historical' &&
            candidate.conversationId === input.runtimeConversationId
          ? indexedMessages
              .map((message) => this.formatMessage(message))
              .join('\n')
          : undefined,
    };
  }

  private renderWithinBudget(
    candidate: ChunkCandidate,
    messages: CandidateMessages,
    budget: number,
  ): { content: string; tailContent?: string } | undefined {
    if (budget <= 0) {
      return undefined;
    }

    if (messages.range.length === 0) {
      return undefined;
    }

    const tailText = messages.tail.map((message) =>
      this.formatMessage(message),
    );
    const tailContent = tailText.join('\n');
    const tailTokens = this.estimateTokens(tailContent);

    if (tailContent && tailTokens >= budget) {
      return {
        content: '',
        tailContent: this.truncateToTokens(tailContent, budget),
      };
    }

    const contentBudget = Math.max(1, budget - (tailContent ? tailTokens : 0));
    const content = this.truncateToTokens(
      messages.indexedContent ?? candidate.content,
      contentBudget,
    );

    return {
      content,
      tailContent: tailContent || undefined,
    };
  }

  private restrictToDateRange(
    messages: ConversationRetrievalMessage[],
    input: NormalizedInput,
  ): ConversationRetrievalMessage[] {
    return messages.filter((message) => {
      if (input.dateFrom && message.createdAt < input.dateFrom) {
        return false;
      }

      if (input.dateTo && message.createdAt > input.dateTo) {
        return false;
      }

      return true;
    });
  }

  private describeTimeRange(
    messages: ConversationRetrievalMessage[],
    timeZone: string,
  ): ConversationRetrievalTimeRange {
    const first = messages[0];
    const last = messages[messages.length - 1];

    // expandCandidates only calls this after checking range.length, but the
    // guard keeps this helper total if it is reused later.
    if (!first || !last) {
      throw new ToolRuntimeContextException(
        'A retrieved result must have at least one source message.',
      );
    }

    return {
      start: formatApplicationDateTime(first.createdAt, timeZone),
      end: formatApplicationDateTime(last.createdAt, timeZone),
      timeZone,
    };
  }

  private normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
  }

  private messagesUpToCurrentMessage(
    messages: ConversationRetrievalMessage[],
    currentMessageId: string | undefined,
  ): ConversationRetrievalMessage[] {
    if (!currentMessageId) {
      return [];
    }

    const currentIndex = messages.findIndex(
      (message) => message.id === currentMessageId,
    );

    return currentIndex < 0 ? [] : messages.slice(0, currentIndex + 1);
  }

  private parseDate(
    value: string | undefined,
    field: string,
    endOfDay = false,
    timeZone: string,
  ): Date | undefined {
    if (!value) {
      return undefined;
    }

    const calendarDateMatch = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);

    if (calendarDateMatch) {
      return this.parseCalendarDate(
        Number(calendarDateMatch[1]),
        Number(calendarDateMatch[2]),
        Number(calendarDateMatch[3]),
        endOfDay,
        field,
        timeZone,
      );
    }

    const parsed = new Date(value);

    if (Number.isNaN(parsed.getTime())) {
      throw new ToolArgumentException(
        field,
        `${field} must be a valid ISO date`,
      );
    }

    return parsed;
  }

  private parseCalendarDate(
    year: number,
    month: number,
    day: number,
    endOfDay: boolean,
    field: string,
    timeZone: string,
  ): Date {
    const hour = endOfDay ? 23 : 0;
    const minute = endOfDay ? 59 : 0;
    const second = endOfDay ? 59 : 0;
    const millisecond = endOfDay ? 999 : 0;
    const localAsUtc = Date.UTC(
      year,
      month - 1,
      day,
      hour,
      minute,
      second,
      millisecond,
    );

    const parsed = new Date(
      localAsUtc -
        this.timeZoneOffsetMilliseconds(new Date(localAsUtc), timeZone),
    );

    if (Number.isNaN(parsed.getTime())) {
      throw new ToolArgumentException(
        field,
        `${field} must be a valid ISO date`,
      );
    }

    return parsed;
  }

  private timeZoneOffsetMilliseconds(date: Date, timeZone: string): number {
    const dateWithoutMilliseconds = new Date(
      Math.floor(date.getTime() / 1_000) * 1_000,
    );
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const values = new Map(
      parts
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, Number(part.value)]),
    );
    const renderedAsUtc = Date.UTC(
      values.get('year') ?? 0,
      (values.get('month') ?? 1) - 1,
      values.get('day') ?? 1,
      values.get('hour') ?? 0,
      values.get('minute') ?? 0,
      values.get('second') ?? 0,
    );

    return renderedAsUtc - dateWithoutMilliseconds.getTime();
  }

  private assertRuntimeUuid(value: string, field: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      )
    ) {
      throw new ToolRuntimeContextException(
        `${field} must be a valid UUID when supplied by the runtime.`,
      );
    }
  }

  private formatMessage(message: ConversationRetrievalMessage): string {
    return `${message.role}: ${message.content}`;
  }

  private estimateTokens(content: string): number {
    return content ? Math.max(1, Math.ceil(content.length / 4)) : 0;
  }

  private truncateToTokens(content: string, tokenLimit: number): string {
    if (!content || tokenLimit <= 0) {
      return '';
    }

    const maxCharacters = tokenLimit * 4;

    if (content.length <= maxCharacters) {
      return content;
    }

    return `${content.slice(0, Math.max(1, maxCharacters - 1)).trimEnd()}…`;
  }
}
