FROM node:22-bookworm-slim AS base

ENV PNPM_HOME="/pnpm"
ENV PATH="${PNPM_HOME}:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable

WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json

RUN pnpm install --frozen-lockfile

FROM dependencies AS build

COPY apps/api apps/api

WORKDIR /app/apps/api

# Prisma only needs the URL to resolve its configuration during client generation.
ENV DATABASE_URL="postgresql://luna:luna@postgres:5432/luna?schema=public"

RUN pnpm exec prisma generate

WORKDIR /app

RUN pnpm --filter api build

FROM build AS migrate

WORKDIR /app/apps/api

CMD ["node", "node_modules/prisma/build/index.js", "migrate", "deploy"]

FROM dependencies AS browser-runtime

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app/apps/api

# The browser is only used when static extraction cannot obtain page content.
RUN ./node_modules/.bin/playwright install --with-deps --only-shell chromium \
    && chmod -R a+rX /ms-playwright

FROM browser-runtime AS runtime

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/apps/api /app/apps/api

USER node

EXPOSE 8000

CMD ["node", "dist/src/main.js"]
