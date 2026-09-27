/**
 * `GitProvider` over GitHub (plans/02-library.md, L2). Commits go through GraphQL
 * `createCommitOnBranch`, which refuses when the branch is not where the caller thinks it
 * is, so two writers cannot overwrite each other. Commits too large for one request go
 * through the Git Data API, with the same guarantee from a non-forced ref update.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/core";
import type {
  CommitInput,
  CommitResult,
  DiffEntry,
  GitProvider,
  PushEvent,
  VaultRef,
} from "./types.ts";

export type GitHubAuth =
  /** A GitHub App installation: what a deployment uses. */
  | { appId: string | number; privateKey: string; installationId: string | number }
  /** A token, for the live tests and for trying things out. */
  | { token: string };

export interface GitHubOptions {
  auth: GitHubAuth;
  /** For GitHub Enterprise Server, and for tests that answer from a local server. */
  baseUrl?: string;
  /** Secret of the push webhook. Without it `verifyWebhook` refuses everything. */
  webhookSecret?: string;
  /** Finds the vault a push belongs to. */
  vaultFor?: (repository: string, branch: string) => Promise<string | null> | string | null;
  /**
   * Commits whose files add up to more than this many bytes go through the Git Data API.
   * See docs/decisions/0003-commit-api.md.
   */
  restThresholdBytes?: number;
}

/** See docs/decisions/0003-commit-api.md for where this number comes from. */
export const DEFAULT_REST_THRESHOLD = 20 * 1024 * 1024;

const STATUS: Record<string, DiffEntry["status"]> = {
  added: "A",
  copied: "A",
  modified: "M",
  changed: "M",
  removed: "D",
  renamed: "R",
};

export function parseRepository(repository: string): { owner: string; repo: string } {
  const m = /^github:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);
  if (!m) throw new Error(`Not a GitHub repository: ${repository}`);
  return { owner: m[1]!, repo: m[2]! };
}

const statusOf = (err: unknown) => (err as { status?: number }).status;
const bytesOf = (content: string | Uint8Array) =>
  typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);

/** A commit message as GitHub wants it: the first line, and the rest. */
export function splitMessage(message: string): { headline: string; body: string } {
  const at = message.indexOf("\n");
  return at < 0
    ? { headline: message.trim(), body: "" }
    : { headline: message.slice(0, at).trim(), body: message.slice(at + 1).replace(/^\n+/, "") };
}

const CREATE_COMMIT = `
  mutation ($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid }
    }
  }`;

export class GitHubProvider implements GitProvider {
  private readonly octokit: Octokit;
  private readonly opts: GitHubOptions;

  constructor(opts: GitHubOptions) {
    this.opts = opts;
    const base = opts.baseUrl ? { baseUrl: opts.baseUrl.replace(/\/$/, "") } : {};
    this.octokit =
      "token" in opts.auth
        ? new Octokit({ auth: opts.auth.token, ...base })
        : new Octokit({ authStrategy: createAppAuth, auth: opts.auth, ...base });
  }

  /** A token for fetching the mirror over HTTPS. Installation tokens last an hour. */
  async token(): Promise<string> {
    if ("token" in this.opts.auth) return this.opts.auth.token;
    const auth = (await this.octokit.auth({ type: "installation" })) as { token: string };
    return auth.token;
  }

  async head(vault: VaultRef): Promise<string | null> {
    const at = parseRepository(vault.repository);
    try {
      const res = await this.octokit.request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
        ...at,
        ref: `heads/${vault.branch}`,
      });
      return res.data.object.sha;
    } catch (err) {
      // 404: no such branch. 409: the repository is empty.
      if (statusOf(err) === 404 || statusOf(err) === 409) return null;
      throw err;
    }
  }

  async readFile(vault: VaultRef, path: string, ref?: string) {
    const at = parseRepository(vault.repository);
    try {
      const res = await this.octokit.request("GET /repos/{owner}/{repo}/contents/{path}", {
        ...at,
        path,
        ref: ref ?? vault.branch,
      });
      const file = res.data;
      if (Array.isArray(file) || file.type !== "file") return null;
      // Files over a megabyte come without their content; the blob has it.
      if (file.content && file.encoding === "base64")
        return { content: new Uint8Array(Buffer.from(file.content, "base64")), blobSha: file.sha };
      const blob = await this.octokit.request("GET /repos/{owner}/{repo}/git/blobs/{file_sha}", {
        ...at,
        file_sha: file.sha,
      });
      return {
        content: new Uint8Array(Buffer.from(blob.data.content, "base64")),
        blobSha: file.sha,
      };
    } catch (err) {
      if (statusOf(err) === 404) return null;
      throw err;
    }
  }

  async diff(vault: VaultRef, from: string, to: string): Promise<DiffEntry[]> {
    const at = parseRepository(vault.repository);
    const out: DiffEntry[] = [];
    for (let page = 1; page <= 30; page++) {
      const res = await this.octokit.request("GET /repos/{owner}/{repo}/compare/{basehead}", {
        ...at,
        basehead: `${from}...${to}`,
        per_page: 100,
        page,
      });
      const files = res.data.files ?? [];
      for (const f of files)
        out.push({
          path: f.filename,
          status: STATUS[f.status] ?? "M",
          ...(f.previous_filename ? { from: f.previous_filename } : {}),
          ...(f.sha ? { newSha: f.sha } : {}),
        });
      if (files.length < 100) break;
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : 1));
  }

  async commit(vault: VaultRef, input: CommitInput): Promise<CommitResult> {
    if (!input.expectedHead)
      throw new Error("The repository needs a first commit before Lore can commit to it");
    const size = input.ops.reduce(
      (sum, op) => sum + (op.op === "put" ? bytesOf(op.content).length : 0),
      0,
    );
    const result =
      size > (this.opts.restThresholdBytes ?? DEFAULT_REST_THRESHOLD)
        ? await this.commitWithGitData(vault, input)
        : await this.commitWithGraphql(vault, input);
    return result;
  }

  private async moved(vault: VaultRef): Promise<CommitResult> {
    return { headMoved: (await this.head(vault)) ?? "0".repeat(40) };
  }

  private async commitWithGraphql(vault: VaultRef, input: CommitInput): Promise<CommitResult> {
    const { owner, repo } = parseRepository(vault.repository);
    try {
      const res = await this.octokit.graphql<{
        createCommitOnBranch: { commit: { oid: string } };
      }>(CREATE_COMMIT, {
        input: {
          branch: { repositoryNameWithOwner: `${owner}/${repo}`, branchName: vault.branch },
          expectedHeadOid: input.expectedHead,
          message: splitMessage(input.message),
          fileChanges: {
            additions: input.ops
              .filter((op) => op.op === "put")
              .map((op) => ({
                path: op.path,
                contents: bytesOf((op as { content: string | Uint8Array }).content).toString(
                  "base64",
                ),
              })),
            deletions: input.ops
              .filter((op) => op.op === "delete")
              .map((op) => ({ path: op.path })),
          },
        },
      });
      return { sha: res.createCommitOnBranch.commit.oid };
    } catch (err) {
      const errors = (err as { errors?: { type?: string; message?: string }[] }).errors ?? [];
      const stale = errors.some(
        (e) =>
          e.type === "STALE_DATA" ||
          /expected branch to point to|expectedHeadOid/i.test(e.message ?? ""),
      );
      if (stale) return this.moved(vault);
      throw err;
    }
  }

  /** Blobs, a tree, a commit, and a ref update that refuses anything but a fast-forward. */
  private async commitWithGitData(vault: VaultRef, input: CommitInput): Promise<CommitResult> {
    const at = parseRepository(vault.repository);
    const parent = input.expectedHead!;
    if ((await this.head(vault)) !== parent) return this.moved(vault);
    const base = await this.octokit.request("GET /repos/{owner}/{repo}/git/commits/{commit_sha}", {
      ...at,
      commit_sha: parent,
    });
    const tree: { path: string; mode: "100644"; type: "blob"; sha: string | null }[] = [];
    for (const op of input.ops) {
      if (op.op === "delete") {
        tree.push({ path: op.path, mode: "100644", type: "blob", sha: null });
        continue;
      }
      const blob = await this.octokit.request("POST /repos/{owner}/{repo}/git/blobs", {
        ...at,
        content: bytesOf(op.content).toString("base64"),
        encoding: "base64",
      });
      tree.push({ path: op.path, mode: "100644", type: "blob", sha: blob.data.sha });
    }
    const made = await this.octokit.request("POST /repos/{owner}/{repo}/git/trees", {
      ...at,
      base_tree: base.data.tree.sha,
      tree,
    });
    const commit = await this.octokit.request("POST /repos/{owner}/{repo}/git/commits", {
      ...at,
      message: input.message,
      tree: made.data.sha,
      parents: [parent],
      ...(input.author ? { author: input.author } : {}),
    });
    try {
      await this.octokit.request("PATCH /repos/{owner}/{repo}/git/refs/{ref}", {
        ...at,
        ref: `heads/${vault.branch}`,
        sha: commit.data.sha,
        force: false,
      });
    } catch (err) {
      // Not a fast-forward: someone committed in between.
      if (statusOf(err) === 422 || statusOf(err) === 409) return this.moved(vault);
      throw err;
    }
    return { sha: commit.data.sha };
  }

  async tag(vault: VaultRef, name: string, sha: string, message: string): Promise<void> {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/.test(name) || name.includes(".."))
      throw new Error(`"${name}" is not a valid tag name`);
    const at = parseRepository(vault.repository);
    const tag = await this.octokit.request("POST /repos/{owner}/{repo}/git/tags", {
      ...at,
      tag: name,
      message,
      object: sha,
      type: "commit",
    });
    try {
      await this.octokit.request("POST /repos/{owner}/{repo}/git/refs", {
        ...at,
        ref: `refs/tags/${name}`,
        sha: tag.data.sha,
      });
    } catch (err) {
      if (statusOf(err) === 422) throw new Error(`The tag ${name} already exists`, { cause: err });
      throw err;
    }
  }

  async listTags(vault: VaultRef) {
    const at = parseRepository(vault.repository);
    const res = await this.octokit.request("GET /repos/{owner}/{repo}/tags", {
      ...at,
      per_page: 100,
    });
    return res.data.map((t) => ({ name: t.name, sha: t.commit.sha, taggedAt: null }));
  }

  /** A branch for a change that is to be reviewed as a pull request. */
  async createBranch(vault: VaultRef, name: string, from: string): Promise<void> {
    const at = parseRepository(vault.repository);
    await this.octokit.request("POST /repos/{owner}/{repo}/git/refs", {
      ...at,
      ref: `refs/heads/${name}`,
      sha: from,
    });
  }

  async openPullRequest(
    vault: VaultRef,
    input: { branch: string; title: string; body: string },
  ): Promise<{ url: string }> {
    const at = parseRepository(vault.repository);
    const res = await this.octokit.request("POST /repos/{owner}/{repo}/pulls", {
      ...at,
      head: input.branch,
      base: vault.branch,
      title: input.title,
      body: input.body,
    });
    return { url: res.data.html_url };
  }

  /**
   * The push a webhook delivery reports, or null for anything else: a bad signature,
   * another event, a branch deletion, or a repository no vault lives in.
   */
  async verifyWebhook(req: Request): Promise<PushEvent | null> {
    const secret = this.opts.webhookSecret;
    const given = req.headers.get("x-hub-signature-256") ?? "";
    const body = await req.text();
    if (!secret || !verifySignature(secret, body, given)) return null;
    if (req.headers.get("x-github-event") !== "push") return null;
    let push: {
      ref?: string;
      before?: string;
      after?: string;
      deleted?: boolean;
      repository?: { full_name?: string };
    };
    try {
      push = JSON.parse(body) as typeof push;
    } catch {
      return null;
    }
    const branch = /^refs\/heads\/(.+)$/.exec(push.ref ?? "")?.[1];
    const name = push.repository?.full_name;
    if (!branch || !name || !push.after || push.deleted || /^0+$/.test(push.after)) return null;
    const vaultId = (await this.opts.vaultFor?.(`github:${name}`, branch)) ?? null;
    if (!vaultId) return null;
    return {
      vaultId,
      before: push.before && !/^0+$/.test(push.before) ? push.before : null,
      after: push.after,
    };
  }
}

/** Checks GitHub's `sha256=<hex>` signature of a delivery, in constant time. */
export function verifySignature(secret: string, body: string, signature: string): boolean {
  if (!signature.startsWith("sha256=")) return false;
  const expected = Buffer.from(
    "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex"),
  );
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
