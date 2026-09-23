import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { ChatMessage } from '../llm/types/types';
import { ObservabilityService } from '../observability/observability.service';
import type {
  ContextSnapshot,
  ObservabilityMessage,
} from '../observability/observability.types';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { formatApplicationDateTime } from '../time/application-time';
import { ContextManagerService } from '../user-agent/context-manager/context-manager.service';
import { EvidenceService } from '../evidence/evidence.service';
import type { PublicConversationEvidence } from '../evidence/evidence.types';
import { UserAgentService } from '../user-agent/user-agent.service';
import type {
  RuntimeMessage,
  UserAgentRunResult,
} from '../user-agent/types/user-agent.types';
import { ConversationChunkService } from './conversation-chunk.service';
import type {
  ConversationDetailResponse,
  ConversationListItemResponse,
  ConversationMessageResponse,
  SendMessageResponse,
} from './types/conversation-response';

@Injectable()
export class ConversationService {
  private readonly logger = new Logger(ConversationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly userAgentService: UserAgentService,
    private readonly contextManager: ContextManagerService,
    private readonly conversationChunkService: ConversationChunkService,
    private readonly settingsService: SettingsService,
    private readonly observabilityService: ObservabilityService,
    private readonly evidenceService: EvidenceService,
  ) {}

  async createConversationWithMessage(
    content: string,
  ): Promise<SendMessageResponse> {
    return this.processMessage(undefined, content);
  }

  async addMessageToConversation(
    conversationId: string,
    content: string,
  ): Promise<SendMessageResponse> {
    return this.processMessage(conversationId, content);
  }

  async listConversations(): Promise<ConversationListItemResponse[]> {
    const [settings, conversations] = await Promise.all([
      this.settingsService.getApplicationSettings(),
      this.prisma.conversation.findMany({
        include: {
          messages: {
            select: {
              content: true,
              createdAt: true,
            },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 1,
          },
          _count: {
            select: {
              messages: true,
            },
          },
        },
      }),
    ]);

    return conversations
      .sort((first, second) => {
        const firstUpdatedAt = first.messages[0]?.createdAt ?? first.updatedAt;
        const secondUpdatedAt =
          second.messages[0]?.createdAt ?? second.updatedAt;

        return secondUpdatedAt.getTime() - firstUpdatedAt.getTime();
      })
      .map((conversation) => {
        const latestMessage = conversation.messages[0];

        return {
          id: conversation.id,
          title: conversation.title ?? 'Nova conversa',
          preview: latestMessage?.content ?? '',
          messageCount: conversation._count.messages,
          createdAt: formatApplicationDateTime(
            conversation.createdAt,
            settings.appTimezone,
          ),
          // `updatedAt` belongs to Conversation and does not change when a
          // child Message is inserted. The latest message is the real
          // activity timestamp for ordering the sidebar.
          updatedAt: formatApplicationDateTime(
            latestMessage?.createdAt ?? conversation.updatedAt,
            settings.appTimezone,
          ),
        };
      });
  }

  async getConversation(
    conversationId: string,
  ): Promise<ConversationDetailResponse> {
    const [settings, conversation] = await Promise.all([
      this.settingsService.getApplicationSettings(),
      this.prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      }),
    ]);

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} was not found`,
      );
    }

    return {
      id: conversation.id,
      title: conversation.title ?? 'Nova conversa',
      createdAt: formatApplicationDateTime(
        conversation.createdAt,
        settings.appTimezone,
      ),
      updatedAt: formatApplicationDateTime(
        conversation.updatedAt,
        settings.appTimezone,
      ),
      messages: conversation.messages.map((message) =>
        this.toMessageResponse(message, settings.appTimezone),
      ),
    };
  }

  private async processMessage(
    conversationId: string | undefined,
    content: string,
  ): Promise<SendMessageResponse> {
    const normalizedContent = content.trim();

    if (!normalizedContent) {
      throw new BadRequestException('Message content cannot be empty');
    }

    // This is the only semantic clock for the entire interaction. It is
    // propagated to the UserAgent, Orchestrator and Luna without being
    // recomputed by those layers.
    const settings = await this.settingsService.getApplicationSettings();
    const currentInstant = new Date();
    const currentDateTime = formatApplicationDateTime(
      currentInstant,
      settings.appTimezone,
    );
    const requestId = randomUUID();
    const traceStartedAt = currentInstant;
    const traceStartMs = Date.now();
    const contextStageStartedAt = Date.now();
    const conversation = conversationId
      ? await this.prisma.conversation.findUnique({
          where: { id: conversationId },
          include: {
            messages: {
              orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              include: { evidences: true },
            },
          },
        })
      : await this.prisma.conversation.create({
          data: {
            title: this.titleFromContent(normalizedContent),
          },
          include: { messages: { include: { evidences: true } } },
        });

    if (!conversation) {
      throw new NotFoundException(
        `Conversation ${conversationId} was not found`,
      );
    }

    if (!conversation.title) {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { title: this.titleFromContent(normalizedContent) },
      });
    }

    const userMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.user,
        content: normalizedContent,
      },
    });
    const recentMessages = this.contextManager.buildRecentMessages(
      [...conversation.messages, userMessage].map((message) =>
        this.toRuntimeMessage(
          message,
          settings.appTimezone,
          settings.conversationEvidenceEnabled,
        ),
      ),
      settings.immediateContextMaxTokens,
    );
    const contextStageMs = Date.now() - contextStageStartedAt;
    const initialSnapshot = this.createContextSnapshot(
      recentMessages,
      [],
      undefined,
      currentDateTime,
      undefined,
      { enabled: settings.conversationEvidenceEnabled, created: false, evidences: [] },
    );
    const userAgentStartedAt = Date.now();

    let execution: UserAgentRunResult;

    try {
      execution = await this.userAgentService.run({
        requestId,
        input: normalizedContent,
        conversationId: conversation.id,
        currentMessageId: userMessage.id,
        currentDateTime,
        recentMessages,
      });
    } catch (error) {
      const completedAt = new Date();
      const estimatedInputTokens =
        this.contextManager.estimateMessagesTokens(recentMessages);
      const failurePrompt = this.failurePromptSnapshot(error);
      const failureSnapshot: ContextSnapshot = failurePrompt
        ? {
            ...initialSnapshot,
            promptTarget: failurePrompt.target,
            promptMessages: failurePrompt.messages,
          }
        : initialSnapshot;

      await this.observabilityService.recordTrace({
        requestId,
        conversationId: conversation.id,
        kind: 'llm',
        status: this.traceStatus(error),
        combo: settings.llmCombo,
        inputTokens: estimatedInputTokens,
        totalTokens: estimatedInputTokens,
        estimatedInputTokens,
        latencyMs: Date.now() - traceStartMs,
        stageDurations: {
          context: contextStageMs,
          userAgent: Date.now() - userAgentStartedAt,
        },
        contextSnapshot: failureSnapshot,
        errorMessage: error instanceof Error ? error.message : 'unknown error',
        startedAt: traceStartedAt,
        completedAt,
      });
      throw error;
    }

    const persistenceStartedAt = Date.now();
    const assistantMessage = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        role: MessageRole.assistant,
        content: execution.luna.response.content,
        model: execution.luna.response.model,
      },
    });
    const persistenceStageMs = Date.now() - persistenceStartedAt;

    const evidenceStartedAt = Date.now();
    let createdEvidences: Array<PublicConversationEvidence & {
      referenceCount: number; exactDateFrom: string; exactDateTo: string;
      sourceReferences: import('../evidence/evidence.types').StoredConversationEvidenceReference[];
    }> = [];
    const retrievalResults = execution.orchestrator.toolExecutions
        .filter((toolExecution) => toolExecution.tool === 'conversation_retrieval')
        .map((toolExecution) => ({
          successful: toolExecution.status === 'success',
          hasResults: Boolean(
            toolExecution.status === 'success' &&
            toolExecution.result &&
            'query' in toolExecution.result &&
            toolExecution.result.results.length > 0,
          ),
          references: toolExecution.evidenceReferences ?? [],
        }));
    try {
      createdEvidences = await this.evidenceService.createForAssistantMessage({
        enabled: settings.conversationEvidenceEnabled,
        assistantMessageId: assistantMessage.id,
        timeZone: settings.appTimezone,
        retrievalResults,
      });
    } catch (error) {
      this.logger.warn(`Evidence persistence failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    const evidenceStageMs = Date.now() - evidenceStartedAt;
    const evidenceTrace = {
      enabled: settings.conversationEvidenceEnabled,
      created: createdEvidences.length > 0,
      evidences: createdEvidences.map((evidence) => ({
        evidenceId: evidence.evidence_id,
        referenceCount: evidence.referenceCount,
        dateFrom: evidence.exactDateFrom,
        dateTo: evidence.exactDateTo,
        dates: evidence.dates,
        sourceReferences: evidence.sourceReferences,
      })),
    };
    this.logger.log(JSON.stringify({ event: 'evidence.enabled', enabled: settings.conversationEvidenceEnabled }));

    const chunkStartedAt = Date.now();
    try {
      await this.conversationChunkService.synchronizeConversation(
        conversation.id,
      );
    } catch (error) {
      // Chunk indexing must not make a successful chat response fail.
      // The next message can retry the open chunk and persisted messages
      // remain available for a later backfill job.
      const reason = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `[ConversationChunkService] Failed to index conversation ${conversation.id}: ${reason}`,
      );
    }
    const chunkStageMs = Date.now() - chunkStartedAt;
    const estimatedInputTokens = this.contextManager.estimateMessagesTokens(
      execution.luna.promptMessages,
    );
    const estimatedOutputTokens = this.contextManager.estimateTokens(
      execution.luna.response.content,
    );
    const inputTokens =
      execution.luna.response.usage?.inputTokens ?? estimatedInputTokens;
    const outputTokens =
      execution.luna.response.usage?.outputTokens ?? estimatedOutputTokens;
    const totalTokens =
      execution.luna.response.usage?.totalTokens ?? inputTokens + outputTokens;

    await this.observabilityService.recordTrace({
      requestId,
      conversationId: conversation.id,
      responseMessageId: assistantMessage.id,
      kind: 'llm',
      status: 'success',
      combo: execution.luna.combo,
      model: execution.luna.response.model,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedInputTokens,
      estimatedOutputTokens,
      latencyMs: Date.now() - traceStartMs,
      stageDurations: {
        context: contextStageMs,
        userAgent: execution.timings.totalMs,
        orchestrator: execution.timings.orchestratorMs,
        luna: execution.timings.lunaMs,
        responsePersistence: persistenceStageMs,
        chunkIndexing: chunkStageMs,
        'evidence.persist': evidenceStageMs,
      },
      contextSnapshot: this.createContextSnapshot(
        recentMessages,
        execution.orchestrator.toolExecutions,
        execution.orchestrator.finalInstructions,
        execution.state.currentDateTime,
        execution.luna.promptMessages,
        evidenceTrace,
      ),
      startedAt: traceStartedAt,
      completedAt: new Date(),
    });

    return {
      conversationId: conversation.id,
      messages: [
        this.toMessageResponse(userMessage, settings.appTimezone),
        this.toMessageResponse(assistantMessage, settings.appTimezone),
      ],
    };
  }

  private createContextSnapshot(
    recentMessages: RuntimeMessage[],
    toolExecutions: unknown[],
    finalInstructions?: string,
    currentDateTime?: string,
    lunaPromptMessages?: ChatMessage[],
    evidence?: { enabled: boolean; created: boolean; evidences: Array<{ evidenceId: string; referenceCount: number; dateFrom: string; dateTo: string; dates?: string[]; sourceReferences?: unknown[] }> },
  ): ContextSnapshot {
    const immediateTokens =
      this.contextManager.estimateMessagesTokens(recentMessages);
    const toolsTokens = this.contextManager.estimateTokens(
      JSON.stringify(toolExecutions),
    );
    const promptSections = this.getLunaPromptSections(lunaPromptMessages);
    const systemTokens = this.contextManager.estimateTokens(
      promptSections.system.map((item) => item.content).join('\n'),
    );
    const orchestratorTokens = this.contextManager.estimateTokens(
      promptSections.orchestrator.map((item) => item.content).join('\n') ||
        finalInstructions ||
        '',
    );
    const messages: ObservabilityMessage[] = recentMessages.map((message) => ({
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
      evidence: message.evidence,
    }));

    const snapshot: ContextSnapshot = {
      ...(lunaPromptMessages
        ? {
            promptTarget: 'luna',
            promptMessages: lunaPromptMessages,
          }
        : {}),
      immediate: { messages, tokens: immediateTokens },
      memory: { items: [], tokens: 0 },
      tools: { items: toolExecutions, tokens: toolsTokens },
      totalTokens:
        immediateTokens + toolsTokens + systemTokens + orchestratorTokens,
      evidence: evidence ?? { enabled: false, created: false, evidences: [] },
    };

    if (promptSections.system.length > 0) {
      snapshot.system = {
        items: promptSections.system,
        tokens: systemTokens,
      };
    } else if (currentDateTime && !lunaPromptMessages) {
      snapshot.system = {
        items: [
          {
            type: 'current_date_time',
            label: 'Data/hora da iteração',
            content: currentDateTime,
          },
        ],
        tokens: this.contextManager.estimateTokens(currentDateTime),
      };
    }

    if (promptSections.orchestrator.length > 0 || finalInstructions) {
      snapshot.orchestrator = {
        items:
          promptSections.orchestrator.length > 0
            ? promptSections.orchestrator
            : [
                {
                  type: 'operational_guidance',
                  label: 'Instruções operacionais',
                  content: finalInstructions ?? '',
                },
              ],
        tokens: orchestratorTokens,
      };
    }

    return snapshot;
  }

  private failurePromptSnapshot(
    error: unknown,
  ): { target: 'luna'; messages: ChatMessage[] } | undefined {
    if (!error || typeof error !== 'object') return undefined;
    const prompt = (error as {
      observabilityPrompt?: { target?: unknown; messages?: unknown };
    }).observabilityPrompt;
    if (
      prompt?.target !== 'luna' ||
      !Array.isArray(prompt.messages) ||
      !prompt.messages.every(
        (message) =>
          message &&
          typeof message === 'object' &&
          typeof (message as Record<string, unknown>).role === 'string' &&
          typeof (message as Record<string, unknown>).content === 'string',
      )
    ) {
      return undefined;
    }
    return { target: 'luna', messages: prompt.messages as ChatMessage[] };
  }

  private getLunaPromptSections(promptMessages?: ChatMessage[]): {
    system: Array<{ type: string; label: string; content: string }>;
    orchestrator: Array<{ type: string; label: string; content: string }>;
  } {
    const systemMessages = (promptMessages ?? []).filter(
      (message) => message.role === 'system',
    );
    const system: Array<{
      type: string;
      label: string;
      content: string;
    }> = [];
    const orchestrator: Array<{
      type: string;
      label: string;
      content: string;
    }> = [];

    for (const message of systemMessages) {
      if (
        message.content.startsWith(
          'Operational response guidance from the Orchestrator:',
        )
      ) {
        orchestrator.push({
          type: 'operational_guidance',
          label: 'Instruções operacionais',
          content: message.content,
        });
        continue;
      }

      if (
        message.content.startsWith('Trusted tool results for this iteration:')
      ) {
        continue;
      }

      if (
        message.content.startsWith(
          'Current iteration time in the application timezone:',
        )
      ) {
        system.push({
          type: 'current_date_time',
          label: 'Data/hora da iteração',
          content: message.content,
        });
        continue;
      }

      system.push({
        type: 'base_prompt',
        label: 'Prompt base da Luna',
        content: message.content,
      });
    }

    return { system, orchestrator };
  }

  private titleFromContent(content: string): string {
    const title = content.replace(/\s+/gu, ' ').trim();

    return title.length > 42
      ? `${title.slice(0, 41).trim()}…`
      : title || 'Nova conversa';
  }

  private traceStatus(error: unknown): 'error' | 'timeout' {
    const message = error instanceof Error ? error.message.toLowerCase() : '';

    return message.includes('timeout') || message.includes('etimedout')
      ? 'timeout'
      : 'error';
  }

  private toRuntimeMessage(
    message: {
      id: string;
      role: MessageRole;
      content: string;
      createdAt: Date;
      evidences?: Array<{ sequence: number; dateFrom: Date; dateTo: Date; dates: string[]; timeZone: string }>;
    },
    timeZone: string,
    evidenceEnabled: boolean,
  ): RuntimeMessage {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: formatApplicationDateTime(message.createdAt, timeZone),
      ...(evidenceEnabled && message.role === MessageRole.assistant && message.evidences?.length
        ? {
            evidence: message.evidences.map((evidence) =>
              this.evidenceService.toPublicView(evidence),
            ),
          }
        : {}),
    };
  }

  private toMessageResponse(
    message: {
      id: string;
      role: MessageRole;
      content: string;
      model: string | null;
      createdAt: Date;
    },
    timeZone: string,
  ): ConversationMessageResponse {
    return {
      id: message.id,
      role: message.role,
      content: message.content,
      model: message.model,
      createdAt: formatApplicationDateTime(message.createdAt, timeZone),
    };
  }
}
