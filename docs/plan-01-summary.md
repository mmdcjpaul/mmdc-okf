# Plan 1 progress: OKF vault toolkit and the MMDC vault

Status as of 2026-09-25. Covers `plans/01-okf-vault-toolkit.md` (milestones M0 to M8) and the
translation of the MMDC runbook bundle into a Lore vault.

## Summary

- The `@lore/okf` library, the `kb` CLI, the vault template, vault CI, and the shared fixtures
  are built and tested: 168 tests pass (149 library, 19 CLI), with type-check and ESLint clean.
- All three scale targets pass on a generated 20,000-note vault.
- The MMDC runbook (`mmdc-tech/mmdc-runbook` at commit `b84c879`) is imported into
  `/Users/polaris/projects/mmdc/mmdc-vault`: 239 notes and 25 hubs, 0 lint errors, every link
  resolves.
- Nothing is committed yet. `portable` has been initialised as a git repo, and `mmdc-vault` is a
  git repo on `main`. Neither has any commits.
- Remaining work needs GitHub access or a person: publishing the CLI, testing the vault workflow on
  GitHub, the Obsidian link check, and the agent navigation check.

## Milestones

| Milestone | Status | What exists |
|---|---|---|
| M0 Monorepo skeleton | Done | pnpm workspaces, Turborepo, TypeScript 6, ESLint, Prettier, Vitest; empty packages for Plans 2 to 4; `.github/workflows/ci.yml` |
| M1 Note model and round trip | Done | Parser and serializer that preserve comments, key order, and unknown keys; profile, namespace, and tag loaders; version, trust, and staleness helpers; `DiskSource`, `MemorySource`, `OverlaySource` |
| M2 Lint engine | Done | 24 rules with `--fix`; human, JSON, and GitHub output formats |
| M3 Links, graph, generated files | Done, except the Obsidian check | Link extraction and resolution, wikilink conversion, link graph with clusters, `index.md` in every folder, hub member lists, `_meta/graph.json`, `_meta/graph-report.md` |
| M4 Pure operations | Done | `newNote`, `moveNote`, `bump`, `verify`, `renameTerm`, `mergeTerms`, `addTerm` |
| M5 Chunker | Done | Heading-aware chunks with contextual headers, token counts, content hashes, footnotes resolved to sources |
| M6 `kb` CLI | Done | `lint`, `new`, `query`, `related`, `index`, `mv`, `bump`, `verify`, `taxonomy`, `migrate`; bundles to one file (`packages/cli/dist/kb.js`) |
| M7 Template and CI | Done, except publishing and the GitHub test | `templates/vault`, `pnpm create-vault`, vault workflow `kb.yml`, `publish-cli` workflow and script |
| M8 Seed content and agent check | Content done; check not run | The MMDC vault is Company A's vault; the agent check protocol is in `docs/demos/agent-navigation.md` |

## Test results

| Area | What is covered |
|---|---|
| Round trip | Property tests: unmodified notes serialize byte-identically; changing one key changes only that key's lines; every fixture note round-trips |
| Lint | One failing case per rule in `fixtures/vault-dirty/`, with expected issues and expected `--fix` output; fixes are idempotent; a duplicate id is caught in memory before anything is written |
| Generated files | Golden files match `fixtures/vault-acme`; a second `kb index` run makes no changes |
| Operations | Each operation leaves the vault lint-clean; a move with five inbound links leaves none broken |
| Chunker | Golden chunks for 10 notes; property tests for coverage, size limits, and determinism |
| CLI | Every command, run against a temporary git copy of the fixture vault |

Scale, on a generated 20,000-note vault (run with `pnpm --filter @lore/okf bench`):

| Step | Result | Target |
|---|---|---|
| `kb lint` | 15.7 s | under 30 s |
| `kb index` | 16.4 s | under 60 s |
| `kb query` with a warm cache | 119 ms in process (305 ms including Node start-up) | under 200 ms |

## Changes from the plan

- `kb query` uses a small custom index instead of MiniSearch. Loading a saved MiniSearch index
  of that size took about 500 ms. Reasons and numbers: `docs/decisions/0002-kb-query-index.md`.
- Two extra lint rules: `lore/link-style` lets `kb lint --fix` switch a whole vault between
  absolute and relative links, and `lore/provenance` checks `generated`, `verified`,
  `stale_after`, and `sources`.
- Links to generated files (`index.md`, `log.md`, `_meta/`) never count as wanted notes.

## MMDC runbook translation

Source: `/Users/polaris/projects/mmdc/mmdc_runbook` at `b84c879`, read-only. Output:
`/Users/polaris/projects/mmdc/mmdc-vault`, created from the template and filled by
`scripts/import/mmdc-runbook.ts`. Re-running the importer gives byte-identical output.

| Old bundle | New vault |
|---|---|
| `systems/*.md` | 17 System hubs in `kb/_systems/` |
| System tags in `tags.md` | `systems:` on each note |
| Function, severity, and role tags | `.kb/tags.yaml`, plus new `aws-lambda` and `post-incident-review` tags |
| 166 Lambda notes | Reference notes in `platform/lambda-functions/`, described by each function's purpose |
| Runbooks | Runbook notes in `platform`, `enrollment-ops`, and `it-support` |
| Workflows | Process notes in `platform/workflows/` |
| Incident write-ups | Reference notes in `platform/incidents/` |
| Knowledge-transfer documents | Source Documents; 35 embedded screenshots moved to `platform/_assets/` |
| Plans, ledgers, audits | The `documentation` namespace |
| Enrollment audit docs | `platform/enrollment-audit/` |
| 32 eval questions | `.kb/eval/questions.yaml`, with their must-include facts and expected notes |
| `hub.md` and `index.md` files | Generated root index, folder indexes, and graph report |
| `log.md` | `kb/log.md`, history kept |

- Eight new Theme hubs group notes across namespaces: enrollment, learner accounts, billing and
  payments, integrations, cloud operations, security, service desk, and documentation.
- Five notes over 2,500 words were split into linked parts.
- Every note's `sources` points at the original file on GitHub at `b84c879`.
- The vault's `AGENTS.md` carries over MMDC's working rules. The answer, eval, and gap-capture
  skills are ported; the old staging area is replaced by draft notes.
- The mapping is recorded in the vault at
  `kb/documentation/translate-the-mmdc-runbook-bundle-to-lore.md`.
- Result: 0 lint errors. The 21 warnings are notes between 1,200 and 2,500 words.

Not carried over: `clickup_exports/` (it may contain credentials), `system_links/`, the Python
tools, and the untracked `id_templates/` folder. Links to files that were not carried over now
point at the old repository on GitHub.

## Agreed decisions

- Every imported note is unverified. Owners should run `kb verify` on the notes they stand
  behind, starting with the runbooks.
- All four namespaces are owned by a placeholder team, `mmdc-tech`, until real teams exist.
- Lambda themes come from a name-based heuristic and are worth a spot check.
- Once people edit the vault, stop re-running the importer: it rewrites `kb/`.

## Remaining work

| Item | Needs |
|---|---|
| Publish the CLI as `@mmdc-tech/kb` (`node scripts/publish-cli.mjs @mmdc-tech/kb`; the dry run already passes) | GitHub token with package write access |
| Commit and push `mmdc-vault`; confirm the workflow fails on a lint error and does not re-trigger itself | GitHub repository |
| Update links to the old repository if it moves or is archived | Final repository location |
| Obsidian link check on macOS and Windows (`docs/decisions/0001-link-style.md`). GitHub's web view resolves `/` links from the repository root, not `kb/`, which may favour relative links | A person with Obsidian |
| Agent navigation check (`docs/demos/agent-navigation.md`) | A fresh agent session |

## Where things are

| Path | Contents |
|---|---|
| `packages/okf`, `packages/cli` | Library and CLI |
| `templates/vault`, `scripts/create-vault.mjs` | Vault template and creator |
| `fixtures/` | Shared test vaults (see `fixtures/README.md`) |
| `scripts/import/mmdc-runbook.ts` | MMDC importer |
| `docs/decisions/` | Link style (proposed) and query index (accepted) |
| `docs/demos/` | A demo script per milestone and the agent check protocol |
| `.github/workflows/` | Product CI and CLI publishing |
