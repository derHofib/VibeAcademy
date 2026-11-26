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
# poppler-utils: Vorschaubilder; Python + pyHanko: PAdES-Siegel (E-10)
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-deu python3 python3-venv ca-certificates \
 && python3 -m venv /opt/seal-venv && /opt/seal-venv/bin/pip install --no-cache-dir "pyhanko==0.29.*" pyhanko-certvalidator \
 && apt-get clean && rm -rf /var/lib/apt/lists/*
ENV SEAL_PYTHON=/opt/seal-venv/bin/python SEAL_SCRIPT=/app/seal/seal.py FONT_DIR=/app/fonts PDF_RENDERER=gotenberg
WORKDIR /app
COPY --from=build /out/api /app
COPY infra/seal /app/seal
COPY apps/web/public/fonts /app/fonts
# Dateiablage im Volume (STORAGE_DRIVER=fs) – muss dem Benutzer node gehören
RUN mkdir -p /data/storage && chown node:node /data/storage
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
