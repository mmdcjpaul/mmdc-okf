# Agent navigation check (Plan 1, M8)

Phase 0 exit criterion: in three scripted tasks, a coding agent starts from the index files,
uses `kb query` before grepping, and produces notes that lint clean without inventing taxonomy.

Company A's vault is the MMDC vault created from the template and filled by
`scripts/import/mmdc-runbook.ts` (255 notes, 25 hubs; see
`kb/documentation/translate-the-mmdc-runbook-bundle-to-lore.md` in that vault).

## Setup

1. A fresh clone of the vault, with the CLI on PATH (`npx -y @mmdc-tech/kb@1` once published, or
   `alias kb="node <lore>/packages/cli/dist/kb.js"`).
2. A fresh agent session (Claude Code or Codex) started in the vault root, with no prior context.
3. `export KB_ACTOR=<agent>/<model>`.
4. Record the transcript. Do not coach the agent beyond the task text.

## Tasks

| # | Task text given to the agent | Passes when |
|---|---|---|
| 1 | "A learner enrolled yesterday but never got their Camu login email. What should I check, in order?" | The answer cites `/platform/runbooks/incident/triage-camu-credential-sync-failure.md` and the scheduler times, and no files change |
| 2 | "Document the `AppsysGSA-prod-read_sftp_gsa_data` function from this code checkout: <path>. Update the vault." | It updates the existing Lambda note (search first) rather than creating a duplicate, adds `sources` at a commit SHA, uses existing themes and systems, and `kb lint` passes |
| 3 | "Starting next term, the `AppsysGSA-prod-read_sftp_gsa_data` schedule changes to hourly from 06:00 to 20:00 Manila time. Update the vault." | It finds every note that states the current schedule (`kb query`, `kb related`), edits them, runs `kb bump --class process --summary ...` on the main one, and lint passes |

## What to record for each task

| Question | Task 1 | Task 2 | Task 3 |
|---|---|---|---|
| Read `kb/index.md` before searching? | | | |
| Read `kb/_meta/graph-report.md`? | | | |
| Used `kb query` / `kb related` before `grep`? | | | |
| Reused existing namespaces, themes, systems, tags only? | | | |
| `kb lint` clean at the end? | | | |
| Added a `verified` entry? (must be no) | | | |
| Notes | | | |

## Status

Not run yet. The vault, CLI, AGENTS.md, and skills are in place. Run the three tasks with a
fresh agent and fill in the table. If an agent skips the index or invents terms, tighten
`AGENTS.md` and the kb-writer skill, and consider a pre-commit hook that runs `kb lint`
(Plan 1 risk table).
