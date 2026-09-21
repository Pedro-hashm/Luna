# Documentação da Luna V2

## Conversation

- [Conversation Module](conversation/conversation-module.md)
- [Histórico antigo com ConversationChunk](conversation/old-history-retrieval.md)

## Runtime da interação

- [UserAgent e contexto imediato](user-agent/user-agent.md)
- [Orchestrator, Tool Registry e LunaModule](orchestrator/orchestrator.md)

## Configurações

- [Configurações persistidas da aplicação](settings/application-settings.md)

## Observabilidade

- [Métricas, inspector de contexto e traces](observability/observability.md)

As features de observabilidade incluem extensões preparadas para módulos futuros. As dependências e os estados incompletos estão registradas na seção [Dependências futuras da interface](observability/observability.md#dependencias-futuras-da-interface).

## Orchestrator

- [Catálogo de tools](orchestrator/tools.md)
- [Tool `conversation_retrieval`](orchestrator/tools/conversation-retrieval.md)

O Orchestrator, UserAgent e a integração inicial da `conversation_retrieval` estão implementados. Memória permanente, personalidade completa da Luna, context builder dinâmico e outras tools continuam planejados e devem ser atualizados junto com as decisões de implementação.
