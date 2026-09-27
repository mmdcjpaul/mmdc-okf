# Demo: Plan 2 L0, platform scaffolding

```bash
pnpm services:up          # Postgres :5433, Meilisearch :7701, object store :9002, Mailpit :8025
pnpm lore seed --vault fixtures/vault-acme --principals fixtures/principals.yaml
pnpm dev:library          # web on :3000, worker on :8081
```

Open http://localhost:3000, choose Alice, and check that the sidebar lists Admissions,
Finance, and IT Support, and not People Ops.

```bash
curl -s localhost:8081/health                  # {"ok":true,"lastIndex":...}
curl -s localhost:3000/api/health              # {"ok":true}
pnpm lore migrate                              # "Migrations applied"; safe to repeat
pnpm --filter @lore/db test                    # includes the additive-only migration check
```

Configuration fails fast. `DATABASE_URL=nonsense pnpm lore migrate` lists the bad setting
and exits.

Container images:

```bash
docker build -f deploy/docker/worker.Dockerfile -t lore-worker .
docker build -f deploy/docker/web.Dockerfile -t lore-web .
```
