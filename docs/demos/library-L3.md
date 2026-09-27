# Demo: Plan 2 L3, the indexer

With the Library running (see `library-L0.md`):

```bash
pnpm lore simulate-push --vault acme --file fixtures/patches/obsidian-edit.patch
```

Within a few seconds "Reset a staff password" shows a Notes section, version 1.0.1, and a new
entry by "External editor" in its History. Click the entry to see the diff.

```bash
pnpm lore reindex --vault acme          # "already at <sha>": nothing to do
pnpm lore reindex --all                 # rebuild; "0 embedded" because vectors are cached
pnpm test:int                           # includes incremental-equals-full and staleness
```

Staleness follows the clock. A note whose `stale_after` passes becomes stale in search and
loses 20 health points on the next index run, even when nothing was pushed. The worker runs
one every 5 minutes.

Scale, nightly in CI: `pnpm scale:library`. Last run: full index of 20,000 notes in 122 s;
a one-note push searchable in 14.6 s (limit 30 s).
