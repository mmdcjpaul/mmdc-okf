import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { MemorySource, type FileOp, type Issue } from "@lore/okf";
import type {
  ChangesetDraft,
  ChangesetFacts,
  Level,
  NoteChange,
  PrepareInput,
  ReviewContext,
} from "../src/index.ts";
import type { PrepareContext } from "../src/index.ts";

export const REPO = resolve(import.meta.dirname, "../../..");
export const NOW = new Date("2026-09-24T00:00:00Z");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** The Acme fixture vault in memory, so tests never touch the files. */
export function acme(): MemorySource {
  const root = join(REPO, "fixtures/vault-acme");
  const files: Record<string, string | Uint8Array> = {};
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (rel.includes(".cache")) continue;
    files[rel] = /\.(md|ya?ml|json)$/.test(rel)
      ? readFileSync(file, "utf8")
      : new Uint8Array(readFileSync(file));
  }
  return new MemorySource(files);
}

/** Principals from fixtures/principals.yaml, as the access maps the pipeline sees. */
export const PEOPLE: Record<string, { access: Map<string, Level>; isAdmin: boolean }> = {
  alice: {
    access: new Map<string, Level>([
      ["admissions", "write"],
      ["finance", "read"],
      ["it-support", "read"],
    ]),
    isAdmin: false,
  },
  bob: {
    access: new Map<string, Level>([
      ["admissions", "read"],
      ["finance", "maintain"],
      ["it-support", "read"],
    ]),
    isAdmin: false,
  },
  carol: {
    access: new Map<string, Level>([
      ["admissions", "read"],
      ["finance", "read"],
      ["it-support", "read"],
    ]),
    isAdmin: false,
  },
  dana: { access: new Map(), isAdmin: true },
};

export function context(who: keyof typeof PEOPLE, src: MemorySource): PrepareContext {
  let n = 0;
  return {
    src,
    ...PEOPLE[who]!,
    now: NOW,
    newId: () => `kb_01K0000000000000000000${String(++n).padStart(4, "0")}`,
  };
}

export function input(over: Partial<PrepareInput> & { ops?: FileOp[] }): PrepareInput {
  return {
    id: "cs_01K000000000000000000000CS",
    source: "editor",
    aiDrafted: false,
    changeClass: "fix",
    actor: "human:alice",
    verify: false,
    ops: [],
    intents: [],
    baseShas: {},
    ...over,
  };
}

export function noteChange(over: Partial<NoteChange> = {}): NoteChange {
  return {
    id: "kb_1",
    kind: "updated",
    from: "kb/admissions/a.md",
    to: "kb/admissions/a.md",
    title: "A note",
    type: "How-To",
    typeBefore: "How-To",
    namespace: "admissions",
    namespaceBefore: "admissions",
    hub: null,
    statusBefore: "stable",
    status: "stable",
    versionBefore: "1.0.0",
    humanVerified: false,
    textChanged: true,
    primary: true,
    ...over,
  };
}

export function facts(over: Partial<ChangesetFacts> = {}): ChangesetFacts {
  const notes = over.notes ?? [noteChange()];
  return {
    notes,
    terms: [],
    namespaces: [
      ...new Set(
        notes.flatMap((n) => [n.namespace, n.namespaceBefore]).filter((n): n is string => !!n),
      ),
    ].sort(),
    touchesTaxonomy: false,
    assets: [],
    ...over,
  };
}

export function draft(over: Partial<ChangesetDraft> = {}): ChangesetDraft {
  return {
    source: "editor",
    aiDrafted: false,
    changeClass: "fix",
    facts: facts(),
    unrepaired: [],
    duplicates: [],
    ...over,
  };
}

export function reviewer(
  who: keyof typeof PEOPLE,
  over: Partial<ReviewContext> = {},
): ReviewContext {
  return { ...PEOPLE[who]!, publishing: {}, ...over };
}

export const issue = (over: Partial<Issue> = {}): Issue => ({
  rule: "lore/limits",
  severity: "error",
  path: "kb/admissions/a.md",
  message: "Too many themes",
  ...over,
});
