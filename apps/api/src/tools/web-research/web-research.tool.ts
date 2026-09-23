import { Injectable, OnModuleInit } from '@nestjs/common';
import { SearchOrchestratorService } from '../../research/search-orchestrator.service';
import type { ResearchResult } from '../../research/dto/research-result.dto';
import { SettingsService } from '../../settings/settings.service';
import type { RegisteredTool } from '../tool-registry.types';
import { ToolRegistryService } from '../tool-registry.service';
import {
  ToolArgumentException,
  ToolRuntimeContextException,
} from '../types/tool-errors';
import type { ToolExecutionContext } from '../types/tool.types';

const MODES = ['quick', 'deep'] as const;
const RECENCIES = ['auto', 'day', 'week', 'month', 'year', 'any'] as const;

@Injectable()
export class WebResearchRegisteredTool implements RegisteredTool, OnModuleInit {
  readonly name = 'web_research' as const;
  readonly description =
    'Pesquisa fontes públicas da internet para fatos atuais, informações externas ' +
    'ou quando o usuário pedir explicitamente uma pesquisa. Devolve fontes, evidências ' +
    'e conflitos; não redige a resposta final.';
  readonly inputSchema = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      question: {
        type: 'string',
        description:
          'Pergunta completa a pesquisar. Resolva referências como "isso" com o contexto imediato.',
      },
      mode: {
        type: 'string',
        enum: MODES,
        description: 'quick por padrão; deep para pesquisas extensas.',
      },
      recency: {
        type: 'string',
        enum: RECENCIES,
        description: 'Janela temporal desejada, se pertinente.',
      },
    },
    required: ['question'],
  };

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly searchOrchestrator: SearchOrchestratorService,
    private readonly settingsService: SettingsService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ResearchResult> {
    const settings = await this.settingsService.getApplicationSettings();
    if (!settings.researchEnabled) {
      throw new ToolRuntimeContextException('Pesquisa na Web está desativada.');
    }

    for (const key of Object.keys(input)) {
      if (!['question', 'mode', 'recency'].includes(key)) {
        throw new ToolArgumentException(
          key,
          `web_research does not accept ${key}`,
        );
      }
    }
    if (typeof input.question !== 'string' || !input.question.trim()) {
      throw new ToolArgumentException(
        'question',
        'question must be a non-empty string',
      );
    }
    if (input.question.length > 1000) {
      throw new ToolArgumentException('question', 'question is too long');
    }
    if (
      input.mode !== undefined &&
      !MODES.includes(input.mode as (typeof MODES)[number])
    ) {
      throw new ToolArgumentException('mode', 'mode must be quick or deep');
    }
    if (
      input.recency !== undefined &&
      !RECENCIES.includes(input.recency as (typeof RECENCIES)[number])
    ) {
      throw new ToolArgumentException('recency', 'recency is invalid');
    }

    const priorMessages = context.messages
      .filter((message) => message.id !== context.currentMessageId)
      .slice(-4)
      .map((message) => `${message.role}: ${message.content.slice(0, 500)}`)
      .join('\n')
      .slice(-1800);

    return this.searchOrchestrator.run({
      question: input.question.trim(),
      mode:
        (input.mode as (typeof MODES)[number] | undefined) ??
        (settings.researchDefaultMode as (typeof MODES)[number]),
      recency:
        (input.recency as (typeof RECENCIES)[number] | undefined) ??
        (settings.researchDefaultRecency as (typeof RECENCIES)[number]),
      conversationId: context.conversationId,
      messageId: context.currentMessageId,
      requestId: context.requestId,
      conversationContext: priorMessages || undefined,
      maxSources: settings.researchMaxSources,
      maxRounds: settings.researchMaxRounds,
      maxQueries: settings.researchMaxQueries,
    });
  }
}
