# Orchestrator Tools

## Objetivo

Este documento registra o catálogo inicial de ferramentas que poderão ser usadas pelo `Orchestrator` da Luna.

O catálogo continua sendo maior que a implementação atual, mas a primeira tool já possui um executor funcional. O `ToolsModule` é o ponto de entrada para registrar e despachar as tools, enquanto cada tool fica em seu próprio submódulo.

## Fluxo atual e evolução

O Orchestrator é uma camada entre a entrada da conversa e a resposta final da Luna:

```text
entrada do usuário
        ↓
Orchestrator
        ├─ prompt de instruções
        ├─ lista de tools e interfaces
        ├─ chamadas iterativas ao modelo
        ├─ execução das tools
        └─ atualização do User Agent
                ↓
        respond(contexto, instruções)
                ↓
             Luna
       personalidade e resposta final
```

O Orchestrator já itera enquanto precisar consultar tools, respeitando limites configuráveis de iterações e chamadas. Quando tem contexto suficiente, retorna instruções operacionais e resultados de tools ao `UserAgent`, que encaminha esses dados ao `LunaModule` para gerar a resposta final. A personalidade completa da Luna ainda é futura.

O combo dessas chamadas é independente do combo usado pela geração final:

```env
LLM_COMBO=local-general
ORCHESTRATOR_COMBO=local-general
```

`LLM_COMBO` controla a geração final do `LunaModule`. `ORCHESTRATOR_COMBO` controla somente o ciclo de decisão, permitindo testar o raciocínio localmente ou trocar para um modelo pago sem alterar a resposta final.

## Contrato conceitual de uma tool

Cada ferramenta deverá futuramente expor, no mínimo:

- `name`: identificador estável usado pelo modelo;
- `description`: quando usar e quando não usar;
- `inputSchema`: parâmetros aceitos e validações;
- `execute(input, context)`: execução feita pela API;
- resultado serializável para voltar ao ciclo do Orchestrator.

O `ToolRegistryService` é a fonte das definitions expostas ao Orchestrator. Cada tool se registra com nome, descrição, schema e executor. O executor público continua disponível em `POST /tools/execute`; ele é uma superfície de teste forçada e não chama o Orchestrator nem o LLM.

As tools devem ser pequenas e especializadas. Memória permanente, histórico de conversa, web, sistema, código e Obsidian são fontes diferentes e não devem ser misturadas em uma única busca genérica.

## 🧠 Memory Tools

### `memory_search`

Busca memórias permanentes sobre o usuário, preservadas porque a Luna decidiu que são relevantes para interações futuras.

Exemplos de conteúdo:

- preferências;
- hábitos;
- informações pessoais relevantes;
- preferências de interação;
- fatos persistentes sobre projetos e interesses.

Não pesquisa conversas antigas diretamente. Uma entrada possível seria:

```text
O usuário prefere respostas curtas.
```

### `memory_create`

Cria uma memória permanente sobre o usuário. A decisão de criar a memória deve pertencer ao sistema de memória ou ao Orchestrator, conforme a política que ainda será definida.

Exemplo:

```text
Usuário: "Pode guardar que eu prefiro respostas mais diretas."
→ memory_create
```

### `memory_update`

Atualiza uma memória existente quando uma informação nova substitui ou refina a anterior.

Exemplo:

```text
Memória atual: "Usuário prefere respostas curtas."
Nova instrução: "Pode explicar com mais detalhes quando for programação."
→ memory_update
```

### `memory_delete`

Remove uma memória permanente quando o usuário deixa de querer que ela seja considerada.

Exemplo:

```text
"Não quero mais que você considere que eu prefiro respostas curtas."
→ memory_delete ou atualização equivalente
```

## 📚 Historical Conversation Tools

### `conversation_retrieval`

É a única tool de recuperação de histórico. Ela substitui as antigas ideias separadas de `conversation_search`, `conversation_get` e `conversation_search_by_date`.

Busca, filtra e recupera conteúdo de conversas anteriores à conversa atual, combinando:

- intenção semântica;
- filtros por conversa;
- filtros temporais;
- ranking por embeddings de `ConversationChunk`;
- recuperação de mensagens completas;
- deduplicação do overlap;
- inclusão da tail não indexada de chunks `open`.

O contexto recente da conversa já pertence ao fluxo normal do `ConversationModule` e não deve ser pesquisado por padrão. A tool deve receber o identificador da conversa atual para excluí-la, mas permitir um escopo explícito quando o usuário pedir uma conversa específica.

Implementação atual:

- `ToolsModule` abriga o dispatcher e o `ConversationRetrievalModule`;
- `POST /tools/execute` aceita `tool: "conversation_retrieval"`;
- a busca sem `query` usa recuperação direta por conversa/data;
- a busca com `query` gera o embedding Qwen 0.6B e ranqueia os chunks no pgvector;
- chunks `open` recebem a tail posterior ao `end_message_id`;
- `includeMessages` vem habilitado por padrão e deduplica mensagens repetidas pelo overlap;
- o orçamento padrão é 8.000 tokens, com `topK` padrão 8.

O fluxo detalhado de chunks abertos, chunks fechados, atualização a cada 1000 tokens, fechamento em 4000 tokens e overlap de 800 tokens está documentado em [old-history-retrieval.md](../conversation/old-history-retrieval.md). O contrato específico da tool está em [conversation-retrieval.md](tools/conversation-retrieval.md).

## 🌐 Web / External Information

### `web_search`

Pesquisa informações atuais ou externas à Luna, como preços, notícias, documentação e fatos posteriores ao histórico disponível.

A arquitetura anterior utilizava SearXNG como mecanismo de busca.

### `web_fetch`

Obtém o conteúdo de uma página específica, normalmente depois que `web_search` encontra um resultado relevante.

```text
web_search → encontra páginas
web_fetch  → lê uma página específica
```

## 🧰 Ferramentas do próprio sistema

### `system_info`

Consulta informações do ambiente da Luna.

Possíveis dados futuros:

- sistema operacional;
- recursos disponíveis;
- modelos instalados;
- status de serviços;
- GPU;
- limites ou capacidades do ambiente.

Esta tool não precisa existir na primeira versão.

### `codebase_search`

Busca informações no código da própria Luna.

Exemplo:

```text
"Onde está implementado o Orchestrator?"
→ codebase_search
```

É uma fonte de conhecimento diferente de memória, histórico de conversas e documentação no Obsidian.

## 📝 Obsidian

O Obsidian é uma réplica ou superfície de consulta, não a fonte primária da memória ou do histórico de conversas.

### `obsidian_search`

Pesquisa diretamente no vault do Obsidian, incluindo notas pessoais, projetos, documentação e registros que não estejam no banco.

### `obsidian_read`

Lê uma nota específica do Obsidian depois que ela foi localizada.

### `obsidian_write`

Cria ou edita uma nota no Obsidian.

Por alterar dados externos, deverá exigir uma política de permissão e confirmação mais explícita do que tools somente de leitura.

## Decisões pendentes

- definir o formato de resultado e erro compartilhado entre múltiplas tools;
- definir orçamento mais sofisticado de iterações e custo;
- definir quais tools são somente leitura e quais alteram dados;
- definir aprovação para `memory_create`, `memory_update`, `memory_delete` e `obsidian_write`;
- definir a política de memória e como ela preenche o estado do UserAgent;
- evoluir o `LunaModule` mínimo para personalidade, contexto compilado e políticas de resposta.

## Estado atual

- Orchestrator: implementado com protocolo JSON, loop controlado e limites básicos;
- User Agent: implementado como estado de runtime da interação;
- demais ferramentas: somente documentadas;
- `ToolsModule`: implementado como dispatcher inicial;
- combo do Orchestrator: separado em `ORCHESTRATOR_COMBO`;
- tool de histórico: `conversation_retrieval` implementada;
- data e hora atual: responsabilidade do `User Agent` em cada iteração, não uma tool separada;
