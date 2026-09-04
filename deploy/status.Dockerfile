# The status page as a server, next to the API it reads.
#
# It is server-rendered on purpose: every request reads the API from inside the
# compose network (http://indexer:42069), so the browser never learns the API's
# address and the API needs no cross-origin grant for this page to work. Build
# from the repository root:
#
#   docker compose --profile public build status
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable

FROM base AS deps
WORKDIR /app
# tsconfig.base.json is not optional here: every workspace tsconfig extends it,
# and without it in the context the build fails with "extends: ../../tsconfig.base.json
# doesn't resolve correctly" - found by building this image, not by reading it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json .npmrc* ./
COPY packages/core/package.json packages/core/
COPY packages/api/package.json packages/api/
COPY packages/sdk/package.json packages/sdk/
COPY packages/indexer/package.json packages/indexer/
COPY apps/status/package.json apps/status/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @exdate/status... --prod=false

FROM deps AS build
WORKDIR /app
COPY packages/core packages/core
COPY apps/status apps/status
# The page's hand-declared response subsets are checked against core at compile
# time (apps/status/lib/contract.assert.ts), so a build that succeeds is also
# the proof that the page and the API still agree on every shape.
RUN pnpm --filter @exdate/status build

FROM base AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
# Next's standalone output traces exactly the files the server needs; static and
# public are not traced and have to be carried over by hand.
COPY --from=build /app/apps/status/.next/standalone ./
COPY --from=build /app/apps/status/.next/static ./apps/status/.next/static
EXPOSE 3000
CMD ["node", "apps/status/server.js"]
