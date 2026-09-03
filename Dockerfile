# The indexer and its API in one container: Ponder polls Robinhood Chain,
# keeps the tables in Postgres and serves /v1 on port 42069. Build from the
# repository root:
#
#   docker build -t exdate .
#   docker run -e DATABASE_URL=postgres://... -p 42069:42069 exdate
#
# or `docker compose up` to get Postgres alongside (see docker-compose.yml).
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/sdk/package.json packages/sdk/
COPY packages/indexer/package.json packages/indexer/
COPY apps/status/package.json apps/status/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @exdate/indexer... --prod=false

FROM deps AS runtime
WORKDIR /app
COPY packages/core packages/core
COPY packages/api packages/api
COPY packages/indexer packages/indexer
COPY data data
COPY scripts scripts
ENV NODE_ENV=production PORT=42069
EXPOSE 42069
WORKDIR /app/packages/indexer
# `ponder start` refuses to run without a schema on Postgres; the operator's
# DATABASE_SCHEMA wins, this is the default the compose file uses too.
CMD ["sh", "-c", "pnpm exec ponder start --schema ${DATABASE_SCHEMA:-exdate}"]
