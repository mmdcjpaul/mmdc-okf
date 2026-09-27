/**
 * The changeset job and the indexer on a vault that lives on GitHub. GitHub is played by a
 * small server over a bare repository: its API commits to the repository, and its git
 * address is the repository itself. What the real service does is checked by the nightly
 * `live` job; this checks that Lore's parts fit together around it.
 */
import { execFileSync } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { newRecordId, toStoredOps } from "@lore/changesets";
import { createChangeset, getChangeset, getNote, upsertVault } from "@lore/db";
import { LocalGitProvider } from "@lore/git";
import { gitBlobSha } from "@lore/okf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../src/api.ts";
import { processChangeset, type ChangesetDeps } from "../src/changesets/process.ts";
import { github, mirrorFor, providerFor, setupGit, syncMirror } from "../src/git.ts";
import { indexVault } from "../src/indexer/index-vault.ts";
import { createHarness, servicesAvailable, type Harness } from "./harness.ts";

await servicesAvailable();

const VAULT = "acme-on-github";
const REPO = "github:acme/kb";
const NOTE = "kb/admissions/check-an-applications-status.md";
const SECRET = "whsec-int";

describe("a vault on GitHub", () => {
  let h: Harness;
  let remote: string;
  let server: Server;
  let calls: string[];
  let deps: ChangesetDeps;
  const origin = new LocalGitProvider();
  const remoteRef = () => ({ id: VAULT, repository: `local:${remote}`, branch: "main" });
  const remoteHead = () =>
    execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8" }).trim();

  beforeAll(async () => {
    h = await createHarness("github");
    const dir = join(h.bare, "..");
    remote = join(dir, "remotes/acme/kb.git");
    await mkdir(join(dir, "remotes/acme"), { recursive: true });
    execFileSync("git", ["clone", "--quiet", "--bare", h.bare, remote]);

    calls = [];
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        void (async () => {
          calls.push(`${req.method} ${req.url}`);
          const send = (status: number, body: unknown) => {
            res.writeHead(status, { "content-type": "application/json" });
            res.end(JSON.stringify(body));
          };
          if (req.url === "/repos/acme/kb/git/ref/heads%2Fmain")
            return send(200, { object: { sha: remoteHead() } });
          if (req.url === "/graphql") {
            const { input } = (
              JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
                variables: { input: Record<string, any> };
              }
            ).variables;
            const result = await origin.commit(remoteRef(), {
              ops: [
                ...input.fileChanges.additions.map((a: { path: string; contents: string }) => ({
                  op: "put" as const,
                  path: a.path,
                  content: new Uint8Array(Buffer.from(a.contents, "base64")),
                })),
                ...input.fileChanges.deletions.map((d: { path: string }) => ({
                  op: "delete" as const,
                  path: d.path,
                })),
              ],
              message: `${input.message.headline}\n\n${input.message.body}`,
              expectedHead: input.expectedHeadOid,
            });
            return "sha" in result
              ? send(200, { data: { createCommitOnBranch: { commit: { oid: result.sha } } } })
              : send(200, {
                  data: { createCommitOnBranch: null },
                  errors: [
                    { type: "STALE_DATA", message: "Expected branch to point to another commit" },
                  ],
                });
          }
          send(404, { message: "Not Found" });
        })();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    setupGit({
      dataDir: join(dir, "data"),
      github: {
        auth: { token: "ghs_int" },
        apiUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        gitUrl: `file://${join(dir, "remotes")}`,
        webhookSecret: SECRET,
      },
      vaultFor: async (repository, branch) =>
        repository === REPO && branch === "main" ? VAULT : null,
    });
    await upsertVault(h.db, {
      id: VAULT,
      slug: VAULT,
      title: "Acme on GitHub",
      repository: REPO,
      branch: "main",
      bundleRoot: "kb",
    });
    await h.db.$client`
      insert into namespace_grants (vault_id, namespace, team_id, user_id, level)
      select ${VAULT}, namespace, team_id, user_id, level from namespace_grants
      where vault_id = ${h.vaultId}`;
    deps = {
      db: h.db,
      log: h.deps.log,
      mirrorFor,
      syncMirror,
      providerFor: (repository) => providerFor(repository),
      now: () => h.clock.now,
    };
  });
  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    setupGit({ dataDir: join(h.bare, "..", "data") });
    await h.close();
  });

  const index = () => indexVault({ ...h.deps, mirrorFor, syncMirror }, VAULT);
  const edit = async (by: string, line: string) => {
    const text = execFileSync("git", ["--git-dir", remote, "show", `main:${NOTE}`], {
      encoding: "utf8",
    });
    return createChangeset(h.db, {
      id: newRecordId("cs", h.clock.now),
      vaultId: VAULT,
      submitterId: by,
      actor: `human:${by}`,
      source: "editor",
      changeClass: "fix",
      state: "submitted",
      title: "",
      ops: toStoredOps([{ op: "put", path: NOTE, content: `${text}\n${line}\n` }]),
      intents: [],
      baseShas: { [NOTE]: gitBlobSha(text) },
      submittedAt: h.clock.now,
    });
  };

  it("is indexed from a mirror that is cloned on first use", async () => {
    const result = await index();
    expect(result.head).toBe(remoteHead());
    expect(result.notes).toBeGreaterThan(40);
    expect(await mirrorFor(REPO).resolve("refs/heads/main")).toBe(remoteHead());
  });

  it("a saved edit is committed through the API, on the head it was prepared on", async () => {
    const before = remoteHead();
    const cs = await edit("alice", "Committed through GitHub.");
    calls.length = 0;
    const outcome = await processChangeset(deps, cs.id);
    expect(outcome.state).toBe("committed");
    expect(calls).toEqual(["GET /repos/acme/kb/git/ref/heads%2Fmain", "POST /graphql"]);

    const head = remoteHead();
    expect(head).not.toBe(before);
    expect((await getChangeset(h.db, cs.id))!.commitSha).toBe(head);
    const message = execFileSync("git", ["--git-dir", remote, "log", "-1", "--format=%B"], {
      encoding: "utf8",
    });
    expect(message).toMatch(/^kb\(admissions\): update "Check an application's status"/);
    expect(message).toContain(`Changeset: ${cs.id}`);
    expect(message).toContain("Co-authored-by: Alice Reyes <alice@acme.test>");
  });

  it("the push webhook queues the index, and the change is then in the Library", async () => {
    const queued: string[] = [];
    const api = createApi({
      db: h.db,
      mirrorFor,
      token: "internal-token-for-tests",
      health: () => ({}),
      onWebhook: async (request) => {
        const push = await github()!.verifyWebhook(request);
        if (push) queued.push(`${push.vaultId}@${push.after}`);
        return !!push;
      },
    });
    const web = createServer((req, res) => void api(req, res));
    await new Promise<void>((r) => web.listen(0, "127.0.0.1", r));
    const url = `http://127.0.0.1:${(web.address() as AddressInfo).port}/webhooks/github`;
    const body = JSON.stringify({
      ref: "refs/heads/main",
      before: "a".repeat(40),
      after: remoteHead(),
      repository: { full_name: "acme/kb" },
    });
    const deliver = (signature: string, token = "internal-token-for-tests") =>
      fetch(url, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "x-github-event": "push",
          "x-hub-signature-256": signature,
        },
        body,
      });
    const good = "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
    try {
      expect((await deliver(good, "wrong-token-for-tests")).status).toBe(401);
      const forged = await deliver("sha256=" + "0".repeat(64));
      expect(await forged.json()).toEqual({ accepted: false });
      expect(queued).toEqual([]);
      const ok = await deliver(good);
      expect(ok.status).toBe(202);
      expect(await ok.json()).toEqual({ accepted: true });
      expect(queued).toEqual([`${VAULT}@${remoteHead()}`]);
    } finally {
      await new Promise<void>((r) => web.close(() => r()));
    }

    await index();
    const [row] = await h.db.$client`
      select id from notes where vault_id = ${VAULT} and path = ${NOTE}`;
    const note = await getNote(h.db, { vaultId: VAULT, namespaces: ["admissions"] }, row!.id);
    expect(note!.body).toContain("Committed through GitHub.");
    expect(note!.lastCommitSha).toBe(remoteHead());
  });

  it("when someone pushed another file meanwhile, the job prepares again and lands", async () => {
    const cs = await edit("alice", "A second line.");
    // A push from outside, after the draft was made and before the job runs.
    await origin.commit(remoteRef(), {
      ops: [{ op: "put", path: "kb/finance/outside.txt", content: "pushed from a laptop\n" }],
      message: "Outside push",
      expectedHead: remoteHead(),
    });
    const outcome = await processChangeset(deps, cs.id);
    expect(outcome.state).toBe("committed");
    const files = execFileSync(
      "git",
      ["--git-dir", remote, "ls-tree", "-r", "--name-only", "main"],
      {
        encoding: "utf8",
      },
    );
    expect(files).toContain("kb/finance/outside.txt");
  });

  it("when someone changed the same note meanwhile, the change is conflicted, not lost", async () => {
    const cs = await edit("alice", "Alice's line.");
    const text = execFileSync("git", ["--git-dir", remote, "show", `main:${NOTE}`], {
      encoding: "utf8",
    });
    await origin.commit(remoteRef(), {
      ops: [{ op: "put", path: NOTE, content: `${text}\nSomeone else's line.\n` }],
      message: "Outside edit",
      expectedHead: remoteHead(),
    });
    const before = remoteHead();
    const outcome = await processChangeset(deps, cs.id);
    expect(outcome.state).toBe("conflicted");
    expect((await getChangeset(h.db, cs.id))!.conflicts).toEqual([NOTE]);
    expect(remoteHead()).toBe(before);
  });
});
