# 0005: Test tiers, and compose services instead of Testcontainers

- Status: Accepted
- Date: 2026-09-27
- Plan: overview section 5; Plan 2 L3

## Context

The overview asks for three tiers (`test`, `test:int`, `e2e`) and for Testcontainers to start
Postgres and Meilisearch in integration tests. The first pass of Plan 2 had one tier. Its
integration tests ran against the dev compose services and skipped when those were down, so a
local run could report green without running the indexer or the leak canary.

## Decision

| Tier | Command | Needs | Files |
|---|---|---|---|
| Unit | `pnpm test` | Nothing | `*.test.ts` |
| Integration | `pnpm test:int` | `pnpm services:up` | `*.int.test.ts` |
| End to end | `pnpm --filter web e2e` | `pnpm services:up` | `apps/web/e2e/*.spec.ts` |

Integration and end-to-end tests use the dev compose services, not Testcontainers. They never
skip: when a service is unreachable the run fails and says to run `pnpm services:up`.

Each integration test file creates its own database and search indexes, and the end-to-end
suite has its own database, indexes, bucket, and repository, so neither touches a developer's
running Library.

## Why not Testcontainers

- The services are the same ones a developer already runs. Starting a second set costs 10 to
  20 seconds per run and a second copy of each image's memory.
- CI uses GitHub service containers, which are the same images on the same ports.
- What the plan wanted from Testcontainers was isolation and a guarantee that the tests ran.
  Per-test databases give the first; failing instead of skipping gives the second.

## Consequences

- `pnpm test` is fast and needs no Docker, as the overview requires.
- A machine with other software on ports 5433, 7701, or 9002 sets `TEST_PG_ADMIN_URL`,
  `TEST_MEILI_URL`, or `TEST_S3_ENDPOINT`.
- Live tests (`@live`: real GitHub, real models) are a fourth tier that arrives with the
  GitHub provider and the AI core.
