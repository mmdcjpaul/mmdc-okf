import { createHash } from "node:crypto";
import type { FootnoteReference, List, RootContent } from "mdast";
import { getEncoding, type Tiktoken } from "js-tiktoken";
import { toString as mdToString } from "mdast-util-to-string";
import { visit } from "unist-util-visit";
import { noteAst, str, strList, type ParsedNote } from "./note.ts";
import { namespaceOf } from "./paths.ts";
import type { Vault } from "./vault.ts";

/** Counts the tokens in a piece of text. The default approximates with cl100k. */
export type TokenCounter = (text: string) => number;

/** Size limits for {@link chunkNote}, in tokens. */
export interface ChunkOptions {
  countTokens?: TokenCounter;
  /** A section or procedure above this many tokens is split. Default 700. */
  maxTokens?: number;
  /** Target size when splitting. Default 600. */
  targetTokens?: number;
  /** Sections below this many tokens merge into a neighbour. Default 80. */
  minTokens?: number;
}

/** One retrievable section of a note, with the header that gives it context. */
export interface Chunk {
  /** `<noteId>#<position>`. */
  id: string;
  noteId: string;
  position: number;
  headingPath: string[];
  /** Deterministic contextual header shared by keyword and vector search. */
  header: string;
  /** An exact slice of the note body. */
  text: string;
  /** Tokens in `text`. */
  tokens: number;
  /** sha256 of header plus text: the embedding cache key. */
  contentHash: string;
  /** Offsets of `text` in the note file. */
  start: number;
  end: number;
  /** Footnote markers in this chunk, resolved to their `sources` titles. */
  footnotes: { id: string; title: string }[];
}

let encoder: Tiktoken | null = null;

/** Approximate token count with the cl100k encoding. */
export const tiktokenCounter: TokenCounter = (text) => {
  encoder ??= getEncoding("cl100k_base");
  return encoder.encode(text).length;
};

interface Block {
  start: number;
  end: number;
  node: RootContent;
}

interface Section {
  headingPath: string[];
  blocks: Block[];
}

interface Piece {
  headingPath: string[];
  titles: string[];
  start: number;
  end: number;
  nodes: RootContent[];
}

function offsets(node: {
  position?: { start: { offset?: number }; end: { offset?: number } };
}): [number, number] | null {
  const s = node.position?.start.offset;
  const e = node.position?.end.offset;
  return s === undefined || e === undefined ? null : [s, e];
}

/**
 * Splits a note into retrieval chunks: one per H1 to H3 section, lists, tables, and code
 * kept whole, long procedures split between items, small sections merged into a neighbour,
 * and long sections packed into 400 to 600 token chunks at block boundaries. Pure and
 * deterministic, so the indexer and the Desk sandbox produce identical chunks.
 */
export function chunkNote(note: ParsedNote, vault: Vault | null, opts: ChunkOptions = {}): Chunk[] {
  const count = opts.countTokens ?? tiktokenCounter;
  const max = opts.maxTokens ?? 700;
  const target = opts.targetTokens ?? 600;
  const min = opts.minTokens ?? 80;
  const text = note.text;
  const ast = noteAst(note);

  // 1. Sections at H1 to H3, each with its heading path.
  const sections: Section[] = [];
  const stack: { depth: number; title: string }[] = [];
  let current: Section = { headingPath: [], blocks: [] };
  for (const node of ast.children) {
    if (node.type === "yaml") continue;
    const range = offsets(node);
    if (!range) continue;
    if (node.type === "heading" && node.depth <= 3) {
      if (current.blocks.length) sections.push(current);
      while (stack.length && stack[stack.length - 1]!.depth >= node.depth) stack.pop();
      stack.push({ depth: node.depth, title: mdToString(node).trim() });
      current = { headingPath: stack.map((s) => s.title), blocks: [] };
    }
    current.blocks.push({ start: range[0], end: range[1], node });
  }
  if (current.blocks.length) sections.push(current);

  const slice = (s: number, e: number) => text.slice(s, e);
  const tokensOf = (s: number, e: number) => count(slice(s, e));

  // 2. Split long sections at block boundaries; split long lists between items.
  const pieces: Piece[] = [];
  for (const section of sections) {
    const title = section.headingPath[section.headingPath.length - 1] ?? "";
    const first = section.blocks[0]!;
    const last = section.blocks[section.blocks.length - 1]!;
    const base = { headingPath: section.headingPath, titles: title ? [title] : [] };
    if (tokensOf(first.start, last.end) <= max) {
      pieces.push({
        ...base,
        start: first.start,
        end: last.end,
        nodes: section.blocks.map((b) => b.node),
      });
      continue;
    }
    const units: Block[] = [];
    for (const block of section.blocks) {
      if (block.node.type === "list" && tokensOf(block.start, block.end) > max) {
        for (const item of (block.node as List).children) {
          const r = offsets(item);
          if (r) units.push({ start: r[0], end: r[1], node: item as unknown as RootContent });
        }
      } else units.push(block);
    }
    let group: Block[] = [];
    const flush = () => {
      if (!group.length) return;
      pieces.push({
        ...base,
        start: group[0]!.start,
        end: group[group.length - 1]!.end,
        nodes: group.map((g) => g.node),
      });
      group = [];
    };
    for (const unit of units) {
      // A heading never ends up alone: it stays with the block that follows it.
      const onlyHeadings = group.every((g) => g.node.type === "heading");
      if (group.length && !onlyHeadings && tokensOf(group[0]!.start, unit.end) > target) flush();
      group.push(unit);
    }
    flush();
  }

  // 3. Merge small pieces into a neighbour when the result stays within the limit.
  const merged: Piece[] = [];
  for (const piece of pieces) {
    const prev = merged[merged.length - 1];
    const size = tokensOf(piece.start, piece.end);
    if (
      prev &&
      (size < min || tokensOf(prev.start, prev.end) < min) &&
      tokensOf(prev.start, piece.end) <= max
    ) {
      prev.end = piece.end;
      prev.nodes.push(...piece.nodes);
      for (const t of piece.titles) if (!prev.titles.includes(t)) prev.titles.push(t);
      if (!prev.headingPath.length) prev.headingPath = piece.headingPath;
      continue;
    }
    merged.push({ ...piece, titles: [...piece.titles], nodes: [...piece.nodes] });
  }

  // 4. Contextual headers, footnotes, ids, and hashes.
  const noteId = str(note.data, "id") ?? note.path;
  const title = str(note.data, "title") ?? note.path;
  const type = str(note.data, "type") ?? "Note";
  const ns = vault ? namespaceOf(vault.root, note.path) : null;
  const description = str(note.data, "description");
  const themes = strList(note.data, "themes");
  const systems = strList(note.data, "systems");
  const sources = Array.isArray(note.data.sources)
    ? (note.data.sources as Record<string, unknown>[])
    : [];
  const sourceTitle = (id: string): string => {
    const s = sources.find((x) => x && String(x.id ?? "") === id);
    return s ? String(s.title ?? s.resource ?? id) : id;
  };

  return merged.map((piece, position) => {
    const lines = [`Note: ${title} (${[type, ns].filter(Boolean).join(", ")})`];
    if (description) lines.push(`Summary: ${description}`);
    const facets: string[] = [];
    if (themes.length) facets.push(`Themes: ${themes.join(", ")}.`);
    if (systems.length) facets.push(`Systems: ${systems.join(", ")}.`);
    if (facets.length) lines.push(facets.join(" "));
    if (piece.titles.length) lines.push(`Section: ${piece.titles.join(" / ")}`);
    const header = lines.join("\n");
    const chunkText = slice(piece.start, piece.end);
    const footnotes: Chunk["footnotes"] = [];
    for (const node of piece.nodes) {
      visit(node, "footnoteReference", (ref: FootnoteReference) => {
        if (!footnotes.some((f) => f.id === ref.identifier))
          footnotes.push({ id: ref.identifier, title: sourceTitle(ref.identifier) });
      });
    }
    return {
      id: `${noteId}#${position}`,
      noteId,
      position,
      headingPath: piece.headingPath,
      header,
      text: chunkText,
      tokens: count(chunkText),
      contentHash: createHash("sha256")
        .update(header + "\n\n" + chunkText)
        .digest("hex"),
      start: piece.start,
      end: piece.end,
      footnotes,
    };
  });
}
