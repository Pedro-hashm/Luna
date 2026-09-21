# Histórico antigo com retrieval por ConversationChunk

## Objetivo

Permitir que a aplicação recupere partes relevantes de conversas antigas sem enviar todo o histórico para o modelo. A conversa é dividida em chunks de mensagens concatenadas; cada chunk recebe um embedding e pode ser encontrado por similaridade semântica com a mensagem atual.

O chunk não é apenas um arquivo fechado. Enquanto a conversa está acontecendo, existe um chunk `open` que continua recebendo mensagens e cujo embedding é atualizado periodicamente. Isso permite recuperar uma conversa em andamento sem esperar que ela seja fechada.

## Estrutura persistida

### `conversations`

- `summary`: resumo textual opcional da conversa;
- `summary_embedding`: embedding opcional do resumo.

### `conversation_chunks`

- `conversation_id`: conversa à qual o chunk pertence;
- `content`: mensagens concatenadas até o último ponto indexado;
- `embedding`: vetor semântico do conteúdo indexado;
- `start_message_id`: primeira mensagem fisicamente incluída no conteúdo;
- `end_message_id`: última mensagem fisicamente incluída no conteúdo;
- `status`: `open` ou `closed`;
- `token_count`: quantidade total de tokens do conteúdo lógico atual do chunk, incluindo a tail ainda não indexada e o overlap;
- `created_at`: momento em que o chunk foi criado.

Os IDs inicial e final permitem localizar as mensagens originais. Como existe overlap, uma mesma mensagem pode aparecer no final de um chunk e no início do próximo; a montagem final do contexto deve deduplicar mensagens quando necessário.

## Parâmetros da estratégia

| Parâmetro | Valor inicial | Significado |
| --- | ---: | --- |
| limite total do chunk | 4000 tokens | tamanho aproximado do conteúdo total, incluindo overlap |
| tokens novos por chunk | 3200 tokens | conteúdo novo antes de fechar o chunk |
| overlap | 800 tokens | cauda do chunk anterior reaproveitada no próximo |
| intervalo de atualização | 1000 tokens | quantidade de tokens novos antes de recalcular o embedding |
| dimensão do embedding | 1024 | dimensão do Qwen Embedding 0.6B |

Assim, um chunk fechado terá aproximadamente:

```text
3200 tokens novos + 800 tokens de overlap = 4000 tokens
```

Os limites são medidos por tokens, não por quantidade de mensagens. A implementação deve preferir manter mensagens inteiras; se uma mensagem ultrapassar o limite, a política para esse caso precisa ser definida antes do chunker entrar em produção.

## Ciclo de vida do chunk

### 1. Criação do primeiro chunk

Quando uma conversa ainda não possui chunk, é criado um chunk `open` com as mensagens disponíveis. O embedding inicial pode ser gerado imediatamente, mesmo que o chunk ainda esteja abaixo de 1000 tokens.

### 2. Acúmulo de mensagens

Novas mensagens são concatenadas no chunk `open` e o `token_count` é atualizado. O contador considera o conteúdo completo armazenado no chunk, inclusive os tokens de overlap herdados do chunk anterior.

### 3. Atualização do embedding

Cada vez que forem acumulados 1000 tokens novos desde a última indexação, o sistema recalcula o embedding usando o conteúdo atual do chunk e atualiza a linha persistida.

O embedding representa sempre o conteúdo conhecido no último ponto de atualização. Portanto, depois de uma atualização pode existir uma cauda recente no banco que ainda não está refletida no vetor.

### 4. Fechamento

Quando o chunk alcançar aproximadamente 3200 tokens novos, ele é fechado com `status = closed`. O embedding deve ser recalculado no fechamento para representar a versão final do chunk.

O tamanho pode passar levemente de 4000 tokens quando for necessário preservar uma mensagem inteira. Essa tolerância deve ser registrada e monitorada, em vez de cortar uma mensagem sem uma política explícita.

### 5. Criação do próximo chunk com overlap

Ao fechar um chunk, os últimos 800 tokens do conteúdo anterior são copiados para o início do próximo chunk. O novo chunk nasce com `status = open` e acumula aproximadamente 3200 tokens novos até ser fechado.

```text
chunk N:     [conteúdo novo ................................][últimos 800]
chunk N+1:                                      [overlap 800][conteúdo novo .................]
```

O overlap deve respeitar limites de mensagens sempre que possível. Se os 800 tokens terminarem no meio de uma mensagem, a implementação precisa escolher entre preservar a mensagem inteira ou usar uma estratégia explícita de segmentação.

## Tail não indexada

Quando um retrieval encontra um chunk `open`, o sistema não pode retornar somente o conteúdo correspondente ao último embedding. Antes de devolver o resultado, deve acrescentar as mensagens posteriores ao `end_message_id`, que formam a tail recente ainda não refletida no embedding.

Exemplo:

```text
end_message_id:          M10
conteúdo indexado:       M1 ... M10
tail não indexada:        M11 ... M12
```

Nesse caso, o ranking usa o embedding até `M10`, mas o contexto retornado contém também as mensagens `M11` e `M12` — ou a parte limitada pelo orçamento da consulta.

### Limite da indexação

O `end_message_id` é o limite da última versão indexada. A tail não precisa ser persistida novamente: ela pode ser carregada pelas mensagens posteriores a esse ID enquanto o chunk estiver `open`. Quando o embedding for recalculado, `content`, `token_count` e `end_message_id` avançam juntos.

## Busca vetorial

O PostgreSQL utiliza a extensão `pgvector`. O modelo definido para esta feature é o **Qwen Embedding 0.6B**, com vetores de dimensão **1024**. Por isso, `summary_embedding` e `conversation_chunks.embedding` usam o tipo `vector(1024)`.

A busca de um chunk `open` usa o último embedding persistido para ranking e, depois da seleção, anexa a tail não indexada. Um chunk `closed` não possui tail pendente e pode ser recuperado diretamente.

Consulta conceitual:

```sql
SELECT id,
       conversation_id,
       content,
       embedding,
       start_message_id,
       end_message_id,
       status,
       token_count,
       embedding <=> $1 AS distance
FROM conversation_chunks
WHERE embedding IS NOT NULL
ORDER BY embedding <=> $1
LIMIT $2;
```

Quanto menor a distância, maior a similaridade. O operador e o índice devem ser escolhidos de acordo com a métrica usada pelo modelo, normalmente distância de cosseno ou distância euclidiana.

Não devemos misturar embeddings produzidos por outro modelo nesses campos. Se o modelo mudar, os chunks precisam ser reindexados antes de serem comparados com novos vetores.

## Relação com a tool `conversation_retrieval`

O Orchestrator terá uma única tool sofisticada para histórico. Ela substituirá as antigas ideias separadas de `conversation_search`, `conversation_get` e `conversation_search_by_date`.

Essa tool deverá:

1. interpretar a intenção de recuperação;
2. aplicar filtros de conversa, data ou escopo quando existirem;
3. gerar o embedding da consulta;
4. buscar chunks relevantes por similaridade;
5. incluir a tail atual dos chunks `open` selecionados;
6. recuperar mensagens completas quando necessário;
7. deduplicar o overlap;
8. devolver contexto e referências para auditoria.

A especificação detalhada da tool está em [conversation-retrieval.md](../orchestrator/tools/conversation-retrieval.md).

## Cuidados de implementação

- usar o mesmo modelo de embedding para a consulta e para os chunks comparados;
- usar uma tokenização consistente para contar tokens;
- persistir o texto exato usado para gerar cada embedding;
- guardar a versão do modelo de embedding quando a solução evoluir;
- limitar o contexto recuperado por tokens;
- deduplicar mensagens repetidas pelo overlap antes de montar o prompt;
- não pesquisar a conversa atual por padrão quando a intenção for histórico antigo;
- permitir escopo explícito quando o usuário pedir uma conversa específica;
- proteger o processo de atualização contra duas mensagens atualizando o mesmo chunk simultaneamente;
- tratar falhas de embedding sem perder as mensagens já persistidas;
- reprocessar os chunks quando houver mudança de modelo ou dimensão.

## Decisões pendentes

- escolher a métrica e o índice do `pgvector`;
- definir `topK`, score mínimo e orçamento máximo de tokens;
- definir se a busca atravessa conversas do mesmo usuário;
- decidir se o chunking acontece de forma síncrona, em background ou por job;
- definir a política para mensagens que ultrapassam os limites;
- definir a política de retry para geração de embeddings;
- definir como o resumo da conversa será atualizado;
- avaliar exclusão e reindexação dos embeddings quando uma conversa for apagada.
