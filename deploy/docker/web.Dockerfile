# The Library web app. Build from the repository root:
#   docker build -f deploy/docker/web.Dockerfile -t lore-web .
#
# The build needs no secrets and no database: every page renders per request. Configuration
# is read from the environment when the container starts.
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/ai/package.json packages/ai/
COPY packages/auth/package.json packages/auth/
COPY packages/db/package.json packages/db/
COPY packages/ingest/package.json packages/ingest/
COPY packages/search/package.json packages/search/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
COPY packages/ai packages/ai
COPY packages/auth packages/auth
COPY packages/db packages/db
COPY packages/ingest packages/ingest
COPY packages/search packages/search
RUN NEXT_OUTPUT=standalone pnpm --filter web build

FROM node:24-bookworm-slim
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static apps/web/.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
