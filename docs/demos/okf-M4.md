# Demo: Plan 1 M4, pure operations

In a scratch copy of the fixture (`cp -r fixtures/vault-acme /tmp/acme && cd /tmp/acme && git init -q`):

```bash
KB=../path/to/packages/cli/dist/kb.js
node $KB mv kb/finance/refund-policy.md kb/finance/policies/student-refund-policy.md
grep -rn student-refund-policy kb | head        # inbound links rewritten
node $KB bump kb/finance/refund-policy.md --class process --summary "New deadline"
head -8 kb/finance/log.md                         # log entry; verified reset
node $KB verify kb/finance/how-deposits-flow-from-salesforce-to-netsuite.md
node $KB taxonomy rename tag refunds student-refunds
node $KB index && node $KB lint                   # still clean
```

`packages/okf/test/ops.test.ts` covers the same with snapshots, including a move with five
inbound links (absolute, relative, and reference-style).
