/**
 * The worker's internal HTTP API. The web app never touches Git, so anything it needs from
 * the mirror comes through here. Only the web container may reach it: it listens on the
 * internal network and every route except /health needs the shared token.
 */
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { getVault, type Db } from "@lore/db";
import type { Mirror } from "@lore/git";
import { stripMembers } from "./indexer/derive.ts";

export interface ApiDeps {
  db: Db;
  mirrorFor: (repository: string) => Mirror;
  token: string;
  health: () => Record<string, unknown>;
  /** Queues a changeset for processing. The web app calls this right after it saves one. */
  onChangeset?: (id: string) => Promise<void>;
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
        return send(res, 404, { error: "Not found" });
      }
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      if (url.pathname === "/health") return send(res, 200, { ok: true, ...deps.health() });
      if (!authorized(req, deps.token)) return send(res, 401, { error: "Unauthorized" });

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
