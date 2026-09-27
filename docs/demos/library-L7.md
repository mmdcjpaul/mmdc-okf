# Demo: Plan 2 L7, review, feedback, and trust

With the Library and worker running on the Acme fixture.

## Review

Sign in as Alice and open Review. Each item shows who submitted it, why it needs review, and
whether it needs a maintainer. Opening one shows the diff, how the note will read, similar
notes for new notes, and earlier reviews. Alice can approve, request changes or reject (both
need a comment), or edit the suggestion before approving it.

Approving publishes the change and records Alice as a verifier of the notes it changed.

| Signed in as | A change to a finance Request Type |
|---|---|
| Alice (writes in admissions) | Cannot see it: 404 |
| Bob (maintains finance) | Can approve it |
| Dana (admin), its author | Can approve her own, as the only exception to "nobody approves their own" |

## Feedback

1. As Carol, open a finance note. Choose Helpful, then Report an issue, Outdated, with a
   comment.
2. The note shows "Reported as outdated on ..., owner notified" to everyone.
3. As Bob, Notifications has the report with Carol's name. The note lists it under Open
   reports. Choose Fix it, edit, and save.
4. The commit carries `Resolves-Report: fb_...`. Once it is indexed the report closes and
   the banner goes.

Bob can also dismiss a report with a reason; Carol is told what he said.

## Health

Collections sort by health. The score starts at 100 and loses 25 for each open incorrect or
outdated report, 10 for each other open report, 20 when stale, 10 when unverified, and 5 for
each broken link. A good helpful rate adds up to 10 once a note has three ratings. The
weights are the `health_weights` setting.

```bash
pnpm --filter @lore/db test      # one test per factor
pnpm test:int                    # the 11th report in a day is refused; a rebuild keeps health
```
