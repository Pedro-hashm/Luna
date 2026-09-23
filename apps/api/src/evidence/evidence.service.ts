import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { formatApplicationDateTime } from '../time/application-time';
import type { ConversationEvidenceReference } from '../tools/conversation-retrieval/types/conversation-retrieval.types';
import type { PublicConversationEvidence, StoredConversationEvidenceReference } from './evidence.types';

@Injectable()
export class EvidenceService {
  private readonly logger = new Logger(EvidenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async createForAssistantMessage(input: {
    enabled: boolean;
    assistantMessageId: string;
    timeZone: string;
    retrievalResults: Array<{ successful: boolean; hasResults: boolean; references: ConversationEvidenceReference[] }>;
  }): Promise<Array<PublicConversationEvidence & {
    referenceCount: number;
    exactDateFrom: string;
    exactDateTo: string;
    sourceReferences: StoredConversationEvidenceReference[];
  }>> {
    const created: Array<PublicConversationEvidence & {
      referenceCount: number;
      exactDateFrom: string;
      exactDateTo: string;
      sourceReferences: StoredConversationEvidenceReference[];
    }> = [];
    if (!input.enabled) return created;

    for (const retrieval of input.retrievalResults) {
      const references = retrieval.references;
      if (!retrieval.successful || !retrieval.hasResults || !references.length) continue;

      const timestamps = references.flatMap((reference) => [
        new Date(reference.startAt),
        new Date(reference.endAt),
      ]).filter((date) => !Number.isNaN(date.getTime()));
      if (!timestamps.length) continue;

      const dateFrom = new Date(Math.min(...timestamps.map((date) => date.getTime())));
      const dateTo = new Date(Math.max(...timestamps.map((date) => date.getTime())));
      const dates = [...new Set(references.flatMap((reference) => reference.dates))].sort();
      if (!dates.length) continue;

      let evidence: {
        sequence: number;
        dateFrom: Date;
        dateTo: Date;
        dates: string[];
        timeZone: string;
      };
      try {
        evidence = await this.prisma.conversationEvidence.create({
          data: {
            messageId: input.assistantMessageId,
            sourceType: 'conversation_retrieval',
            dateFrom,
            dateTo,
            dates,
            timeZone: input.timeZone,
            sourceReferences: references as unknown as Prisma.InputJsonValue,
          },
        });
      } catch {
        this.logger.error(JSON.stringify({ event: 'evidence.create.failed', referenceCount: references.length }));
        continue;
      }
      const view = this.toPublicView(evidence);
      created.push({
        ...view,
        referenceCount: references.length,
        exactDateFrom: dateFrom.toISOString(),
        exactDateTo: dateTo.toISOString(),
        sourceReferences: references,
      });
      this.logger.log(JSON.stringify({
        event: 'evidence.created',
        evidenceId: view.evidence_id,
        referenceCount: references.length,
        dateFrom: dateFrom.toISOString(),
        dateTo: dateTo.toISOString(),
      }));
    }

    return created;
  }

  async resolvePublicId(evidenceId: string) {
    const match = /^ev_([1-9]\d*)$/u.exec(evidenceId);
    if (!match) return undefined;
    const sequence = Number(match[1]);
    if (!Number.isSafeInteger(sequence)) return undefined;
    const evidence = await this.prisma.conversationEvidence.findUnique({
      where: { sequence },
    });
    if (!evidence) return undefined;
    return {
      ...evidence,
      publicView: this.toPublicView(evidence),
      sourceReferences: this.readReferences(evidence.sourceReferences),
    };
  }

  toPublicView(evidence: {
    sequence: number;
    dateFrom: Date;
    dateTo: Date;
    dates: string[];
    timeZone: string;
  }): PublicConversationEvidence {
    return {
      evidence_id: `ev_${evidence.sequence}`,
      date_from: formatApplicationDateTime(evidence.dateFrom, evidence.timeZone).slice(0, 10),
      date_to: formatApplicationDateTime(evidence.dateTo, evidence.timeZone).slice(0, 10),
      dates: evidence.dates,
    };
  }

  private readReferences(value: Prisma.JsonValue): StoredConversationEvidenceReference[] {
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is Prisma.JsonObject =>
      Boolean(item && typeof item === 'object' && !Array.isArray(item)),
    ).map((item) => item as unknown as StoredConversationEvidenceReference);
  }
}
