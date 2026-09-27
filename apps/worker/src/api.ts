/**
 * The worker's internal HTTP API. The web app never touches Git, so anything it needs from
 * the mirror comes through here. Only the web container may reach it: it listens on the
 * internal network and every route except /health needs the shared token.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getVault, type Db } from "@lore/db";
import type { GitProvider, Mirror } from "@lore/git";
import { stripMembers } from "./indexer/derive.ts";

export interface ApiDeps {
  db: Db;
  mirrorFor: (repository: string) => Mirror;
  token: string;
  health: () => Record<string, unknown>;
  /** Queues a changeset for processing. The web app calls this right after it saves one. */
  onChangeset?: (id: string) => Promise<void>;
  /** Queues an upload or capture for processing (Process now). */
  onIngest?: (id: string) => Promise<void>;
  /** Calls the scripted model has received, when AI_MODE=fake. Null otherwise. */
  fakeCalls?: () => { count: number; last: string | null } | null;
  /** Makes one small call with a provider's stored key. */
  testKey?: (provider: string) => Promise<unknown>;
  providerFor?: (repository: string) => GitProvider;
  /** Recomputes health for notes whose feedback changed. */
  onFeedback?: (vaultId: string, noteIds: string[]) => Promise<void>;
  /** Sends an email the web app has written, such as a sign-in link. */
  sendMail?: (mail: {
    to: { name: string; email: string };
    subject: string;
    text: string;
    html: string;
  }) => Promise<boolean>;
  /** Runs one turn of the batch schedule now, whatever the clock says. */
  onBatchTick?: () => Promise<unknown>;
  /** Queues a Gardener run. */
  onGardener?: (run: {
    vaultId: string;
    namespace: string | null;
    requestedBy: string | null;
  }) => Promise<void>;
}

/** Notes are capped at 2,500 words; anything far beyond that is not a note worth diffing. */
const MAX_TEXT = 2_000_000;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function authorized(req: IncomingMessage, token: string): boolean {
  const header = req.headers.authorization ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function createApi(deps: ApiDeps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? "/", "http://worker");
      if (req.method === "POST") {
        if (!authorized(req, deps.token)) return send(res, 401, { error: "Unauthorized" });
        // POST /changesets/:id/process
        const cs = /^\/changesets\/(cs_[0-9A-HJKMNP-TV-Z]{26})\/process$/.exec(url.pathname);
        if (cs && deps.onChangeset) {
          await deps.onChangeset(cs[1]!);
          return send(res, 202, { queued: cs[1] });
        }
        // POST /ingest/:id/process
        const item = /^\/ingest\/(in_[0-9A-HJKMNP-TV-Z]{26})\/process$/.exec(url.pathname);
        if (item && deps.onIngest) {
          await deps.onIngest(item[1]!);
          return send(res, 202, { queued: item[1] });
        }
        // POST /ai/test?provider=<name>
        if (url.pathname === "/ai/test" && deps.testKey) {
          const name = url.searchParams.get("provider") ?? "";
          if (!/^[a-z][a-z0-9-]*$/.test(name)) return send(res, 400, { error: "No provider" });
          return send(res, 200, await deps.testKey(name));
        }
        // POST /vaults/:id/tags?name=<tag>&message=<text>: a snapshot of the branch head.
        const tag = /^\/vaults\/([^/]+)\/tags$/.exec(url.pathname);
        if (tag && deps.providerFor) {
          const vault = await getVault(deps.db, decodeURIComponent(tag[1]!));
          if (!vault) return send(res, 404, { error: "Unknown vault" });
          const provider = deps.providerFor(vault.repository);
          const ref = { id: vault.id, repository: vault.repository, branch: vault.branch };
          const head = await provider.head(ref);
          if (!head || !provider.tag) return send(res, 409, { error: "Nothing to tag" });
          try {
            await provider.tag(
              ref,
              url.searchParams.get("name") ?? "",
              head,
              (url.searchParams.get("message") ?? "Snapshot").slice(0, 500),
            );
          } catch (err) {
            return send(res, 400, { error: (err as Error).message });
          }
          return send(res, 201, { name: url.searchParams.get("name"), sha: head });
        }
        // POST /mail with { to, subject, text, html }
        if (url.pathname === "/mail" && deps.sendMail) {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of req) {
            size += (chunk as Buffer).length;
            if (size > 200_000) return send(res, 413, { error: "Too large" });
            chunks.push(chunk as Buffer);
          }
          let mail: {
            to?: { name?: string; email?: string };
            subject?: string;
            text?: string;
            html?: string;
          };
          try {
            mail = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof mail;
          } catch {
            return send(res, 400, { error: "Not JSON" });
          }
          if (
            !mail.to?.email ||
            !/^[^@\s]+@[^@\s]+$/.test(mail.to.email) ||
            !mail.subject ||
            !mail.text
          )
            return send(res, 400, { error: "An email needs an address, a subject, and a text" });
          const sent = await deps.sendMail({
            to: { name: mail.to.name ?? "", email: mail.to.email },
            subject: mail.subject.slice(0, 200),
            text: mail.text,
            html: mail.html ?? "",
          });
          return send(res, sent ? 202 : 503, sent ? { sent: true } : { error: "Email is off" });
        }
        // POST /batches/tick: for operators and tests, which cannot wait for the window.
        if (url.pathname === "/batches/tick" && deps.onBatchTick)
          return send(res, 200, await deps.onBatchTick());
        // POST /vaults/:id/gardener[?namespace=<slug>][&by=<user id>]
        const gardener = /^\/vaults\/([^/]+)\/gardener$/.exec(url.pathname);
        if (gardener && deps.onGardener) {
          const vault = await getVault(deps.db, decodeURIComponent(gardener[1]!));
          if (!vault) return send(res, 404, { error: "Unknown vault" });
          const namespace = url.searchParams.get("namespace");
          if (namespace && !/^[a-z0-9][a-z0-9-]*$/.test(namespace))
            return send(res, 400, { error: "No such namespace" });
          await deps.onGardener({
            vaultId: vault.id,
            namespace: namespace || null,
            requestedBy: url.searchParams.get("by") || null,
          });
          return send(res, 202, { queued: true });
        }
        // POST /vaults/:id/health?note=<id>&note=<id>
        const health = /^\/vaults\/([^/]+)\/health$/.exec(url.pathname);
        const notes = url.searchParams.getAll("note").slice(0, 100);
        if (health && notes.length && deps.onFeedback) {
          await deps.onFeedback(decodeURIComponent(health[1]!), notes);
          return send(res, 200, { refreshed: notes.length });
        }
        return send(res, 404, { error: "Not found" });
      }
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      if (url.pathname === "/health") return send(res, 200, { ok: true, ...deps.health() });
      if (!authorized(req, deps.token)) return send(res, 401, { error: "Unauthorized" });

      // GET /ai/fake: what the scripted model was asked, for tests that count calls.
      if (url.pathname === "/ai/fake") {
        const calls = deps.fakeCalls?.() ?? null;
        return calls ? send(res, 200, calls) : send(res, 404, { error: "AI_MODE is not fake" });
      }

      // GET /vaults/:id/changes/:sha?path=<repository path>
      const m = /^\/vaults\/([^/]+)\/changes\/([0-9a-f]{40,64})$/.exec(url.pathname);
      const path = url.searchParams.get("path");
      if (m && path) {
        const vault = await getVault(deps.db, decodeURIComponent(m[1]!));
        if (!vault) return send(res, 404, { error: "Unknown vault" });
        const change = await deps.mirrorFor(vault.repository).fileChange(m[2]!, path);
        if (!change) return send(res, 404, { error: "The commit did not change this file" });
        if ((change.before?.length ?? 0) > MAX_TEXT || (change.after?.length ?? 0) > MAX_TEXT)
          return send(res, 413, { error: "File too large to compare" });
        // A hub's generated member list names every member, including notes the reader may
        // not see. The Library builds member lists per reader, so the list never leaves here.
        return send(res, 200, {
          ...change,
          before: change.before === null ? null : stripMembers(change.before),
          after: change.after === null ? null : stripMembers(change.after),
        });
      }

      // GET /vaults/:id/tags
      const tags = /^\/vaults\/([^/]+)\/tags$/.exec(url.pathname);
      if (tags && deps.providerFor) {
        const vault = await getVault(deps.db, decodeURIComponent(tags[1]!));
        if (!vault) return send(res, 404, { error: "Unknown vault" });
        const provider = deps.providerFor(vault.repository);
        const ref = { id: vault.id, repository: vault.repository, branch: vault.branch };
        return send(res, 200, {
          head: await provider.head(ref),
          tags: (await provider.listTags?.(ref)) ?? [],
        });
      }

      // GET /vaults/:id/file?path=<repository path>[&ref=<commit>]
      const file = /^\/vaults\/([^/]+)\/file$/.exec(url.pathname);
      if (file && path) {
        const vault = await getVault(deps.db, decodeURIComponent(file[1]!));
        if (!vault) return send(res, 404, { error: "Unknown vault" });
        const mirror = deps.mirrorFor(vault.repository);
        const given = url.searchParams.get("ref");
        if (given && !/^[0-9a-f]{40,64}$/.test(given))
          return send(res, 404, { error: "Not found" });
        const ref = given ?? (await mirror.resolve(`refs/heads/${vault.branch}`));
        if (!ref) return send(res, 404, { error: "The vault has no commits" });
        const entry = (await mirror.listTree(ref)).find((e) => e.path === path);
        if (!entry) return send(res, 200, { path, ref, blobSha: null, text: null });
        if (entry.size > MAX_TEXT) return send(res, 413, { error: "File too large" });
        const bytes = (await mirror.readBlobs([entry.blobSha])).get(entry.blobSha);
        const text = bytes ? stripMembers(new TextDecoder().decode(bytes)) : null;
        return send(res, 200, { path, ref, blobSha: entry.blobSha, text });
      }

      // GET /vaults/:id/blobs/:sha
      const blob = /^\/vaults\/([^/]+)\/blobs\/([0-9a-f]{40,64})$/.exec(url.pathname);
      if (blob) {
        const vault = await getVault(deps.db, decodeURIComponent(blob[1]!));
        if (!vault) return send(res, 404, { error: "Unknown vault" });
        const bytes = (await deps.mirrorFor(vault.repository).readBlobs([blob[2]!])).get(blob[2]!);
        if (!bytes) return send(res, 404, { error: "No such blob" });
        if (bytes.length > MAX_TEXT) return send(res, 413, { error: "File too large" });
        return send(res, 200, { text: stripMembers(new TextDecoder().decode(bytes)) });
      }
      return send(res, 404, { error: "Not found" });
    } catch (err) {
      return send(res, 500, { error: (err as Error).message });
    }
  };
}
