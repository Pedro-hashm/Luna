import { Injectable, OnModuleInit } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { bounded, day, MEMORY_KINDS, MEMORY_OPERATIONS, normal } from '../memory/memory.types';
import { ToolRegistryService } from './tool-registry.service';
import { ToolArgumentException, ToolRuntimeContextException } from './types/tool-errors';
import type { ToolExecutionContext } from './types/tool.types';

const text = { type: 'string' };
const identity = { subject: text, predicate: text, scope: text };

@Injectable()
export class MemoryTools implements OnModuleInit {
  constructor(private readonly registry: ToolRegistryService, private readonly memory: MemoryService) {}

  onModuleInit() {
    this.registry.register({
      name: 'memory_search',
      description: 'Consulta fatos pessoais e preferências já confirmados e autorizados, vigentes na data pedida. Use conversation_retrieval para localizar o que foi dito no histórico.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        query: text, date: { type: 'string', description: 'AAAA-MM-DD, omita para hoje' },
        scope: { type: 'string', description: 'global ou o nome do projeto explicitamente mencionado neste turno' },
      } },
      execute: async (input, context) => {
        const { messageId } = this.runtime(context);
        const scope = input.scope ? bounded(input.scope, 'Escopo', 80) : 'global';
        const current = context.messages.find(message => message.id === messageId && message.role === 'user');
        if (scope !== 'global' && !normal(current?.content ?? '').includes(normal(scope))) {
          throw new ToolArgumentException('scope', 'O escopo precisa estar explícito no pedido.');
        }
        return this.memory.search(bounded(input.query, 'Consulta', 300), day(input.date) ?? context.currentDateTime!.slice(0, 10), scope);
      },
    });
    this.registry.register({
      name: 'memory_save',
      description: 'Grava uma memória quando o usuário pede explicitamente. Para fatos da pessoa, use subject Usuário. Copie value e quote literalmente do pedido atual. Use a mesma relação e escopo ao corrigir.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {
        ...identity, kind: { type: 'string', enum: MEMORY_KINDS }, value: text, quote: text,
        validFrom: { type: 'string', description: 'AAAA-MM-DD, omita se desconhecido' },
        operation: { type: 'string', enum: MEMORY_OPERATIONS },
      } },
      execute: async (input, context) => {
        const { messageId, conversationId } = this.runtime(context);
        return this.memory.explicitSave(input, messageId, conversationId);
      },
    });
    this.registry.register({
      name: 'memory_forget',
      description: 'Remove uma memória quando o usuário pede explicitamente para esquecê-la. A ferramenta identifica o alvo pelo texto original do pedido.',
      inputSchema: { type: 'object', additionalProperties: false, properties: {} },
      execute: async (_input, context) => {
        const { messageId, conversationId } = this.runtime(context);
        return this.memory.explicitForget(messageId, conversationId);
      },
    });
  }

  private runtime(context: ToolExecutionContext) {
    if (!context.currentMessageId || !context.conversationId || !context.currentDateTime) {
      throw new ToolRuntimeContextException('A memória exige um turno de conversa.');
    }
    return { messageId: context.currentMessageId, conversationId: context.conversationId };
  }
}
