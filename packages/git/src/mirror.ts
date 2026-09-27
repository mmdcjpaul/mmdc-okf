import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { CommitInfo, DiffEntry, FileChange, TreeEntry } from "./types.ts";

const exec = promisify(execFile);

/** Runs git against a bare repository or mirror clone. */
export async function git(
  gitDir: string,
  args: string[],
  opts: { input?: string | Buffer; env?: Record<string, string> } = {},
): Promise<string> {
  if (opts.input !== undefined) {
    return new Promise((resolve, reject) => {
      const child = spawn("git", args, {
        env: { ...process.env, GIT_DIR: gitDir, ...opts.env },
      });
      const out: Buffer[] = [];
      const err: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.stderr.on("data", (d: Buffer) => err.push(d));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(Buffer.concat(out).toString("utf8"));
        else
          reject(new Error(`git ${args[0]} failed: ${Buffer.concat(err).toString("utf8").trim()}`));
      });
      child.stdin.end(opts.input);
    });
  }
  const { stdout } = await exec("git", args, {
    env: { ...process.env, GIT_DIR: gitDir, ...opts.env },
    maxBuffer: 256 * 1024 * 1024,
  });
  return stdout;
}

const FIELD = "\x1f";
const RECORD = "\x1e";

/**
 * Read access to a repository on disk: the bare repository for `LocalGitProvider`, or the
 * worker's mirror clone for GitHub. Everything the indexer reads goes through here.
 */
export class Mirror {
  readonly gitDir: string;

  constructor(gitDir: string) {
    this.gitDir = gitDir;
  }

  async resolve(ref: string): Promise<string | null> {
    try {
      return (
        (await git(this.gitDir, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).trim() ||
        null
      );
    } catch {
      return null;
    }
  }

  /** Every file in the tree at `ref`, with blob SHAs and sizes. */
  async listTree(ref: string): Promise<TreeEntry[]> {
    const out = await git(this.gitDir, ["ls-tree", "-r", "-z", "--long", "--full-tree", ref]);
    const entries: TreeEntry[] = [];
    for (const line of out.split("\0")) {
      if (!line) continue;
      const tab = line.indexOf("\t");
      const [, type, sha, size] = line.slice(0, tab).split(/\s+/);
      if (type !== "blob") continue;
      entries.push({ path: line.slice(tab + 1), blobSha: sha!, size: Number(size) });
    }
    return entries;
  }

  /** Reads many blobs with one `git cat-file --batch` process. */
  async readBlobs(shas: string[]): Promise<Map<string, Uint8Array>> {
    const unique = [...new Set(shas)];
    const result = new Map<string, Uint8Array>();
    if (unique.length === 0) return result;
    const buf = await new Promise<Buffer>((resolve, reject) => {
      const child = spawn("git", ["cat-file", "--batch"], {
        env: { ...process.env, GIT_DIR: this.gitDir },
      });
      const out: Buffer[] = [];
      child.stdout.on("data", (d: Buffer) => out.push(d));
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0 ? resolve(Buffer.concat(out)) : reject(new Error("git cat-file failed")),
      );
      child.stdin.end(unique.join("\n") + "\n");
    });
    let pos = 0;
    while (pos < buf.length) {
      const nl = buf.indexOf(0x0a, pos);
      const header = buf.subarray(pos, nl).toString("utf8");
      const [sha, type, size] = header.split(" ");
      if (type === "missing") {
        pos = nl + 1;
        continue;
      }
      const len = Number(size);
      result.set(sha!, new Uint8Array(buf.subarray(nl + 1, nl + 1 + len)));
      pos = nl + 1 + len + 1;
    }
    return result;
  }

  /**
   * One file's text before and after a commit, relative to the commit's first parent.
   * Follows a rename, so `before` is the text under the old path. Null when the commit did
   * not touch the file.
   */
  async fileChange(sha: string, path: string): Promise<FileChange | null> {
    if (!/^[0-9a-f]{40,64}$/.test(sha)) throw new Error(`Invalid commit ${sha}`);
    const parent = await this.resolve(`${sha}^1`);
    const args = parent
      ? ["diff", "--raw", "-z", "-M", "--no-abbrev", parent, sha]
      : ["diff-tree", "-r", "--root", "--no-commit-id", "--raw", "-z", "--no-abbrev", sha];
    const entry = parseRaw((await git(this.gitDir, args)).split("\0")).find((e) => e.path === path);
    if (!entry) return null;
    const blobs = await this.readBlobs(
      [entry.oldSha, entry.newSha].filter((s): s is string => !!s),
    );
    const text = (blob?: string) => {
      const bytes = blob ? blobs.get(blob) : undefined;
      return bytes ? new TextDecoder().decode(bytes) : null;
    };
    return {
      status: entry.status,
      path,
      fromPath: entry.from ?? null,
      before: text(entry.oldSha),
      after: text(entry.newSha),
    };
  }

  async diff(from: string, to: string): Promise<DiffEntry[]> {
    const out = await git(this.gitDir, ["diff", "--name-status", "-z", "-M", from, to]);
    return parseNameStatus(out.split("\0"));
  }

  /**
   * Commits reachable from `to` but not `from` (all history when `from` is null), newest first,
   * with the files each one touched relative to its first parent.
   */
  async log(from: string | null, to: string): Promise<CommitInfo[]> {
    const range = from ? `${from}..${to}` : to;
    const format = ["%H", "%P", "%an", "%ae", "%cI", "%s", "%b", "%(trailers:unfold,only)"].join(
      FIELD,
    );
    const out = await git(this.gitDir, [
      "log",
      "-z",
      "--first-parent",
      "-M",
      "--raw",
      "--no-abbrev",
      `--format=${RECORD}${format}${FIELD}`,
      range,
    ]);
    const commits: CommitInfo[] = [];
    for (const record of out.split(RECORD)) {
      if (!record.trim()) continue;
      const parts = record.split(FIELD);
      const [sha, parents, authorName, authorEmail, date, subject, body, trailerText, rest] = parts;
      const trailers: Record<string, string> = {};
      for (const line of (trailerText ?? "").split("\n")) {
        const m = /^([A-Za-z-]+):\s*(.+)$/.exec(line.trim());
        if (!m) continue;
        const key = m[1]!.toLowerCase();
        // A trailer may repeat (several people credited, several reports resolved).
        trailers[key] = key in trailers ? `${trailers[key]}\n${m[2]!}` : m[2]!;
      }
      commits.push({
        sha: sha!,
        parents: parents ? parents.split(" ").filter(Boolean) : [],
        authorName: authorName!,
        authorEmail: authorEmail!,
        committedAt: new Date(date!),
        subject: subject!,
        body: (body ?? "").trim(),
        trailers,
        files: parseRaw((rest ?? "").replace(/^\n+/, "").split("\0")),
      });
    }
    return commits;
  }
}

/** Parses `--raw -z` output: `:<mode> <mode> <old> <new> <status>\0<path>[\0<path>]`. */
function parseRaw(tokens: string[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const meta = tokens[i]?.trim();
    if (!meta?.startsWith(":")) continue;
    const [, , oldSha, newSha, code] = meta.slice(1).split(" ");
    const kind = code![0];
    const zero = /^0+$/;
    const shas = {
      ...(oldSha && !zero.test(oldSha) ? { oldSha } : {}),
      ...(newSha && !zero.test(newSha) ? { newSha } : {}),
    };
    if (kind === "R" || kind === "C") {
      const from = tokens[++i]!;
      const path = tokens[++i]!;
      out.push(
        kind === "R" ? { path, status: "R", from, ...shas } : { path, status: "A", ...shas },
      );
    } else if (kind === "A" || kind === "M" || kind === "D" || kind === "T") {
      out.push({ path: tokens[++i]!, status: kind === "T" ? "M" : kind, ...shas });
    }
  }
  return out;
}

function parseNameStatus(tokens: string[]): DiffEntry[] {
  const out: DiffEntry[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const code = tokens[i]?.trim();
    if (!code) continue;
    const kind = code[0];
    if (kind === "R" || kind === "C") {
      const from = tokens[++i]!;
      const path = tokens[++i]!;
      out.push(kind === "R" ? { path, status: "R", from } : { path, status: "A" });
    } else if (kind === "A" || kind === "M" || kind === "D" || kind === "T") {
      out.push({ path: tokens[++i]!, status: kind === "T" ? "M" : kind });
    }
  }
  return out;
}
