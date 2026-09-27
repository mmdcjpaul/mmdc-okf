# Demo: Plan 2 L9, Admin

With the services up and the Acme fixture seeded, start the Library and sign in as Dana
(an admin). Admin is in the sidebar for admins and owners only.

```bash
AI_MODE=fake APP_ENCRYPTION_KEY=$(openssl rand -hex 32) pnpm dev:library
```

## Access takes effect on the next request

1. In a second browser, sign in as Carol and open Finance.
2. As Dana, open Admin, Namespaces and grants. Set Finance to Restricted and save.
3. Reload Carol's page: Finance is gone from the sidebar, from search, and `/ns/finance`
   answers 404. Bob, who holds a grant, still reads it.
4. The same change arrives in the vault as a commit to `.kb/namespaces.yaml`, so the vault
   stays the record:

```bash
git -C .data/vaults/acme.git log -1 --format=%s
# kb(vault): change the settings of namespace "finance"
```

Grants work the same way: give Carol Read on People Ops and her next request can read it;
remove it and her next request cannot.

## Provider keys

1. Admin, AI. Paste a key for Anthropic and save. The page answers with the last four
   characters and never shows the key again.
2. "Test key" makes one small call and reports the model and the time it took.
3. The key is stored encrypted (AES-256-GCM, `v1.` prefix) in `settings`:

```bash
psql "$DATABASE_URL" -c "select value->'keys' from settings where key = 'ai'"
```

Models, fallbacks, and budgets are on the same page, with this month's usage by task.
A model without a known price is accepted, and the page says its calls are logged
without a cost.

## The rest

| Page | What it does |
|---|---|
| People | Roles. The last admin cannot be demoted. |
| Teams | Add and remove teams and members, pin hubs to a team's home page. Teams are written to `.kb/profile.yaml` so `kb lint` accepts them as owners offline. |
| Branding and features | Name, accent colour, and feature switches. |
| Audit log | Every Admin action with who and when. Filter by action or person, export as CSV. The export is itself recorded. |
| Snapshots | An annotated Git tag on the vault as it is now. A name can be used once. |

## What is refused

| Try | Result |
|---|---|
| Any Admin page or `/api/admin/*` as a member | 403, with nothing from the page in the response |
| The same, signed out | Sign-in page, or 401 from the API |
| An accent colour that is not `#rrggbb` | Refused |
| A model not written as `provider:model` | Refused |

## Tests

`apps/web/e2e/08-admin.spec.ts` finds every Admin route on disk and checks each one as
Alice, Bob, Carol, and Erin. `apps/web/test/routes.test.ts` fails if an Admin route does
not call `requireAdmin` or `apiAdmin`. The accessibility suite covers all seven pages.
