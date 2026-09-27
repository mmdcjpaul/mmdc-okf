# Working in this vault

This repository is an OKF v0.2 knowledge bundle in `kb/`.

Before searching:
1. Read `kb/index.md` for namespaces, themes, and systems.
2. Read `kb/_meta/graph-report.md` for hubs, clusters, and gaps.
3. Use `kb query "<words>"` and `kb related <note>` before grepping.

When writing notes, follow `.agents/skills/kb-writer/SKILL.md`.
Never invent namespaces, themes, systems, or tags; run `kb taxonomy list`.
Run `kb lint --fix` before every commit.

## Running kb

`kb` is the Lore CLI. If it is not on your PATH, run it with
`npx -y {{CLI_PACKAGE}} <command>`. Set `KB_ACTOR` to `<agent>/<model>`, for example
`claude-code/claude-sonnet-5`, so `generated.by` credits you correctly.

## Rules that are easy to miss

- Links are standard markdown links with bundle-absolute paths such as
  `/general/how-to-contribute-to-the-knowledge-base.md`. No `[[wikilinks]]`.
- `index.md`, `log.md`, hub member lists, and `kb/_meta/` are generated. Do not edit them by
  hand; CI regenerates them on main.
- Never add a `verified` entry. Verification belongs to people.
- Never put secrets, passwords, tokens, or personal data in the vault.
