# Demo: Plan 2 L4, search

With the Library running on the Acme fixture:

1. Press Cmd-K (Ctrl-K on Windows), type `refund`, and press Enter on "Refund policy".
2. On Home, search `returning student`. The first result is "Enroll a returning student in
   Salesforce". Narrow by Type: How-To.
3. Search `paper enrollment form`. The deprecated note is hidden until you choose "Show
   deprecated notes".
4. Sign in as Carol and search `zebra-payroll-canary`: nothing from People Ops. Sign in as
   Erin: "Payroll calendar" is there.

```bash
EMBEDDINGS=fail pnpm dev:web        # search still answers, marked "keyword search"
EMBEDDINGS=local pnpm lore reindex --all && EMBEDDINGS=local pnpm dev:web
                                    # real semantic vectors from a model on this machine
pnpm scale:library                  # p95 on 20,000 notes; last run 71 ms and 93 ms
```
