# Configurações da aplicação

## Fonte de verdade

As configurações de runtime ficam no PostgreSQL e são editáveis pela tela `/settings`. As variáveis de ambiente continuam existindo para bootstrap inicial, mas não sobrescrevem uma configuração já persistida.

O endpoint usado pela interface é:

```text
GET   /settings
PATCH /settings
```

## Categorias atuais

### Geral

- `appTimezone`: fuso IANA usado para interpretar datas sem horário, como `dateFrom=2026-09-20`.

### LLM

- `llmCombo`: combo usado pelo `LunaModule` para a resposta final;
- `llmTemperature`: temperatura opcional;
- `llmMaxTokens`: limite opcional de tokens da resposta.

### Orchestrator

- `orchestratorCombo`: combo usado nas decisões iterativas do Orchestrator;
- `orchestratorMaxIterations`: limite de decisões por request;
- `orchestratorMaxToolCalls`: limite de tools executadas por request.
- `orchestratorToolResultMaxTokens`: teto do conteúdo de uma tool que pode ser reinjetado no prompt do Orchestrator; default `1000` para o combo local com contexto de 4096 tokens.

### Conversation · contexto imediato

- `immediateContextMaxTokens`: orçamento cronológico de mensagens recentes enviado para uma nova iteração; default `32000`.

### Tools · conversation retrieval

- `retrievalDefaultTopK`;
- `retrievalMaxTopK`;
- `retrievalDefaultMaxContextTokens`;
- `retrievalMaxContextTokens`;
- `retrievalIncludeMessages`.

Os valores informados diretamente por uma chamada da tool continuam tendo prioridade sobre os defaults, respeitando os limites persistidos.

No fluxo normal de agente, `conversation_retrieval` é ainda limitado por `orchestratorToolResultMaxTokens` e recebe `includeMessages: false`: o conteúdo concatenado já contém o contexto útil, enquanto mensagens estruturadas duplicariam o payload. A tela de teste forçado pode continuar pedir `includeMessages: true` quando essa inspeção for desejada.

### Conversation · chunks e embeddings

Esses valores ficam na tabela `conversation_chunk_settings`:

- `maxTokens`;
- `overlapTokens`;
- `embeddingRefreshTokens`;
- `embeddingModel`;
- `embeddingDimensions`.

`embeddingDimensions` aparece na interface apenas como leitura, pois o schema atual do banco usa `vector(1024)` e mudar essa dimensão exige uma migração estrutural e reindexação completa.

## O que continua fora da tela

URLs de serviços, `DATABASE_URL`, portas, volumes Docker, hostname e parâmetros de infraestrutura continuam nas envs/Compose. Eles definem a arquitetura de execução e não são configurações de comportamento da aplicação.
