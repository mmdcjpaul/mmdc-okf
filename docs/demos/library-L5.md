# Demo: Plan 2 L5, browse, note pages, and hubs

With the Library running on the Acme fixture, signed in as Alice:

| Do | See |
|---|---|
| Open Home | The search box, hubs pinned by Admissions Ops, process changes, recent updates |
| Sidebar: Themes, Systems, Types, Tags | One page per dimension |
| Types, then Runbook, then Cards | The collection as cards; sort by Health |
| Open "Enroll a returning student in Salesforce" | Header, trust badge, outline, graph, backlinks, related notes, sources, history |
| Click a History entry | The line diff of that commit |
| Open "Submit a paper enrollment form" | Deprecated and Due for review banners |
| Open "Manage the course waitlist" | Draft banner |
| Open "Reset a staff password" | A wanted-note link, shown dashed |
| Open `/n/<id>/any-old-slug` | Redirect to the current URL |
| Themes, then Enrollment | Introduction, members by type, graph |

Then sign in as Carol and open Themes, then Onboarding: no People Ops notes are listed, and
`/ns/people-ops` returns 404.

```bash
pnpm --filter web e2e      # 47 tests, including axe in light and dark and a 375 px check
```
