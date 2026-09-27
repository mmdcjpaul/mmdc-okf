# 0001: Link style for vault notes

- Status: **Proposed** (the manual Obsidian check below has not been run yet)
- Date: 2026-09-24
- Plan: 1, milestone M3 (TECH_STACK section 20, "Obsidian links" spike)

## Context

OKF recommends bundle-absolute links such as `/admissions/enroll-a-new-student.md` because
they survive moving the linking note within its folder, and they read the same in every note.
The PRD asks people to open `kb/` (not the repository root) as their Obsidian vault so that a
leading `/` resolves from the bundle root. Whether Obsidian resolves leading-slash markdown
links reliably, on both macOS and Windows, in reading view, live preview, the graph view,
and when it renames files, has to be checked by hand.

## Decision

Default `link_style: absolute`, as the PRD and OKF recommend. The choice is configuration,
not code:

- `.kb/profile.yaml` has `link_style: absolute | relative`.
- Everything the toolkit writes (new notes, `kb mv`, wikilink conversion, index files, hub
  member lists) uses the profile's style.
- The `lore/link-style` lint rule warns about links in the other style and `kb lint --fix`
  converts them. Switching a whole vault is: edit the profile, run `kb lint --fix`, run
  `kb index`, commit. A test converts all of `fixtures/vault-acme` this way with no broken links.

## The manual check (to do)

Run on macOS and Windows with the current Obsidian release. Open `fixtures/vault-acme/kb`
as the vault.

| Check | macOS | Windows |
|---|---|---|
| Click `/admissions/enroll-a-new-student.md` from `admissions/enroll-a-returning-student-in-salesforce.md` in reading view | | |
| Same in live preview | | |
| Link from a nested note (`admissions/actions/resend-enrollment-confirmation.md`) to a hub | | |
| Links with anchors (`...md#details`) | | |
| Graph view shows edges for leading-slash links | | |
| Backlinks pane lists the returning-student note on `enroll-a-new-student` | | |
| Renaming a note in Obsidian rewrites leading-slash links (or leaves them for `kb lint`) | | |
| Hub member lists (`_themes/enrollment.md`) are clickable | | |

If any of the first five fail on either platform, set `link_style: relative` in the template
profile and in `fixtures/vault-acme`, run `kb lint --fix` and `kb index`, update this record
to Accepted with the results, and re-run the fixture goldens.

## Consequences

- Absolute links keep diffs small when notes move within a namespace and make links easy to
  read in GitHub, which renders `/`-links relative to the repository root (so they break in
  GitHub's web view unless the bundle root is the repository root). Relative links work in
  GitHub's web view. This GitHub trade-off is a second reason the check may favour relative.
