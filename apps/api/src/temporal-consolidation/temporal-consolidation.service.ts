import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { MessageRole, Prisma, TemporalRelationType, type TemporalConsolidationRun } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { ConversationRetrievalService } from '../tools/conversation-retrieval/conversation-retrieval.service';
import { isTemporalCandidate } from './candidate-detector';
import {
  extractInput,
  TEMPORAL_EXTRACT_PROMPT,
  TEMPORAL_VALIDATE_PROMPT,
  validationInput,
} from './temporal-prompt';
import {
  InvalidTemporalOutputError,
  parseExtractedChange,
  parseValidatedChange,
  type ExtractedChange,
  type ValidatedChange,
} from './temporal-structured-output';
import {
  emptyTemporalRunMetrics,
  type ProposedTemporalRelation,
  type RejectedTemporalRelation,
  type TemporalMessage,
  type TemporalRunMetrics,
  type TemporalRunOutcome,
  type TemporalTrigger,
} from './temporal-consolidation.types';

const MAX_MESSAGES_PER_RUN = 100;
const MAX_CANDIDATES_PER_RUN = 25;
const MAX_LLM_CALLS_PER_RUN = 60;
const MAX_HISTORICAL_MATCHES = 16;
const MAX_HISTORICAL_CHUNKS = 20;
const MAX_EXACT_OLD_MATCHES = 32;
const MAX_HISTORICAL_CONTEXT_TOKENS = 16_000;
const MAX_RUN_MS = 5 * 60_000;
const LOCK_MS = MAX_RUN_MS + 90_000;
const LLM_TIMEOUT_MS = 45_000;

type TemporalSettings = Awaited<ReturnType<SettingsService['getApplicationSettings']>>;
type Cursor = { lastMessageCreatedAt: Date | null; lastMessageId: string | null };
type ComboChoice = { combo: string; fallbackEligible: boolean };
type TemporalRunPhase =
  | 'starting'
  | 'loading_messages'
  | 'detecting_candidates'
  | 'extracting_change'
  | 'retrieving_history'
  | 'validating_antecedent'
  | 'persisting_relation'
  | 'finalizing';
type TemporalRunProgress = {
  currentPhase: TemporalRunPhase;
  currentPhaseStartedAt: Date;
  phaseStartedMonotonic: number;
  phaseDurationsMs: Record<string, number>;
};
type HistoricalRow = {
  id: string;
  conversationId: string;
  role: string;
  content: string;
  createdAt: Date;
};

class TemporalRunCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TemporalRunCancelledError';
  }
}

/** Uses the configured application timezone and an end-exclusive window. */
export function isWithinTemporalWindow(
  instant: Date,
  timeZone: string,
  startTime: string,
  endTime: string,
): boolean {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);
  const now = hour * 60 + minute;
  const parse = (value: string) => {
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  };
  const start = parse(startTime);
  const end = parse(endTime);
  if (start === end) return false;
  return start < end ? now >= start && now < end : now >= start || now < end;
}

@Injectable()
export class TemporalConsolidationService implements OnModuleDestroy {
  private readonly logger = new Logger(TemporalConsolidationService.name);
  private readonly activeControllers = new Map<string, AbortController>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly settingsService: SettingsService,
    private readonly llm: LlmService,
    private readonly conversationRetrieval: ConversationRetrievalService,
  ) {}

  onModuleDestroy(): void {
    for (const controller of this.activeControllers.values()) {
      controller.abort(new TemporalRunCancelledError('application_shutdown'));
    }
  }

  async getStatus() {
    const [settings, checkpoint, latestRun] = await Promise.all([
      this.settingsService.getApplicationSettings(),
      this.prisma.temporalConsolidationCheckpoint.findUnique({ where: { id: 1 } }),
      this.prisma.temporalConsolidationRun.findFirst({ orderBy: { startedAt: 'desc' } }),
    ]);
    const running = Boolean(
      checkpoint?.activeRunId &&
        checkpoint.lockExpiresAt &&
        checkpoint.lockExpiresAt > new Date(),
    );
    const activeRun = running && checkpoint?.activeRunId
      ? await this.prisma.temporalConsolidationRun.findUnique({ where: { id: checkpoint.activeRunId } })
      : null;
    return {
      enabled: settings.temporalConsolidationEnabled,
      running,
      activeRun,
      latestRun,
      checkpoint: checkpoint
        ? {
            lastMessageCreatedAt: checkpoint.lastMessageCreatedAt,
            lastMessageId: checkpoint.lastMessageId,
          }
        : null,
    };
  }

  getRuns() {
    return this.prisma.temporalConsolidationRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    });
  }

  async runManual(input: { dryRun?: boolean } = {}): Promise<TemporalRunOutcome> {
    return (await this.execute('manual', Boolean(input.dryRun)))!;
  }

  async runScheduled(): Promise<TemporalRunOutcome | null> {
    return this.execute('scheduled', false);
  }

  async getRun(id: string): Promise<TemporalConsolidationRun | null> {
    return this.prisma.temporalConsolidationRun.findUnique({ where: { id } });
  }

  private async execute(
    trigger: TemporalTrigger,
    dryRun: boolean,
  ): Promise<TemporalRunOutcome | null> {
    const settings = await this.settingsService.getApplicationSettings();
    if (!settings.temporalConsolidationEnabled) {
      if (trigger === 'scheduled') return null;
      throw new ConflictException('Temporal consolidation is disabled');
    }
    const withinWindow = this.inWindow(new Date(), settings);
    if (trigger === 'scheduled' && !withinWindow) return null;

    const defaultCombo = settings.temporalConsolidationDefaultCombo?.trim() || null;
    const fallbackCombo = settings.temporalConsolidationFallbackCombo?.trim() || null;
    const selectedCombo = trigger === 'manual' && !withinWindow
      ? fallbackCombo
      : defaultCombo;
    if (!selectedCombo) {
      if (trigger === 'scheduled') {
        this.logger.warn('Temporal consolidation skipped: default combo is not configured');
        return null;
      }
      throw new BadRequestException(
        trigger === 'manual' && !withinWindow
          ? 'Fallback combo is required for a manual run outside the configured window'
          : 'Default combo is required for temporal consolidation',
      );
    }

    await this.prisma.temporalConsolidationCheckpoint.upsert({
      where: { id: 1 }, update: {}, create: { id: 1 },
    });
    const checkpoint = await this.prisma.temporalConsolidationCheckpoint.findUniqueOrThrow({
      where: { id: 1 },
    });
    if (trigger === 'scheduled' && !(await this.hasPendingMessages(checkpoint))) {
      return null;
    }

    const runId = randomUUID();
    const now = new Date();
    const lock = await this.prisma.temporalConsolidationCheckpoint.updateMany({
      where: {
        id: 1,
        OR: [{ activeRunId: null }, { lockExpiresAt: { lt: now } }],
      },
      data: {
        activeRunId: runId,
        lockExpiresAt: new Date(now.getTime() + LOCK_MS),
      },
    });
    if (lock.count !== 1) {
      if (trigger === 'scheduled') return null;
      throw new ConflictException('Temporal consolidation is already running');
    }
    if (checkpoint.activeRunId && checkpoint.lockExpiresAt && checkpoint.lockExpiresAt < now) {
      await this.prisma.temporalConsolidationRun.updateMany({
        where: { id: checkpoint.activeRunId, status: 'running' },
        data: {
          status: 'cancelled',
          finishedAt: now,
          errorMessage: 'lock_expired_after_restart',
          hasMore: true,
        },
      });
    }

    const metrics = emptyTemporalRunMetrics();
    const comboChoice: ComboChoice = {
      combo: selectedCombo,
      fallbackEligible: withinWindow && Boolean(fallbackCombo && fallbackCombo !== selectedCombo),
    };
    metrics.actualCombo = selectedCombo;
    metrics.provider = 'OmniRoute';
    if (trigger === 'manual' && !withinWindow) {
      metrics.fallbackUsed = true;
      metrics.fallbackReason = 'manual_outside_window';
    }

    let run;
    try {
      run = await this.prisma.temporalConsolidationRun.create({
        data: {
          id: runId,
          trigger,
          status: 'running',
          currentPhase: 'starting',
          currentPhaseStartedAt: now,
          progressUpdatedAt: now,
          phaseDurationsMs: {},
          dryRun,
          defaultCombo,
          fallbackCombo,
          actualCombo: selectedCombo,
          provider: 'OmniRoute',
          fallbackUsed: metrics.fallbackUsed,
          fallbackReason: metrics.fallbackReason,
        },
      });
    } catch (error) {
      await this.releaseLock(runId);
      throw error;
    }

    void this.processRun({
      runId, trigger, dryRun, startedAt: now, checkpoint,
      metrics, comboChoice, fallbackCombo,
    }).catch((error: unknown) => {
      this.logger.error(`Temporal run ${runId} could not be finalized: ${this.safeError(error)}`);
    });
    return { run };
  }

  private async processRun(input: {
    runId: string;
    trigger: TemporalTrigger;
    dryRun: boolean;
    startedAt: Date;
    checkpoint: Cursor;
    metrics: TemporalRunMetrics;
    comboChoice: ComboChoice;
    fallbackCombo: string | null;
  }): Promise<void> {
    const { runId, trigger, dryRun, startedAt, metrics, comboChoice, fallbackCombo } = input;
    const controller = new AbortController();
    const progress: TemporalRunProgress = {
      currentPhase: 'starting',
      currentPhaseStartedAt: startedAt,
      phaseStartedMonotonic: performance.now(),
      phaseDurationsMs: {},
    };
    this.activeControllers.set(runId, controller);
    const monitor = this.startMonitor(runId, controller, trigger, startedAt);
    const proposed: ProposedTemporalRelation[] = [];
    const rejected: RejectedTemporalRelation[] = [];
    let hasMore = false;
    let status: 'completed' | 'cancelled' | 'failed' = 'completed';
    let errorMessage: string | null = null;
    try {
      await this.enterPhase(runId, 'loading_messages', progress, metrics);
      const currentSettings = await this.settingsService.getApplicationSettings();
      if (!currentSettings.temporalConsolidationEnabled) {
        controller.abort(new TemporalRunCancelledError('disabled'));
        throw new TemporalRunCancelledError('disabled');
      }
      const result = await this.processMessages({
        runId,
        trigger,
        dryRun,
        cursor: input.checkpoint,
        signal: controller.signal,
        metrics,
        progress,
        comboChoice,
        fallbackCombo,
        proposed,
        rejected,
      });
      hasMore = result.hasMore;
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof TemporalRunCancelledError;
      status = cancelled ? 'cancelled' : 'failed';
      errorMessage = cancelled
        ? (controller.signal.aborted ? this.abortReason(controller.signal) : this.safeError(error))
        : this.safeError(error);
      if (!cancelled) metrics.errorCount++;
      hasMore = true;
    } finally {
      try {
        await this.enterPhase(runId, 'finalizing', progress, metrics);
      } catch (error) {
        this.logger.warn(`Could not publish finalizing phase for ${runId}: ${this.safeError(error)}`);
      }
      clearInterval(monitor);
      this.activeControllers.delete(runId);
      await this.releaseLock(runId);
    }

    this.closeCurrentPhase(progress);
    await this.prisma.temporalConsolidationRun.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        errorMessage,
        hasMore,
        currentPhase: null,
        currentPhaseStartedAt: null,
        progressUpdatedAt: new Date(),
        phaseDurationsMs: progress.phaseDurationsMs as Prisma.InputJsonValue,
        proposed: proposed as unknown as Prisma.InputJsonValue,
        rejected: rejected as unknown as Prisma.InputJsonValue,
        ...this.metricData(metrics),
      },
    });
    this.logger.log(JSON.stringify({
      event: 'temporal_consolidation.run.finished',
      runId,
      trigger,
      status,
      dryRun,
      metrics: {
        messagesScanned: metrics.messagesScanned,
        candidatesDetected: metrics.candidatesDetected,
        relationsCreated: metrics.relationsCreated,
        relationsRejected: metrics.relationsRejected,
        llmCalls: metrics.llmCalls,
        fallbackReason: metrics.fallbackReason,
      },
    }));
  }

  private async processMessages(input: {
    runId: string;
    trigger: TemporalTrigger;
    dryRun: boolean;
    cursor: Cursor;
    signal: AbortSignal;
    metrics: TemporalRunMetrics;
    progress: TemporalRunProgress;
    comboChoice: ComboChoice;
    fallbackCombo: string | null;
    proposed: ProposedTemporalRelation[];
    rejected: RejectedTemporalRelation[];
  }): Promise<{ hasMore: boolean }> {
    const messages = await this.prisma.message.findMany({
      where: {
        role: MessageRole.user,
        ...this.afterCursor(input.cursor),
        createdAt: { lte: new Date() },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_MESSAGES_PER_RUN + 1,
      select: {
        id: true, conversationId: true, role: true, content: true, createdAt: true,
      },
    });
    let processed = 0;
    for (const message of messages.slice(0, MAX_MESSAGES_PER_RUN)) {
      await this.enterPhase(input.runId, 'detecting_candidates', input.progress, input.metrics);
      this.assertNotCancelled(input.signal);
      if (input.metrics.candidatesDetected >= MAX_CANDIDATES_PER_RUN ||
          input.metrics.llmCalls >= MAX_LLM_CALLS_PER_RUN) break;

      const detectedAt = performance.now();
      const candidate = isTemporalCandidate(message.content);
      input.metrics.candidateDetectionLatencyMs += Math.round(performance.now() - detectedAt);
      input.metrics.messagesScanned++;
      processed++;
      if (!candidate) {
        await this.advanceCheckpoint(input.runId, message, input.dryRun);
        await this.publishProgress(input.runId, input.progress, input.metrics);
        continue;
      }
      input.metrics.candidatesDetected++;
      const proposal = await this.analyzeCandidate(message, input);
      if (proposal) {
        input.metrics.relationsProposed++;
        input.proposed.push(proposal);
        if (!input.dryRun) {
          await this.enterPhase(input.runId, 'persisting_relation', input.progress, input.metrics);
          const persistedAt = performance.now();
          try {
            await this.prisma.$transaction(async (tx) => {
              await tx.temporalRelation.create({
                data: {
                  predecessorMessageId: proposal.predecessorMessageId,
                  successorMessageId: proposal.successorMessageId,
                  type: proposal.type,
                  subject: proposal.subject,
                  oldValue: proposal.oldValue,
                  newValue: proposal.newValue,
                  confidence: proposal.confidence,
                  reason: proposal.reason,
                },
              });
              const advanced = await tx.temporalConsolidationCheckpoint.updateMany({
                where: { id: 1, activeRunId: input.runId },
                data: { lastMessageCreatedAt: message.createdAt, lastMessageId: message.id },
              });
              if (advanced.count !== 1) throw new TemporalRunCancelledError('run_lock_lost');
            });
            input.metrics.relationsCreated++;
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
              this.reject(input, message.id, 'duplicate_or_conflicting_relation', proposal.predecessorMessageId);
              await this.advanceCheckpoint(input.runId, message, false);
            } else {
              throw error;
            }
          } finally {
            input.metrics.persistenceLatencyMs += Math.round(performance.now() - persistedAt);
          }
        }
      } else {
        await this.advanceCheckpoint(input.runId, message, input.dryRun);
      }
      await this.publishProgress(input.runId, input.progress, input.metrics);
      if (input.dryRun) continue;
    }
    return { hasMore: processed < messages.length };
  }

  private async analyzeCandidate(
    message: TemporalMessage,
    input: {
      runId: string;
      trigger: TemporalTrigger;
      dryRun: boolean;
      signal: AbortSignal;
      metrics: TemporalRunMetrics;
      progress: TemporalRunProgress;
      comboChoice: ComboChoice;
      fallbackCombo: string | null;
      rejected: RejectedTemporalRelation[];
    },
  ): Promise<ProposedTemporalRelation | null> {
    await this.enterPhase(input.runId, 'extracting_change', input.progress, input.metrics);
    const modelExtraction = await this.callStructured(
      TEMPORAL_EXTRACT_PROMPT,
      extractInput(message),
      parseExtractedChange,
      input,
    );
    const extracted = {
      ...modelExtraction,
      oldValue: modelExtraction.oldValue &&
        this.containsValue(message.content, modelExtraction.oldValue)
        ? modelExtraction.oldValue : null,
    };
    if (extracted.type === 'NONE' || extracted.confidence < 0.65) {
      this.reject(input, message.id, 'no_explicit_change');
      return null;
    }
    if (!extracted.newValue || !this.containsValue(message.content, extracted.newValue)) {
      this.reject(input, message.id, 'new_value_not_grounded');
      return null;
    }

    await this.enterPhase(input.runId, 'retrieving_history', input.progress, input.metrics);
    const searchAt = performance.now();
    const historical = await this.findHistoricalMessages(message, extracted);
    const antecedents = historical.messages;
    input.metrics.chunksScanned += historical.chunksScanned;
    input.metrics.historicalRetrievalCalls++;
    input.metrics.historicalRetrievalLatencyMs += Math.round(performance.now() - searchAt);
    if (!antecedents.length) {
      this.reject(input, message.id, 'antecedent_not_found');
      return null;
    }

    await this.enterPhase(input.runId, 'validating_antecedent', input.progress, input.metrics);
    const validatedAt = performance.now();
    const validated = await this.callStructured(
      TEMPORAL_VALIDATE_PROMPT,
      validationInput(message, extracted, antecedents),
      parseValidatedChange,
      input,
    );
    input.metrics.validationLatencyMs += Math.round(performance.now() - validatedAt);
    const predecessor = antecedents.find((item) => item.id === validated.predecessorMessageId);
    if (validated.type === 'NONE' || !predecessor || validated.confidence < 0.75) {
      this.reject(input, message.id, 'insufficient_evidence', validated.predecessorMessageId ?? undefined);
      return null;
    }
    if (!this.strictlyBefore(predecessor, message) ||
        !validated.oldValue || !validated.newValue || !validated.subject ||
        !this.containsValue(predecessor.content, validated.oldValue) ||
        !this.containsValue(message.content, validated.newValue)) {
      this.reject(input, message.id, 'value_not_grounded', predecessor.id);
      return null;
    }
    const matchingOld = antecedents.filter((item) =>
      this.containsValue(item.content, validated.oldValue!),
    );
    // Repeated confirmations of the same named old value may span several
    // conversations. Treat them as ambiguous only when the new message does
    // not itself identify that old value; the validator still has to select
    // one explicit authoritative predecessor.
    if (predecessor.conversationId !== message.conversationId &&
        new Set(matchingOld.map((item) => item.conversationId)).size > 1 &&
        !this.containsValue(message.content, validated.oldValue)) {
      this.reject(input, message.id, 'ambiguous_antecedent', predecessor.id);
      return null;
    }
    const existing = await this.prisma.temporalRelation.findUnique({
      where: { predecessorMessageId: predecessor.id },
    });
    if (existing) {
      input.metrics.relationsSkipped++;
      this.reject(input, message.id,
        existing.successorMessageId === message.id ? 'duplicate_relation' : 'conflicting_successor',
        predecessor.id);
      return null;
    }
    return {
      predecessorMessageId: predecessor.id,
      successorMessageId: message.id,
      type: validated.type as TemporalRelationType,
      subject: validated.subject,
      oldValue: validated.oldValue,
      newValue: validated.newValue,
      confidence: validated.confidence,
      reason: validated.reason.slice(0, 500),
      predecessorExcerpt: predecessor.content.slice(0, 500),
      successorExcerpt: message.content.slice(0, 500),
    };
  }

  private async findHistoricalMessages(
    successor: TemporalMessage,
    change: ExtractedChange,
  ): Promise<{ messages: TemporalMessage[]; chunksScanned: number }> {
    const settings = await this.settingsService.getApplicationSettings();
    const topK = Math.min(MAX_HISTORICAL_CHUNKS, settings.retrievalMaxTopK);
    const query = change.oldValue?.trim() ||
      `${change.subject ?? ''} ${change.newValue ?? ''} ${successor.content.slice(0, 400)}`.trim();
    if (!query) return { messages: [], chunksScanned: 0 };

    // Reuse the conversation retrieval engine for each positive candidate.
    // Its chunk ranking searches the whole indexed history; the messages used
    // as evidence are loaded from the source table, never trusted from a chunk.
    const retrieved = await this.conversationRetrieval.retrieve(
      {
        query,
        scope: 'auto',
        temporalMode: 'historical',
        dateTo: successor.createdAt.toISOString(),
        includeMessages: true,
        maxContextTokens: Math.min(
          MAX_HISTORICAL_CONTEXT_TOKENS,
          settings.retrievalMaxContextTokens,
        ),
      },
      {
        conversationId: successor.conversationId,
        currentMessageId: successor.id,
        messages: [],
      },
      {
        topK,
        configOverrides: {
          strategy: 'hybrid',
          vectorTopK: topK,
          lexicalTopK: topK,
          candidatePoolTopK: topK,
          rerankerTopK: topK,
          rerankerThreshold: -100,
          deduplicationEnabled: false,
        },
      },
    );

    const ranked = retrieved.results.flatMap((item, chunkRank) =>
      (item.messages ?? []).map((message) => ({
        id: message.id,
        conversationId: item.conversationId,
        role: message.role as MessageRole,
        content: message.content,
        createdAt: message.createdAt,
        chunkRank,
      })),
    );

    // Exact old-value matches complement the bounded chunk ranking. This
    // keeps a distant explicit antecedent eligible when many similar chunks
    // outrank it, while still validating the original message with the LLM.
    const exactRows = change.oldValue
      ? await this.prisma.$queryRaw<HistoricalRow[]>(Prisma.sql`
          SELECT m."id", m."conversation_id" AS "conversationId",
                 m."role"::text AS "role", m."content", m."created_at" AS "createdAt"
          FROM "messages" m
          WHERE m."role" IN ('user', 'assistant')
            AND (m."created_at" < ${successor.createdAt}
                 OR (m."created_at" = ${successor.createdAt} AND m."id" < ${successor.id}::uuid))
            AND position(lower(${change.oldValue}) in lower(m."content")) > 0
          ORDER BY m."created_at" DESC, m."id" DESC
          LIMIT ${MAX_EXACT_OLD_MATCHES}
        `)
      : [];

    const byId = new Map<string, TemporalMessage & { chunkRank: number }>();
    for (const message of ranked) {
      if (!this.strictlyBefore(message, successor)) continue;
      byId.set(message.id, message);
    }
    for (const row of exactRows) {
      const message = { ...row, role: row.role as MessageRole, chunkRank: topK };
      if (!this.strictlyBefore(message, successor)) continue;
      if (!byId.has(message.id)) byId.set(message.id, message);
    }
    const oldValue = change.oldValue;
    const messages = [...byId.values()]
      .sort((left, right) => {
        const leftExact = oldValue && this.containsValue(left.content, oldValue) ? 1 : 0;
        const rightExact = oldValue && this.containsValue(right.content, oldValue) ? 1 : 0;
        if (leftExact !== rightExact) return rightExact - leftExact;
        const leftSame = left.conversationId === successor.conversationId ? 1 : 0;
        const rightSame = right.conversationId === successor.conversationId ? 1 : 0;
        if (leftSame !== rightSame) return rightSame - leftSame;
        if (left.chunkRank !== right.chunkRank) return left.chunkRank - right.chunkRank;
        return right.createdAt.getTime() - left.createdAt.getTime() ||
          right.id.localeCompare(left.id);
      })
      .slice(0, MAX_HISTORICAL_MATCHES)
      .map(({ chunkRank: _chunkRank, ...message }) => message);
    return { messages, chunksScanned: retrieved.results.length };
  }

  private async callStructured<T>(
    system: string,
    user: string,
    parse: (raw: string) => T,
    input: {
      signal: AbortSignal;
      trigger: TemporalTrigger;
      metrics: TemporalRunMetrics;
      progress: TemporalRunProgress;
      runId: string;
      comboChoice: ComboChoice;
      fallbackCombo: string | null;
    },
  ): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 4; attempt++) {
      this.assertNotCancelled(input.signal);
      const settings = await this.settingsService.getApplicationSettings();
      if (!settings.temporalConsolidationEnabled) {
        throw new TemporalRunCancelledError('disabled');
      }
      if (input.trigger === 'scheduled' && !this.inWindow(new Date(), settings)) {
        throw new TemporalRunCancelledError('window_ended');
      }
      if (input.metrics.llmCalls >= MAX_LLM_CALLS_PER_RUN) {
        throw new TemporalRunCancelledError('llm_call_limit');
      }
      input.metrics.llmCalls++;
      await this.publishProgress(input.runId, input.progress, input.metrics);
      const startedAt = performance.now();
      const timeout = new AbortController();
      const timeoutId = setTimeout(
        () => timeout.abort(new Error('temporal_llm_timeout')),
        LLM_TIMEOUT_MS,
      );
      try {
        const response = await this.llm.chat({
          combo: input.comboChoice.combo,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
          temperature: 0,
          maxTokens: 1600,
          signal: AbortSignal.any([input.signal, timeout.signal]),
        });
        input.metrics.model = response.model;
        input.metrics.actualCombo = input.comboChoice.combo;
        return parse(response.content);
      } catch (error) {
        lastError = timeout.signal.aborted && !input.signal.aborted
          ? new Error('temporal_llm_timeout')
          : error;
        input.metrics.errorCount++;
        if (input.signal.aborted) throw new TemporalRunCancelledError(this.abortReason(input.signal));
        if (!this.isRetriableLlmError(lastError)) throw lastError;
        if (attempt === 0 || (attempt === 2 && input.metrics.fallbackUsed)) {
          input.metrics.retryCount++;
        } else if (attempt === 1 && input.comboChoice.fallbackEligible && input.fallbackCombo) {
          input.comboChoice.combo = input.fallbackCombo;
          input.comboChoice.fallbackEligible = false;
          input.metrics.actualCombo = input.fallbackCombo;
          input.metrics.fallbackUsed = true;
          input.metrics.fallbackReason = error instanceof InvalidTemporalOutputError
            ? 'invalid_structured_output'
            : 'provider_failure';
        } else {
          throw lastError;
        }
      } finally {
        clearTimeout(timeoutId);
        input.metrics.llmLatencyMs += Math.round(performance.now() - startedAt);
      }
    }
    throw lastError;
  }

  private startMonitor(
    runId: string,
    controller: AbortController,
    trigger: TemporalTrigger,
    startedAt: Date,
  ): ReturnType<typeof setInterval> {
    let checking = false;
    const timer = setInterval(async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        const now = new Date();
        if (now.getTime() - startedAt.getTime() >= MAX_RUN_MS) {
          controller.abort(new TemporalRunCancelledError('run_duration_limit'));
          return;
        }
        const settings = await this.settingsService.getApplicationSettings();
        if (!settings.temporalConsolidationEnabled) {
          controller.abort(new TemporalRunCancelledError('disabled'));
          return;
        }
        if (trigger === 'scheduled' && !this.inWindow(now, settings)) {
          controller.abort(new TemporalRunCancelledError('window_ended'));
          return;
        }
        const renewed = await this.prisma.temporalConsolidationCheckpoint.updateMany({
          where: { id: 1, activeRunId: runId },
          data: { lockExpiresAt: new Date(now.getTime() + LOCK_MS) },
        });
        if (renewed.count !== 1) {
          controller.abort(new TemporalRunCancelledError('run_lock_lost'));
        }
      } catch {
        controller.abort(new TemporalRunCancelledError('monitor_failure'));
      } finally {
        checking = false;
      }
    }, 5_000);
    timer.unref();
    return timer;
  }

  private async hasPendingMessages(cursor: Cursor): Promise<boolean> {
    const message = await this.prisma.message.findFirst({
      where: { role: MessageRole.user, ...this.afterCursor(cursor) },
      select: { id: true },
    });
    return Boolean(message);
  }

  private afterCursor(cursor: Cursor): Prisma.MessageWhereInput {
    if (!cursor.lastMessageCreatedAt || !cursor.lastMessageId) return {};
    return {
      OR: [
        { createdAt: { gt: cursor.lastMessageCreatedAt } },
        { createdAt: cursor.lastMessageCreatedAt, id: { gt: cursor.lastMessageId } },
      ],
    };
  }

  private async advanceCheckpoint(runId: string, message: TemporalMessage, dryRun: boolean) {
    if (dryRun) return;
    const advanced = await this.prisma.temporalConsolidationCheckpoint.updateMany({
      where: { id: 1, activeRunId: runId },
      data: { lastMessageCreatedAt: message.createdAt, lastMessageId: message.id },
    });
    if (advanced.count !== 1) throw new TemporalRunCancelledError('run_lock_lost');
  }

  private async enterPhase(
    runId: string,
    phase: TemporalRunPhase,
    progress: TemporalRunProgress,
    metrics: TemporalRunMetrics,
  ): Promise<void> {
    if (progress.currentPhase === phase) return;
    this.closeCurrentPhase(progress);
    progress.currentPhase = phase;
    progress.currentPhaseStartedAt = new Date();
    progress.phaseStartedMonotonic = performance.now();
    await this.publishProgress(runId, progress, metrics);
  }

  private closeCurrentPhase(progress: TemporalRunProgress): void {
    const elapsedMs = Math.max(0, Math.round(performance.now() - progress.phaseStartedMonotonic));
    progress.phaseDurationsMs[progress.currentPhase] =
      (progress.phaseDurationsMs[progress.currentPhase] ?? 0) + elapsedMs;
    progress.phaseStartedMonotonic = performance.now();
  }

  private async publishProgress(
    runId: string,
    progress: TemporalRunProgress,
    metrics: TemporalRunMetrics,
  ): Promise<void> {
    await this.prisma.temporalConsolidationRun.update({
      where: { id: runId },
      data: {
        currentPhase: progress.currentPhase,
        currentPhaseStartedAt: progress.currentPhaseStartedAt,
        progressUpdatedAt: new Date(),
        phaseDurationsMs: progress.phaseDurationsMs as Prisma.InputJsonValue,
        ...this.metricData(metrics),
      },
    });
  }

  private async releaseLock(runId: string): Promise<void> {
    await this.prisma.temporalConsolidationCheckpoint.updateMany({
      where: { id: 1, activeRunId: runId },
      data: { activeRunId: null, lockExpiresAt: null },
    });
  }

  private inWindow(instant: Date, settings: TemporalSettings): boolean {
    return isWithinTemporalWindow(
      instant,
      settings.appTimezone,
      settings.temporalConsolidationStartTime,
      settings.temporalConsolidationEndTime,
    );
  }

  private strictlyBefore(first: TemporalMessage, second: TemporalMessage): boolean {
    return first.createdAt < second.createdAt ||
      (first.createdAt.getTime() === second.createdAt.getTime() && first.id < second.id);
  }

  private containsValue(content: string, value: string): boolean {
    const normalize = (text: string) => text.toLowerCase().normalize('NFKD')
      .replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
    return normalize(content).includes(normalize(value));
  }

  private reject(
    input: { metrics: TemporalRunMetrics; rejected: RejectedTemporalRelation[] },
    successorMessageId: string,
    reason: string,
    predecessorMessageId?: string,
  ): void {
    input.metrics.relationsRejected++;
    input.metrics.rejectionReasons[reason] =
      (input.metrics.rejectionReasons[reason] ?? 0) + 1;
    input.rejected.push({ successorMessageId, predecessorMessageId, reason });
  }

  private isRetriableLlmError(error: unknown): boolean {
    if (error instanceof InvalidTemporalOutputError) return true;
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    return /timeout|abort|fetch failed|network|connection|unavailable|inference|\b429\b|\b5\d\d\b/u.test(message);
  }

  private assertNotCancelled(signal: AbortSignal): void {
    if (signal.aborted) throw new TemporalRunCancelledError(this.abortReason(signal));
  }

  private abortReason(signal: AbortSignal): string {
    return signal.reason instanceof Error ? signal.reason.message : 'cancelled';
  }

  private safeError(error: unknown): string {
    return error instanceof Error ? error.message.slice(0, 500) : 'unknown error';
  }

  private metricData(metrics: TemporalRunMetrics) {
    return {
      actualCombo: metrics.actualCombo,
      provider: metrics.provider,
      model: metrics.model,
      messagesScanned: metrics.messagesScanned,
      chunksScanned: metrics.chunksScanned,
      candidatesDetected: metrics.candidatesDetected,
      llmCalls: metrics.llmCalls,
      historicalRetrievalCalls: metrics.historicalRetrievalCalls,
      relationsProposed: metrics.relationsProposed,
      relationsCreated: metrics.relationsCreated,
      relationsRejected: metrics.relationsRejected,
      relationsSkipped: metrics.relationsSkipped,
      fallbackUsed: metrics.fallbackUsed,
      fallbackReason: metrics.fallbackReason,
      retryCount: metrics.retryCount,
      errorCount: metrics.errorCount,
      candidateDetectionLatencyMs: metrics.candidateDetectionLatencyMs,
      llmLatencyMs: metrics.llmLatencyMs,
      historicalRetrievalLatencyMs: metrics.historicalRetrievalLatencyMs,
      validationLatencyMs: metrics.validationLatencyMs,
      persistenceLatencyMs: metrics.persistenceLatencyMs,
      rejectionReasons: metrics.rejectionReasons,
    };
  }
}
