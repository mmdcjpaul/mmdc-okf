# Plan 1: OKF Vault Toolkit

The portable markdown layer: the `@lore/okf` library, the `kb` CLI, the vault template repository, vault CI, and the agent instructions. This plan is PRD phase 0. It needs no database, no server, and no AI, so it is fully testable with Node.js and Git.

| Item | Value |
|---|---|
| PRD sections | 6 (knowledge model), 7.1 direct edit and coding agent paths, 7.4 step 1, 11.3 Action format |
| TECH_STACK sections | 5, 6 (CI workflow only), 10.1 (chunker), 14.1 |
| Requirements | AU-9, AU-14 (CLI side), AU-16 (format), AP-1, phase 0 exit criteria |
| Packages | `packages/okf`, `packages/cli`, `templates/vault`, `fixtures/` |
| Depends on | Nothing |
| Depended on by | Plans 2, 3, and 4 import `@lore/okf`; Plan 4 uses the CLI in Multica runtimes |

---

## 1. Scope

In scope:

- The monorepo skeleton that every other plan builds in.
- Parsing, validating, and serializing OKF v0.2 notes with Lore's extra keys, preserving comments, key order, and unknown keys.
- Loading the vault profile (`.kb/profile.yaml`, `namespaces.yaml`, `tags.yaml`).
- The shared lint engine used by `kb lint`, CI, and the Library ingestion pipeline.
- Link extraction, link resolution, wikilink conversion, the link graph, hub member lists, `index.md` files, `graph.json`, and `graph-report.md`.
- Pure note operations that return file operations: new, move, bump, verify, taxonomy rename and merge.
- The heading-aware chunker with contextual headers (pure and deterministic, so the Library indexer and the Desk sandbox share it).
- Request Type field schemas converted to zod at runtime (the Desk uses this for intake).
- The `kb` CLI with every command in TECH_STACK section 5.
- The vault template repository: README, AGENTS.md, CLAUDE.md, the kb-writer skill, `.kb/` files, seed hubs, and `.github/workflows/kb.yml`.
- The shared fixtures listed in the overview.
- The Obsidian links spike.

Out of scope:

- Anything that reads Postgres, Meilisearch, or GitHub's API.
- `kb related --remote`. The flag exists and returns "Lore API not configured" until Plan 4 adds the endpoint.
- doc2query, embeddings, and any model call.

---

## 2. Design principles for this package

1. All mutations are pure functions that return `FileOp[]`. The CLI applies them to disk; the Library turns the same ops into a changeset. This is how "one pipeline for all writers" becomes true in code.
2. All reads go through a `FileSource`, so the linter can validate a changeset against the vault before anything is committed, with no working copy.
3. Output is deterministic. Generated files sort their contents, and running `kb index` or `kb lint --fix` twice produces no diff.
4. The toolkit is strict about Lore's rules and lenient about OKF's optional parts. Unknown keys survive every round trip.

---

## 3. Public API of `@lore/okf`

Plans 2 and 3 code against this surface. Freeze it at the end of M1 (types) and M2 (lint), and change it afterwards only with a changelog entry.

```ts
// File access
export interface FileSource {
  list(prefix: string): Promise<string[]>;
  read(path: string): Promise<string | Uint8Array | null>;
  blobSha?(path: string): Promise<string | null>;
}
export class DiskSource implements FileSource {}
export class MemorySource implements FileSource {}
export class OverlaySource implements FileSource { constructor(base: FileSource, ops: FileOp[]) }

export type FileOp =
  | { op: "put"; path: string; content: string | Uint8Array }
  | { op: "delete"; path: string };

// Vault and notes
export function loadVault(src: FileSource, opts?: { only?: string[] }): Promise<Vault>;
export function parseNote(text: string, path: string): ParsedNote;   // never throws; parse errors become issues
export function serializeNote(note: ParsedNote): string;             // stable key order, preserves unknowns
export function trustTier(verified: Verification[] | undefined): "unverified" | "machine" | "human";
export function isStale(note: ParsedNote, now: Date): boolean;

// Operations (pure)
export function newNote(vault: Vault, input: NewNoteInput, actor: Actor, now: Date): FileOp[];
export function moveNote(vault: Vault, from: string, to: string): FileOp[];   // rewrites inbound links
export function bump(vault: Vault, path: string, cls: ChangeClass, actor: Actor, now: Date): FileOp[]; // version, generated, log.md
export function verify(vault: Vault, path: string, actor: Actor, now: Date): FileOp[];                 // verified, stale_after
export function renameTerm(vault: Vault, kind: TermKind, from: string, to: string): FileOp[];
export function mergeTerms(vault: Vault, kind: TermKind, from: string[], into: string): FileOp[];

// Validation
export function lint(vault: Vault, opts?: { paths?: string[]; rules?: RuleConfig }): Promise<LintReport>;
export function fix(vault: Vault, report: LintReport): FileOp[];

// Links and graph
export function extractLinks(note: ParsedNote): Link[];
export function resolveLink(vault: Vault, from: string, href: string): ResolvedLink; // { targetId | null, wanted }
export function buildGraph(vault: Vault): Graph;           // graphology instance
export function generateIndexes(vault: Vault): FileOp[];   // index.md files, hub members, _meta/*

// Retrieval support
export function chunkNote(note: ParsedNote, vault: Vault, opts?: ChunkOptions): Chunk[];
export function requestTypeSchema(note: ParsedNote): z.ZodObject<any>;
export function actionParameterSchema(note: ParsedNote): z.ZodObject<any>;
```

---

## 4. Milestones

Sizes are rough: S is 1 to 3 days, M is 3 to 6 days, L is 1 to 2 weeks, for one engineer working with coding agents.

### M0. Monorepo skeleton (S)

Build:

- pnpm workspaces, Turborepo, TypeScript project references, a shared `tsconfig`, ESLint, Prettier, Vitest workspace config, and the folder layout from the overview with empty packages.
- Product repository CI: install, type-check, lint, `turbo test`. Caching enabled.
- `fixtures/` folder with a README describing each fixture and the rule that fixture changes are reviewed.

Tests and acceptance:

- `pnpm install && pnpm turbo test` passes on a clean clone in CI.
- A trivial package can import another through the workspace.

### M1. Note model, profile, and round trip (M)

Build:

- `parseNote` using remark (`remark-parse`, `remark-frontmatter`, `remark-gfm`) for the body and the `yaml` Document API for frontmatter. Keep the original text for untouched sections.
- `serializeNote` with the stable key order: type, title, description, id, version, themes, systems, tags, owner, aliases, resource, status, generated, verified, stale_after, sources, then everything else in original order.
- Typed views over frontmatter (`NoteData`) with zod schemas for each Lore field, including the Request Type and Action extras.
- Profile, namespaces, and tags loaders with zod validation and PRD defaults for anything missing. Add a `link_style` profile option (`absolute` or `relative`) so the Obsidian spike outcome is configuration, not code.
- `trustTier`, `isStale`, ULID-based `newId`, `parseActor`, `bumpVersion(version, class)` (fix to patch, addition to minor, process to major; drafts start at 0.1.0 and stable at 1.0.0).
- `FileSource` implementations: `DiskSource`, `MemorySource`, `OverlaySource`.

Tests and acceptance:

- Property test with fast-check: generate frontmatter with comments, unknown keys, nested maps, flow and block styles, and unicode; assert `serialize(parse(x))` is byte-identical when nothing was modified.
- Property test: modify one known key and assert the diff touches only that key's lines.
- Every note in `fixtures/vault-acme` round-trips byte-identically.
- Table tests for `bumpVersion`, `trustTier` (human, machine-only, empty), and `isStale` at boundary instants.
- Malformed YAML produces a parse issue, not an exception.

### M2. Lint engine and rules (L)

Build a rule engine where each rule has an id, severity, a check function over the vault or a note, and an optional fix that returns `FileOp[]`. Rules run against any `FileSource`, including an `OverlaySource`, so the Library can lint a changeset before it commits.

| Rule id | Check | Level | Fix |
|---|---|---|---|
| `okf/frontmatter` | Frontmatter parses and `type` is present | Error | No |
| `okf/reserved-files` | `index.md` has no frontmatter except the root `okf_version`; `log.md` is well formed | Error | Regenerate |
| `lore/required` | Profile's required fields present | Error | Adds `id` and `version` |
| `lore/id-format`, `lore/version-format`, `lore/status` | Formats and enums | Error | No |
| `lore/vocabulary` | Types, themes, systems, tags, owners exist | Error | Rewrites aliases to canonical terms |
| `lore/limits` | 1 to 3 themes, at most 8 tags | Error | No |
| `lore/namespace` | Top-level folder is registered | Error | No |
| `lore/custom-fields` | Custom fields match the profile | Error | No |
| `lore/wikilinks` | Obsidian wikilinks present | Warning | Converts to standard links in the profile's link style |
| `lore/link-targets` | Link targets exist (reported as wanted notes) | Warning | No |
| `lore/hub-link` | At least one link to a hub | Warning | No |
| `lore/word-count` | Warn above 1,200 words, error above 2,500 | Warning or error | No |
| `lore/duplicate-id` | Ids unique across the vault | Error | No |
| `lore/duplicate-title` | Titles unique within a namespace | Error | No |
| `lore/deprecated` | Deprecated notes have `superseded_by` pointing at an existing note | Error | No |
| `lore/action` | Actions have valid `execution`, `risk`, `parameters`, `executor`, and Manual procedure and Rollback sections | Error | No |
| `lore/request-type` | Request Type `kind`, `route_to`, `follow_up_after` (ISO 8601), and `fields` are valid; `self_service` and `runbook` resolve | Error | No |
| `lore/secrets` | secretlint recommended rules | Error | No |
| `lore/images` | Referenced images exist and are under the size limit | Warning | No |
| `lore/hub-members` | Generated member lists are current | Warning | Regenerate |
| `lore/link-style` | Links use the profile's `link_style` | Warning | Converts to the profile's style |
| `lore/provenance` | `generated`, `verified`, `stale_after`, and `sources` are well formed | Error | No |

Also build:

- `requestTypeSchema(note)`: converts `fields` into a zod object (email, text, select with options, date, number, boolean), with labels carried as descriptions. `actionParameterSchema` does the same for Action parameters.
- Report formats: human (grouped by file), JSON (for the pipeline), and GitHub annotations (for CI).

Tests and acceptance:

- For each rule, `fixtures/vault-dirty/<rule-id>/` contains a failing input, the expected issues as JSON, and the expected output after `--fix`. One parameterized test runs them all.
- `fixtures/vault-acme` lints with zero errors.
- `fix` is idempotent: applying it twice equals applying it once.
- Linting an `OverlaySource` that adds a note with a duplicate id fails, while the same note on disk alone passes. This proves changesets can be validated in memory.
- `requestTypeSchema` accepts and rejects sample payloads for each field type.
- Performance: linting the 20,000-note synthetic vault takes under 30 seconds on a CI runner.

### M3. Links, graph, generated files, and the Obsidian spike (M)

Build:

- Link extraction from the markdown syntax tree, ignoring code spans and blocks. Resolution of bundle-absolute and relative links to note ids, with anchors preserved. Wikilink conversion by title and alias.
- `buildGraph` with graphology: nodes for notes, edges for body links, hub membership, and `superseded_by`. Louvain communities.
- `generateIndexes`:
  - `kb/index.md` with `okf_version: "0.2"`, namespaces, themes, and systems with descriptions and note counts.
  - An `index.md` in every folder with grouped titles and descriptions.
  - Hub member lists between `<!-- kb:members:start -->` and `<!-- kb:members:end -->`, grouped by type, leaving the human introduction untouched.
  - `_meta/graph.json` with every note (id, path, type, namespace, themes, systems, tags, trust tier, status) and every edge.
  - `_meta/graph-report.md`: most-linked notes, clusters with labels, notes per theme and system, orphans, wanted notes, stale and unverified counts.
- Obsidian spike: open `fixtures/vault-acme/kb` as an Obsidian vault on macOS and Windows, click through bundle-absolute links, record results in `docs/decisions/0001-link-style.md`, and set the default `link_style` accordingly.

Tests and acceptance:

- `generateIndexes` on `vault-acme` matches committed golden files. Running it twice yields zero ops the second time.
- The graph report lists the fixture's known orphan, wanted note, stale note, and unverified note.
- Resolution table tests: absolute, relative, anchors, missing targets, links inside code blocks (ignored).
- The link-style decision record exists and the fixtures use the chosen style.

### M4. Pure operations (M)

Build `newNote`, `moveNote`, `bump`, `verify`, `renameTerm`, and `mergeTerms` as pure functions that return `FileOp[]`.

- `bump` with class `process` sets the major version, updates `generated`, resets `verified` to entries added in the same change, and appends an entry to the namespace `log.md`.
- `verify` appends `{ by, at }` and sets `stale_after` to now plus the type's review interval.
- `moveNote` rewrites every inbound link in the same set of ops and keeps the `id`.
- `renameTerm` and `mergeTerms` update `tags.yaml` or the hub note and rewrite every affected note, adding the old term as an alias.

Tests and acceptance:

- Each operation applied to a `MemorySource` copy of `vault-acme` produces a vault that still lints clean.
- `moveNote` on a note with 5 inbound links leaves zero broken links.
- `bump --class process` produces the expected `log.md` entry and resets `verified`.
- Snapshot tests of the ops for each operation.

### M5. Chunker (S)

Build `chunkNote` following TECH_STACK 10.1:

- Split at H1 to H3 and keep the heading path. Keep lists, tables, and code blocks whole; split a numbered procedure over 700 tokens between list items and repeat the heading.
- Merge sections under 80 tokens into a neighbour. Split sections over 700 tokens into 400 to 600 token chunks at paragraph boundaries, with no overlap.
- Resolve footnote markers to their `sources` titles in chunk metadata.
- Build the deterministic contextual header (note title, type, namespace, summary, themes, systems, section).
- Each chunk has `id` (`<noteId>#<position>`), `headingPath`, `header`, `text`, `tokens`, and `contentHash` (sha256 of header plus text, the embedding cache key).
- Token counting uses a pluggable counter, defaulting to `js-tiktoken` cl100k as an approximation.

Tests and acceptance:

- Golden chunk output for 10 representative fixture notes.
- Property tests: every body character outside frontmatter appears in exactly one chunk, no chunk exceeds 700 tokens unless it is a single indivisible block, and output is identical across runs.

### M6. The `kb` CLI (M)

Build `packages/cli` on top of `@lore/okf`, bundled with tsup into a single file.

| Command | Behaviour |
|---|---|
| `kb lint [--fix] [--format human,json,github] [paths]` | Exit 1 on errors |
| `kb new <type> "<title>" --ns <ns> --theme <theme>` | Writes a templated note with a fresh id |
| `kb query "<text>" [--ns] [--type] [--limit]` | Full-text search over title, aliases, description, and body; a compact index cached in `.kb/.cache/` keyed by file mtimes (not MiniSearch: `docs/decisions/0002-kb-query-index.md`) |
| `kb related <path or id> [--remote]` | Linked notes plus similarity from the same index; `--remote` deferred to Plan 4 |
| `kb index [--check]` | Regenerates files; `--check` exits 1 if anything is out of date |
| `kb mv <from> <to>` | Applies `moveNote` |
| `kb bump <path> --class fix,addition,process` | Applies `bump` |
| `kb verify <path>` | Applies `verify`; refuses when the actor is not `human:` |
| `kb taxonomy list,add,rename,merge` | Vocabulary management |
| `kb migrate` | Framework for profile or OKF upgrades; ships with a no-op 0.2 to 0.2 migration |

The actor comes from `KB_ACTOR`, or `human:<local part of git user.email>`. Exit codes: 0 success, 1 validation failure, 2 usage error.

Tests and acceptance:

- Each command runs against a temporary copy of `vault-acme` in a temporary Git repo, with snapshot tests of stdout and of the resulting files.
- `kb query "re-enroll returning student"` returns the fixture's returning-student note first.
- `kb query` answers in under 200 ms on the synthetic 20,000-note vault once the cache is warm.
- `kb index` on the synthetic vault finishes in under 60 seconds.

### M7. Vault template, CI, and agent instructions (M)

Build `templates/vault/` and a `pnpm create-vault <name>` script that copies it into a new repository:

- `README.md`: how the vault works and how to contribute by each path in PRD 7.1.
- `AGENTS.md` as in TECH_STACK 14.1, and `CLAUDE.md` containing `@AGENTS.md`.
- `.agents/skills/kb-writer/SKILL.md`: search first and prefer updates; one idea per note; a frontmatter template per type; bundle links and at least one hub link; `sources` pointing at repository paths with commit SHAs; `generated.by` set to the agent and model; never add `verified`; run `kb lint --fix`; the commit message format.
- `.kb/profile.yaml`, `namespaces.yaml`, `tags.yaml`, `eval/questions.yaml` with the PRD defaults.
- Seed hubs in `kb/_themes/` and `kb/_systems/`.
- `.github/workflows/kb.yml` from TECH_STACK section 6.
- `.gitignore` for `.kb/.cache/`.
- Publish the CLI to GitHub Packages as `@yourorg/kb`, major version aligned with the profile schema version.

Tests and acceptance:

- A CI job in the product repository creates a vault from the template, runs `kb lint` and `kb index --check`, and both pass.
- The workflow is exercised on a scratch GitHub repository: a push with a lint error fails; a clean push to main produces one `kb: regenerate indexes [skip ci]` commit and does not loop.
- `npx -y @yourorg/kb@1 lint` works on a machine with only Node.js 24 and a GitHub Packages token.

### M8. Seed content and agent navigation check (M)

Build:

- Create Company A's vault from the template. Write 30 to 50 real notes with people and coding agents, following the kb-writer skill.
- An agent navigation check in `docs/demos/agent-navigation.md`: three scripted tasks for a coding agent in the vault (find how to enroll a returning student, document a small service from a sample code repository, update a Process note with a Process change). Record whether the agent read `index.md` and `graph-report.md` first, whether it used `kb query` before grepping, and whether its output passed lint with existing taxonomy.

Tests and acceptance (phase 0 exit criteria):

- Company A's vault passes lint in CI on main.
- In all three agent tasks the agent starts from the index files and produces notes that lint clean without inventing taxonomy terms.

---

## 5. Test strategy summary

| Layer | What | Where |
|---|---|---|
| Unit | Parser, serializer, loaders, version and trust helpers, each rule, each operation, chunker | `packages/okf/src/**/*.test.ts` |
| Property | Round trip, fix idempotency, chunk coverage and determinism, index idempotency | `packages/okf/test/property/` |
| Golden files | Lint rule fixtures, generated index files, chunk outputs | `fixtures/vault-dirty/`, `packages/okf/test/golden/` |
| CLI | Command snapshots in temporary Git repos | `packages/cli/test/` |
| Scale | Lint, index, and query timings on the synthetic vault | `pnpm --filter @lore/okf bench` (nightly) |
| Workflow | Template CI on a scratch GitHub repository | Nightly `@live` job |
| Human | Obsidian spike, agent navigation check | Decision record and demo doc |

---

## 6. Definition of done

- The API in section 3 is implemented, documented with TSDoc, and marked stable.
- Every test tier above is green in CI.
- The CLI is published and installable with `npx`.
- The template repository exists, and Company A's vault was created from it with 30 to 50 real notes.
- The link-style decision is recorded.
- The fixtures in the overview exist and lint as expected.

## 7. Risks

| Risk | Mitigation |
|---|---|
| The `yaml` Document API does not preserve some formatting exactly | Property tests in M1 find it early; normalize only what cannot be preserved and document it |
| OKF v0.2 changes | Keep OKF rules under the `okf/` prefix, separate from `lore/` rules; `kb migrate` exists from the start |
| Obsidian does not resolve bundle-absolute links | `link_style: relative` is already a profile option and `--fix` converts |
| Agents ignore AGENTS.md | M8 measures it; tighten the skill and add a pre-commit hook that runs `kb lint` |
