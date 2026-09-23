FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN corepack enable

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

ARG API_URL=http://api:8000

ENV API_URL=${API_URL}
ENV NEXT_TELEMETRY_DISABLED=1

COPY apps/web apps/web

RUN pnpm --filter web build

FROM base AS runtime

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV API_URL=http://api:8000

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/web ./apps/web

WORKDIR /app/apps/web

EXPOSE 3000

CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0", "--port", "3000"]
