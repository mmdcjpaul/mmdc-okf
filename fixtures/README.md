# Shared fixtures

Every plan tests against these files. **Changing a fixture is a reviewed change**: it can move
test results and evaluation numbers in all four plans. Rebuild from the scripts, review the
diff, and say in the pull request which numbers moved.

| Fixture | Contents | Rebuild |
|---|---|---|
| `vault-acme/` | A clean vault of 58 markdown files (48 notes and 8 hubs, plus generated indexes): namespaces `admissions`, `finance`, `it-support` (company) and `people-ops` (restricted); themes `enrollment`, `onboarding`, `access-management`, `month-end-close`; systems `salesforce`, `sis`, `netsuite`, `lms`; every note type; 3 Request Types; 2 Actions (`auto`, `approval`); a deprecated note with `superseded_by`; a draft; a stale note; an unverified AI note with `sources`; a wanted note; an orphan; a near-duplicate pair; a recent Process change with its `log.md` entry; Runbooks in `it-support` | `node scripts/fixtures/build-vault-acme.mjs`, then `kb index` in the folder with `KB_NOW=2026-09-24T00:00:00Z` |
| Leak canaries | `zebra-payroll-canary` in `people-ops/payroll-calendar.md`; `okapi-runbook-canary` in `it-support/runbooks/lms-outage-response.md` | part of `vault-acme` |
| `vault-acme/.kb/eval/questions.yaml` | 40 golden questions with expected note ids, intents, and request types | part of `build-vault-acme.mjs` |
| `vault-dirty/` | `_base/` plus one folder per lint rule id (`okf/frontmatter`, `lore/required`, ...), each with `input/`, `expected-issues.json`, and `expected/` (files after `--fix`, fixable rules only) | `node scripts/fixtures/build-vault-dirty.mjs`, then `node packages/okf/test/update-goldens.ts` |
| `principals.yaml` | Users `alice`, `bob`, `carol`, `dana`, `erin`, `svc-multica`, their teams, grants, and expected permissions | hand-edited |
| `uploads/` | Sample documents for ingestion tests | owned by Plan 2 (not created yet) |
| synthetic vault | 20,000 notes with realistic link density for scale tests | `node scripts/gen-synthetic-vault.ts bench-out/synthetic-vault 20000` (not committed) |

Tests treat `2026-09-24T00:00:00Z` as now, so stale-note results do not drift with the clock.
