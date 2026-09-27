# Demo: Plan 1 M7, vault template and CI

```bash
pnpm --filter @lore/cli build
pnpm create-vault demo-vault --dir /tmp/demo-vault --cli @yourorg/kb@1
cd /tmp/demo-vault && node <repo>/packages/cli/dist/kb.js lint && node <repo>/packages/cli/dist/kb.js index --check
```

The product CI job `vault-template` does the same on every pull request.

Still to do by hand (needs GitHub):

1. Publish the CLI: run the `publish-cli` workflow with the package name (for example
   `@mmdc-tech/kb`), or `node scripts/publish-cli.mjs @org/kb` with a `write:packages` token.
   `node scripts/publish-cli.mjs @org/kb --dry-run` shows the package without publishing.
2. Push a created vault to a scratch GitHub repository. Push a note with a lint error: the
   `kb` workflow fails with annotations. Push a clean change to main: one
   `kb: regenerate indexes [skip ci]` commit appears and no second run loops.
3. On a machine with only Node 24 and a `read:packages` token in `~/.npmrc`, run
   `npx -y @org/kb@1 lint` in the vault.
