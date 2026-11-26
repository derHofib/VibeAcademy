# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @sn/api... --filter @sn/db...
COPY packages packages
COPY apps/api apps/api
RUN pnpm --filter @sn/shared --filter @sn/db build && pnpm --filter @sn/api build \
 && pnpm deploy --filter @sn/api --prod --legacy /out/api

# Migrationen (läuft als Einmal-Container)
FROM base AS migrate
COPY --from=build /repo /repo
WORKDIR /repo/packages/db
CMD ["sh", "-c", "pnpm run bootstrap && pnpm run migrate"]

FROM node:22-bookworm-slim AS api
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/api /app
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
