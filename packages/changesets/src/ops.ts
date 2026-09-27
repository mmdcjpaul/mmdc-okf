import { monotonicFactory } from "ulid";
import type { FileOp } from "@lore/okf";
import type { StoredOp } from "./types.ts";

/** Converts ops for storage as JSON. Binary content becomes base64. */
export function toStoredOps(ops: FileOp[]): StoredOp[] {
  return ops.map((op) => {
    if (op.op === "delete") return { op: "delete", path: op.path };
    if (typeof op.content === "string") return { op: "put", path: op.path, content: op.content };
    return {
      op: "put",
      path: op.path,
      content: Buffer.from(op.content).toString("base64"),
      encoding: "base64",
    };
  });
}

export function fromStoredOps(ops: StoredOp[]): FileOp[] {
  return ops.map((op) => {
    if (op.op === "delete") return { op: "delete", path: op.path };
    return op.encoding === "base64"
      ? { op: "put", path: op.path, content: new Uint8Array(Buffer.from(op.content, "base64")) }
      : { op: "put", path: op.path, content: op.content };
  });
}

/** Rejects paths that could escape the repository or are not plain relative paths. */
export function isSafePath(path: string): boolean {
  if (!path || path.length > 400) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("\0")) return false;
  return path.split("/").every((s) => s !== "" && s !== "." && s !== ".." && s.trim() === s);
}

const ulid = monotonicFactory();

/** Ids for app records: a prefix plus a ULID, for example `cs_01J9ZB4M3FQ8R2T6V0X4Z8C2E6`. */
export function newRecordId(prefix: "cs" | "fb" | "in", now: Date = new Date()): string {
  return `${prefix}_${ulid(now.getTime())}`;
}
