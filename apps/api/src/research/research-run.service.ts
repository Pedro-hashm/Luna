import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ResearchEventType,
  ResearchRunView,
} from './dto/research-step.dto';
import type {
  ResearchEvidence,
  ResearchSource,
} from './dto/research-result.dto';
import type { ResearchTask, ResearchMode } from './dto/research-task.dto';

function jsonRecord(
  value: Prisma.JsonValue | null,
): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null;
}

function jsonInput(value: Record<string, unknown>): Prisma.InputJsonValue {
  // Prisma rejects undefined nested inside JSON; omit optional telemetry fields.
  const parsed: unknown = JSON.parse(JSON.stringify(value));
  return parsed as Prisma.InputJsonValue;
}

@Injectable()
export class ResearchRunService {
  private readonly sequences = new Map<string, number>();

  constructor(private readonly prisma: PrismaService) {}

  async create(
    task: ResearchTask,
    mode: ResearchMode,
    plannerCombo: string,
  ): Promise<string> {
    const run = await this.prisma.researchRun.create({
      data: {
        conversationId: task.conversationId,
        messageId: task.messageId,
        requestId: task.requestId,
        question: task.question,
        status: 'running',
        mode,
        plannerCombo,
      },
    });
    this.sequences.set(run.id, 0);
    return run.id;
  }

  async event(
    runId: string,
    type: ResearchEventType,
    data: Record<string, unknown> = {},
  ): Promise<void> {
    const sequence = (this.sequences.get(runId) ?? 0) + 1;
    this.sequences.set(runId, sequence);
    await this.prisma.researchEvent.create({
      data: { runId, sequence, type, data: jsonInput(data) },
    });
  }

  async source(runId: string, source: ResearchSource): Promise<void> {
    await this.prisma.researchSource.upsert({
      where: { runId_id: { runId, id: source.id } },
      create: {
        runId,
        id: source.id,
        normalizedUrl: source.normalizedUrl,
        url: source.url,
        title: source.title,
        domain: source.domain,
        sourceType: source.sourceType,
        rank: source.rank,
        publishedAt: source.publishedAt
          ? new Date(source.publishedAt)
          : undefined,
        retrievedAt: new Date(source.retrievedAt),
        extractionMethod: source.extractionMethod,
        metadata: source.metadata ? jsonInput(source.metadata) : undefined,
      },
      update: {
        title: source.title,
        extractionMethod: source.extractionMethod,
        metadata: source.metadata ? jsonInput(source.metadata) : undefined,
      },
    });
  }

  async evidence(runId: string, item: ResearchEvidence): Promise<void> {
    await this.prisma.researchEvidence.create({
      data: {
        runId,
        id: item.id,
        sourceId: item.sourceId,
        text: item.text,
        location: item.location,
        type: item.type,
        createdAt: new Date(item.retrievedAt),
      },
    });
  }

  async complete(
    runId: string,
    status: string,
    summaryContext: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.prisma.researchRun.update({
      where: { id: runId },
      data: {
        status,
        summaryContext,
        metadata: jsonInput(metadata),
        completedAt: new Date(),
      },
    });
    this.sequences.delete(runId);
  }

  async get(runId: string): Promise<ResearchRunView> {
    const run = await this.prisma.researchRun.findUnique({
      where: { id: runId },
      include: {
        events: { orderBy: { sequence: 'asc' } },
        sources: { orderBy: { rank: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!run)
      throw new NotFoundException(`Research run ${runId} was not found`);
    return this.toView(run);
  }

  async listForConversation(
    conversationId: string,
  ): Promise<{ runs: ResearchRunView[] }> {
    const runs = await this.prisma.researchRun.findMany({
      where: { conversationId },
      orderBy: { startedAt: 'desc' },
      take: 30,
      include: {
        events: { orderBy: { sequence: 'asc' } },
        sources: { orderBy: { rank: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
    });
    return { runs: runs.map((run) => this.toView(run)) };
  }

  private toView(
    run: Awaited<ReturnType<ResearchRunService['loadShape']>>,
  ): ResearchRunView {
    return {
      id: run.id,
      conversationId: run.conversationId,
      messageId: run.messageId,
      requestId: run.requestId,
      question: run.question,
      status: run.status,
      mode: run.mode,
      plannerCombo: run.plannerCombo,
      summaryContext: run.summaryContext,
      metadata: jsonRecord(run.metadata),
      startedAt: run.startedAt.toISOString(),
      completedAt: run.completedAt?.toISOString() ?? null,
      events: run.events.map((event) => ({
        id: event.id,
        sequence: event.sequence,
        type: event.type as ResearchEventType,
        data: jsonRecord(event.data) ?? {},
        createdAt: event.createdAt.toISOString(),
      })),
      sources: run.sources.map((source) => ({
        id: source.id,
        url: source.url,
        normalizedUrl: source.normalizedUrl,
        domain: source.domain,
        title: source.title,
        sourceType: source.sourceType,
        rank: source.rank,
        publishedAt: source.publishedAt?.toISOString() ?? null,
        retrievedAt: source.retrievedAt.toISOString(),
        extractionMethod: source.extractionMethod,
        metadata: jsonRecord(source.metadata),
      })),
      evidence: run.evidence.map((item) => ({
        id: item.id,
        sourceId: item.sourceId,
        text: item.text,
        location: item.location,
        type: item.type,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  // Keeps the inferred Prisma include shape in one place for toView.
  private loadShape(runId: string) {
    return this.prisma.researchRun.findUniqueOrThrow({
      where: { id: runId },
      include: { events: true, sources: true, evidence: true },
    });
  }
}
