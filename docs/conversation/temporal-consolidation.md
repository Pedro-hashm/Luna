# Consolidação Temporal para Conversation Retrieval

## Status e escopo

Este documento registra a arquitetura, suas decisões e a validação executada em 23/09/2026. A revisão da detecção e da busca de antecedentes descrita abaixo está em andamento; os resultados de validação ao final pertencem à versão anterior e ainda não comprovam essa revisão.

A Consolidação Temporal enriquece `conversation_retrieval` com relações de substituição ou correção demonstradas pelas próprias mensagens. `Message` continua sendo a fonte de verdade; `ConversationChunk` e as relações temporais são índices derivados. Nenhuma mensagem, chunk ou embedding é apagado ou reescrito por esse processo. A feature não cria memória permanente, decay, um banco geral de fatos ou um segundo mecanismo de Evidence.

## Arquitetura implementada

```text
novas Messages persistidas
  → seleção incremental e filtro barato de candidatos
  → LLM: extrair mudança explícita em saída estruturada
  → por candidata positiva: retrieval híbrido de chunks + busca exata complementar do valor anterior
  → recuperar Messages originais anteriores à candidata e selecionar evidências
  → validação da evidência, ordem e escopo
  → relação temporal derivada entre Messages

conversation_retrieval existente
  → vector + lexical/BM25 → RRF → reranker, quando habilitado
  → expansão de mensagens e deduplicação do overlap
  → leitura das relações temporais dos resultados selecionados
  → resolução do sucessor conforme temporalMode
  → projeção para Orchestrator/Luna e Evidence existente
```

A seleção de candidatos reconhece expressões de mudança/correção, inclusive “agora se chama” em frases como “lembra do projeto Nebula 47? agora se chama Nebula 49”. Esse filtro é apenas uma otimização: palavras como “agora” e “novo” não bastam para persistir uma relação. A LLM de extração recebe a mensagem nova e produz `NONE`, `SUPERSEDES` ou `CORRECTS`, assunto e valores anterior/novo. A saída passa por validação de schema. Não se solicita raciocínio interno do modelo.

Para cada candidata positiva, a consolidação chama `ConversationRetrievalService`, que usa o `RetrievalEngine` existente em modo híbrido (vetor, lexical, RRF e reranker, se habilitado). A consulta prioriza `oldValue` explícito; na falta dele, usa assunto, valor novo e um trecho da mensagem. A busca considera até 20 chunks, respeitando o limite configurado, e até 16.000 tokens de contexto. Para esta busca, o limiar do reranker é permissivo e a deduplicação de chunks fica desativada, pois afirmações repetidas podem ser evidências distintas. Se o reranker falhar, o fallback já existente no engine preserva o ranking vetorial/lexical.

Os chunks localizam possíveis fontes; a validação usa as **Messages originais** expandidas, com corte estrito anterior à candidata por `(createdAt, id)`. Quando `oldValue` está explícito, uma busca exata complementar pode trazer até 32 mensagens anteriores que o limite ou o ranking dos chunks não trouxe. As fontes são deduplicadas por ID e priorizadas por correspondência literal do valor antigo, mesma conversa e posição no ranking; no máximo 16 mensagens seguem para o prompt de validação. Esse limite não é uma janela de 16 mensagens vizinhas nem uma restrição de uma semana: a busca percorre o histórico elegível, mas seus resultados ainda são limitados. O antecedente precisa ser comprovado pelo texto original. Se houver âncoras de conversas diferentes igualmente plausíveis ou mudanças concorrentes, o processo registra rejeição/conflito. A validação pede a afirmação explícita mais recente do mesmo assunto. Nenhuma idade, score semântico ou data isolada implica supersession.

O processamento usa um checkpoint persistido em `(createdAt, id)`, atualizado somente depois de cada mensagem concluída. O UUID isolado não é usado como cursor cronológico. A relação e o avanço do checkpoint são gravados na mesma transação; a unicidade de `predecessorMessageId` impede uma segunda relação para a mesma âncora. Após falha ou restart, a próxima execução retoma a partir do último checkpoint. **Corrigir o detector ou a busca não revisita mensagens que o checkpoint já ultrapassou**; elas exigem replay explícito e idempotente. Clicar em **Executar agora** continua do checkpoint e não constitui replay. Cada run registra suas métricas e rejeições; não há uma tabela separada de status por mensagem. As execuções têm limites de 100 mensagens, 25 candidatos, 60 chamadas de LLM e cinco minutos. Mensagens acumuladas enquanto a feature está desativada continuam elegíveis.

### Identidade da relação: mensagem antes de chunk

Uma relação persistida aponta para `predecessorMessageId` e `successorMessageId`, com tipo (`SUPERSEDES`/`CORRECTS`), assunto ou chave de afirmação, resumo factual, confiança e evidência suficiente para auditoria. Quando uma mensagem contiver mais de uma afirmação, a relação também precisa identificar o trecho/afirmação afetado; não é correto classificar a mensagem inteira como obsoleta. A identidade e o schema exatos devem respeitar as tabelas e os contratos existentes na implementação.

`Message.id` é estável e permite recuperar o texto original. Já um `ConversationChunk` pode ser recriado, contém várias mensagens, possui overlap com o chunk vizinho e pode ter uma tail ainda não refletida no embedding. Por isso, uma eventual metadata temporal no chunk é **projeção reconstruível** das relações entre mensagens, nunca uma segunda fonte de verdade. O retrieval deve atribuir o status somente à evidência efetivamente expandida e devolvida.

Para evitar ciclos, a aresta sempre aponta de uma mensagem anterior para uma posterior. `A → B → C` é válido; `B → A` não. `A → B` e `A → C` exigem evidência de que B e C representam versões sequenciais ou estados concorrentes distintos. Na dúvida, rejeitar ou registrar conflito para inspeção. A criação da relação e o avanço do estado de processamento devem ser atômicos, com restrição de unicidade adequada à afirmação e ao par de mensagens.

### Comportamento do retrieval

Adicionar uma intenção temporal independente de `scope` e de `dateFrom`/`dateTo`:

| `temporalMode` | Resultado esperado |
| --- | --- |
| `current` | Se um resultado selecionado foi substituído, incluir a evidência sucessora vigente dentro dos filtros da consulta, com proveniência. Não tratar a versão anterior como atual. |
| `historical` | Preservar acesso à versão anterior e ao contexto de sua época. |
| `both` | Mostrar a sequência histórica e o estado posterior conhecido, dentro do orçamento de contexto. |

O Orchestrator expressa a intenção (`current`, `historical` ou `both`); não precisa conhecer IDs nem a tabela de relações. `scope: "historical"` hoje significa “outras conversas” e **não** equivale a `temporalMode: "historical"`. Consultas sem intenção temporal explícita devem preservar o comportamento existente e, quando houver enriquecimento, tornar o status legível sem esconder resultados históricos.

A resolução do sucessor respeita os filtros de escopo e datas, o cutoff de `currentMessageId` na conversa atual e o orçamento de tokens. Um sucessor posterior ao ponto de observação não pode vazar para a resposta. Se o sucessor não for elegível ou não puder ser carregado, o resultado pode informar a relação conhecida, mas não deve declarar uma versão “atual” sem evidência disponível. As fontes efetivamente usadas continuam rastreáveis pelo mecanismo de `ConversationEvidence`; `conversation_context` continua podendo expandir regiões históricas.

## Ativação, janela e execução manual

A seção **Consolidação Temporal** em Settings contém `Enabled`, `Default Combo`, `Fallback Combo`, `Start Time`, `End Time`, **Executar agora** e **Dry Run**. `Enabled` inicia em **false** para que nenhuma análise em background ou chamada paga comece sem ativação deliberada. Os combos conhecidos e testados neste ambiente são pré-preenchidos como `local-general` e `paid-general`, respectivamente; podem ser alterados ou limpos na UI. O horário inicial é `04:30–08:30` no `appTimezone` central da aplicação.

`enabled=false` tem uma semântica única em API, scheduler e UI:

1. Não iniciar novos runs agendados, manuais ou Dry Run. A UI deixa as ações indisponíveis e explica o motivo; a API também verifica a flag.
2. Um run já iniciado para de aceitar novos batches/chamadas de LLM e termina em um checkpoint seguro.
3. O retrieval não consulta nem projeta relações temporais e mantém o comportamento anterior da tool.
4. Relações, histórico e estado de processamento permanecem persistidos para retomada quando `enabled=true`.

O agendamento só inicia dentro da janela. Ao sair dela, interrompe o processamento pesado e preserva o checkpoint. O acionamento manual usa o pipeline real e registra `trigger=manual`, sem alterar artificialmente o scheduler. Fora da janela, a execução manual seleciona **Fallback Combo** por padrão; se não estiver configurado, falha antes de iniciar e explica o problema. Um override avançado para o combo local padrão, se oferecido, deve ser explícito e identificado como intensivo em recursos. Na execução agendada, falhas transitórias do default podem levar ao fallback após retries limitados; rejeição por falta de evidência não é falha de provider. Os logs distinguem fallback por erro de seleção intencional do fallback no manual fora da janela.

Dry Run, se implementado, percorre detecção, LLM, busca e validação e apresenta relações propostas/rejeitadas com evidências, mas não grava relações nem avança o estado de processamento. Executar agora persiste os resultados válidos. Ambos exigem `enabled=true`.

## Observabilidade necessária

Cada run registra `runId`, `trigger`, status, horários, duração, combos configurados e usado, provider/modelo, mensagens examinadas, candidatos, chamadas de LLM e busca histórica, relações propostas/criadas/rejeitadas/ignoradas, retries, fallback, erros e motivo de parada. Registrar latências por etapa e razões objetivas de rejeição como evidência insuficiente, duplicata e saída estruturada inválida. Não incluir raciocínio interno da LLM nem conteúdo sensível desnecessário nos logs.

O painel de execução acompanha o `activeRun` indicado pelo checkpoint, e não somente um resumo local da página. Cada transição persiste `currentPhase`, `currentPhaseStartedAt`, `progressUpdatedAt`, contadores atualizados e `phaseDurationsMs`. Os intervalos são medidos sequencialmente com relógio monotônico no servidor; a UI soma o tempo acumulado à fase atual em andamento e ancora o contador no timestamp do servidor. Assim, os tempos por fase são exclusivos e somam aproximadamente o tempo total; `llmLatencyMs` é mostrado como subtotais de trabalho dentro das fases de extração e validação, e não como fase adicional.

## Decisões e custos

| Problema | Alternativas | Escolha e motivo | Trade-off |
| --- | --- | --- | --- |
| Informação antiga semanticamente relevante | Recency boost, nova busca por consulta, relação pré-computada | Relação explícita pré-computada. Idade não prova substituição e validação em toda consulta custa tempo/LLM. | Mudanças não processadas ainda podem escapar; observar backlog. |
| Identidade estável | `chunkId`, `messageId`, fatos atomizados | `messageId` com âncora de afirmação quando necessário. Suporta re-chunking e overlap sem novo banco de fatos. | Requer expansão da mensagem e validação do trecho. |
| Custo de LLM | Todas as mensagens, só regras, filtro + LLM | Filtro barato seguido de LLM estruturada apenas em candidatos. | Filtro pode perder mudanças implícitas; medir falsos negativos. |
| Localizar antecedente | Varrer histórico inteiro, criar outro índice, reutilizar retrieval | Retrieval híbrido por candidata, complementado por busca exata do `oldValue`, com validação na mensagem original. | Os limites de ranking e de mensagens ainda podem deixar uma âncora fora do prompt, especialmente sem `oldValue`. |
| Modo desativado | Apagar relações, pausar só scheduler, suspender a feature | Suspender produção e consumo das relações sem apagá-las. Retomada é reversível e não muda histórico. | Durante a pausa, consultas voltam ao comportamento anterior. |
| Consulta temporal | Supressão da versão antiga, só reordenar por data, enriquecer | Anotar resultado e resolver sucessor quando cabível. Preserva perguntas históricas e Evidence. | Pode aumentar contexto; aplicar deduplicação e orçamento. |

Em custo, o filtro de expressões evita chamadas de LLM para mensagens comuns; uma candidata positiva usa extração, retrieval híbrido e validação estruturada, além da busca exata quando há `oldValue`. O processamento tem uma única execução ativa, limites por run e timeout de 45 segundos por chamada LLM. Em performance de consulta, as relações são lidas após o ranking, em lotes e até oito transições, sem nova chamada de LLM; a projeção temporal recebe no máximo 25% do orçamento de contexto solicitado. Em corretude, a validação exige valores presentes nas mensagens originais, ordem cronológica e assunto compatível, preserva os cortes de escopo/data e não declara a última versão como atual quando a cadeia atingiu o limite. O custo dessa postura é deixar mudanças ambíguas sem relação.

Limites explícitos: mudanças implícitas podem não passar pelo filtro; a LLM pode errar o sujeito/valores; os limites de 20 chunks, 32 correspondências exatas e 16 mensagens para validação podem deixar uma âncora fora da análise; mensagens com múltiplas afirmações exigem delimitação precisa; conflitos sem evidência suficiente ficam sem relação; relações derivadas podem ficar temporariamente atrasadas após falha ou pausa. Nenhum desses casos autoriza inferir validade apenas pela data.

## Pesquisa que informa a proposta

As publicações abaixo são fontes primárias. Resultados de artigos são evidência de pesquisa, não resultados medidos na Luna. Issues do Hermes são propostas ou relatos da comunidade, não garantias de comportamento implementado.

| Fonte | Contribuição e limite para esta feature |
| --- | --- |
| [FRESCO (2026)](https://arxiv.org/abs/2604.14227) | Avalia rerankers com revisões históricas e relata preferência por documentos antigos semanticamente ricos. Justifica verificar versão depois do ranking. |
| [Temporal Validity in Retrieval Memory (2026)](https://arxiv.org/abs/2606.26511) | Mostra que similaridade é fraca para distinguir duplicata de contradição e estuda supersession explícita. O ledger bi-temporal de fatos do artigo excede o escopo da Luna. |
| [Re³, ACL 2026](https://aclanthology.org/2026.acl-long.1180/) | Estuda conflito entre versões e recência. Sua supressão de versões antigas não atende às consultas históricas da Luna; aproveitar somente a separação entre relevância e validade temporal. |
| [TG-RAG (2025)](https://arxiv.org/abs/2510.13590) | Demonstra atualização incremental de relações temporais com novos dados. Grafo temporal completo e resumos hierárquicos seriam complexidade excessiva aqui. |
| [TimelyRAG (2026)](https://arxiv.org/abs/2609.11572) | Trata documentos parcialmente substituídos com forte sobreposição semântica. Reforça a necessidade de delimitar qual afirmação mudou, em vez de invalidar a chunk inteira. |
| [Hermes Agent: memória e session search](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/memory.md) | Distingue memória curada de busca de mensagens originais em SQLite/FTS5. Aqui só interessa a segunda fronteira: manter conversa como fonte. |
| [Hermes: proposta de consolidação em background](https://github.com/NousResearch/hermes-agent/issues/25309) e [relato de temporal hygiene](https://github.com/NousResearch/hermes-agent/issues/37661) | Oferecem referências de opt-in, execução agendada/manual e do problema de vetores contraditórios. Varredura global, “mais recente vence” e deleção de memória não são apropriados para este índice derivado. |
| [Hermes Desktop](https://github.com/fathah/hermes-desktop/blob/main/README.md) | Referência de UX para configuração e schedules em desktop; não determina a arquitetura de persistência. |
| [QMD](https://github.com/tobi/qmd/blob/main/README.md) | Documenta BM25 + vetores + RRF + rerank, filtros de metadata e atualização por conteúdo. O pipeline da Luna já é híbrido; reutilizá-lo evita um segundo retriever. |

## Validação da revisão atual (23/09/2026)

Na API local conectada ao banco de conversas real, a execução manual anterior examinou a mensagem `lembra do projeto nebula 47 ? agora se chama nebula 49`, mas registrou **0 candidatos**. O detector não reconhecia `agora se chama`; o checkpoint já havia avançado. Após corrigir o detector, a primeira repetição mostrou uma segunda falha: `deepseek-flash` às vezes retornava `subject: null` na extração, embora tivesse identificado `SUPERSEDES`, `nebula 47` e `nebula 49`. A extração agora aceita esse assunto provisório, e a validação histórica exige um assunto concreto antes de criar uma relação.

O checkpoint foi reposicionado apenas para antes da mensagem afetada, com verificação de que não havia run ativo nem relação para ela. A execução manual seguinte (`84bdb05d-21a0-4445-b937-f628275d21d2`, `paid-general`) concluiu com **2 mensagens examinadas, 1 candidata, 1 busca histórica, 2 chamadas LLM, 1 proposta e 1 relação criada, sem rejeições**. O retrieval híbrido buscou `nebula 47` no histórico inteiro e retornou 8 chunks; a validação escolheu a mensagem de 21/09/2026 às 22:19:04 UTC como antecedente da mensagem de 23/09/2026 às 15:19:44 UTC. A relação persistida tem `type=SUPERSEDES`, `subject=nome do projeto`, `oldValue=Nebula 47`, `newValue=nebula 49` e confiança `0.95`. O checkpoint voltou à posição original após processar as duas mensagens.

Uma chamada real de `conversation_retrieval` com `query="Nebula 47"` e `temporalMode="current"` retornou 5 chunks. O chunk que contém a mensagem predecessora incluiu `temporalChanges` com a relação e o texto original da mensagem sucessora `... agora se chama nebula 49`, mesmo com a sucessora em outra conversa. Em um teste direto do prompt final da Luna com esses cinco resultados, `deepseek-flash` respondeu que o nome atual é **Nebula 49** e manteve as demais regras do projeto. A relação é ancorada em uma única mensagem anterior: outros chunks que também mencionam `Nebula 47` não recebem automaticamente a mesma anotação. Isso continua sendo um limite para consultas que recuperem somente essas outras menções. A instrução final agora aplica a mudança comprovada ao mesmo assunto entre resultados, sem rotular automaticamente os demais chunks como substituídos.

Na revisão atual, a suíte da API passou com **96 testes em 18 suites**; após o ajuste de observabilidade, os **21 testes temporais** e `tsc --noEmit` também passaram. O build/deploy da API local concluiu. O teste de regressão inclui a frase literal e um antecedente separado por mais de 12 mensagens. A contagem `chunksScanned` passou a refletir os chunks retornados pela busca histórica em novos runs; a execução real registrada acima ocorreu antes desse ajuste e manteve o valor antigo no registro daquela execução.

## Validação anterior à revisão atual

Os resultados abaixo foram obtidos antes da inclusão do sinal “agora se chama” e da busca híbrida por candidata. Eles documentam a validação da versão anterior; a verificação da revisão atual está acima.

O relatório [temporal-prompt-evaluation.json](temporal-prompt-evaluation.json) contém os dez casos sintéticos enviados ao `local-general` (`qwen3:4b-instruct`), com prompt, entrada, saída bruta, saída normalizada, esperado e aprovação. **10/10 passaram** após ajustar o prompt e validar `type`, `oldValue`, `newValue`, `predecessorMessageId` e o assunto explícito do caso sem entidade. As [iterações 1](temporal-prompt-evaluation-iteration-1.json), [2](temporal-prompt-evaluation-iteration-2.json) e [3](temporal-prompt-evaluation-iteration-3.json) preservam as falhas corrigidas: valor antigo inventado, `"null"` textual, escolha da primeira âncora em vez da afirmação mais recente e assunto com entidade ausente da mensagem. O teste separado de `local-reasoning` produziu resposta vazia no limite usado e está registrado em [seu relatório](temporal-prompt-evaluation-local-reasoning.json); ele não é o combo validado para esta execução.

Na versão anterior, a suíte da API passou com **90 testes em 18 suites**. `tsc --noEmit` passou na API e na interface; o lint e o build de produção da interface passaram. Aqueles testes cobriam detector, parser estruturado, janela, toggle, cancelamento antes da chamada ao modelo, fallback fora da janela, Dry Run, persistência com checkpoint, retrieval temporal, Evidence, orçamento e cortes por data/mensagem.

O smoke test executou em um banco PostgreSQL e uma API **isolados**, somente com mensagens sintéticas. A sequência foi:

| Verificação | Resultado observado |
| --- | --- |
| `enabled=false` | `POST /temporal-consolidation/run` retornou 409. |
| Dry Run dentro da janela | `local-general` (`qwen3:4b-instruct`), 2 mensagens examinadas, 1 candidata, 2 chamadas LLM, 1 proposta `47 → 48`, 0 relações gravadas. |
| Agendamento dentro da janela | Criou `47 → 48` uma vez. Uma execução manual seguinte examinou 0 mensagens, comprovando o checkpoint. |
| Busca híbrida | Um erro preexistente no registro dos retrievers foi corrigido: os canais lexical e de filtro agora chamam seus métodos próprios. A consulta por `Nebula 47` voltou a recuperar a chunk antiga. |
| Manual fora da janela, sem fallback | Retornou 400 antes de iniciar. |
| Manual fora da janela, com fallback | `paid-general` (`deepseek-flash`), `trigger=manual`, `fallbackReason=manual_outside_window`, 2 chamadas LLM e relação `48 → 49` gravada. |
| `current`, `historical`, `both` | `current` resolveu `Nebula 49`; `historical` mostrou somente a fonte antiga; `both` mostrou `Nebula 48 → Nebula 49`. |
| Corte temporal | `dateTo` anterior às mudanças mostrou só a fonte antiga; `currentMessageId` na mensagem de `Nebula 48` resolveu somente até 48. |
| Desativação após relações | Novos runs retornaram 409; o retrieval deixou de projetar mudanças; as duas relações persistidas permaneceram no banco isolado. |
| Âncora repetida e restart | Em um segundo banco isolado, uma afirmação de 30 dias, sua confirmação de 14 dias e três menções posteriores a 47 precederam a mudança para 48. A relação usou a confirmação como antecedente. Após reiniciar a API, uma nova execução examinou 0 mensagens, não duplicou a relação e o retrieval resolveu 48. |

Esses testes da versão anterior confirmaram a trilha `47 → 48 → 49`, a seleção intencional do combo pago fora da janela e a retomada após um reinício normal. Não foi executado um crash no meio de uma transação, uma saída da janela enquanto o modelo respondia, nem um conflito de duas conversas com âncoras indistinguíveis em PostgreSQL; esses cenários continuam como limites de verificação. A unicidade de um sucessor por mensagem de antecedente também significa que duas afirmações independentes na mesma mensagem não podem receber arestas diferentes; nesse caso a consolidação rejeita a segunda relação em vez de atualizar a mensagem inteira.
