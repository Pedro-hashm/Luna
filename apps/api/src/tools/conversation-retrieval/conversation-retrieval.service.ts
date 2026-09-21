import { Injectable, Logger } from '@nestjs/common';
import { ConversationChunkStatus, Prisma } from '@prisma/client';
import { ConversationEmbeddingService } from '../../conversation/conversation-embedding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import {
  ToolArgumentException,
  ToolRuntimeContextException,
} from '../types/tool-errors';
import type { ToolExecutionContext } from '../types/tool.types';
import type {
  ConversationRetrievalInput,
  ConversationRetrievalItem,
  ConversationRetrievalMessage,
  ConversationRetrievalResult,
} from './types/conversation-retrieval.types';

type NormalizedInput = {
  query?: string;
  scope: 'historical' | 'current';
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

type RawChunkCandidate = {
  id: string;
  conversation_id: string;
  content: string;
  status: 'open' | 'closed';
  token_count: number;
  start_message_id: string;
  end_message_id: string;
  score: number;
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
};

@Injectable()
export class ConversationRetrievalService {
  private readonly logger = new Logger(ConversationRetrievalService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: ConversationEmbeddingService,
    private readonly settingsService: SettingsService,
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

    const candidates = normalized.query
      ? await this.findSemanticCandidates(normalized)
      : await this.findDirectCandidates(normalized);

    const results = await this.expandCandidates(candidates, normalized);

    this.logger.log(
      `Retrieved ${results.length} conversation chunk(s) using ${
        normalized.query ? 'semantic' : 'direct'
      } strategy (query=${JSON.stringify(normalized.query ?? null)}, ` +
        `dateFrom=${normalized.dateFrom?.toISOString() ?? 'null'}, ` +
        `dateTo=${normalized.dateTo?.toISOString() ?? 'null'}, ` +
        `timeZone=${normalized.timeZone})`,
    );

    return {
      query: normalized.query ?? null,
      results,
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
    const scope = input.searchCurrentConversation ? 'current' : 'historical';

    if (runtimeConversationId) {
      this.assertRuntimeUuid(runtimeConversationId, 'conversationId');
    }

    if (currentMessageId) {
      this.assertRuntimeUuid(currentMessageId, 'currentMessageId');
    }

    if (scope === 'current') {
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

  private async findSemanticCandidates(
    input: NormalizedInput,
  ): Promise<ChunkCandidate[]> {
    const settings = await this.prisma.conversationChunkSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    const vector = await this.embeddingService.embed(
      input.query ?? '',
      settings.embeddingModel,
      settings.embeddingDimensions,
    );
    const vectorLiteral = this.embeddingService.toVectorLiteral(vector);
    const filters = this.buildSqlFilters(input, true);

    const rows = await this.prisma.$queryRaw<RawChunkCandidate[]>(
      Prisma.sql`
                SELECT
                    cc."id",
                    cc."conversation_id",
                    cc."content",
                    cc."status"::text AS "status",
                    cc."token_count",
                    cc."start_message_id",
                    cc."end_message_id",
                    1 - (cc."embedding" <=> ${vectorLiteral}::vector) AS "score"
                FROM "conversation_chunks" cc
                WHERE ${Prisma.join(filters, ' AND ')}
                ORDER BY cc."embedding" <=> ${vectorLiteral}::vector ASC
                LIMIT ${input.topK}
            `,
    );

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversation_id,
      content: row.content,
      status: row.status,
      tokenCount: Number(row.token_count),
      startMessageId: row.start_message_id,
      endMessageId: row.end_message_id,
      score: Number(row.score),
    }));
  }

  private async findDirectCandidates(
    input: NormalizedInput,
  ): Promise<ChunkCandidate[]> {
    const dateFilter: Prisma.MessageWhereInput = {};

    if (input.dateFrom) {
      dateFilter.createdAt = { gte: input.dateFrom };
    }

    if (input.dateTo) {
      dateFilter.createdAt = {
        ...(dateFilter.createdAt as Prisma.DateTimeFilter | undefined),
        lte: input.dateTo,
      };
    }

    const where: Prisma.ConversationChunkWhereInput = {
      conversationId:
        input.scope === 'current'
          ? input.runtimeConversationId
          : input.runtimeConversationId
            ? { not: input.runtimeConversationId }
            : undefined,
      conversation:
        input.dateFrom || input.dateTo
          ? { messages: { some: dateFilter } }
          : undefined,
      startMessage:
        input.scope === 'current' &&
        input.currentMessageId &&
        input.currentMessageCreatedAt
          ? {
              OR: [
                { createdAt: { lt: input.currentMessageCreatedAt } },
                {
                  createdAt: input.currentMessageCreatedAt,
                  id: { lte: input.currentMessageId },
                },
              ],
            }
          : undefined,
    };

    const chunks = await this.prisma.conversationChunk.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: input.topK,
      select: {
        id: true,
        conversationId: true,
        content: true,
        status: true,
        tokenCount: true,
        startMessageId: true,
        endMessageId: true,
      },
    });

    return chunks.map((chunk) => ({
      ...chunk,
      score: 1,
    }));
  }

  private buildSqlFilters(
    input: NormalizedInput,
    requireEmbedding: boolean,
  ): Prisma.Sql[] {
    const filters: Prisma.Sql[] = [];

    if (requireEmbedding) {
      filters.push(Prisma.sql`cc."embedding" IS NOT NULL`);
    }

    if (input.scope === 'current' && input.runtimeConversationId) {
      filters.push(
        Prisma.sql`cc."conversation_id" = ${input.runtimeConversationId}::uuid`,
      );
    } else if (input.runtimeConversationId) {
      filters.push(
        Prisma.sql`cc."conversation_id" <> ${input.runtimeConversationId}::uuid`,
      );
    }

    if (
      input.scope === 'current' &&
      input.currentMessageId &&
      input.currentMessageCreatedAt
    ) {
      filters.push(Prisma.sql`
        EXISTS (
          SELECT 1
          FROM "messages" chunk_start_message
          WHERE chunk_start_message."id" = cc."start_message_id"
            AND (
              chunk_start_message."created_at" < ${input.currentMessageCreatedAt}
              OR (
                chunk_start_message."created_at" = ${input.currentMessageCreatedAt}
                AND chunk_start_message."id" <= ${input.currentMessageId}::uuid
              )
            )
        )
      `);
    }

    if (input.dateFrom || input.dateTo) {
      filters.push(Prisma.sql`
                EXISTS (
                    SELECT 1
                    FROM "messages" date_range_message
                    WHERE date_range_message."conversation_id" = cc."conversation_id"
                      ${input.dateFrom ? Prisma.sql`AND date_range_message."created_at" >= ${input.dateFrom}` : Prisma.empty}
                      ${input.dateTo ? Prisma.sql`AND date_range_message."created_at" <= ${input.dateTo}` : Prisma.empty}
                )
            `);
    }

    return filters;
  }

  private async expandCandidates(
    candidates: ChunkCandidate[],
    input: NormalizedInput,
  ): Promise<ConversationRetrievalItem[]> {
    const expanded = await Promise.all(
      candidates.map(async (candidate) => ({
        candidate,
        messages: await this.loadCandidateMessages(candidate, input),
      })),
    );
    const results: ConversationRetrievalItem[] = [];
    const seenMessageIds = new Set<string>();
    let remainingTokens = input.maxContextTokens;

    for (const { candidate, messages } of expanded) {
      if (remainingTokens <= 0) {
        break;
      }

      const rendered = this.renderWithinBudget(
        candidate,
        messages,
        remainingTokens,
      );

      if (!rendered) {
        continue;
      }

      remainingTokens -= this.estimateTokens(
        [rendered.content, rendered.tailContent].filter(Boolean).join('\n'),
      );

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
      };

      if (input.includeMessages) {
        result.messages = messages.range
          .filter((message) => {
            if (seenMessageIds.has(message.id)) {
              return false;
            }

            seenMessageIds.add(message.id);
            return true;
          })
          .map((message) => ({ ...message }));
      }

      results.push(result);
    }

    return results;
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
      input.scope === 'current' &&
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
        indexedContent: input.scope === 'current' ? '' : undefined,
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

    return {
      range,
      tail,
      indexedContent:
        input.scope === 'current'
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

    if (messages.indexedContent !== undefined && messages.range.length === 0) {
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
