import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConversationChunkStatus, Prisma } from '@prisma/client';
import { ConversationEmbeddingService } from '../../conversation/conversation-embedding.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SettingsService } from '../../settings/settings.service';
import type {
  ConversationRetrievalInput,
  ConversationRetrievalItem,
  ConversationRetrievalMessage,
  ConversationRetrievalResult,
} from './types/conversation-retrieval.types';

type NormalizedInput = {
  query?: string;
  currentConversationId?: string;
  conversationId?: string;
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
  all: ConversationRetrievalMessage[];
  range: ConversationRetrievalMessage[];
  tail: ConversationRetrievalMessage[];
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
  ): Promise<ConversationRetrievalResult> {
    const applicationSettings =
      await this.settingsService.getApplicationSettings();
    const normalized = this.normalizeInput(input, applicationSettings);

    if (
      !normalized.query &&
      !normalized.conversationId &&
      !normalized.dateFrom &&
      !normalized.dateTo
    ) {
      throw new BadRequestException(
        'conversation_retrieval needs a query, conversationId, dateFrom, or dateTo',
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

  private normalizeInput(
    input: ConversationRetrievalInput,
    settings: {
      appTimezone: string;
      retrievalDefaultTopK: number;
      retrievalMaxTopK: number;
      retrievalDefaultMaxContextTokens: number;
      retrievalMaxContextTokens: number;
      retrievalIncludeMessages: boolean;
    },
  ): NormalizedInput {
    const query = this.normalizeOptionalText(input.query);
    let conversationId = this.normalizeOptionalText(input.conversationId);
    const currentConversationId = this.normalizeOptionalText(
      input.currentConversationId,
    );

    if (conversationId) {
      this.assertUuid(conversationId, 'conversationId');
    }

    if (currentConversationId) {
      this.assertUuid(currentConversationId, 'currentConversationId');
    }

    if (
      conversationId &&
      currentConversationId &&
      conversationId.toLowerCase() === currentConversationId.toLowerCase()
    ) {
      this.logger.warn(
        'Ignoring conversationId because it points to the current conversation',
      );
      conversationId = undefined;
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
      throw new BadRequestException('dateFrom must be before dateTo');
    }

    const topK = input.topK ?? settings.retrievalDefaultTopK;
    const maxContextTokens =
      input.maxContextTokens ?? settings.retrievalDefaultMaxContextTokens;

    if (
      !Number.isInteger(topK) ||
      topK < 1 ||
      topK > settings.retrievalMaxTopK
    ) {
      throw new BadRequestException(
        `topK must be an integer between 1 and ${settings.retrievalMaxTopK}`,
      );
    }

    if (
      !Number.isInteger(maxContextTokens) ||
      maxContextTokens < 1 ||
      maxContextTokens > settings.retrievalMaxContextTokens
    ) {
      throw new BadRequestException(
        `maxContextTokens must be an integer between 1 and ${settings.retrievalMaxContextTokens}`,
      );
    }

    if (
      input.includeMessages !== undefined &&
      typeof input.includeMessages !== 'boolean'
    ) {
      throw new BadRequestException('includeMessages must be a boolean');
    }

    return {
      query,
      currentConversationId,
      conversationId,
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
      status: row.status as ConversationChunkStatus,
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
      conversationId: input.conversationId,
      conversation:
        input.dateFrom || input.dateTo
          ? { messages: { some: dateFilter } }
          : undefined,
    };

    if (!input.conversationId && input.currentConversationId) {
      where.conversationId = { not: input.currentConversationId };
    }

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

    if (input.conversationId) {
      filters.push(
        Prisma.sql`cc."conversation_id" = ${input.conversationId}::uuid`,
      );
    } else if (input.currentConversationId) {
      filters.push(
        Prisma.sql`cc."conversation_id" <> ${input.currentConversationId}::uuid`,
      );
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
        messages: await this.loadCandidateMessages(candidate),
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
        break;
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
    const startIndex = all.findIndex(
      (message) => message.id === candidate.startMessageId,
    );
    const endIndex = all.findIndex(
      (message) => message.id === candidate.endMessageId,
    );

    if (startIndex < 0 || endIndex < startIndex) {
      return { all, range: [], tail: [] };
    }

    const indexedEnd = endIndex + 1;
    const range = all.slice(
      startIndex,
      candidate.status === ConversationChunkStatus.open
        ? all.length
        : indexedEnd,
    );
    const tail =
      candidate.status === ConversationChunkStatus.open
        ? all.slice(indexedEnd)
        : [];

    return { all, range, tail };
  }

  private renderWithinBudget(
    candidate: ChunkCandidate,
    messages: CandidateMessages,
    budget: number,
  ): { content: string; tailContent?: string } | undefined {
    if (budget <= 0) {
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
    const content = this.truncateToTokens(candidate.content, contentBudget);

    return {
      content,
      tailContent: tailContent || undefined,
    };
  }

  private normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized || undefined;
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
      throw new BadRequestException(`${field} must be a valid ISO date`);
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
      throw new BadRequestException(`${field} must be a valid ISO date`);
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

  private assertUuid(value: string, field: string): void {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        value,
      )
    ) {
      throw new BadRequestException(`${field} must be a valid UUID`);
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
