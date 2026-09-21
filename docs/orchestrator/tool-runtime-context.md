# Contexto de runtime das tools

## Princípio

O Orchestrator decide intenção; o runtime resolve identificadores concretos. Um modelo não deve precisar copiar UUIDs, IDs de conversa, IDs de mensagem, IDs de chunk, request IDs, sessão, usuário ou outros valores técnicos que a aplicação já conhece exatamente.

Cada parâmetro de uma tool deve ser classificado antes de entrar no schema:

| Categoria | Responsável | Exemplos |
| --- | --- | --- |
| LLM-owned | Orchestrator | `query`, filtros semânticos, `searchCurrentConversation`, intervalo temporal solicitado |
| Runtime-owned | backend | `conversationId`, `currentMessageId`, `userId`, `requestId`, `currentDateTime` |
| Derived | backend | escopo elegível, exclusão da conversa atual, chunks candidatos, limites efetivos de contexto |

Valores runtime-owned e derived não pertencem ao `inputSchema` exposto ao modelo.

## Contrato de execução

```text
Orchestrator
  └─ argumentos semânticos
          ↓
Tool executor
  ├─ argumentos do LLM
  └─ contexto de runtime injetado pela API
          ↓
Tool service
```

O contexto atual padronizado é:

```ts
type ToolExecutionContext = {
  conversationId: string;
  currentMessageId: string;
  currentDateTime: string;
};
```

Em superfícies de teste sem uma conversa persistida, alguns valores podem estar ausentes. Tools que dependem deles devem interromper com erro `RUNTIME_CONTEXT`; a chamada normal do Orchestrator sempre os fornece.

## `conversation_retrieval`

Por padrão, `conversation_retrieval` procura apenas fora da conversa atual. O runtime aplica `conversationId != context.conversationId` sem expor esse filtro ao modelo.

Quando o usuário pede explicitamente para procurar nesta conversa, o Orchestrator usa:

```json
{
  "query": "tokyo ghoul",
  "searchCurrentConversation": true
}
```

O serviço troca o escopo para `context.conversationId`, elimina já na seleção chunks cujo início está depois de `currentMessageId` e limita a expansão do conteúdo à mesma mensagem. Assim, nem o ranking nem o conteúdo devolvido podem incluir mensagens que chegaram depois do ponto da interação.

## Resultados devolvidos ao modelo

O armazenamento e a observabilidade podem manter IDs de fonte para auditoria. A representação entregue ao Orchestrator e ao LunaModule remove esses IDs e mantém apenas conteúdo, score, status e metadados semânticos necessários para a resposta.

## Erros e retries

Erros retornados ao Orchestrator são estruturados:

```json
{
  "status": "error",
  "errorType": "INVALID_ARGUMENT",
  "tool": "conversation_retrieval",
  "argument": "query",
  "message": "The query could not be processed.",
  "modelRetryable": true
}
```

- `INVALID_ARGUMENT`: pode voltar ao modelo para uma nova decisão;
- `TRANSIENT`: uma tool de leitura e idempotente pode receber retry limitado do runtime;
- `RUNTIME_CONTEXT` e `TECHNICAL`: interrompem o loop, pois o modelo não consegue corrigir o ambiente.

Essa política evita usar o Orchestrator como copiador de contexto técnico.
