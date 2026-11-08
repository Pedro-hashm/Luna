# Fluxo de entrega da Luna

Combine o comportamento, os cenários obrigatórios e os limites de qualidade antes de implementar. Abra um worktree e uma branch `codex/<feature>` a partir da branch padrão atual. Abra um PR em rascunho e faça commit e push a cada checkpoint reportado.

## Comparar revisões

Pré-requisitos: Node 22, Git, tar e Docker com Compose. Execute a partir do checkout que contém o comparador.

```sh
node scripts/eval/compare.mjs --base origin/master --candidate HEAD --fixture --unit
node scripts/eval/compare.mjs --base origin/master --candidate HEAD --router http://host.docker.internal:11435/v1 --model qwen3:4b-instruct --repetitions 2
```

O comparador resolve os SHAs, compila a API a partir dos arquivos versionados em cada commit e aplica as migrations em um banco novo para cada lado. Cada caso começa uma conversa nova, com o mesmo conjunto de casos e a mesma ordem nas duas versões. O relógio e provedores externos ainda podem variar. A API é publicada numa porta efêmera de loopback e cada banco de avaliação é removido após a execução. As imagens compiladas ficam no cache local do Docker.

O modo fixture exercita o caminho HTTP, a persistência, as migrations, a passagem de contexto e a correlação com respostas determinísticas. O modo com provedor real também testa o comportamento do modelo. O exemplo usa o Ollama da stack local pelo endpoint compatível com OpenAI e registra o modelo retornado. Em Linux, indique um endereço do provedor alcançável de dentro do container. Para casos de recuperação semântica, reranking ou pesquisa, configure os serviços de teste em `LUNA_EVAL_OLLAMA`, `LUNA_EVAL_RERANKER` e `LUNA_EVAL_SEARCH` conforme o caso. Use somente entradas sintéticas e serviços autorizados para a avaliação.

A stack mínima cobre a API de texto. Features de voz precisam dos smokes WebSocket ou de browser e dos serviços correspondentes, também com dados isolados. Features de extração por browser precisam da imagem runtime e dos serviços descritos no Compose principal. Consulte [a validação de voz](voice/validation-2026-09-24.md).

### Casos e resultados

`--cases caminho.json` seleciona uma lista de casos com `id` único e `turns` em ordem. Cada turno tem `input` e pode declarar `contains`, `excludes` e `tools`. As duas primeiras checam trechos sem distinção de maiúsculas e a última exige tools concluídas com sucesso nesse request. O [conjunto inicial](../scripts/eval/cases.json) exercita respostas em português e contexto imediato. Para casos qualitativos, anexe ao PR uma comparação julgada contra a rubrica combinada no plano.

- Saída 0: todos os casos da candidata passaram e ambas as versões produziram evidência.
- Saída 1: a candidata falhou em alguma asserção.
- Saída 2: falta evidência, por exemplo por erro de infraestrutura, de provedor ou de correlação.

O relatório em `.luna-eval/<run>/report.json` inclui os SHAs, respostas, IDs, traces, latências, tokens, ferramentas e resultados de pesquisa disponíveis. Os logs da stack ficam no mesmo diretório. Relatórios e logs brutos são locais. No PR, registre somente resultados, exemplos sintéticos pertinentes e limitações. Os checks do GitHub usam a fixture e a suíte Jest. Faça a avaliação real antes do merge quando o plano exigir comportamento de modelo.

## Merge e reversão

Confirme o SHA da candidata e o SHA da base atual no PR. Se algum mudar, repita a avaliação relevante. Só marque o PR como pronto quando os casos obrigatórios, as verificações do GitHub e a avaliação qualitativa combinada estiverem completas. Faça squash merge e registre como reverter o commit. Para mudanças de dados, documente e ensaie a reversão separadamente.
