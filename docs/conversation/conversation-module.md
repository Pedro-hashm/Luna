# Conversation Module

## Responsabilidade

O `ConversationModule` é a porta de entrada do chat. Ele gerencia persistência e ciclo de vida da conversa, mas não decide tools nem chama o LLM diretamente para produzir a resposta.

Ele é responsável por:

1. criar ou carregar uma `Conversation`;
2. persistir a `Message` do usuário;
3. carregar o histórico persistido;
4. montar o contexto imediato limitado;
5. iniciar o `UserAgent`;
6. persistir a resposta final retornada pela camada Luna;
7. sincronizar os `ConversationChunk`s depois de uma resposta bem-sucedida.

## Fluxo atual

```text
HTTP request
    ↓
ConversationController
    ↓
ConversationService
    ├─ cria/carrega Conversation
    ├─ persiste Message(user)
    ├─ ContextManager: sufixo recente de até 32.000 tokens estimados
    ├─ UserAgent
    │   ├─ Orchestrator
    │   │   └─ ToolRegistry → conversation_retrieval, quando necessário
    │   └─ LunaModule → LlmService
    ├─ persiste Message(assistant)
    └─ ConversationChunkService.synchronizeConversation()
```

O `ConversationService` captura `currentDateTime` uma única vez antes de iniciar esse fluxo. O valor ISO é propagado ao `UserAgent`, ao `Orchestrator` e ao `LunaModule`; timestamps criados posteriormente servem somente para telemetria, não para decisões semânticas.

## Contexto imediato

O histórico inteiro permanece no PostgreSQL. Para cada nova interação, o `ContextManagerService` percorre as mensagens de trás para frente e preserva o maior sufixo cronológico que caiba no orçamento de contexto imediato.

| Configuração | Default | Efeito |
| --- | ---: | --- |
| `immediateContextMaxTokens` | `32000` | máximo estimado de tokens enviados ao `UserAgent`, Orchestrator e Luna |

A estimativa atual é deliberadamente simples: aproximadamente quatro caracteres por token, incluindo o papel da mensagem. Se a mensagem mais recente isoladamente exceder o orçamento, ela é truncada apenas no contexto enviado ao modelo; a mensagem persistida não é alterada. Mensagens mais antigas que ficam fora desse sufixo continuam recuperáveis por `conversation_retrieval`.

O valor é persistido em `application_settings` para a tela de configurações, mas inicia em `32000` conforme a regra atual. Ainda não existe um context builder dinâmico ou tokenizer específico do Qwen.

O orçamento da aplicação não aumenta o contexto aceito pelo provider. No ambiente local validado, o combo `local-general` reporta `n_ctx = 4096`; para conversar com um contexto imediato próximo de 32k, o combo no OmniRoute/Ollama precisa ser configurado com uma janela compatível. Caso contrário, reduza temporariamente `immediateContextMaxTokens` pela tela de configurações.

## Endpoints

### Criar conversa e enviar a primeira mensagem

```http
POST /conversation/messages
Content-Type: application/json
```

```json
{
  "content": "Olá, preciso de ajuda"
}
```

### Adicionar mensagem a uma conversa existente

```http
POST /conversation/:conversationId/messages
Content-Type: application/json
```

```json
{
  "content": "Pode continuar de onde paramos?"
}
```

### Consultar conversas

```text
GET /conversation
GET /conversation/:conversationId
```

As respostas dos dois endpoints de envio preservam o contrato existente: devolvem `conversationId` e as mensagens `user` e `assistant` criadas naquela interação.

## LLMs e configuração

Os combos são persistidos em `application_settings` e editáveis pela interface:

| Campo | Responsabilidade |
| --- | --- |
| `orchestratorCombo` | decisões JSON iterativas do Orchestrator |
| `llmCombo` | geração final do `LunaModule` |
| `llmTemperature` / `llmMaxTokens` | parâmetros da geração final |

O `LlmModule` e o OmniRoute são reutilizados nas duas chamadas. O OmniRoute continua registrando no terminal da API o payload exato enviado ao provedor; como esse log contém conteúdo de conversa, ele deve permanecer restrito ao desenvolvimento ou receber mascaramento antes de produção.

## Indexação de ConversationChunk

Após persistir a resposta final, o módulo chama `ConversationChunkService.synchronizeConversation()`. A falha de embedding não desfaz uma resposta de chat já gerada: as mensagens continuam persistidas e a indexação pode ser retomada na próxima sincronização ou por um job futuro.

Os parâmetros de chunking são configuráveis pela tabela singleton `conversation_chunk_settings`:

| Campo | Default |
| --- | ---: |
| `max_tokens` | 4000 |
| `overlap_tokens` | 800 |
| `embedding_refresh_tokens` | 1000 |
| `embedding_model` | `qwen3-embedding:0.6b` |
| `embedding_dimensions` | 1024 |

`content`, `embedding` e `end_message_id` representam a última versão indexada. Em um chunk `open`, mensagens posteriores ao `end_message_id` formam a tail ainda não indexada. O retrieval recupera essa tail junto do conteúdo indexado quando ela for relevante.

Veja também [Histórico antigo e retrieval](old-history-retrieval.md) e [UserAgent](../user-agent/user-agent.md).

## Regras e falhas

- conteúdo vazio é rejeitado;
- um `conversationId` inexistente retorna `404`;
- a mensagem do usuário é persistida antes de chamar o fluxo de agentes;
- se a execução falhar, a mensagem do usuário continua no banco e nenhum assistant parcial é salvo;
- uma resposta final bem-sucedida é persistida com o modelo retornado pelo OmniRoute;
- tracing de LLM, Orchestrator e tools usa o mesmo `requestId` para a mesma interação.

## Próximas evoluções

- tokenizer específico do modelo e composição dinâmica de contexto;
- memória permanente e preferências reais no estado do `UserAgent`;
- personalidade e políticas completas da Luna;
- novas tools registradas no `ToolRegistry`;
- retry/idempotência e controle de concorrência por conversa;
- autenticação e escopo por usuário.
