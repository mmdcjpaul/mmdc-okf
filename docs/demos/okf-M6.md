# Demo: Plan 1 M6, the kb CLI

```bash
pnpm --filter @lore/cli build
cd fixtures/vault-acme
KB=../../packages/cli/dist/kb.js
node $KB query "re-enroll returning student"          # returning-student note first
node $KB related kb_01J9Z6Q4X8M2T7C3VQ5R1N0B8D
node $KB taxonomy list --kind themes
node $KB related kb/finance/refund-policy.md --remote  # "Lore API not configured", exit 1
node $KB frobnicate; echo $?                           # usage error, exit 2
rm -rf .kb/.cache                                      # leave the fixture clean
```

Scale (nightly): `pnpm --filter @lore/okf bench` generates the 20,000-note vault and checks
lint < 30 s, index < 60 s, warm query < 200 ms. Last run: 15.7 s, 16.4 s, 119 ms.
