import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import type { FileOp } from "./types.ts";

/**
 * Read access to a vault's files. Paths are repository-relative and always use `/`.
 * Every reader in Lore goes through this interface, so a changeset can be validated
 * against the vault (with {@link OverlaySource}) before anything is committed.
 */
export interface FileSource {
  /** Every file path that starts with `prefix` (use `""` for all), sorted. */
  list(prefix: string): Promise<string[]>;
  /** Text files come back as strings, binary files as bytes, missing files as `null`. */
  read(path: string): Promise<string | Uint8Array | null>;
  /** Git blob SHA of the file, when the source can provide one. */
  blobSha?(path: string): Promise<string | null>;
}

const TEXT_EXTENSIONS = new Set([
  ".md",
  ".markdown",
  ".yaml",
  ".yml",
  ".json",
  ".txt",
  ".csv",
  ".html",
  ".svg",
  ".toml",
]);

/** True for files read as text. Anything else is read as bytes. */
export function isTextPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  if (dot < 0) return true;
  return TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

/** Git's blob hash: sha1 of `blob <size>\0<content>`. */
export function gitBlobSha(content: string | Uint8Array): string {
  const bytes = typeof content === "string" ? Buffer.from(content, "utf8") : Buffer.from(content);
  return createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

const IGNORED_DIRS = new Set([".git", "node_modules", ".cache", ".turbo"]);

/** Reads a working copy on disk. Skips `.git`, `node_modules`, and cache folders. */
export class DiskSource implements FileSource {
  readonly root: string;
  private listing: Promise<string[]> | null = null;

  constructor(root: string) {
    this.root = root;
  }

  private async walk(): Promise<string[]> {
    const out: string[] = [];
    const visit = async (dir: string): Promise<void> => {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue;
          await visit(join(dir, entry.name));
        } else if (entry.isFile()) {
          if (entry.name === ".DS_Store") continue;
          out.push(relative(this.root, join(dir, entry.name)).split(sep).join("/"));
        }
      }
    };
    await visit(this.root);
    return out.sort();
  }

  async list(prefix: string): Promise<string[]> {
    this.listing ??= this.walk();
    const all = await this.listing;
    return prefix ? all.filter((p) => p.startsWith(prefix)) : all;
  }

  async read(path: string): Promise<string | Uint8Array | null> {
    try {
      const buf = await readFile(join(this.root, path));
      return isTextPath(path) ? buf.toString("utf8") : new Uint8Array(buf);
    } catch {
      return null;
    }
  }

  async size(path: string): Promise<number | null> {
    try {
      return (await stat(join(this.root, path))).size;
    } catch {
      return null;
    }
  }

  async blobSha(path: string): Promise<string | null> {
    const content = await this.read(path);
    return content === null ? null : gitBlobSha(content);
  }
}

/** An in-memory set of files. Used by tests and by the Desk sandbox. */
export class MemorySource implements FileSource {
  readonly files: Map<string, string | Uint8Array>;

  constructor(files: Record<string, string | Uint8Array> | Map<string, string | Uint8Array> = {}) {
    this.files = files instanceof Map ? new Map(files) : new Map(Object.entries(files));
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.files.keys()].filter((p) => p.startsWith(prefix)).sort();
  }

  async read(path: string): Promise<string | Uint8Array | null> {
    return this.files.get(path) ?? null;
  }

  async blobSha(path: string): Promise<string | null> {
    const content = this.files.get(path);
    return content === undefined ? null : gitBlobSha(content);
  }

  /** Returns a new source with the ops applied. */
  apply(ops: FileOp[]): MemorySource {
    const next = new MemorySource(this.files);
    for (const op of ops) {
      if (op.op === "put") next.files.set(op.path, op.content);
      else next.files.delete(op.path);
    }
    return next;
  }
}

/** A base source with a list of file operations applied on top, without copying the base. */
export class OverlaySource implements FileSource {
  private readonly base: FileSource;
  private readonly changes = new Map<string, string | Uint8Array | null>();

  constructor(base: FileSource, ops: FileOp[]) {
    this.base = base;
    for (const op of ops) this.changes.set(op.path, op.op === "put" ? op.content : null);
  }

  async list(prefix: string): Promise<string[]> {
    const paths = new Set(await this.base.list(prefix));
    for (const [path, content] of this.changes) {
      if (!path.startsWith(prefix)) continue;
      if (content === null) paths.delete(path);
      else paths.add(path);
    }
    return [...paths].sort();
  }

  async read(path: string): Promise<string | Uint8Array | null> {
    if (this.changes.has(path)) return this.changes.get(path) ?? null;
    return this.base.read(path);
  }

  async blobSha(path: string): Promise<string | null> {
    if (this.changes.has(path)) {
      const content = this.changes.get(path);
      return content == null ? null : gitBlobSha(content);
    }
    return this.base.blobSha ? this.base.blobSha(path) : null;
  }
}

/** Reads a file as text, decoding bytes when needed. */
export async function readText(src: FileSource, path: string): Promise<string | null> {
  const content = await src.read(path);
  if (content === null) return null;
  return typeof content === "string" ? content : Buffer.from(content).toString("utf8");
}

/** Merges ops so each path appears once, last write wins, in first-touched order. */
export function compactOps(ops: FileOp[]): FileOp[] {
  const byPath = new Map<string, FileOp>();
  for (const op of ops) {
    byPath.delete(op.path);
    byPath.set(op.path, op);
  }
  return [...byPath.values()];
}
