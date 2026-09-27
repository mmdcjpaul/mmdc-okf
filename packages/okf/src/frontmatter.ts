import {
  Document,
  isCollection,
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  type Node as YamlNode,
  type Scalar,
} from "yaml";

/** Stable key order used whenever tooling writes or inserts frontmatter keys. */
export const KEY_ORDER = [
  "type",
  "title",
  "description",
  "id",
  "version",
  "themes",
  "systems",
  "tags",
  "owner",
  "aliases",
  "resource",
  "status",
  "generated",
  "verified",
  "stale_after",
  "sources",
] as const;

const KEY_RANK = new Map<string, number>(KEY_ORDER.map((k, i) => [k, i]));

/** A note file split at its frontmatter delimiters. */
export interface SplitNote {
  hasFrontmatter: boolean;
  /** True when an opening `---` has no closing delimiter. */
  unterminated: boolean;
  /** Text between the delimiters, including the newline before the closing `---`. */
  raw: string;
  /** Offset of `raw` in the full text. */
  rawStart: number;
  /** Offset where the body starts in the full text. */
  bodyStart: number;
}

/** Locates the YAML frontmatter block without interpreting it. */
export function splitFrontmatter(text: string): SplitNote {
  const open = /^---[ \t]*\r?\n/.exec(text);
  if (!open) {
    return { hasFrontmatter: false, unterminated: false, raw: "", rawStart: 0, bodyStart: 0 };
  }
  const rawStart = open[0].length;
  const closer = /^(?:---|\.\.\.)[ \t]*$/gm;
  closer.lastIndex = rawStart;
  const close = closer.exec(text);
  if (!close) {
    return {
      hasFrontmatter: true,
      unterminated: true,
      raw: text.slice(rawStart),
      rawStart,
      bodyStart: text.length,
    };
  }
  let bodyStart = close.index + close[0].length;
  if (text.startsWith("\r\n", bodyStart)) bodyStart += 2;
  else if (text[bodyStart] === "\n") bodyStart += 1;
  return {
    hasFrontmatter: true,
    unterminated: false,
    raw: text.slice(rawStart, close.index),
    rawStart,
    bodyStart,
  };
}

/** Frontmatter as a YAML document (for editing in place) and as plain data. */
export interface ParsedFrontmatter {
  doc: Document.Parsed | null;
  data: Record<string, unknown>;
  errors: { message: string; line?: number; column?: number }[];
}

/** Parses frontmatter text. Never throws: YAML errors are returned in `errors`. */
export function parseFrontmatter(raw: string): ParsedFrontmatter {
  let doc: Document.Parsed;
  try {
    doc = parseDocument(raw, { prettyErrors: true, uniqueKeys: true });
  } catch (err) {
    return { doc: null, data: {}, errors: [{ message: String(err) }] };
  }
  const errors = doc.errors.map((e) => ({
    message: (e.message.split("\n")[0] ?? e.message).replace(/ at line \d+, column \d+:?$/, ""),
    line: e.linePos?.[0]?.line,
    column: e.linePos?.[0]?.col,
  }));
  if (errors.length) return { doc, data: {}, errors };
  if (doc.contents !== null && !isMap(doc.contents)) {
    return { doc, data: {}, errors: [{ message: "Frontmatter must be a YAML mapping" }] };
  }
  let data: unknown;
  try {
    data = doc.toJS({ maxAliasCount: 100 });
  } catch (err) {
    return { doc, data: {}, errors: [{ message: String(err) }] };
  }
  return { doc, data: (data ?? {}) as Record<string, unknown>, errors: [] };
}

interface StyleHint {
  flow?: boolean;
  scalarType?: Scalar.Type;
}

function styleNode(node: unknown, forceFlow: boolean): void {
  if (isSeq(node)) {
    if (forceFlow || node.items.every((i) => isScalar(i))) {
      node.flow = true;
      node.items.forEach((i) => styleNode(i, true));
      return;
    }
    node.flow = false;
    for (const item of node.items) {
      if (isMap(item) && item.items.every((p) => isScalar(p.value))) item.flow = true;
      else styleNode(item, false);
    }
  } else if (isMap(node)) {
    if (forceFlow || node.items.every((p) => isScalar(p.value))) {
      node.flow = true;
      node.items.forEach((p) => styleNode(p.value, true));
      return;
    }
    node.flow = false;
    node.items.forEach((p) => styleNode(p.value, false));
  }
}

function isScalarValue(v: unknown): boolean {
  return v === null || ["string", "number", "boolean"].includes(typeof v);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A scalar written for a flow collection, quoted by the yaml library when needed. */
function flowScalar(v: unknown): string {
  const doc = new Document([v]);
  (doc.contents as unknown as { flow: boolean }).flow = true;
  return doc.toString({ flowCollectionPadding: false, lineWidth: 0 }).trim().slice(1, -1);
}

function flowKey(k: string): string {
  return /^[A-Za-z_][A-Za-z0-9_-]*$/.test(k) ? k : flowScalar(k);
}

/** Flow style in the house format: `[a, b]` and `{ by: x, at: y }`. */
export function renderFlow(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(renderFlow).join(", ")}]`;
  if (isPlainObject(v)) {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined);
    return entries.length
      ? `{ ${entries.map(([k, x]) => `${flowKey(k)}: ${renderFlow(x)}`).join(", ")} }`
      : "{}";
  }
  return flowScalar(v);
}

/**
 * Renders one `key: value` pair. Lists of scalars and maps of scalars use flow style
 * (`[a, b]`, `{ by: x, at: y }`); lists of small maps use a block list of flow maps.
 */
export function renderPair(key: string, value: unknown, hint: StyleHint = {}): string {
  const k = flowKey(key);
  const collection = Array.isArray(value) || isPlainObject(value);
  const flat = (x: unknown) => isScalarValue(x) || (Array.isArray(x) && x.every(isScalarValue));
  if (collection && hint.flow !== false) {
    const scalarsOnly = Array.isArray(value)
      ? value.every(isScalarValue)
      : Object.values(value as Record<string, unknown>).every(isScalarValue);
    // Small maps of scalars and scalar lists also read well on one line.
    const smallFlatMap =
      !Array.isArray(value) &&
      Object.values(value as Record<string, unknown>).every(flat) &&
      renderFlow(value).length <= 100;
    if (hint.flow === true || scalarsOnly || smallFlatMap) return `${k}: ${renderFlow(value)}\n`;
  }
  if (
    Array.isArray(value) &&
    value.every((i) => isScalarValue(i) || (isPlainObject(i) && Object.values(i).every(flat)))
  ) {
    if (value.length === 0) return `${k}: []\n`;
    return `${k}:\n${value.map((i) => `  - ${renderFlow(i)}`).join("\n")}\n`;
  }
  const doc = new Document({ [key]: value });
  const node = doc.get(key, true);
  if (isCollection(node)) {
    if (hint.flow === true) styleNode(node, true);
    else if (hint.flow === false) {
      styleNode(node, false);
      node.flow = false;
    } else styleNode(node, false);
  } else if (isScalar(node) && typeof value === "string" && hint.scalarType) {
    if (hint.scalarType === "QUOTE_DOUBLE" || hint.scalarType === "QUOTE_SINGLE")
      node.type = hint.scalarType;
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: true, indentSeq: true });
}

/** Renders a complete frontmatter body (without delimiters) in the stable key order. */
export function renderFrontmatter(data: Record<string, unknown>): string {
  return orderKeys(Object.keys(data))
    .filter((k) => data[k] !== undefined)
    .map((k) => renderPair(k, data[k]))
    .join("");
}

/** Sorts keys into the stable order: known keys first in {@link KEY_ORDER}, then the rest as given. */
export function orderKeys(keys: string[]): string[] {
  const known = keys
    .filter((k) => KEY_RANK.has(k))
    .sort((a, b) => KEY_RANK.get(a)! - KEY_RANK.get(b)!);
  const rest = keys.filter((k) => !KEY_RANK.has(k));
  return [...known, ...rest];
}

interface KeyRegion {
  key: string;
  /** First line of the pair. */
  start: number;
  /** One past the last line of the pair (trailing comments before the next key excluded). */
  end: number;
  hint: StyleHint;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === "\n") starts.push(i + 1);
  return starts;
}

function lineOf(starts: number[], offset: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid]! <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function isTrivia(line: string): boolean {
  const t = line.trim();
  return t === "" || t.startsWith("#");
}

/**
 * Applies key changes to raw frontmatter while leaving every untouched line byte-identical.
 * Changed keys are re-rendered in place, removed keys are cut, and new keys are inserted
 * next to their neighbours in the stable key order.
 */
export function editFrontmatter(
  raw: string,
  doc: Document.Parsed | null,
  set: Map<string, unknown>,
  unset: Set<string>,
): string {
  if (set.size === 0 && unset.size === 0) return raw;
  const contents = doc?.contents;
  if (!doc || (contents !== null && !isMap(contents))) {
    throw new Error("Cannot edit frontmatter that is not a YAML mapping");
  }
  const text = raw.length && !raw.endsWith("\n") ? raw + "\n" : raw;
  const starts = lineStarts(text);
  const lines: string[] = [];
  for (let i = 0; i < starts.length; i++) {
    const s = starts[i]!;
    const e = i + 1 < starts.length ? starts[i + 1]! : text.length;
    if (s === text.length) break;
    lines.push(text.slice(s, e));
  }

  const regions: KeyRegion[] = [];
  if (isMap(contents)) {
    for (const pair of contents.items) {
      if (!isPair(pair) || !isScalar(pair.key)) continue;
      const range = (pair.key as YamlNode).range;
      if (!range) continue;
      const value = pair.value as YamlNode | null;
      const hint: StyleHint = {};
      if (isCollection(value)) hint.flow = Boolean(value.flow);
      else if (isScalar(value)) hint.scalarType = value.type;
      regions.push({ key: String(pair.key.value), start: lineOf(starts, range[0]), end: 0, hint });
    }
  }
  regions.sort((a, b) => a.start - b.start);
  for (let i = 0; i < regions.length; i++) {
    let end = i + 1 < regions.length ? regions[i + 1]!.start : lines.length;
    while (end - 1 > regions[i]!.start && isTrivia(lines[end - 1]!)) end--;
    regions[i]!.end = end;
  }

  // Replacements and deletions, keyed by the start line of the region they replace.
  const replace = new Map<number, { end: number; text: string }>();
  const present = new Set(regions.map((r) => r.key));
  for (const region of regions) {
    if (unset.has(region.key)) replace.set(region.start, { end: region.end, text: "" });
    else if (set.has(region.key)) {
      replace.set(region.start, {
        end: region.end,
        text: renderPair(region.key, set.get(region.key), region.hint),
      });
    }
  }

  // Insertions: after the closest preceding key in the stable order, else before the closest following key.
  const insertAt = new Map<number, string[]>();
  const newKeys = orderKeys([...set.keys()].filter((k) => !present.has(k)));
  const regionOf = new Map(regions.filter((r) => !unset.has(r.key)).map((r) => [r.key, r]));
  for (const key of newKeys) {
    const rank = KEY_RANK.get(key);
    let at: number | null = null;
    if (rank !== undefined) {
      for (let r = rank - 1; r >= 0 && at === null; r--) {
        const prev = regionOf.get(KEY_ORDER[r]!);
        if (prev) at = prev.end;
      }
      for (let r = rank + 1; r < KEY_ORDER.length && at === null; r++) {
        const next = regionOf.get(KEY_ORDER[r]!);
        if (next) at = next.start;
      }
    }
    if (at === null) {
      const last = [...regionOf.values()].sort((a, b) => b.end - a.end)[0];
      at = last ? last.end : lines.length;
    }
    const list = insertAt.get(at) ?? [];
    list.push(renderPair(key, set.get(key)));
    insertAt.set(at, list);
  }

  let out = "";
  for (let i = 0; i <= lines.length; i++) {
    const ins = insertAt.get(i);
    if (ins) out += ins.join("");
    if (i === lines.length) break;
    const rep = replace.get(i);
    if (rep) {
      out += rep.text;
      i = rep.end - 1;
      continue;
    }
    out += lines[i];
  }
  return out;
}
