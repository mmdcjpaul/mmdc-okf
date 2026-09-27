import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { git, Mirror } from "./mirror.ts";
import type {
  CommitInput,
  CommitResult,
  DiffEntry,
  GitProvider,
  PushEvent,
  VaultRef,
} from "./types.ts";

const ZERO = "0000000000000000000000000000000000000000";

/** Path of the bare repository for a `local:` vault. */
export function localRepoPath(vault: VaultRef): string {
  if (!vault.repository.startsWith("local:")) {
    throw new Error(`Not a local repository: ${vault.repository}`);
  }
  return vault.repository.slice("local:".length);
}

/**
 * `GitProvider` over a bare repository on disk, for running the Library with no GitHub.
 * Commits use plumbing with a temporary index and compare-and-swap through `git update-ref`,
 * then call `onPush` the way a GitHub push webhook would.
 */
export class LocalGitProvider implements GitProvider {
  private readonly onPush: ((event: PushEvent) => Promise<void> | void) | undefined;

  constructor(opts: { onPush?: (event: PushEvent) => Promise<void> | void } = {}) {
    this.onPush = opts.onPush;
  }

  mirror(vault: VaultRef): Mirror {
    return new Mirror(localRepoPath(vault));
  }

  async head(vault: VaultRef): Promise<string | null> {
    return this.mirror(vault).resolve(`refs/heads/${vault.branch}`);
  }

  async readFile(vault: VaultRef, path: string, ref?: string) {
    const m = this.mirror(vault);
    const at = ref ?? `refs/heads/${vault.branch}`;
    let sha: string;
    try {
      sha = (await git(m.gitDir, ["rev-parse", "--verify", "--quiet", `${at}:${path}`])).trim();
    } catch {
      return null;
    }
    if (!sha) return null;
    const blobs = await m.readBlobs([sha]);
    const content = blobs.get(sha);
    return content ? { content, blobSha: sha } : null;
  }

  async diff(vault: VaultRef, from: string, to: string): Promise<DiffEntry[]> {
    return this.mirror(vault).diff(from, to);
  }

  async commit(vault: VaultRef, input: CommitInput): Promise<CommitResult> {
    const gitDir = localRepoPath(vault);
    const ref = `refs/heads/${vault.branch}`;
    const current = await this.head(vault);
    if ((current ?? null) !== (input.expectedHead ?? null)) return { headMoved: current ?? ZERO };

    const tmp = await mkdtemp(join(tmpdir(), "lore-index-"));
    const env: Record<string, string> = { GIT_INDEX_FILE: join(tmp, "index") };
    if (input.author) {
      env.GIT_AUTHOR_NAME = input.author.name;
      env.GIT_AUTHOR_EMAIL = input.author.email;
      env.GIT_COMMITTER_NAME = input.author.name;
      env.GIT_COMMITTER_EMAIL = input.author.email;
    }
    try {
      if (current) await git(gitDir, ["read-tree", current], { env });
      else await git(gitDir, ["read-tree", "--empty"], { env });
      // `--index-info` works without a work tree; mode 0 removes an entry.
      const lines: string[] = [];
      for (const op of input.ops) {
        if (op.op === "delete") {
          lines.push(`0 ${ZERO}\t${op.path}`);
        } else {
          const content =
            typeof op.content === "string"
              ? Buffer.from(op.content, "utf8")
              : Buffer.from(op.content);
          const sha = (
            await git(gitDir, ["hash-object", "-w", "--stdin"], { input: content, env })
          ).trim();
          lines.push(`100644 ${sha}\t${op.path}`);
        }
      }
      if (lines.length)
        await git(gitDir, ["update-index", "--index-info"], {
          input: lines.join("\n") + "\n",
          env,
        });
      const tree = (await git(gitDir, ["write-tree"], { env })).trim();
      const parents = current ? ["-p", current] : [];
      const sha = (
        await git(gitDir, ["commit-tree", tree, ...parents, "-F", "-"], {
          input: input.message,
          env,
        })
      ).trim();
      try {
        await git(gitDir, ["update-ref", ref, sha, current ?? ZERO]);
      } catch {
        return { headMoved: (await this.head(vault)) ?? ZERO };
      }
      await this.onPush?.({ vaultId: vault.id, before: current, after: sha });
      return { sha };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  }
}

/** Creates an empty bare repository whose default branch is `branch`. */
export async function initBareRepo(path: string, branch = "main"): Promise<void> {
  await git(path, ["init", "--bare", "--quiet", `--initial-branch=${branch}`, path]);
}

/**
 * Commits the files of a working folder onto a bare repository's branch, honouring the folder's
 * .gitignore. Used by `lore seed` and `lore simulate-push`. Returns the new head, or null when
 * the tree did not change.
 */
export async function commitWorkingTree(
  bare: string,
  dir: string,
  branch: string,
  message: string,
  author = { name: "Lore seed", email: "seed@lore.local" },
): Promise<string | null> {
  const tmp = await mkdtemp(join(tmpdir(), "lore-snap-"));
  const env = {
    GIT_WORK_TREE: resolve(dir),
    GIT_INDEX_FILE: join(tmp, "index"),
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
  };
  try {
    const ref = `refs/heads/${branch}`;
    let head: string | null = null;
    try {
      head = (await git(bare, ["rev-parse", "--verify", "--quiet", ref])).trim() || null;
    } catch {
      head = null;
    }
    if (head) await git(bare, ["read-tree", head], { env });
    await git(bare, ["add", "-A", "."], { env });
    const tree = (await git(bare, ["write-tree"], { env })).trim();
    if (head && (await git(bare, ["rev-parse", `${head}^{tree}`])).trim() === tree) return null;
    const sha = (
      await git(bare, ["commit-tree", tree, ...(head ? ["-p", head] : []), "-F", "-"], {
        input: message,
        env,
      })
    ).trim();
    await git(bare, ["update-ref", ref, sha, head ?? ZERO]);
    return sha;
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
