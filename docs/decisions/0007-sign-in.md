# 0007: Better Auth for sign-in only; teams and roles stay in Lore's tables

- Status: Accepted, with one part that needs the owner's agreement (see Open)
- Date: 2026-09-27
- Plan: 2, L1

## Context

Plan 2 L1 asks for Better Auth with the Drizzle adapter and the organization (teams), admin,
and SSO plugins, Google and Microsoft Entra sign-in, an email link as the fallback, an
allowed-domain check, and dev login.

By the time this was built, Admin (L9) already managed people's roles, teams, team
members, pinned hubs, and grants in Lore's own tables, with tests, and every permission
helper reads those tables.

## Decision

- Better Auth does sign-in: sessions, accounts with identity providers, and the values
  behind email links. It reads and writes Lore's `users` table, which gained
  `email_verified`, `image`, and `updated_at`. `sessions`, `accounts`, and `verifications`
  are new. The migration only adds.
- Google and Microsoft Entra are Better Auth's social providers, switched on by their
  environment variables. Entra is limited to one tenant by `AUTH_MICROSOFT_TENANT_ID`.
- The email link is Better Auth's magic-link plugin. The web app writes the email and the
  worker sends it, because the worker has the mail server.
- `AUTH_ALLOWED_DOMAINS` is checked when an account is created and again at every sign-in.
  A production deployment refuses to start without it.
- Dev login is a small Better Auth plugin, so there is one kind of session. It is only
  added when `AUTH_DEV_LOGIN=true`, which production refuses.
- The first person to sign in to a deployment with no admin becomes its owner.
- The organization and admin plugins are not used. Roles, teams, and grants stay in Lore's
  tables and are managed in Admin. `computeAccess`, `readableNamespaces`, and
  `requireNamespace` kept their signatures, and the permission tests pass unchanged.
- The SSO plugin (SAML and per-company OIDC) is not installed. Plan 2 says per-company
  configuration is Plan 4.

## Why not the organization plugin

It would hold a second copy of teams and roles, in its own tables, next to the ones Admin
and the permission helpers use. Two sources for who is on which team is how a person keeps
access they should have lost. TECH_STACK section 8 already keeps namespace permissions out
of Better Auth for a related reason: its access control is per resource type, not per
record.

## Consequences

- One deployment is one company, as before. Nothing in the data model stops the
  organization plugin from being added later if several organizations per deployment are
  wanted.
- Sessions are rows, so signing out, or deleting a person, ends their sessions at once.

## Open

- This departs from the letter of Plan 2 L1 and TECH_STACK section 8, which name the
  organization and admin plugins. If they are wanted, teams and roles move to Better Auth's
  tables and Admin is changed to write there.
- Google and Entra sign-in are configured and checked up to the redirect to the provider.
  The round trip has not been run, because it needs a test Google Workspace and a test
  Entra tenant with OAuth clients registered for the deployment's URL.
