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
  currentMessageId: string;
  currentDateTime: string;
  recentMessages: RuntimeMessage[];
};
```

O estado também já contém espaços extensíveis para `memory`, `preferences` e `runtime`, todos vazios na implementação atual.

`currentDateTime` é obtido uma vez no `ConversationModule` e propagado como ISO 8601 no fuso configurado, incluindo o offset — por exemplo, `2026-09-21T21:25:00.000-03:00`. Assim, "hoje" sempre é interpretado pela data local da aplicação, não pela data UTC. `currentMessageId` aponta para a mensagem de usuário persistida que iniciou a iteração. Orchestrator e Luna usam o mesmo valor temporal; tools recebem ambos como contexto de runtime e não pedem que o modelo reproduza identificadores técnicos.

Os instantes persistidos no PostgreSQL permanecem canônicos em UTC. A API os serializa no `appTimezone` para telas e observabilidade; o armazenamento em UTC evita alterar o instante histórico ao trocar de fuso ou durante mudanças de horário de verão.

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
