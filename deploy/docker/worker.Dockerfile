# The worker: index jobs, the mirror, and the internal API. Build from the repository root:
#   docker build -f deploy/docker/worker.Dockerfile -t lore-worker .
#
# Workspace packages ship TypeScript source and Node runs it directly, which only works for
# files outside node_modules. So the image keeps the workspace layout and its symlinks rather
# than a flattened `pnpm deploy` copy.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable \
  && apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/worker/package.json apps/worker/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/git/package.json packages/git/
COPY packages/ingest/package.json packages/ingest/
COPY packages/okf/package.json packages/okf/
COPY packages/search/package.json packages/search/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --prod --filter worker...

FROM base
ENV NODE_ENV=production WORKER_HOST=0.0.0.0 WORKER_PORT=8081 DATA_DIR=/data
COPY --from=deps /app ./
COPY tsconfig.base.json ./
COPY apps/worker apps/worker
COPY packages/ai packages/ai
COPY packages/auth packages/auth
COPY packages/db packages/db
COPY packages/git packages/git
COPY packages/ingest packages/ingest
COPY packages/okf packages/okf
COPY packages/search packages/search
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME /data
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.WORKER_PORT||8081)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
WORKDIR /app/apps/worker
CMD ["node", "src/main.ts"]
