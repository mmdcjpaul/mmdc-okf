# 0003: Committing to GitHub

- Status: Proposed. The numbers below are from GitHub's documentation and have not been
  measured against GitHub. See "What is still to be measured".
- Date: 2026-09-27
- Plan: 2, L2

## Context

Every write in the Library becomes one commit made by the Lore GitHub App. Two writers must
never overwrite each other, a commit often carries images, and the vault's main branch is
usually protected.

## Decision

- Commits go through GraphQL `createCommitOnBranch` with `expectedHeadOid`. GitHub refuses
  the commit when the branch is not at that commit, and Lore then prepares the changeset
  again on the new head. If none of its files changed in between it lands; if one did, the
  changeset is marked conflicted and nothing is written.
- Commits made this way are signed by GitHub and attributed to the app. The people behind a
  change are named in `Co-authored-by` trailers.
- A commit whose files add up to more than 20 MB goes through the Git Data API instead:
  one blob per file, a tree on top of the head's tree, a commit whose parent is the expected
  head, and a ref update with `force: false`. GitHub refuses that update unless it is a
  fast-forward, which gives the same guarantee. `restThresholdBytes` changes the limit.
- The worker reads vaults from a mirror clone under `DATA_DIR/mirrors`, fetched before each
  job and every five minutes, so reading costs no API calls. The installation token is
  given to git through the environment, and is in no file and no command line.
- The push webhook is received by the web app, which passes it to the worker unread. The
  worker checks the signature, because it holds the secret. A delivery with a bad signature
  gets the same answer as a push nobody is waiting for.
- Pull-request mode at the provider: `createBranch` and `openPullRequest`. Choosing it per
  vault, and auto-merge, are Plan 4.

## Why 20 MB

Lore allows images of up to 10 MB each. Contents are sent as base64, which adds a third, and
GitHub's documentation does not state a limit for one GraphQL request. 20 MB of files is
about 27 MB on the wire, which keeps ordinary changes (text and a few screenshots) on the
path that makes signed commits, and sends the rare large upload the other way.

## What is still to be measured

This needs a scratch repository and a test installation of the app, which were not
available when this was written.

1. The largest `createCommitOnBranch` payload GitHub accepts, with one large image and with
   many small ones. Lower `DEFAULT_REST_THRESHOLD` in `packages/git/src/github.ts` if it is
   under 27 MB.
2. That the app commits to a protected branch when it is on the bypass list, through both
   paths.
3. What GitHub answers when `expectedHeadOid` is stale. The provider looks for an error of
   type `STALE_DATA` or a message about the expected head; the contract suite's "two commits
   on the same head" test fails if GitHub words it differently.

Run the contract suite against GitHub with:

```bash
LIVE_GITHUB_REPO=owner/scratch LIVE_GITHUB_TOKEN=... pnpm --filter @lore/git test:live
```

The nightly `live` job does the same once the repository has the `LIVE_GITHUB_REPO`
variable and the `LIVE_GITHUB_TOKEN` secret.

## Tests

- `packages/git/test/contract.ts`: what every provider must do, run against
  `LocalGitProvider` on every change and against GitHub nightly.
- `packages/git/test/github.test.ts`: the requests the provider makes and how it reads the
  answers, against a local server. The plan names msw for this; a local server does the
  same job with nothing to install. Its replies are written from GitHub's documentation.
- `apps/worker/test/github.int.test.ts`: the changeset job and the indexer on a vault whose
  repository is `github:`, with GitHub played by a server over a bare repository.
