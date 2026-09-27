# Demo: Plan 1 M2, lint engine

```bash
cd fixtures/vault-acme && node ../../packages/cli/dist/kb.js lint        # 0 errors, 2 known warnings
cd ../vault-dirty && ls okf lore                                        # one folder per rule
```

- `packages/okf/test/lint.test.ts` runs every case in `fixtures/vault-dirty/<rule>/`: expected
  issues, expected `--fix` output, and a second fix that changes nothing.
- The in-memory test adds a note with a duplicate id through an `OverlaySource` and shows the
  linter catching it before anything is written.
- `requestTypeSchema` accepts and rejects payloads for each field type.
- Output formats: `kb lint --format human,json,github`.
