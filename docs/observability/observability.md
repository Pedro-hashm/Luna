# Observabilidade

## Objetivo

A observabilidade registra o caminho técnico das operações sem alterar o resultado da conversa. Cada execução de LLM ou tool pode gerar um `ObservabilityTrace` no Postgres.

O registro é modular. O Orchestrator e o LunaModule já adicionam traces ao mesmo ciclo; memória e futuras fontes de contexto poderão preencher novas partes sem mudar a interface do dashboard.

## Trace

Um trace pode ser:

- `llm`: decisão do Orchestrator ou geração final do LunaModule;
- `tool`: execução de uma tool, como `conversation_retrieval`.

O trace registra:

- status de sucesso, erro ou timeout;
- combo e modelo;
- tokens informados pelo provedor e estimativas locais;
- latência total;
- duração por etapa;
- snapshot do contexto, separado em imediato, memória, resultados de tools, sistema da Luna e instruções do Orchestrator;
- conversa e mensagem de resposta relacionadas, quando existirem.

Quando o provedor não devolve `usage`, a aplicação estima tokens pela regra aproximada de quatro caracteres por token. A interface identifica esses números como estimativas.

## Endpoints

```text
GET /observability/metrics?from=<ISO>&to=<ISO>
GET /observability/conversations/:conversationId
```

O primeiro endpoint retorna resumo, série diária, tempo por etapa, distribuição de combos/modelos e execuções recentes.

O segundo retorna as estatísticas da conversa e os traces necessários para o inspector de contexto.

## Interface

A tela está disponível em `/observability` e contém:

- requests, tokens, latência e saúde do período;
- gráfico simples por dia;
- tempo acumulado e médio por etapa;
- combos/modelos utilizados;
- últimas execuções;
- visualização do fluxo `Você → Context → Orchestrator → Tools → Memory → Luna`;
- estatísticas da conversa selecionada;
- inspector de cada resposta, com contexto e contribuição estimada por parte.

No inspector, `Sistema da Luna` mostra as mensagens de sistema realmente montadas para a geração final, como o prompt base e o horário da iteração. `Instruções do Orchestrator` mostra a orientação operacional fornecida pelo backend depois que o Orchestrator decidiu que não havia mais tools a executar. Essa orientação não é uma resposta ao usuário. Os resultados de `conversation_retrieval` permanecem em `Tools usadas`, separados dessas duas camadas.

O Orchestrator e o LunaModule agora emitem atividade real. O nó de Memory permanece em estado futuro, pois não existe `MemoryModule` nesta fase. O sistema não registra atividade fictícia.

## Dependências futuras da interface

Parte da interface foi criada antecipadamente para acompanhar a arquitetura planejada. Esses elementos já possuem estados vazios, estimativas ou visualização estrutural, mas dependem de módulos que ainda não existem para mostrar dados completos.

| Feature | Funciona hoje com | Depende futuramente de | Estado atual |
| --- | --- | --- | --- |
| Dashboard de métricas | ConversationModule, Orchestrator, LunaModule, ToolsModule e `ObservabilityTrace` | MemoryModule e novos executores de etapas | Decisões, tools e geração final já são persistidas pelo mesmo `requestId` |
| Inspector de contexto | Histórico imediato, resultado de tools, Orchestrator e LunaModule | Context Builder e MemoryModule | O contexto imediato e tools reais aparecem; memória ainda fica vazia |
| Cérebro da Luna | Estados de request e traces observados | MemoryModule e futuras tools | Orchestrator, tools chamadas e Luna podem acender com eventos reais; Memory permanece inativo |
| Token counter | Estimativa por caracteres no frontend | Tokenizer do modelo, Context Builder e limite real de contexto | É uma estimativa visual; não representa ainda a tokenização exata do Qwen |
| Conversation statistics | Mensagens persistidas e traces | MemoryModule e fontes de conversas relacionadas | Mensagens, tokens, duração e tools funcionam; memórias/relacionadas retornam zero quando não há fonte real |
| Tempo por etapa | Contexto, Orchestrator, Luna, persistência, chunks e execução de tool | Context Builder e futuras etapas | Mostra somente as etapas que já emitiram trace |

### Regras para evolução

- Não remover os estados vazios da UI apenas para esconder módulos ainda não implementados.
- Quando um módulo novo for conectado, ele deve emitir eventos ou preencher o `contextSnapshot` do trace em vez de criar uma implementação paralela no frontend.
- O Orchestrator reutiliza o mesmo `requestId` em todas as iterações, permitindo agrupar LLM, tools e resposta final.
- O MemoryModule deverá preencher a parte `memory` do contexto com itens recuperados e tokens consumidos.
- O Context Builder deverá ser a fonte oficial da composição e da contagem do contexto final; o contador visual do chat deve continuar identificado como estimativa enquanto isso não existir.
- O LunaModule já registra a geração final; personalidade e políticas futuras podem complementar o snapshot sem criar outro formato de trace.
- Uma futura autenticação/escopo por usuário deve ser aplicada também nos endpoints do inspector e dashboard.

## Token counter

O chat mostra uma estimativa em tempo real do contexto atual, separando input, memória, histórico, tools e output. A estimativa do frontend é visual e não substitui o usage retornado pelo provedor.

## Evolução planejada

- enriquecer a interface com agrupamento visual dos traces de um mesmo `requestId`;
- preencher memória recuperada e contexto histórico real;
- adicionar retenção/limpeza de traces antigos;
- proteger o inspector por autenticação quando houver múltiplos usuários;
- substituir estimativas por tokenizer específico quando a precisão for necessária.
