# Build context is the repo root (see docker-compose.yml) because this is
# a pnpm workspace — @hackpulse/api depends on @hackpulse/shared by
# workspace protocol, so both need to be present to install/build.

FROM node:22-alpine AS base
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --filter @hackpulse/shared --filter @hackpulse/api

FROM deps AS build
COPY packages/shared packages/shared
COPY apps/api apps/api
# The shared fixture data every reviewer's portal loads at boot: load-
# fixtures.ts resolves it relative to its own file location
# (../../../../fixtures.json from apps/api/src/db), so it has to exist at
# the repo root inside the image too, not just on the host running
# `docker build`.
COPY fixtures.json fixtures.json
RUN pnpm --filter @hackpulse/shared run build
RUN pnpm --filter @hackpulse/api run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/packages/shared ./packages/shared
COPY --from=build /repo/apps/api ./apps/api
COPY --from=build /repo/fixtures.json /repo/fixtures.json
WORKDIR /repo/apps/api
EXPOSE 3001
# Migrations run before every boot — idempotent, and this is what makes
# `docker compose up` alone (no separate setup step) satisfy NFR-OPS-01.
# load-fixtures.ts then loads the shared fixture data (also idempotent);
# see auth.config.ts's databaseHooks for how the first account anyone
# actually registers becomes this instance's admin, independent of it.
CMD ["sh", "-c", "node_modules/.bin/tsx src/db/migrate.ts && node_modules/.bin/tsx src/db/load-fixtures.ts && node dist/main.js"]
