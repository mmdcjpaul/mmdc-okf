import { parseNote, serializeNote, type ParsedNote } from "../note.ts";
import type { FileOp } from "../types.ts";
import type { Vault } from "../vault.ts";

/**
 * An in-memory working copy over a vault. Operations read and write through it so that
 * several edits to one file compose, then hand back the net file operations.
 */
export class Workspace {
  readonly vault: Vault;
  private readonly changes = new Map<string, string | null>();
  private readonly parsed = new Map<string, ParsedNote>();
  private readonly extraTexts = new Map<string, string | null>();

  constructor(vault: Vault) {
    this.vault = vault;
  }

  /** Seeds text for a file the vault does not parse (log.md, tags.yaml). */
  seed(path: string, text: string | null): void {
    if (!this.extraTexts.has(path)) this.extraTexts.set(path, text);
  }

  has(path: string): boolean {
    if (this.changes.has(path)) return this.changes.get(path) !== null;
    return (
      this.vault.notes.has(path) ||
      this.vault.aux.has(path) ||
      (this.extraTexts.get(path) ?? null) !== null
    );
  }

  text(path: string): string | null {
    if (this.changes.has(path)) return this.changes.get(path) ?? null;
    return (
      this.vault.notes.get(path)?.text ??
      this.vault.aux.get(path) ??
      this.extraTexts.get(path) ??
      null
    );
  }

  note(path: string): ParsedNote | null {
    const text = this.text(path);
    if (text === null) return null;
    const cached = this.parsed.get(path);
    if (cached && cached.text === text) return cached;
    const original = this.vault.notes.get(path);
    const note = original && original.text === text ? original : parseNote(text, path);
    this.parsed.set(path, note);
    return note;
  }

  put(path: string, text: string): void {
    this.changes.set(path, text);
  }

  delete(path: string): void {
    this.changes.set(path, null);
  }

  /** Clones the note, applies `fn` to its data and body, and stores the result. */
  update(path: string, fn: (note: ParsedNote) => void): void {
    const note = this.note(path);
    if (!note) throw new Error(`No note at ${path}`);
    const copy = { ...note, data: structuredClone(note.data) };
    fn(copy);
    const text = serializeNote(copy);
    if (text !== note.text) this.put(path, text);
  }

  /** Paths of every note, including ones created in this workspace. */
  notePaths(): string[] {
    const paths = new Set(this.vault.notes.keys());
    for (const [p, t] of this.changes) {
      if (t === null) paths.delete(p);
      else if (
        p.endsWith(".md") &&
        !p.endsWith("/index.md") &&
        !p.endsWith("/log.md") &&
        p !== "index.md" &&
        p !== "log.md"
      )
        paths.add(p);
    }
    return [...paths].sort();
  }

  ops(): FileOp[] {
    const ops: FileOp[] = [];
    for (const [path, text] of this.changes) {
      const original =
        this.vault.notes.get(path)?.text ??
        this.vault.aux.get(path) ??
        this.extraTexts.get(path) ??
        null;
      if (text === original) continue;
      ops.push(text === null ? { op: "delete", path } : { op: "put", path, content: text });
    }
    return ops;
  }
}
