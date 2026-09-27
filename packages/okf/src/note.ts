import type { Root } from "mdast";
import remarkFrontmatter from "remark-frontmatter";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Document } from "yaml";
import {
  editFrontmatter,
  parseFrontmatter,
  renderFrontmatter,
  splitFrontmatter,
} from "./frontmatter.ts";
import type { Issue } from "./types.ts";

/**
 * A note parsed from text. `data` and `body` are working copies: change them and call
 * {@link serializeNote} to get text in which only the changed keys differ from the original.
 */
export interface ParsedNote {
  /** Repository-relative path. */
  path: string;
  /** The text the note was parsed from. */
  text: string;
  hasFrontmatter: boolean;
  /** Raw frontmatter between the delimiters. */
  frontmatterRaw: string;
  /** Frontmatter values, including keys Lore does not know. */
  data: Record<string, unknown>;
  /** Markdown after the frontmatter. */
  body: string;
  /** Offset of the body in `text`. */
  bodyOffset: number;
  /** 1-based line number of the first body line. */
  bodyLine: number;
  /** Parse problems. A note with issues still loads. */
  issues: Issue[];
  /** @internal */
  _doc: Document.Parsed | null;
  /** @internal JSON snapshot of the parsed data for change detection. */
  _original: Record<string, string>;
  /** @internal */
  _originalBody: string;
}

function snapshot(data: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) out[k] = JSON.stringify(v);
  return out;
}

/** Parses a note. Never throws: YAML problems become issues on the returned note. */
export function parseNote(text: string, path: string): ParsedNote {
  const split = splitFrontmatter(text);
  const issues: Issue[] = [];
  let data: Record<string, unknown> = {};
  let doc: Document.Parsed | null = null;
  const fmLine = 2;
  if (split.hasFrontmatter) {
    if (split.unterminated) {
      issues.push({
        rule: "okf/frontmatter",
        severity: "error",
        path,
        line: 1,
        message: "Frontmatter has no closing ---",
      });
    } else {
      const parsed = parseFrontmatter(split.raw);
      doc = parsed.doc;
      data = parsed.data;
      for (const e of parsed.errors) {
        issues.push({
          rule: "okf/frontmatter",
          severity: "error",
          path,
          line: e.line !== undefined ? e.line + fmLine - 1 : 1,
          ...(e.column !== undefined ? { column: e.column } : {}),
          message: `Invalid frontmatter: ${e.message}`,
        });
      }
    }
  }
  const body = text.slice(split.bodyStart);
  let bodyLine = 1;
  for (let i = 0; i < split.bodyStart; i++) if (text[i] === "\n") bodyLine++;
  return {
    path,
    text,
    hasFrontmatter: split.hasFrontmatter,
    frontmatterRaw: split.raw,
    data,
    body,
    bodyOffset: split.bodyStart,
    bodyLine,
    issues,
    _doc: doc,
    _original: snapshot(data),
    _originalBody: body,
  };
}

/** Deep-copies a note so pure operations can change it without touching the vault's copy. */
export function cloneNote(note: ParsedNote): ParsedNote {
  return { ...note, data: structuredClone(note.data), issues: [...note.issues] };
}

/**
 * Turns a note back into text. Unchanged notes come back byte-identical. Changed keys are
 * rewritten in place, new keys are inserted in the stable key order, and unknown keys,
 * comments, and formatting of untouched keys are preserved.
 */
export function serializeNote(note: ParsedNote): string {
  const set = new Map<string, unknown>();
  const unset = new Set<string>();
  for (const [k, v] of Object.entries(note.data)) {
    if (v === undefined) continue;
    if (note._original[k] !== JSON.stringify(v)) set.set(k, v);
  }
  for (const k of Object.keys(note._original)) {
    if (note.data[k] === undefined) unset.add(k);
  }
  const bodyChanged = note.body !== note._originalBody;
  if (!set.size && !unset.size && !bodyChanged) return note.text;

  if (!note.hasFrontmatter) {
    if (!set.size) return note.body;
    const body = note.body.startsWith("\n") || note.body === "" ? note.body : "\n" + note.body;
    return `---\n${renderFrontmatter(note.data)}---\n${body}`;
  }
  const split = splitFrontmatter(note.text);
  if (split.unterminated)
    throw new Error(`${note.path}: cannot edit a note whose frontmatter is not closed`);
  const head = note.text.slice(0, split.rawStart);
  const closing = note.text.slice(split.rawStart + split.raw.length, split.bodyStart);
  let raw = split.raw;
  if (set.size || unset.size) {
    if (note.issues.some((i) => i.rule === "okf/frontmatter")) {
      throw new Error(`${note.path}: cannot edit frontmatter that does not parse`);
    }
    raw = editFrontmatter(split.raw, note._doc, set, unset);
  }
  return head + raw + closing + note.body;
}

/** Builds the text of a new note with keys in the stable order. */
export function buildNoteText(data: Record<string, unknown>, body: string): string {
  const trimmed = body.replace(/^\n+/, "");
  return `---\n${renderFrontmatter(data)}---\n\n${trimmed}${trimmed.endsWith("\n") ? "" : "\n"}`;
}

const processor = unified().use(remarkParse).use(remarkFrontmatter, ["yaml"]).use(remarkGfm);
const astCache = new WeakMap<ParsedNote, Root>();

/**
 * The markdown syntax tree of the note's original text. Positions are offsets into
 * `note.text`, so line numbers match the file.
 */
export function noteAst(note: ParsedNote): Root {
  let ast = astCache.get(note);
  if (!ast) {
    ast = processor.parse(note.text) as Root;
    astCache.set(note, ast);
  }
  return ast;
}

/** Parses arbitrary markdown with the same settings used for notes. */
export function parseMarkdown(text: string): Root {
  return processor.parse(text) as Root;
}

/** Reads a string field, returning undefined for anything else. */
export function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key];
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : undefined;
}

/** Reads a list-of-strings field. A single string counts as a one-item list. */
export function strList(data: Record<string, unknown>, key: string): string[] {
  const v = data[key];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  if (typeof v === "string") return [v];
  return [];
}
