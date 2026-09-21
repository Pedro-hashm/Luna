# Tool `conversation_retrieval`

## Status

A primeira versão está implementada dentro de `apps/api/src/tools/conversation-retrieval` e registrada no `ToolRegistryService` como `conversation_retrieval`.

O executor pode ser chamado pelo `ToolsModule` através de `POST /tools/execute` com `tool: "conversation_retrieval"`; essa é a superfície de teste forçada do frontend e não envolve LLM. Durante uma conversa normal, o Orchestrator recebe a definição da tool pelo registry, emite um `tool_call` JSON, e o código valida e executa a mesma tool antes de devolver o resultado para a próxima iteração.

## Objetivo

Oferecer ao Orchestrator uma única interface sofisticada para recuperar informações de conversas históricas. Essa tool substitui as ferramentas separadas que haviam sido consideradas anteriormente:

- `conversation_search`;
- `conversation_get`;
- `conversation_search_by_date`.

O nome `conversation_retrieval` representa a responsabilidade completa: encontrar os trechos relevantes, recuperar o conteúdo necessário e devolvê-lo pronto para o context builder.

Por padrão, a tool pesquisa apenas conversas históricas fora da conversa atual. Identificadores internos não fazem parte da entrada do modelo: o executor recebe a conversa atual, a mensagem atual e o relógio da iteração como contexto de runtime. Quando o usuário pedir explicitamente para pesquisar nesta conversa, o Orchestrator usa `searchCurrentConversation: true`; o runtime então aplica o escopo e o corte temporal corretos sem UUIDs no JSON do modelo.

## O que a tool deve resolver

Exemplos de solicitações:

```text
"Qual era mesmo aquele jogo que a gente estava discutindo semana passada?"
"Recupere o que decidimos sobre o módulo de memória."
"Abra a conversa de setembro sobre o TCC."
"Encontre conversas antigas onde falamos sobre o projeto Luna."
```

A tool deve conseguir combinar:

- busca semântica;
- filtros de data;
- escopo histórico por padrão ou da conversa atual quando solicitado explicitamente;
- recuperação de chunks e mensagens;
- ranking por similaridade;
- orçamento máximo de contexto;
- conteúdo recente de chunks ainda `open`.

## Fronteira com o contexto recente

O histórico imediato da conversa atual já é carregado pelo fluxo normal do `ConversationModule`. Por padrão, a tool exclui `context.conversationId` da busca. A conversa atual só entra quando o Orchestrator fornece `searchCurrentConversation: true`; nesse modo, o runtime exclui candidatos que começam depois de `context.currentMessageId` e limita a saída ao mesmo cutoff, para nunca incluir mensagens posteriores ao ponto atual.

## Resolução temporal pelo User Agent

A data e hora atuais não são uma tool do Orchestrator. O `ConversationService` as captura uma vez no início da interação e o `UserAgent` as recebe no estado inicial, propagando o mesmo valor durante todas as iterações.

Isso permite que o Orchestrator transforme expressões relativas em limites concretos sem fazer uma chamada adicional:

```text
User Agent: agora = 2026-09-20T15:00:00-03:00
Usuário: "semana passada"
Orchestrator: dateFrom = 2026-09-13, dateTo = 2026-09-19
```

Depois de resolver a janela, o Orchestrator chama `conversation_retrieval` com `dateFrom` e `dateTo`. O custo é praticamente nulo e a informação permanece disponível durante todas as iterações do mesmo ciclo.

```text
Conversation atual
       ↓
contexto recente do ConversationModule

Conversas antigas
       ↓
conversation_retrieval
       ↓
contexto histórico para o Orchestrator
```

## Entrada conceitual

O contrato definitivo será criado junto da implementação, mas a primeira versão deve suportar uma entrada equivalente a:

```ts
type ConversationRetrievalInput = {
  query?: string;
  dateFrom?: string;
  dateTo?: string;
  searchCurrentConversation?: boolean;
  maxContextTokens?: number;
  includeMessages?: boolean;
};

type ToolExecutionContext = {
  conversationId: string;
  currentMessageId: string;
  currentDateTime: string;
};
```

Defaults e limites atuais:

| Parâmetro | Default | Limite |
| --- | ---: | ---: |
| `topK` | `8` | definido pela configuração do runtime |
| `maxContextTokens` | `8000` | `1..20000` |
| `includeMessages` | `true` | booleano |

Datas no formato `YYYY-MM-DD` são interpretadas como datas do fuso configurado em `APP_TIMEZONE` — por padrão `America/Sao_Paulo` — usando início do dia para `dateFrom` e fim do dia para `dateTo`. Datas ISO com horário e offset preservam o instante informado.

### Campos

- `query`: semântica opcional usada para gerar o embedding da busca;
- `dateFrom` e `dateTo`: limites temporais opcionais, absorvendo a antiga ideia de `conversation_search_by_date`. Se somente um for informado, a janela fica aberta no outro lado;
- `searchCurrentConversation`: solicita o escopo da conversa atual; só deve ser usado para um pedido explícito do usuário;
- `maxContextTokens`: orçamento máximo do conteúdo devolvido;
- `includeMessages`: indica se a tool deve retornar mensagens estruturadas além do conteúdo concatenado dos chunks.

O runtime controla `topK`; o executor valida `maxContextTokens` para evitar que o modelo solicite contexto sem limite. `conversationId`, `currentMessageId` e o horário atual pertencem exclusivamente ao contexto de execução, não ao schema do LLM.

`query`, `dateFrom` e `dateTo` são independentes e opcionais. A ausência de `query` não significa que a solicitação é inválida: nesse caso, a tool faz recuperação direta usando o escopo temporal informado, sem gerar embedding.

### Exemplos de interpretação

```text
"Lembra a conversa de semana passada?"
→ dateFrom + dateTo
→ recuperação direta e cronológica, sem query semântica
```

```text
"Lembra aquela conversa de jogos semana passada?"
→ dateFrom + dateTo + query="jogos"
→ busca semântica restrita à janela da semana passada
```

```text
"Encontre conversas antigas sobre o projeto Luna."
→ query="projeto Luna"
→ busca semântica sem filtro temporal
```

```text
"Procura algumas mensagens atrás nesta conversa quando falamos de Tokyo Ghoul."
→ query="Tokyo Ghoul" + searchCurrentConversation=true
→ o runtime usa a conversa e a mensagem atuais, sem UUID no argumento
```

## Saída conceitual

```ts
type ConversationRetrievalResult = {
  query: string | null;
  results: Array<{
    conversationId: string;
    chunkId: string;
    status: "open" | "closed";
    score: number;
    content: string;
    tailContent?: string;
    startMessageId: string;
    endMessageId: string;
    tokenCount: number;
    messages?: Array<{
      id: string;
      role: string;
      content: string;
      createdAt: string;
    }>;
  }>;
};
```

Esse é o resultado interno, preservado para logs e observabilidade. Antes de ser devolvido ao Orchestrator ou à Luna, ele é projetado para remover `conversationId`, `chunkId`, `startMessageId`, `endMessageId`, IDs de mensagens e timestamps técnicos; os modelos recebem apenas conteúdo e metadados semânticos.

## Pipeline de execução

### 1. Normalizar a solicitação

Interpretar a intenção do Orchestrator e validar os filtros semânticos. O contexto de runtime determina o escopo: histórico exclui a conversa atual; `searchCurrentConversation` seleciona a conversa atual e exige a mensagem atual como cutoff.

### 2. Escolher a estratégia de recuperação

- com `query`, executar busca semântica;
- com `query` e datas, executar busca semântica dentro da janela temporal;
- sem `query`, mas com `dateFrom` ou `dateTo`, recuperar diretamente pelo escopo informado, em ordem cronológica;
- sem `query` e sem qualquer escopo, rejeitar a solicitação por falta de critérios de recuperação.

### 3. Gerar o vetor da consulta quando necessário

Somente quando existir `query`, gerar o embedding com o **Qwen Embedding 0.6B**, produzindo um vetor de dimensão 1024.

A consulta deve usar o mesmo modelo e a mesma preparação textual dos embeddings persistidos nos chunks.

### 4. Selecionar candidatos

Na busca semântica, buscar `ConversationChunk` por similaridade no `pgvector`, aplicando filtros estruturados antes ou durante a consulta:

- escopo derivado do runtime;
- período;
- usuário, quando existir autenticação;
- status;
- existência de embedding.

Na recuperação direta sem `query`, não é necessário calcular embedding nem ordenar por distância. Os chunks e mensagens devem ser filtrados pelo escopo solicitado e ordenados cronologicamente.

Chunks `open` e `closed` podem participar do ranking. O embedding de um chunk `open` representa a última versão indexada, não necessariamente todo o conteúdo atual.

### 5. Recuperar conteúdo atualizado

Depois do ranking, carregar o conteúdo atual dos chunks selecionados.

Para cada chunk `open`, identificar e anexar a tail que chegou depois da última atualização do embedding. O resultado nunca deve esconder mensagens recentes apenas porque elas ainda não atingiram o próximo marco de 1000 tokens.

Para chunks `closed`, o conteúdo persistido já representa a versão final e não existe tail pendente.

### 6. Expandir para mensagens quando necessário

Quando `includeMessages` estiver habilitado, usar internamente `startMessageId` e `endMessageId` para recuperar as mensagens originais. A expansão deve considerar que o overlap faz a mesma mensagem aparecer em chunks vizinhos. Esses IDs ficam em logs e observabilidade, não na representação devolvida ao LLM.

### 7. Deduplicar e ordenar

Ordenar os trechos de acordo com relevância e, dentro de cada trecho, manter a ordem cronológica. Remover mensagens duplicadas causadas pelo overlap usando o ID da mensagem como chave.

### 8. Aplicar orçamento

Limitar a saída a `maxContextTokens`. O limite deve ser aplicado depois da inclusão da tail e da deduplicação, para refletir o custo real do contexto que será entregue ao modelo.

### 9. Retornar fontes

Devolver os chunks selecionados, score/distância, status, limites de mensagens e conteúdo efetivamente incluído. Isso permitirá auditar por que um contexto foi recuperado.

## Estado dos chunks

A estratégia dos chunks está detalhada em [old-history-retrieval.md](../../conversation/old-history-retrieval.md).

Resumo dos parâmetros iniciais:

```text
chunk fechado:       3200 tokens novos + 800 de overlap ≈ 4000 tokens
reindexação aberta:  a cada 1000 tokens novos
embedding:           Qwen Embedding 0.6B, vector(1024)
```

Um chunk `open` deve trazer a tail não indexada junto com o conteúdo recuperado. A implementação usa `end_message_id` como limite do último embedding: as mensagens posteriores a esse ID formam a tail. `token_count` registra o tamanho lógico atual do chunk, incluindo essa tail.

## Casos de borda

- nenhum chunk possui embedding: retornar vazio ou usar uma estratégia textual/recentemente criada definida pelo Orchestrator;
- chunk `open` ainda muito pequeno: permitir recuperação direta quando o escopo for explícito, mesmo com baixa confiança semântica;
- mensagem maior que o limite do chunk: respeitar a política de segmentação escolhida pelo chunker;
- overlap com mensagens repetidas: deduplicar por ID, preservando a primeira posição cronológica;
- tail maior que o orçamento: truncar com uma regra determinística e informar a limitação;
- duas mensagens atualizando o mesmo chunk: proteger com transação, lock ou controle otimista de versão;
- falha na geração de embedding: não perder a mensagem persistida e marcar a atualização para retry;
- conversa apagada: remover ou invalidar seus chunks e embeddings;
- modelo de embedding alterado: reindexar antes de misturar os vetores novos com os antigos.

## Segurança e escopo

A tool deve receber o usuário autenticado quando essa camada existir e nunca devolver chunks pertencentes a outro usuário. Antes da autenticação, a implementação local pode operar sem esse filtro, mas isso deve ser tratado como limitação de desenvolvimento.

Como é uma tool de leitura, não deve alterar mensagens ou conversas. A única operação indireta prevista é solicitar ou disparar a atualização de embeddings, se essa responsabilidade não ficar em um job separado.

## Integração com o Orchestrator

O Orchestrator pode chamar a tool durante suas iterações:

```text
mensagem do usuário
        ↓
Orchestrator decide que falta histórico
        ↓
conversation_retrieval(input)
        ↓
resultado com fontes e contexto
        ↓
resultado é mantido no estado operacional do Orchestrator
        ↓
outra iteração de decisão ou finalização
```

O resultado da tool não é a resposta final ao usuário. Ele é contexto intermediário para o Orchestrator e para o `LunaModule`, que recebe apenas conteúdo, score, status e metadados semânticos confiáveis. IDs de conversa, chunk e mensagem podem continuar no resultado interno e na observabilidade, mas são removidos da projeção enviada aos modelos.

## Implementação atual e decisões pendentes

- o schema inicial da entrada e da saída está definido nos tipos do módulo e validado pelo registry;
- `end_message_id` marca o último conteúdo incluído no embedding; a tail aberta é carregada em tempo de retrieval;
- `topK`, orçamento e `includeMessages` possuem defaults seguros na primeira versão; `topK` é decidido pela configuração, não pelo LLM;
- ainda falta decidir um score mínimo específico por produto;
- definir a política de fallback sem embeddings;
- definir a métrica e o índice do `pgvector`;
- definir autorização e escopo por usuário;
- escolher se a geração de embeddings acontece dentro da tool ou em processo assíncrono separado.
