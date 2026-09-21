# Orchestrator

## Responsabilidade

O `OrchestratorModule` é o planejador da Luna. Ele avalia o contexto imediato, a entrada atual, o horário da iteração e as tools registradas para decidir se precisa recuperar informação antes da camada final responder.

Ele não responde diretamente ao usuário e não devolve chain-of-thought. Seu resultado contém apenas dados operacionais:

- contexto original;
- registros de decisões sem raciocínio interno;
- tools executadas, argumentos, resultado ou erro;
- quantidade de iterações;
- uma decisão de finalização; as instruções operacionais são definidas pelo backend e passadas à camada final `LunaModule`.

## Protocolo de decisão

O modelo do Orchestrator recebe um system prompt estrito e deve retornar somente um objeto JSON:

```json
{
  "type": "tool_call",
  "tool": "conversation_retrieval",
  "arguments": {
    "query": "jogos",
    "dateFrom": "2026-09-14",
    "dateTo": "2026-09-20"
  }
}
```

Ou, quando houver informação suficiente:

```json
{
  "type": "finalize"
}
```

O modelo do Orchestrator não pode escrever a resposta final nem fornecer texto livre em `finalize`. A aplicação usa uma orientação operacional conservadora fixa para a Luna. Isso evita que uma saudação ou uma resposta inventada seja tratada como uma instrução de sistema e apareça como se tivesse sido produzida pela camada errada.

Se o protocolo vier inválido, a aplicação faz fallback seguro para finalização com o contexto já disponível. Isso impede que uma resposta malformada do modelo impeça a conversa inteira de receber uma resposta.

## Loop controlado

O código — e não o modelo — controla a execução:

```text
decisão estruturada
        ↓
validação no ToolRegistry
        ↓
execução da tool
        ↓
resultado adicionado ao estado
        ↓
nova decisão ou finalização
```

Há limites básicos persistidos em `application_settings`:

- `orchestrator_max_iterations`: default `4`;
- `orchestrator_max_tool_calls`: default `3`.
- `orchestrator_tool_result_max_tokens`: default `1000` por resultado de tool reinjetado no modelo local.

Eles são proteções simples contra loops. Não existe ainda orçamento avançado de custo ou tokens.

Uma chamada idêntica de mesma tool e mesmos argumentos também é interrompida: como não houve mudança de estado entre as iterações, repeti-la não adicionaria informação e apenas consumiria o orçamento. O prompt ainda esclarece que anos mencionados como assunto (por exemplo, `GOTY de 2024`) devem ficar na `query`, e não virar filtro de data da conversa sem um pedido temporal explícito.

Para `conversation_retrieval`, o código normaliza a execução do Orchestrator com `includeMessages: false` e limita `maxContextTokens` ao teto acima. A rota de teste forçada não recebe essa normalização, pois sua finalidade é inspecionar a saída completa da tool.

Antes de executar a tool, a aplicação também remove `conversationId` inválido ou igual ao `conversationId` atual. O histórico não deve pesquisar a conversa corrente, mesmo que o modelo local invente um UUID ou tente reutilizar o ID que recebeu no estado da iteração. Um `conversationId` válido só é preservado quando representa outra conversa, normalmente obtida de um resultado anterior da própria tool.

O default conservador de 1000 foi validado contra o combo local atual, que expõe 4096 tokens de contexto. Se um combo com janela maior for configurado no OmniRoute, esse limite pode ser aumentado pela interface.

## Tool Registry

`ToolRegistryService` mantém as definitions disponíveis para o Orchestrator. Cada tool registra:

- `name`;
- `description`;
- `inputSchema`;
- executor validado.

Hoje, `ConversationRetrievalTool` se registra ao iniciar o `ToolsModule`. O prompt recebe as definitions serializadas pelo registry, portanto não precisa listar manualmente cada tool. Novas tools devem seguir o mesmo padrão e não alterar o prompt principal.

## LunaModule mínimo

O `LunaModule` atual é uma camada mínima, sem a personalidade final planejada. Ele recebe o contexto imediato, instruções operacionais e resultados confiáveis de tools; então reutiliza o `LlmModule` com `llmCombo` para produzir a resposta persistida pela conversa.

O combo de decisão é independente e vem de `orchestratorCombo`.

## Observabilidade

Cada chamada de decisão do Orchestrator, cada execução de tool e a geração final da Luna recebem o mesmo `requestId` nos traces. O dashboard e o inspector podem, portanto, apresentar as etapas reais da mesma interação sem expor raciocínio interno.
