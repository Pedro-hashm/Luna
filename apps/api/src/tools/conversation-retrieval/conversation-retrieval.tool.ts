import { Injectable, OnModuleInit } from '@nestjs/common';
import { ToolRegistryService } from '../tool-registry.service';
import { ToolArgumentException } from '../types/tool-errors';
import type { RegisteredTool } from '../tool-registry.types';
import type { ToolExecutionContext } from '../types/tool.types';
import { ConversationRetrievalService } from './conversation-retrieval.service';
import type {
  ConversationRetrievalInput,
  ConversationRetrievalResult,
  ConversationRetrievalScope,
  ConversationTemporalMode,
} from './types/conversation-retrieval.types';
import { CONVERSATION_RETRIEVAL_SCOPES, CONVERSATION_TEMPORAL_MODES } from './types/conversation-retrieval.types';

@Injectable()
export class ConversationRetrievalTool implements RegisteredTool, OnModuleInit {
  readonly name = 'conversation_retrieval' as const;
  readonly description =
    'Recupera conversas por semântica ou período. scope=auto (default) não ' +
    'restringe a busca a uma conversa; use current_conversation somente se o ' +
    'usuário pedir explicitamente para pesquisar nesta conversa, ou historical ' +
    'quando pedir exclusivamente outras conversas.';
  readonly inputSchema = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      query: {
        type: 'string',
        description:
          "Consulta semântica opcional, por exemplo 'jogos' ou 'projeto Luna'. Omita para listar o que foi conversado em um período amplo; nesse caso, informe dateFrom/dateTo.",
      },
      dateFrom: {
        type: ['string', 'null'] as const,
        description:
          'Data ISO opcional de início; use null ou omita quando não houver limite. YYYY-MM-DD usa o fuso da aplicação.',
      },
      dateTo: {
        type: ['string', 'null'] as const,
        description:
          'Data ISO opcional de fim; use null ou omita quando não houver limite. YYYY-MM-DD usa o fuso da aplicação.',
      },
      scope: {
        type: 'string',
        enum: CONVERSATION_RETRIEVAL_SCOPES,
        description:
          'Escopo opcional. auto é o default e não restringe por conversa; current_conversation busca somente nesta conversa; historical exclui a conversa atual.',
      },
      temporalMode: {
        type: 'string',
        enum: CONVERSATION_TEMPORAL_MODES,
        description:
          'Intenção temporal: current para estado vigente (default), historical para o estado da época, both para evolução e estado atual. É independente de scope.',
      },
      maxContextTokens: {
        type: 'integer',
        description: 'Orçamento máximo do conteúdo recuperado.',
      },
      includeMessages: {
        type: 'boolean',
        description:
          'Inclui mensagens estruturadas além do conteúdo dos chunks.',
      },
    },
  };

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly retrievalService: ConversationRetrievalService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async execute(
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ConversationRetrievalResult> {
    const normalized = this.normalizeInput(input);

    return this.retrievalService.retrieve(normalized, context);
  }

  private normalizeInput(
    input: Record<string, unknown>,
  ): ConversationRetrievalInput {
    const allowed = new Set([
      'query',
      'dateFrom',
      'dateTo',
      'scope',
      'temporalMode',
      'maxContextTokens',
      'includeMessages',
    ]);

    for (const key of Object.keys(input)) {
      if (!allowed.has(key)) {
        throw new ToolArgumentException(
          key,
          `conversation_retrieval does not accept ${key}`,
        );
      }
    }

    return {
      query: this.optionalString(input.query, 'query'),
      dateFrom: this.optionalDateString(input.dateFrom, 'dateFrom'),
      dateTo: this.optionalDateString(input.dateTo, 'dateTo'),
      scope: this.optionalScope(input.scope),
      temporalMode: this.optionalTemporalMode(input.temporalMode),
      maxContextTokens: this.optionalInteger(
        input.maxContextTokens,
        'maxContextTokens',
      ),
      includeMessages: this.optionalBoolean(
        input.includeMessages,
        'includeMessages',
      ),
    };
  }

  private optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new ToolArgumentException(field, `${field} must be a string`);
    }

    return value;
  }

  private optionalDateString(
    value: unknown,
    field: string,
  ): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    if (typeof value !== 'string') {
      throw new ToolArgumentException(
        field,
        `${field} must be a string or null`,
      );
    }

    return value;
  }

  private optionalInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ToolArgumentException(field, `${field} must be an integer`);
    }

    return value;
  }

  private optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'boolean') {
      throw new ToolArgumentException(field, `${field} must be a boolean`);
    }

    return value;
  }

  private optionalScope(
    value: unknown,
  ): ConversationRetrievalScope | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !CONVERSATION_RETRIEVAL_SCOPES.includes(
        value as ConversationRetrievalScope,
      )
    ) {
      throw new ToolArgumentException(
        'scope',
        `scope must be one of: ${CONVERSATION_RETRIEVAL_SCOPES.join(', ')}`,
      );
    }

    return value as ConversationRetrievalScope;
  }

  private optionalTemporalMode(value: unknown): ConversationTemporalMode | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' ||
        !CONVERSATION_TEMPORAL_MODES.includes(value as ConversationTemporalMode)) {
      throw new ToolArgumentException(
        'temporalMode',
        `temporalMode must be one of: ${CONVERSATION_TEMPORAL_MODES.join(', ')}`,
      );
    }
    return value as ConversationTemporalMode;
  }
}
