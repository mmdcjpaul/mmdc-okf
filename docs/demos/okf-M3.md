# Demo: Plan 1 M3, links, graph, and generated files

```bash
cd fixtures/vault-acme
KB_NOW=2026-09-24T00:00:00Z node ../../packages/cli/dist/kb.js index --check   # up to date
cat kb/index.md kb/_meta/graph-report.md
```

- `kb/index.md` declares `okf_version: "0.2"` and lists namespaces, themes, and systems with counts.
- Every folder has an `index.md`; hubs carry member lists between the `kb:members` markers.
- The graph report names the known orphan (campus printer), wanted note (unlock a locked
  account), stale note (approve vendor invoices), and unverified notes.
- Link style: see `docs/decisions/0001-link-style.md`. The manual Obsidian check is still to do.
