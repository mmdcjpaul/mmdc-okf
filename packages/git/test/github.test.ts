import { createHmac } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  GitHubProvider,
  parseRepository,
  splitMessage,
  verifySignature,
  type GitHubOptions,
} from "../src/github.ts";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: any;
}
type Reply = { status?: number; body: unknown } | undefined;

/**
 * GitHub's API on localhost. The replies are written from GitHub's published response
 * shapes; the nightly `live` job is what checks the provider against GitHub itself.
 */
let server: Server | null = null;
async function github(routes: (req: Seen) => Reply) {
  const seen: Seen[] = [];
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      const got: Seen = {
        method: req.method ?? "GET",
        path: req.url ?? "/",
        headers: req.headers,
        body: raw ? JSON.parse(raw) : null,
      };
      seen.push(got);
      const reply = routes(got) ?? { status: 404, body: { message: "Not Found" } };
      res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
      res.end(JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((r) => server!.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const provider = (over: Partial<GitHubOptions> = {}) =>
    new GitHubProvider({ auth: { token: "ghs_test" }, baseUrl: url, ...over });
  return { seen, provider };
}
afterEach(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  server = null;
});

const vault = { id: "acme", repository: "github:acme/kb", branch: "main" };
const HEAD = "a".repeat(40);
const NEXT = "b".repeat(40);
const ref = (sha: string) => ({
  body: { ref: "refs/heads/main", object: { type: "commit", sha } },
});

describe("repository names and messages", () => {
  it("reads owner and repository, and refuses anything else", () => {
    expect(parseRepository("github:acme/kb.vault")).toEqual({ owner: "acme", repo: "kb.vault" });
    expect(() => parseRepository("local:/tmp/x.git")).toThrow(/Not a GitHub repository/);
    expect(() => parseRepository("github:acme/kb/../../x")).toThrow();
  });

  it("splits a message into the headline and the rest", () => {
    expect(splitMessage("kb(finance): update\n\nWhy.\n\nChange-Class: fix\n")).toEqual({
      headline: "kb(finance): update",
      body: "Why.\n\nChange-Class: fix\n",
    });
    expect(splitMessage("one line")).toEqual({ headline: "one line", body: "" });
  });
});

describe("GitHubProvider", () => {
  it("reads the head, and knows a missing branch and an empty repository", async () => {
    let reply: Reply = ref(HEAD);
    const gh = await github(() => reply);
    expect(await gh.provider().head(vault)).toBe(HEAD);
    expect(gh.seen[0]).toMatchObject({
      method: "GET",
      path: "/repos/acme/kb/git/ref/heads%2Fmain",
    });
    expect(gh.seen[0]!.headers.authorization).toBe("token ghs_test");
    reply = { status: 404, body: { message: "Not Found" } };
    expect(await gh.provider().head(vault)).toBeNull();
    reply = { status: 409, body: { message: "Git Repository is empty." } };
    expect(await gh.provider().head(vault)).toBeNull();
    reply = { status: 500, body: { message: "Server Error" } };
    await expect(gh.provider().head(vault)).rejects.toThrow();
  });

  it("commits with createCommitOnBranch: the expected head, base64 contents, and deletions", async () => {
    const gh = await github((r) =>
      r.path === "/graphql"
        ? { body: { data: { createCommitOnBranch: { commit: { oid: NEXT } } } } }
        : undefined,
    );
    const res = await gh.provider().commit(vault, {
      ops: [
        { op: "put", path: "kb/finance/a.md", content: "# A\n" },
        { op: "put", path: "kb/finance/_assets/x.png", content: new Uint8Array([137, 80, 0, 255]) },
        { op: "delete", path: "kb/finance/old.md" },
      ],
      message: 'kb(finance): update "A"\n\nChange-Class: fix\nChangeset: cs_1\n',
      expectedHead: HEAD,
    });
    expect(res).toEqual({ sha: NEXT });
    expect(gh.seen).toHaveLength(1);
    expect(gh.seen[0]!.body.query).toContain("createCommitOnBranch(input: $input)");
    expect(gh.seen[0]!.body.variables).toEqual({
      input: {
        branch: { repositoryNameWithOwner: "acme/kb", branchName: "main" },
        expectedHeadOid: HEAD,
        message: {
          headline: 'kb(finance): update "A"',
          body: "Change-Class: fix\nChangeset: cs_1\n",
        },
        fileChanges: {
          additions: [
            { path: "kb/finance/a.md", contents: Buffer.from("# A\n").toString("base64") },
            { path: "kb/finance/_assets/x.png", contents: "iVAA/w==" },
          ],
          deletions: [{ path: "kb/finance/old.md" }],
        },
      },
    });
  });

  it("answers that the head moved when GitHub says the branch is elsewhere", async () => {
    const gh = await github((r) =>
      r.path === "/graphql"
        ? {
            body: {
              data: { createCommitOnBranch: null },
              errors: [
                {
                  type: "STALE_DATA",
                  path: ["createCommitOnBranch"],
                  message: `Expected branch to point to "${HEAD}" but it points to "${NEXT}"`,
                },
              ],
            },
          }
        : ref(NEXT),
    );
    const res = await gh.provider().commit(vault, {
      ops: [{ op: "put", path: "a.md", content: "a" }],
      message: "m",
      expectedHead: HEAD,
    });
    expect(res).toEqual({ headMoved: NEXT });
  });

  it("passes on errors that are not about the head", async () => {
    const gh = await github((r) =>
      r.path === "/graphql"
        ? {
            body: {
              data: null,
              errors: [{ type: "FORBIDDEN", message: "Resource not accessible by integration" }],
            },
          }
        : undefined,
    );
    await expect(
      gh.provider().commit(vault, {
        ops: [{ op: "put", path: "a.md", content: "a" }],
        message: "m",
        expectedHead: HEAD,
      }),
    ).rejects.toThrow(/not accessible/);
  });

  it("refuses to commit to a repository with no commits", async () => {
    const gh = await github(() => undefined);
    await expect(
      gh.provider().commit(vault, { ops: [], message: "m", expectedHead: null }),
    ).rejects.toThrow(/needs a first commit/);
    expect(gh.seen).toEqual([]);
  });

  describe("commits over the size for one request", () => {
    const big = { restThresholdBytes: 10 };
    const input = {
      ops: [
        { op: "put" as const, path: "kb/a.md", content: "more than ten bytes" },
        { op: "delete" as const, path: "kb/old.md" },
      ],
      message: "kb(finance): add a scan\n\nChange-Class: addition\n",
      expectedHead: HEAD,
      author: { name: "Alice Reyes", email: "alice@acme.test" },
    };

    it("go through blobs, a tree, a commit, and a ref update that is not forced", async () => {
      const gh = await github((r) => {
        if (r.path.startsWith("/repos/acme/kb/git/ref/")) return ref(HEAD);
        if (r.path === `/repos/acme/kb/git/commits/${HEAD}`)
          return { body: { sha: HEAD, tree: { sha: "t".repeat(40) } } };
        if (r.path === "/repos/acme/kb/git/blobs")
          return { status: 201, body: { sha: "c".repeat(40) } };
        if (r.path === "/repos/acme/kb/git/trees")
          return { status: 201, body: { sha: "d".repeat(40) } };
        if (r.path === "/repos/acme/kb/git/commits") return { status: 201, body: { sha: NEXT } };
        if (r.method === "PATCH") return ref(NEXT);
        return undefined;
      });
      expect(await gh.provider(big).commit(vault, input)).toEqual({ sha: NEXT });
      expect(gh.seen.map((s) => `${s.method} ${s.path}`)).toEqual([
        "GET /repos/acme/kb/git/ref/heads%2Fmain",
        `GET /repos/acme/kb/git/commits/${HEAD}`,
        "POST /repos/acme/kb/git/blobs",
        "POST /repos/acme/kb/git/trees",
        "POST /repos/acme/kb/git/commits",
        "PATCH /repos/acme/kb/git/refs/heads%2Fmain",
      ]);
      const [, , blob, tree, commit, update] = gh.seen;
      expect(blob!.body).toEqual({
        content: Buffer.from("more than ten bytes").toString("base64"),
        encoding: "base64",
      });
      expect(tree!.body).toEqual({
        base_tree: "t".repeat(40),
        tree: [
          { path: "kb/a.md", mode: "100644", type: "blob", sha: "c".repeat(40) },
          // A null sha removes the file.
          { path: "kb/old.md", mode: "100644", type: "blob", sha: null },
        ],
      });
      expect(commit!.body).toEqual({
        message: input.message,
        tree: "d".repeat(40),
        parents: [HEAD],
        author: input.author,
      });
      expect(update!.body).toEqual({ sha: NEXT, force: false });
    });

    it("write nothing when the head has already moved", async () => {
      const gh = await github(() => ref(NEXT));
      expect(await gh.provider(big).commit(vault, input)).toEqual({ headMoved: NEXT });
      expect(gh.seen.every((s) => s.method === "GET")).toBe(true);
    });

    it("answer that the head moved when the ref update is not a fast-forward", async () => {
      let head = HEAD;
      const gh = await github((r) => {
        if (r.method === "PATCH") {
          head = "e".repeat(40);
          return { status: 422, body: { message: "Update is not a fast forward" } };
        }
        if (r.path.startsWith("/repos/acme/kb/git/ref/")) return ref(head);
        if (r.method === "GET") return { body: { sha: HEAD, tree: { sha: "t".repeat(40) } } };
        return { status: 201, body: { sha: NEXT } };
      });
      expect(await gh.provider(big).commit(vault, input)).toEqual({ headMoved: "e".repeat(40) });
    });
  });

  it("reads a file, and fetches the blob when the file is too large to come inline", async () => {
    const gh = await github((r) => {
      if (r.path.startsWith("/repos/acme/kb/contents/kb%2Fa.md"))
        return {
          body: {
            type: "file",
            sha: "1".repeat(40),
            encoding: "base64",
            content: Buffer.from("# A\n").toString("base64"),
          },
        };
      if (r.path.startsWith("/repos/acme/kb/contents/kb%2Fbig.pdf"))
        return { body: { type: "file", sha: "2".repeat(40), encoding: "none", content: "" } };
      if (r.path === `/repos/acme/kb/git/blobs/${"2".repeat(40)}`)
        return { body: { encoding: "base64", content: Buffer.from("PDF").toString("base64") } };
      if (r.path.startsWith("/repos/acme/kb/contents/kb?"))
        return { body: [{ type: "file", name: "a.md" }] };
      return undefined;
    });
    const p = gh.provider();
    const a = await p.readFile(vault, "kb/a.md", HEAD);
    expect(new TextDecoder().decode(a!.content)).toBe("# A\n");
    expect(a!.blobSha).toBe("1".repeat(40));
    expect(gh.seen[0]!.path).toBe(`/repos/acme/kb/contents/kb%2Fa.md?ref=${HEAD}`);
    expect(new TextDecoder().decode((await p.readFile(vault, "kb/big.pdf"))!.content)).toBe("PDF");
    expect(await p.readFile(vault, "kb/none.md")).toBeNull();
    // A folder is not a file.
    expect(await p.readFile(vault, "kb")).toBeNull();
  });

  it("reports what changed between two commits", async () => {
    const gh = await github(() => ({
      body: {
        files: [
          { filename: "kb/b.md", status: "added", sha: "1".repeat(40) },
          { filename: "kb/a.md", status: "modified", sha: "2".repeat(40) },
          { filename: "kb/old.md", status: "removed", sha: "3".repeat(40) },
          {
            filename: "kb/new-name.md",
            status: "renamed",
            previous_filename: "kb/name.md",
            sha: "4".repeat(40),
          },
        ],
      },
    }));
    expect(await gh.provider().diff(vault, HEAD, NEXT)).toEqual([
      { path: "kb/a.md", status: "M", newSha: "2".repeat(40) },
      { path: "kb/b.md", status: "A", newSha: "1".repeat(40) },
      { path: "kb/new-name.md", status: "R", from: "kb/name.md", newSha: "4".repeat(40) },
      { path: "kb/old.md", status: "D", newSha: "3".repeat(40) },
    ]);
    expect(gh.seen[0]!.path).toContain(`/repos/acme/kb/compare/${HEAD}...${NEXT}`);
  });

  it("opens a pull request from a branch made for the change", async () => {
    const gh = await github((r) =>
      r.path === "/repos/acme/kb/git/refs"
        ? { status: 201, body: { ref: "refs/heads/lore/cs_1", object: { sha: HEAD } } }
        : r.path === "/repos/acme/kb/pulls"
          ? { status: 201, body: { html_url: "https://github.com/acme/kb/pull/7", number: 7 } }
          : undefined,
    );
    const p = gh.provider();
    await p.createBranch(vault, "lore/cs_1", HEAD);
    expect(gh.seen[0]!.body).toEqual({ ref: "refs/heads/lore/cs_1", sha: HEAD });
    const pr = await p.openPullRequest(vault, {
      branch: "lore/cs_1",
      title: 'kb(finance): update "A"',
      body: "Why.",
    });
    expect(pr).toEqual({ url: "https://github.com/acme/kb/pull/7" });
    expect(gh.seen[1]!.body).toEqual({
      head: "lore/cs_1",
      base: "main",
      title: 'kb(finance): update "A"',
      body: "Why.",
    });
  });

  it("tags a commit, and says so when the tag exists", async () => {
    let taken = false;
    const gh = await github((r) => {
      if (r.path === "/repos/acme/kb/git/tags")
        return { status: 201, body: { sha: "9".repeat(40) } };
      if (r.path === "/repos/acme/kb/git/refs")
        return taken
          ? { status: 422, body: { message: "Reference already exists" } }
          : { status: 201, body: { ref: "refs/tags/vault-2026-09" } };
      return undefined;
    });
    const p = gh.provider();
    await p.tag(vault, "vault-2026-09", HEAD, "September audit");
    expect(gh.seen[0]!.body).toEqual({
      tag: "vault-2026-09",
      message: "September audit",
      object: HEAD,
      type: "commit",
    });
    expect(gh.seen[1]!.body).toEqual({ ref: "refs/tags/vault-2026-09", sha: "9".repeat(40) });
    taken = true;
    await expect(p.tag(vault, "vault-2026-09", HEAD, "again")).rejects.toThrow(
      "The tag vault-2026-09 already exists",
    );
    await expect(p.tag(vault, "../x", HEAD, "bad")).rejects.toThrow(/not a valid tag name/);
  });
});

describe("the push webhook", () => {
  const secret = "whsec-test";
  const sign = (body: string, key = secret) =>
    "sha256=" + createHmac("sha256", key).update(body).digest("hex");
  const push = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      ref: "refs/heads/main",
      before: HEAD,
      after: NEXT,
      deleted: false,
      repository: { full_name: "acme/kb" },
      ...over,
    });
  const delivery = (body: string, headers: Record<string, string> = {}) =>
    new Request("https://kb.acme.test/api/webhooks/github", {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": sign(body), ...headers },
      body,
    });
  const provider = (over: Partial<GitHubOptions> = {}) =>
    new GitHubProvider({
      auth: { token: "t" },
      webhookSecret: secret,
      vaultFor: (repository, branch) =>
        repository === "github:acme/kb" && branch === "main" ? "acme" : null,
      ...over,
    });

  it("accepts a signed push to a vault's branch", async () => {
    expect(await provider().verifyWebhook(delivery(push()))).toEqual({
      vaultId: "acme",
      before: HEAD,
      after: NEXT,
    });
    // The first push to a new branch has no commit before it.
    expect(await provider().verifyWebhook(delivery(push({ before: "0".repeat(40) })))).toEqual({
      vaultId: "acme",
      before: null,
      after: NEXT,
    });
  });

  it("refuses a delivery that is not signed with the secret", async () => {
    const body = push();
    const p = provider();
    expect(
      await p.verifyWebhook(delivery(body, { "x-hub-signature-256": sign(body, "other") })),
    ).toBeNull();
    expect(await p.verifyWebhook(delivery(body, { "x-hub-signature-256": "" }))).toBeNull();
    expect(
      await p.verifyWebhook(delivery(body, { "x-hub-signature-256": sign(body).slice(0, 20) })),
    ).toBeNull();
    // Signed, then changed on the way.
    const changed = new Request("https://kb.acme.test/x", {
      method: "POST",
      headers: { "x-github-event": "push", "x-hub-signature-256": sign(body) },
      body: body.replace(NEXT, "c".repeat(40)),
    });
    expect(await p.verifyWebhook(changed)).toBeNull();
    // With no secret configured, nothing is accepted.
    expect(await provider({ webhookSecret: undefined }).verifyWebhook(delivery(body))).toBeNull();
  });

  it("ignores what is not a push to a vault", async () => {
    const p = provider();
    expect(await p.verifyWebhook(delivery(push(), { "x-github-event": "ping" }))).toBeNull();
    expect(await p.verifyWebhook(delivery(push({ ref: "refs/tags/v1" })))).toBeNull();
    expect(await p.verifyWebhook(delivery(push({ ref: "refs/heads/other" })))).toBeNull();
    expect(
      await p.verifyWebhook(delivery(push({ repository: { full_name: "acme/else" } }))),
    ).toBeNull();
    expect(
      await p.verifyWebhook(delivery(push({ deleted: true, after: "0".repeat(40) }))),
    ).toBeNull();
    expect(await p.verifyWebhook(delivery("not json"))).toBeNull();
  });

  it("checks signatures in constant time and by length", () => {
    expect(verifySignature(secret, "a", sign("a"))).toBe(true);
    expect(verifySignature(secret, "a", sign("b"))).toBe(false);
    expect(verifySignature(secret, "a", "sha1=abc")).toBe(false);
  });
});
