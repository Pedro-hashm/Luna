import { Injectable, OnModuleInit } from '@nestjs/common';
import { CONVERSATION_CONTEXT_DIRECTIONS, type ConversationContextDirection, type ConversationContextResult } from '../../evidence/evidence.types';
import { ToolRegistryService } from '../tool-registry.service';
import { ToolArgumentException } from '../types/tool-errors';
import type { ToolExecutionContext } from '../types/tool.types';
import type { RegisteredTool } from '../tool-registry.types';
import { ConversationContextService } from './conversation-context.service';

@Injectable()
export class ConversationContextTool implements RegisteredTool, OnModuleInit {
  readonly name = 'conversation_context' as const;
  readonly description = 'Recupera mensagens cronologicamente antes, depois ou ao redor de uma Evidence existente.';
  readonly inputSchema = {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      evidence_id: { type: 'string', description: 'ID público curto fornecido em uma Evidence no contexto.' },
      direction: { type: 'string', enum: CONVERSATION_CONTEXT_DIRECTIONS },
    },
    required: ['evidence_id', 'direction'],
  };

  constructor(
    private readonly registry: ToolRegistryService,
    private readonly contextService: ConversationContextService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  execute(input: Record<string, unknown>, context: ToolExecutionContext): Promise<ConversationContextResult> {
    for (const key of Object.keys(input)) {
      if (key !== 'evidence_id' && key !== 'direction') {
        throw new ToolArgumentException(key, `conversation_context does not accept ${key}`);
      }
    }
    if (typeof input.evidence_id !== 'string' || !input.evidence_id.trim()) {
      throw new ToolArgumentException('evidence_id', 'evidence_id must be a non-empty string');
    }
    if (typeof input.direction !== 'string' || !CONVERSATION_CONTEXT_DIRECTIONS.includes(input.direction as ConversationContextDirection)) {
      throw new ToolArgumentException('direction', `direction must be one of: ${CONVERSATION_CONTEXT_DIRECTIONS.join(', ')}`);
    }
    return this.contextService.expand(
      input.evidence_id,
      input.direction as ConversationContextDirection,
      context,
    );
  }
}
