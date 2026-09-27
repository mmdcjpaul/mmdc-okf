import { monotonicFactory } from "ulid";
import type { Actor, ChangeClass, Verification } from "./types.ts";

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function isValidVersion(version: unknown): version is string {
  return typeof version === "string" && VERSION_RE.test(version);
}

/** Bumps a semver-lite version: fix is a patch, addition a minor, process a major. */
export function bumpVersion(version: string, cls: ChangeClass): string {
  const m = VERSION_RE.exec(version);
  if (!m) throw new Error(`Invalid version "${version}"`);
  const [maj, min, pat] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (cls === "fix") return `${maj}.${min}.${pat + 1}`;
  if (cls === "addition") return `${maj}.${min + 1}.0`;
  return `${maj + 1}.0.0`;
}

/** The version a new note starts at: 0.1.0 for drafts, 1.0.0 otherwise. */
export function initialVersion(status: string | undefined): string {
  return status === "draft" ? "0.1.0" : "1.0.0";
}

/** Normalizes `verified`, which may be a single entry or a list. */
export function verifications(value: unknown): Verification[] {
  const list = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  return list.filter(
    (v): v is Verification =>
      Boolean(v) &&
      typeof (v as Verification).by === "string" &&
      typeof (v as Verification).at === "string",
  );
}

/**
 * OKF trust tier: `human` when at least one `human:` verifier, `machine` when only automated
 * verifiers, `unverified` when there are none.
 */
export function trustTier(
  verified: Verification[] | undefined | unknown,
): "unverified" | "machine" | "human" {
  const list = verifications(verified);
  if (list.length === 0) return "unverified";
  return list.some((v) => v.by.startsWith("human:")) ? "human" : "machine";
}

/** True once `stale_after` has passed. Notes without `stale_after` never go stale. */
export function isStale(note: { data: Record<string, unknown> }, now: Date): boolean {
  const staleAfter = note.data.stale_after;
  if (typeof staleAfter !== "string") return false;
  const t = Date.parse(staleAfter);
  return Number.isFinite(t) && now.getTime() >= t;
}

export interface ParsedActor {
  kind: "human" | "agent" | "process";
  id: string;
  /** For agents, the model part of `<job>/<model>`. */
  model?: string;
}

export function parseActor(actor: Actor): ParsedActor | null {
  if (actor.startsWith("human:") && actor.length > 6) return { kind: "human", id: actor.slice(6) };
  if (actor.startsWith("process:") && actor.length > 8)
    return { kind: "process", id: actor.slice(8) };
  const slash = actor.indexOf("/");
  if (slash > 0 && slash < actor.length - 1 && !/\s/.test(actor)) {
    return { kind: "agent", id: actor.slice(0, slash), model: actor.slice(slash + 1) };
  }
  return null;
}

const ulid = monotonicFactory();

/** A fresh note id: the profile prefix plus a ULID. */
export function newId(prefix = "kb_", now: Date = new Date()): string {
  return prefix + ulid(now.getTime());
}

export const ID_BODY_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export function isValidId(id: unknown, prefix = "kb_"): boolean {
  return (
    typeof id === "string" && id.startsWith(prefix) && ID_BODY_RE.test(id.slice(prefix.length))
  );
}

/** Formats an instant as `YYYY-MM-DDTHH:MM:SSZ`, the form Lore writes. */
export function isoInstant(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
