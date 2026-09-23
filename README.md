# Luna V2

## Stack Docker

O Compose agora fica na raiz do projeto e usa o nome `luna-v2`. Ele sobe:

- PostgreSQL 16 com pgvector;
- Ollama usando a GPU, com `qwen3:4b-instruct`, `qwen3-embedding:0.6b` e o modelo de teste `qwen3.5:4b`;
- uma etapa de `prisma migrate deploy`;
- SearXNG para descoberta de fontes na rede interna;
- API NestJS na porta `8000`;
- frontend Next.js na porta `3000`.

O modelo de embedding é compatível com a estratégia de vetores de 1024 dimensões. Quando o módulo de embeddings for implementado, a chamada a `/api/embed` deve solicitar `dimensions: 1024`.

### Primeiro uso

Copie a configuração opcional e suba a stack:

```powershell
Copy-Item .env.example .env
pnpm docker:up
```

O V2 reutiliza por padrão o volume `luna_luna-ollama-data` do Luna anterior. O `ollama-init` confirma as três tags e reutiliza blobs já presentes; ele baixa apenas os modelos ou camadas que estiverem ausentes. Caso seja um ambiente novo, isso representa cerca de 2.5 GB para o Qwen de chat, 639 MB para o embedding e 3.4 GB para o `qwen3.5:4b`. A API espera as migrations e a preparação dos modelos terminarem antes de iniciar.

O provider local do Ollama é iniciado com uma janela de contexto de `8192` tokens. Esse valor é aplicado no servidor Ollama, portanto vale para os combos que usam o provider `ollama-local`; não é uma configuração individual de combo.

O frontend fica em `http://localhost:3000`, a API em `http://localhost:8000` e o Ollama em `http://localhost:11435`.

### Migração do Compose antigo

O arquivo `apps/docker-compose.yml` foi removido. O volume atual `apps_luna_postgres_data` é reutilizado por padrão, portanto as conversas e migrations existentes são preservadas.

Os volumes de PostgreSQL e Ollama são externos de propósito. Assim, nem `docker compose down -v` remove as conversas ou os modelos. Em uma máquina nova, crie os dois volumes antes do primeiro boot:

```powershell
docker volume create apps_luna_postgres_data
docker volume create luna_luna-ollama-data
```

Antes do primeiro `pnpm docker:up`, encerre os processos locais que usam as portas `3000` e `8000` (por exemplo, os terminais com `pnpm dev` e `pnpm start`).

Se o container legado `lunav2-postgres` ainda estiver em execução, pare e remova apenas o container antes de subir a stack; não use `-v`:

```powershell
docker stop lunav2-postgres
docker rm lunav2-postgres
pnpm docker:up
```

Os containers principais ficam nomeados como `luna-v2-postgres`, `luna-v2-ollama`, `luna-v2-searxng`, `luna-v2-api` e `luna-v2-web`.

### Pesquisa na Web

A Luna usa um Search Orchestrator separado do orquestrador de conversa. O planner usa o combo `local-reasoning` por padrão via OmniRoute e gera uma consulta no modo Quick. O SearXNG descobre páginas; a API seleciona fontes, extrai texto por HTTP e usa Chromium como fallback para páginas dinâmicas. Fontes, trechos de evidência, decisões e eventos são gravados no PostgreSQL antes da síntese da resposta. Respostas HTTP bloqueadas e páginas sem evidência útil não viram citações.

As opções ficam em **Configurações → Pesquisa na Web**: ativação, combo do planner, modo, recência, limites, cache e fallback de browser. Cada execução pode ser examinada em **Visibilidade**, com prompt e modelo do planner, queries, fontes, extração, evidências, verificação, erros e linha do tempo. A API também expõe `GET /research/conversations/:conversationId/runs` e `GET /research/runs/:runId`.

`SEARXNG_BASE_URL`, `SEARXNG_TIMEOUT_MS`, `WEB_EXTRACT_TIMEOUT_MS` e `WEB_EXTRACT_MAX_BYTES` podem ser definidos no `.env`. SearXNG não precisa de porta pública: a API o alcança pelo nome `searxng` no Compose. O browser e suas dependências são instalados na imagem da API durante o build.

### OmniRoute

A API continua usando o combo `paid-general`. Dentro do Docker, ela alcança o OmniRoute do host por `http://host.docker.internal:20128/v1`.

Para fazer um combo local do OmniRoute usar o Ollama deste Compose, configure o provider do OmniRoute no host para `http://localhost:11435` e aponte-o para `qwen3:4b-instruct`. Para usar o novo modelo, faça o mesmo apontando o combo desejado para `qwen3.5:4b`.
