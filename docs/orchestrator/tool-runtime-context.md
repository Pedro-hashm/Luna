# Contexto de runtime das tools

## Princípio

O Orchestrator decide intenção; o runtime resolve identificadores concretos. Um modelo não deve precisar copiar UUIDs, IDs de conversa, IDs de mensagem, IDs de chunk, request IDs, sessão, usuário ou outros valores técnicos que a aplicação já conhece exatamente.

Cada parâmetro de uma tool deve ser classificado antes de entrar no schema:

| Categoria | Responsável | Exemplos |
| --- | --- | --- |
| LLM-owned | Orchestrator | `query`, filtros semânticos, `scope`, intervalo temporal solicitado |
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

`currentDateTime` usa ISO 8601 com o offset de `application_settings.app_timezone`. O modelo deve derivar "hoje", "ontem" e janelas relativas da data local exibida nesse valor, nunca da conversão para UTC.

## `conversation_retrieval`

`conversation_retrieval` aceita um escopo semântico opcional. Se o Orchestrator não o informar, o backend usa `auto`:

- `auto`: não aplica uma restrição de conversa; pode recuperar a conversa atual e outras conversas;
- `current_conversation`: restringe à conversa atual;
- `historical`: exclui a conversa atual e pesquisa somente outras conversas.

O Orchestrator só usa os dois escopos restritivos quando o usuário os pediu explicitamente. A ausência de uma informação no contexto imediato é razão para usar retrieval, nunca para assumir `current_conversation`.

Durante a transição da arquitetura anterior, se um modelo ainda emitir a flag aposentada `searchCurrentConversation`, o Orchestrator a descarta e aplica `auto`. A flag não faz parte do schema atual da tool.

Quando o usuário pede explicitamente para procurar nesta conversa, o Orchestrator usa:

```json
{
  "query": "tokyo ghoul",
  "scope": "current_conversation"
}
```

No escopo `current_conversation`, o serviço usa `context.conversationId`, elimina já na seleção chunks cujo início está depois de `currentMessageId` e limita a expansão do conteúdo à mesma mensagem. Em `auto`, a conversa atual continua elegível, mas recebe o mesmo cutoff temporal; outras conversas permanecem elegíveis integralmente.

## Resultados devolvidos ao modelo

O armazenamento e a observabilidade podem manter IDs de fonte para auditoria. A representação entregue ao Orchestrator e ao LunaModule remove esses IDs e mantém apenas conteúdo, score, status e metadados semânticos necessários para a resposta.

Cada resultado de `conversation_retrieval` inclui também `timeRange` (`start`, `end` e `timeZone`), criado pelo backend a partir das mensagens que realmente foram recuperadas. Esse metadado é confiável para o modelo e não deve ser inferido novamente pelo conteúdo. Se a execução recebeu `dateFrom` e/ou `dateTo`, a expansão já removeu mensagens fora da janela antes de devolver o resultado; a Luna só pode usar aqueles resultados como evidência para o período pedido.

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
