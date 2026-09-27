# {{VAULT_TITLE}}

This repository is the company knowledge base: processes, how-tos, runbooks, systems, and
policies, written as plain markdown in the [Open Knowledge Format](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
(OKF) v0.2. The Lore web app, coding agents, and people with a text editor all read and
write the same files. Git is the source of truth; everything else is rebuilt from it.

## How the vault is organised

```text
.kb/profile.yaml      note types, required fields, limits, teams
.kb/namespaces.yaml   namespaces (top-level folders) and who owns them
.kb/tags.yaml         governed tags and their aliases
kb/index.md           generated map of namespaces, themes, and systems (start here)
kb/_themes/           Theme hubs: business journeys that cross teams
kb/_systems/          System hubs: one per tool
kb/_meta/             generated graph.json and graph-report.md
kb/<namespace>/       one folder per owning team; deeper folders are only for tidiness
```

Each note holds one idea, has a type, 1 to 3 themes, and links to at least one hub.
Files named `index.md` and `log.md`, the hub member lists, and `kb/_meta/` are generated:
CI rebuilds them on every push to main.

## Six ways to add knowledge

| Path | Who | How |
|---|---|---|
| Direct edit | Anyone with repository access | Edit markdown in Obsidian or any editor, run `kb lint --fix`, push or open a pull request |
| Coding agent | Engineers | Ask the agent to document a service or process; it follows `AGENTS.md` and the kb-writer skill |
| Library editor | Writers | Edit in the browser; saving commits directly |
| Suggest edit | Any reader | Same editor, lands in the review queue |
| Upload | Any member | Upload a document; AI turns it into notes for review |
| Capture | Any member | Paste rough notes; AI tidies them into a note for review |

## Working locally

You need Node.js 24. Run the CLI with `npx -y {{CLI_PACKAGE}} <command>` (GitHub Packages
needs a token with `read:packages` in `~/.npmrc`), or install it once and use `kb`.

```bash
kb query "reset a password"                     # offline search
kb new "How-To" "Reset a staff password" --ns general --theme getting-started
kb lint --fix                                   # validate and fix what is safe to fix
kb bump kb/general/some-note.md --class process --summary "What changed"
kb verify kb/general/some-note.md               # people only: "I checked this is accurate"
kb taxonomy list                                # namespaces, themes, systems, tags
```

Obsidian users: open the `kb/` folder as the vault, not the repository root, so links that
start with `/` resolve from the right place.

## Rules CI enforces

Frontmatter parses and has a `type`; required fields are present; types, themes, systems,
tags, and owners exist; notes live in a registered namespace; ids and titles are unique;
deprecated notes point at their replacement; Actions and Request Types are well formed; no
secrets. Warnings (not failures): wikilinks, links to notes that do not exist yet, notes
with no hub link, long notes, stale hub member lists.
