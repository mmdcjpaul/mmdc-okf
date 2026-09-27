# Demo: Plan 2 L1, sign-in

## By email link, locally

```bash
pnpm services:up                        # includes Mailpit
SMTP_URL=smtp://127.0.0.1:1025 pnpm lore seed --vault fixtures/vault-acme --principals fixtures/principals.yaml
SMTP_URL=smtp://127.0.0.1:1025 pnpm dev:library
```

1. Open http://localhost:3000/login. Enter `carol@acme.test` and ask for a link.
2. Open Mailpit at http://localhost:8025, and the link in the email. Carol is signed in.
3. Open the same link again: it has been used.

The list of people below the form is dev login, which exists because `AUTH_DEV_LOGIN=true`.

## Allowed domains

```bash
AUTH_ALLOWED_DOMAINS=acme.test pnpm dev:web
```

Ask for a link for `someone@elsewhere.test`. The form answers as it does for anyone, no
email is sent, and no account is made. A production deployment does not start without
`AUTH_ALLOWED_DOMAINS`.

## Google and Microsoft Entra

Register an OAuth client with each provider, with these redirect addresses:

- `<PUBLIC_URL>/api/auth/callback/google`
- `<PUBLIC_URL>/api/auth/callback/microsoft`

and set:

```bash
PUBLIC_URL=https://kb.example.com
AUTH_ALLOWED_DOMAINS=example.com
AUTH_GOOGLE_CLIENT_ID=...        AUTH_GOOGLE_CLIENT_SECRET=...
AUTH_MICROSOFT_CLIENT_ID=...     AUTH_MICROSOFT_CLIENT_SECRET=...     AUTH_MICROSOFT_TENANT_ID=...
```

The sign-in page then offers "Continue with Google" and "Continue with Microsoft". The
first person to sign in to a deployment with no admin becomes its owner; everyone after is
a member until an admin changes their role in Admin.

This part has been checked up to the redirect to the provider. The round trip needs real
OAuth clients, which need a test Google Workspace and a test Entra tenant.

## What is recorded

Every sign-in is in the audit log with how it was done (Admin, Audit log, action
`auth.sign_in`).
