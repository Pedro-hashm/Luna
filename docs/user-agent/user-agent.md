# UserAgent

## Responsabilidade

O `UserAgentModule` mantém o estado de runtime de uma única iteração de conversa. Ele fica entre o `ConversationModule` e as camadas de decisão/geração:

```text
ConversationModule
        ↓
    UserAgent
        ↓
   Orchestrator
        ↓
      Tools
        ↓
   Orchestrator
        ↓
    UserAgent
        ↓
    LunaModule
```

O UserAgent não escolhe tools e não gera a resposta final. Ele cria o estado inicial, entrega-o ao Orchestrator, recebe o resultado operacional e o encaminha ao `LunaModule`.

## Estado inicial

O `ConversationService` persiste primeiro a mensagem do usuário e captura uma única data/hora para a iteração. Depois constrói o estado:

```ts
type UserAgentInitialState = {
  requestId: string;
  input: string;
  conversationId: string;
  currentDateTime: string;
  recentMessages: RuntimeMessage[];
};
```

O estado também já contém espaços extensíveis para `memory`, `preferences` e `runtime`, todos vazios na implementação atual.

`currentDateTime` é obtido uma vez no `ConversationModule` e propagado como ISO string. Orchestrator e Luna usam esse mesmo valor; eles não recalculam a noção temporal da interação.

## Contexto imediato

`ContextManagerService` monta uma janela cronológica de mensagens recentes. O limite padrão é **32.000 tokens estimados** e fica persistido em `application_settings.immediate_context_max_tokens`.

- a estimativa atual usa aproximadamente quatro caracteres por token;
- o algoritmo percorre as mensagens da mais recente para a mais antiga;
- ele mantém a maior sequência final que cabe no orçamento;
- mensagens antigas que ficaram fora continuam no banco e podem ser recuperadas por `conversation_retrieval`;
- uma mensagem mais recente excepcionalmente maior que todo o orçamento é truncada somente no contexto enviado, nunca no banco.

Não existe ainda um context builder dinâmico, sumarização automática ou tokenizer específico do modelo.

## Resultado

`UserAgentService.run()` retorna o estado criado, o resultado operacional do Orchestrator, o resultado do `LunaModule` e durações de etapa. O `ConversationService` é o único responsável por persistir a mensagem final `assistant`.

Isso preserva a separação entre runtime da interação e persistência da conversa.
