# Demo: Plan 2 L2, a vault on GitHub

A vault's `repository` says where it lives: `local:<path>` or `github:<owner>/<repo>`.

## Credentials

The worker needs the Lore GitHub App's credentials, or a token while trying things out:

```bash
GITHUB_APP_ID=...  GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n..."  GITHUB_INSTALLATION_ID=...
# or
GITHUB_TOKEN=...
GITHUB_WEBHOOK_SECRET=...
```

The app needs read and write access to contents, read access to metadata, and the push
webhook pointed at `<PUBLIC_URL>/api/webhooks/github`.

## What happens

1. The worker clones a mirror into `DATA_DIR/mirrors/<owner>__<repo>.git` the first time
   the vault is indexed, and fetches it before every job and every five minutes.
2. Saving a note in the Library makes one commit through the API, on the head the change
   was prepared on. If someone pushed in between, the change is prepared again; if they
   changed the same note, it is marked "Needs merging" and nothing is written.
3. A push from anywhere reaches the webhook, the worker checks its signature and queues an
   index job, and the change is in the Library within seconds.

## Without GitHub

Nothing above is needed for a local vault, and the standalone suite runs without it. The
provider is checked three ways: its requests and answers against a local server, the whole
job against a stand-in for GitHub over a bare repository, and, nightly, the contract suite
against a scratch repository on GitHub once `LIVE_GITHUB_REPO` and `LIVE_GITHUB_TOKEN` are
set.
