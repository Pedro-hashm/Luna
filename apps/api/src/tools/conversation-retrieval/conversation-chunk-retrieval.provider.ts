import { Injectable } from '@nestjs/common';
import { ConversationChunkStatus, Prisma } from '@prisma/client';
import { ConversationEmbeddingService } from '../../conversation/conversation-embedding.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { RetrievalCandidate, RetrievalQuery, Retriever } from '../../retrieval/retrieval.types';
import type { ConversationEvidenceReference } from './types/conversation-retrieval.types';

type RawChunk = {
  id: string;
  conversation_id: string;
  content: string;
  status: 'open' | 'closed';
  token_count: number;
  start_message_id: string;
  end_message_id: string;
  score: number;
};

type ConversationFilters = {
  includeConversationId?: string;
  excludeConversationId?: string;
  runtimeConversationId?: string;
  currentMessageId?: string;
  currentMessageCreatedAt?: Date;
  dateFrom?: Date;
  dateTo?: Date;
};

@Injectable()
export class ConversationChunkRetrievalProvider implements Retriever {
  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: ConversationEmbeddingService,
  ) {}

  /** Expands a persisted source range by message order; this never runs semantic retrieval. */
  async expandEvidenceReference(
    reference: ConversationEvidenceReference,
    direction: 'before' | 'after' | 'both',
    adjacentLimit: number,
  ): Promise<Array<{ id: string; role: string; content: string; createdAt: Date }>> {
    const anchor = await this.prisma.message.findMany({
      where: {
        conversationId: reference.conversationId,
        id: { in: reference.messageIds },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, role: true, content: true, createdAt: true },
    });
    if (!anchor.length) return [];

    const first = anchor[0];
    const last = anchor[anchor.length - 1];
    const [before, after] = await Promise.all([
      direction === 'after' ? Promise.resolve([]) : this.prisma.message.findMany({
        where: {
          conversationId: reference.conversationId,
          OR: [
            { createdAt: { lt: first.createdAt } },
            { createdAt: first.createdAt, id: { lt: first.id } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: adjacentLimit,
        select: { id: true, role: true, content: true, createdAt: true },
      }),
      direction === 'before' ? Promise.resolve([]) : this.prisma.message.findMany({
        where: {
          conversationId: reference.conversationId,
          OR: [
            { createdAt: { gt: last.createdAt } },
            { createdAt: last.createdAt, id: { gt: last.id } },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: adjacentLimit,
        select: { id: true, role: true, content: true, createdAt: true },
      }),
    ]);

    const surrounding = [
      ...(direction === 'after' ? [] : before.reverse()),
      ...(direction === 'both' ? anchor : []),
      ...after,
    ];
    const unique = new Map(surrounding.map((message) => [message.id, message]));
    return [...unique.values()].sort((a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
    );
  }

  async retrieveVector(
    query: RetrievalQuery,
    topK: number,
  ): Promise<RetrievalCandidate[]> {
    if (!query.query) return [];
    const settings = await this.prisma.conversationChunkSettings.upsert({
      where: { id: 1 },
      update: {},
      create: { id: 1 },
    });
    const vector = await this.embeddings.embed(
      query.query,
      settings.embeddingModel,
      settings.embeddingDimensions,
    );
    const vectorLiteral = this.embeddings.toVectorLiteral(vector);
    const filters = this.buildSqlFilters(query.filters, true);
    const rows = await this.prisma.$queryRaw<RawChunk[]>(Prisma.sql`
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
      ORDER BY cc."embedding" <=> ${vectorLiteral}::vector ASC, cc."id" ASC
      LIMIT ${topK}
    `);
    return rows.map((row, index) => this.toCandidate(row, 'vector', index + 1));
  }

  async retrieveLexical(
    query: RetrievalQuery,
    topK: number,
  ): Promise<RetrievalCandidate[]> {
    if (!query.query) return [];
    const filters = this.buildSqlFilters(query.filters, false);
    const lexicalQuery = Prisma.sql`websearch_to_tsquery('simple'::regconfig, ${query.query})`;
    const exactPhrase = Prisma.sql`position(lower(${query.query}) in lower(cc."content")) > 0`;
    const rows = await this.prisma.$queryRaw<RawChunk[]>(Prisma.sql`
      SELECT
        cc."id",
        cc."conversation_id",
        cc."content",
        cc."status"::text AS "status",
        cc."token_count",
        cc."start_message_id",
        cc."end_message_id",
        ts_rank_cd(
          to_tsvector('simple'::regconfig, cc."content"),
          ${lexicalQuery}
        ) + CASE WHEN ${exactPhrase} THEN 1 ELSE 0 END AS "score"
      FROM "conversation_chunks" cc
      WHERE ${Prisma.join(filters, ' AND ')}
        AND (
          to_tsvector('simple'::regconfig, cc."content") @@ ${lexicalQuery}
          OR ${exactPhrase}
        )
      ORDER BY ${exactPhrase} DESC, "score" DESC, cc."id" ASC
      LIMIT ${topK}
    `);
    return rows.map((row, index) => this.toCandidate(row, 'lexical', index + 1));
  }

  async retrieveFiltered(
    query: RetrievalQuery,
    topK: number,
  ): Promise<RetrievalCandidate[]> {
    const filters = this.buildSqlFilters(query.filters, false);
    const rows = await this.prisma.$queryRaw<RawChunk[]>(Prisma.sql`
      SELECT
        cc."id",
        cc."conversation_id",
        cc."content",
        cc."status"::text AS "status",
        cc."token_count",
        cc."start_message_id",
        cc."end_message_id",
        1::double precision AS "score"
      FROM "conversation_chunks" cc
      WHERE ${Prisma.join(filters, ' AND ')}
      ORDER BY cc."created_at" ASC, cc."id" ASC
      LIMIT ${topK}
    `);
    return rows.map((row, index) => this.toCandidate(row, 'filters', index + 1));
  }

  retrieve(query: RetrievalQuery, config: { topK: number }): Promise<RetrievalCandidate[]> {
    return this.retrieveVector(query, config.topK);
  }

  private buildSqlFilters(
    input: Record<string, unknown> | undefined,
    requireEmbedding: boolean,
  ): Prisma.Sql[] {
    const filters = this.readFilters(input);
    const clauses: Prisma.Sql[] = [];
    if (requireEmbedding) clauses.push(Prisma.sql`cc."embedding" IS NOT NULL`);

    if (filters.includeConversationId) {
      clauses.push(Prisma.sql`cc."conversation_id" = ${filters.includeConversationId}::uuid`);
    } else if (filters.excludeConversationId) {
      clauses.push(Prisma.sql`cc."conversation_id" <> ${filters.excludeConversationId}::uuid`);
    }

    if (filters.runtimeConversationId && filters.currentMessageId && filters.currentMessageCreatedAt) {
      const currentConversationCutoff = Prisma.sql`
        EXISTS (
          SELECT 1 FROM "messages" chunk_start_message
          WHERE chunk_start_message."id" = cc."start_message_id"
            AND (
              chunk_start_message."created_at" < ${filters.currentMessageCreatedAt}
              OR (
                chunk_start_message."created_at" = ${filters.currentMessageCreatedAt}
                AND chunk_start_message."id" <= ${filters.currentMessageId}::uuid
              )
            )
        )
      `;
      clauses.push(
        filters.includeConversationId
          ? currentConversationCutoff
          : Prisma.sql`(
              cc."conversation_id" <> ${filters.runtimeConversationId}::uuid
              OR (cc."conversation_id" = ${filters.runtimeConversationId}::uuid AND ${currentConversationCutoff})
            )`,
      );
    }

    if (filters.dateFrom || filters.dateTo) {
      clauses.push(Prisma.sql`
        EXISTS (
          SELECT 1 FROM "messages" date_range_message
          WHERE date_range_message."conversation_id" = cc."conversation_id"
            ${filters.dateFrom ? Prisma.sql`AND date_range_message."created_at" >= ${filters.dateFrom}` : Prisma.empty}
            ${filters.dateTo ? Prisma.sql`AND date_range_message."created_at" <= ${filters.dateTo}` : Prisma.empty}
        )
      `);
    }

    // A conversation retrieval request is validated to include a date or scope
    // constraint before it reaches this source. Keep an explicit predicate for
    // the unfiltered generic case so Prisma.join never receives an empty list.
    if (!clauses.length) clauses.push(Prisma.sql`TRUE`);
    return clauses;
  }

  private readFilters(input?: Record<string, unknown>): ConversationFilters {
    const asDate = (value: unknown) =>
      value instanceof Date && !Number.isNaN(value.getTime()) ? value : undefined;
    const asString = (value: unknown) =>
      typeof value === 'string' && value.length > 0 ? value : undefined;
    return {
      includeConversationId: asString(input?.includeConversationId),
      excludeConversationId: asString(input?.excludeConversationId),
      runtimeConversationId: asString(input?.runtimeConversationId),
      currentMessageId: asString(input?.currentMessageId),
      currentMessageCreatedAt: asDate(input?.currentMessageCreatedAt),
      dateFrom: asDate(input?.dateFrom),
      dateTo: asDate(input?.dateTo),
    };
  }

  private toCandidate(
    row: RawChunk,
    mode: 'vector' | 'lexical' | 'filters',
    rank: number,
  ): RetrievalCandidate {
    const candidate: RetrievalCandidate = {
      id: row.id,
      content: row.content,
      source: 'conversation_chunk',
      metadata: {
        conversationId: row.conversation_id,
        status: row.status as ConversationChunkStatus,
        tokenCount: Number(row.token_count),
        startMessageId: row.start_message_id,
        endMessageId: row.end_message_id,
      },
      retrievalPresence: [mode],
    };
    if (mode === 'vector') {
      candidate.vectorScore = Number(row.score);
      candidate.vectorRank = rank;
    } else if (mode === 'lexical') {
      candidate.lexicalScore = Number(row.score);
      candidate.lexicalRank = rank;
    }
    return candidate;
  }
}
