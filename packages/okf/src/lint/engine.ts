import { parseNote, serializeNote, type ParsedNote } from "../note.ts";
import { isManagedPath } from "../paths.ts";
import { compactOps } from "../source.ts";
import type { FileOp, Issue, Severity } from "../types.ts";
import type { Vault } from "../vault.ts";

export type RuleSetting = "off" | "warning" | "error";
export type RuleConfig = Record<string, RuleSetting>;

export interface RuleContext {
  vault: Vault;
  /** Notes to check. Vault-wide rules still see every note through `vault`. */
  targets: ParsedNote[];
  now: Date;
}

export interface Rule {
  id: string;
  severity: Severity;
  description: string;
  /** OKF rules check every markdown file; Lore rules skip managed folders and unparsable notes. */
  family: "okf" | "lore";
  check(ctx: RuleContext): Issue[] | Promise<Issue[]>;
  /** Changes the working copy to resolve the given issues. */
  fix?(fc: FixContext, issues: Issue[]): void | Promise<void>;
}

export interface LintReport {
  issues: Issue[];
  errors: number;
  warnings: number;
  /** Number of notes checked. */
  checked: number;
}

export interface FixOptions {
  now?: Date;
  /** Id generator, injectable for deterministic tests. */
  newId?: () => string;
}

/** A working copy of changed files that fixes edit in turn, so fixes to the same note compose. */
export class FixContext {
  readonly vault: Vault;
  readonly now: Date;
  readonly newId: () => string;
  private readonly texts = new Map<string, string>();
  private readonly parsed = new Map<string, ParsedNote>();
  readonly extraOps: FileOp[] = [];

  constructor(vault: Vault, opts: Required<FixOptions>) {
    this.vault = vault;
    this.now = opts.now;
    this.newId = opts.newId;
  }

  /** The current note, reflecting earlier fixes. */
  note(path: string): ParsedNote | undefined {
    const text = this.texts.get(path);
    if (text === undefined) return this.vault.notes.get(path);
    let note = this.parsed.get(path);
    if (!note || note.text !== text) {
      note = parseNote(text, path);
      this.parsed.set(path, note);
    }
    return note;
  }

  setText(path: string, text: string): void {
    this.texts.set(path, text);
  }

  /** Edits a note's data or body through a clone and stores the serialized result. */
  update(path: string, fn: (note: ParsedNote) => void): void {
    const current = this.note(path);
    if (!current) return;
    const copy = { ...current, data: structuredClone(current.data) };
    fn(copy);
    const text = serializeNote(copy);
    if (text !== current.text) this.setText(path, text);
  }

  ops(): FileOp[] {
    const ops: FileOp[] = [];
    for (const [path, text] of this.texts) {
      const original = this.vault.notes.get(path)?.text;
      if (text !== original) ops.push({ op: "put", path, content: text });
    }
    return compactOps([...ops, ...this.extraOps]);
  }
}

export function isLoreTarget(vault: Vault, note: ParsedNote): boolean {
  return (
    !isManagedPath(vault.root, note.path) && !note.issues.some((i) => i.rule === "okf/frontmatter")
  );
}

export function effectiveSeverity(rule: Rule, config: RuleConfig): Severity | null {
  const setting = config[rule.id];
  if (setting === "off") return null;
  if (setting === "warning" || setting === "error") return setting;
  return rule.severity;
}
