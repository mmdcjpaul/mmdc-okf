import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { hubKindOf, namespaceOf, parseNote, str, strList, toBundlePath } from "@lore/okf";

/**
 * Offline full-text search for `kb query` and `kb related`.
 *
 * The index is a compact inverted index cached in `.kb/.cache/query-index.bin`: a JSON header
 * (documents, term dictionary, file manifest) followed by typed arrays of postings that are
 * used in place, so loading does not rebuild anything. Files that changed since the cache was
 * written are kept in a small delta and scored with the same statistics; the base is rebuilt
 * once the delta grows. See docs/decisions/0002-kb-query-index.md.
 */

const VERSION = 3;
const CACHE_FILE = ".kb/.cache/query-index.bin";
const FIELDS = ["title", "aliases", "description", "body"] as const;
const BOOST = [4, 3, 2, 1];
const NF = FIELDS.length;
const K1 = 1.2;
const B = 0.7;
const MAX_DELTA = 500;

export interface DocMeta {
  path: string;
  noteId: string;
  title: string;
  description: string;
  type: string;
  namespace: string;
  status: string;
}

export interface Hit {
  path: string;
  noteId: string;
  title: string;
  description: string;
  type: string;
  namespace: string;
  score: number;
}

/** A document tokenized per field: term frequencies and field lengths. */
interface DeltaDoc {
  meta: DocMeta;
  tf: Record<string, number[]>;
  len: number[];
}

interface Header {
  version: number;
  root: string;
  docs: DocMeta[];
  terms: string[];
  avg: number[];
  /** File path to [mtime, size]. */
  manifest: Record<string, [number, number]>;
  /** Folder path to mtime, to notice added and removed files without listing every folder. */
  dirs: Record<string, number>;
  /** Base documents replaced or removed since the base was built. */
  removed: number[];
  delta: DeltaDoc[];
  counts: { postings: number };
}

const SPLIT = /[^\p{L}\p{N}]+/u;

export function tokenize(text: string): string[] {
  return text.toLowerCase().split(SPLIT).filter(Boolean);
}

function fieldTexts(
  path: string,
  text: string,
  bundleRoot: string,
): { meta: DocMeta; fields: string[] } {
  const note = parseNote(text, path);
  const meta: DocMeta = {
    path,
    noteId: str(note.data, "id") ?? "",
    title: str(note.data, "title") ?? path,
    description: str(note.data, "description") ?? "",
    type: str(note.data, "type") ?? "",
    namespace:
      namespaceOf(bundleRoot, path) ??
      (hubKindOf(bundleRoot, path) ? toBundlePath(bundleRoot, path).split("/")[1]! : ""),
    status: str(note.data, "status") ?? "stable",
  };
  return {
    meta,
    fields: [meta.title, strList(note.data, "aliases").join(" "), meta.description, note.body],
  };
}

function tokenizeDoc(path: string, text: string, bundleRoot: string): DeltaDoc {
  const { meta, fields } = fieldTexts(path, text, bundleRoot);
  const tf: Record<string, number[]> = {};
  const len = fields.map((f, i) => {
    const tokens = tokenize(f);
    for (const t of tokens) (tf[t] ??= new Array(NF).fill(0))[i]!++;
    return tokens.length;
  });
  return { meta, tf, len };
}

// ------------------------------------------------------------------------------------------------
// Scanning

function isIndexed(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    path.endsWith(".md") && name !== "index.md" && name !== "log.md" && !path.includes("/_meta/")
  );
}

/** Lists folders and notes under the bundle root, re-reading only folders whose mtime changed. */
function scan(
  vaultRoot: string,
  bundleRoot: string,
  previous: Header | null,
): { files: Map<string, [number, number]>; dirs: Record<string, number> } {
  const files = new Map<string, [number, number]>();
  const dirs: Record<string, number> = {};
  const known = new Map<string, string[]>();
  if (previous) {
    for (const path of Object.keys(previous.manifest)) {
      const d = path.slice(0, path.lastIndexOf("/"));
      known.set(d, [...(known.get(d) ?? []), path]);
    }
  }
  const visit = (dir: string) => {
    let mtime: number;
    try {
      mtime = Math.floor(statSync(join(vaultRoot, dir)).mtimeMs);
    } catch {
      return;
    }
    dirs[dir] = mtime;
    const subdirs: string[] = [];
    let entries: string[];
    if (previous && previous.dirs[dir] === mtime) {
      entries = known.get(dir) ?? [];
      for (const d of Object.keys(previous.dirs))
        if (d.slice(0, d.lastIndexOf("/")) === dir) subdirs.push(d);
    } else {
      entries = [];
      for (const e of readdirSync(join(vaultRoot, dir), { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) {
          if (e.name !== "_meta" && !e.name.startsWith(".")) subdirs.push(p);
        } else if (isIndexed(p)) entries.push(p);
      }
    }
    for (const p of entries) {
      try {
        const s = statSync(join(vaultRoot, p));
        files.set(p, [Math.floor(s.mtimeMs), s.size]);
      } catch {
        // removed since the folder was listed
      }
    }
    for (const d of subdirs) visit(d);
  };
  visit(bundleRoot);
  return { files, dirs };
}

// ------------------------------------------------------------------------------------------------
// Building and storing

function buildBase(
  vaultRoot: string,
  bundleRoot: string,
  files: Map<string, [number, number]>,
  dirs: Record<string, number>,
): SearchIndex {
  const docs: DocMeta[] = [];
  const postings = new Map<string, number[][]>(); // term -> per field: flat [doc, tf, doc, tf...]
  const lens: number[] = [];
  const sums = new Array(NF).fill(0);
  const manifest: Record<string, [number, number]> = {};
  for (const path of [...files.keys()].sort()) {
    const doc = tokenizeDoc(path, readFileSync(join(vaultRoot, path), "utf8"), bundleRoot);
    const idx = docs.length;
    docs.push(doc.meta);
    doc.len.forEach((l, i) => {
      lens.push(l);
      sums[i] += l;
    });
    for (const [term, tfs] of Object.entries(doc.tf)) {
      let p = postings.get(term);
      if (!p) postings.set(term, (p = Array.from({ length: NF }, () => [])));
      tfs.forEach((tf, f) => {
        if (tf) p![f]!.push(idx, tf);
      });
    }
    manifest[path] = files.get(path)!;
  }
  const terms = [...postings.keys()].sort();
  let total = 0;
  for (const t of terms) for (const f of postings.get(t)!) total += f.length / 2;
  const offsets = new Uint32Array(terms.length * NF + 1);
  const docIds = new Uint32Array(total);
  const tfs = new Uint16Array(total);
  let at = 0;
  terms.forEach((t, ti) => {
    postings.get(t)!.forEach((flat, f) => {
      offsets[ti * NF + f] = at;
      for (let i = 0; i < flat.length; i += 2) {
        docIds[at] = flat[i]!;
        tfs[at] = Math.min(flat[i + 1]!, 65535);
        at++;
      }
    });
  });
  offsets[terms.length * NF] = at;
  const header: Header = {
    version: VERSION,
    root: bundleRoot,
    docs,
    terms,
    avg: sums.map((s) => (docs.length ? s / docs.length : 0)),
    manifest,
    dirs,
    removed: [],
    delta: [],
    counts: { postings: total },
  };
  return new SearchIndex(
    header,
    offsets,
    docIds,
    tfs,
    new Uint16Array(lens.map((l) => Math.min(l, 65535))),
  );
}

function align4(n: number): number {
  return (n + 3) & ~3;
}

function save(path: string, index: SearchIndex): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const head = Buffer.from(JSON.stringify(index.header), "utf8");
    const start = align4(8 + head.length);
    const parts = [index.offsets, index.docIds, index.fieldLens, index.tfs] as const;
    let size = start;
    for (const p of parts) size = align4(size + p.byteLength);
    const buf = Buffer.alloc(size);
    buf.writeUInt32LE(VERSION, 0);
    buf.writeUInt32LE(head.length, 4);
    head.copy(buf, 8);
    let at = start;
    for (const p of parts) {
      Buffer.from(p.buffer, p.byteOffset, p.byteLength).copy(buf, at);
      at = align4(at + p.byteLength);
    }
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, buf);
    renameSync(tmp, path);
  } catch {
    // a read-only checkout still answers queries
  }
}

function load(path: string): SearchIndex | null {
  let buf: Buffer;
  try {
    buf = readFileSync(path);
  } catch {
    return null;
  }
  if (buf.length < 8 || buf.readUInt32LE(0) !== VERSION) return null;
  // Typed-array views need 4-byte alignment.
  if (buf.byteOffset % 4 !== 0) {
    const copy = new Uint8Array(new ArrayBuffer(buf.length));
    copy.set(buf);
    buf = Buffer.from(copy.buffer);
  }
  const headLen = buf.readUInt32LE(4);
  const header = JSON.parse(buf.toString("utf8", 8, 8 + headLen)) as Header;
  if (header.version !== VERSION) return null;
  const ab = buf.buffer;
  let at = buf.byteOffset + align4(8 + headLen);
  const take = <T>(
    ctor: { new (b: ArrayBufferLike, o: number, l: number): T; BYTES_PER_ELEMENT: number },
    length: number,
  ): T => {
    const arr = new ctor(ab, at, length);
    at = buf.byteOffset + align4(at - buf.byteOffset + length * ctor.BYTES_PER_ELEMENT);
    return arr;
  };
  const offsets = take(Uint32Array, header.terms.length * NF + 1);
  const docIds = take(Uint32Array, header.counts.postings);
  const fieldLens = take(Uint16Array, header.docs.length * NF);
  const tfs = take(Uint16Array, header.counts.postings);
  return new SearchIndex(header, offsets, docIds, tfs, fieldLens);
}

// ------------------------------------------------------------------------------------------------
// Querying

function levenshtein(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(
        prev[j]! + 1,
        cur[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length]!;
}

export interface SearchOptions {
  namespace?: string;
  type?: string;
  limit?: number;
  exclude?: Set<string>;
  includeDeprecated?: boolean;
}

export class SearchIndex {
  readonly header: Header;
  readonly offsets: Uint32Array;
  readonly docIds: Uint32Array;
  readonly tfs: Uint16Array;
  readonly fieldLens: Uint16Array;
  private removed: Set<number>;
  private termSet: Map<string, number> | null = null;

  constructor(
    header: Header,
    offsets: Uint32Array,
    docIds: Uint32Array,
    tfs: Uint16Array,
    fieldLens: Uint16Array,
  ) {
    this.header = header;
    this.offsets = offsets;
    this.docIds = docIds;
    this.tfs = tfs;
    this.fieldLens = fieldLens;
    this.removed = new Set(header.removed);
  }

  get size(): number {
    return this.header.docs.length - this.removed.size + this.header.delta.length;
  }

  private termIndex(term: string): number {
    const terms = this.header.terms;
    let lo = 0;
    let hi = terms.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = terms[mid]!;
      if (t === term) return mid;
      if (t < term) lo = mid + 1;
      else hi = mid - 1;
    }
    return -lo - 1;
  }

  /** Dictionary terms matching a query term: exact, prefix, and fuzzy, with their weights. */
  private expand(q: string): Map<string, number> {
    const out = new Map<string, number>();
    const dict = new Set(this.header.terms);
    for (const d of this.header.delta) for (const t of Object.keys(d.tf)) dict.add(t);
    if (dict.has(q)) out.set(q, 1);
    if (q.length >= 3) {
      const terms = this.header.terms;
      let i = this.termIndex(q);
      if (i < 0) i = -i - 1;
      for (; i < terms.length && terms[i]!.startsWith(q); i++)
        if (terms[i] !== q) out.set(terms[i]!, 0.375 * (q.length / terms[i]!.length));
      for (const d of this.header.delta)
        for (const t of Object.keys(d.tf))
          if (t !== q && t.startsWith(q) && !out.has(t)) out.set(t, 0.375 * (q.length / t.length));
    }
    const maxDist = q.length >= 8 ? 2 : q.length >= 4 ? 1 : 0;
    if (maxDist) {
      for (const t of dict) {
        if (out.has(t) || Math.abs(t.length - q.length) > maxDist) continue;
        const dist = levenshtein(q, t, maxDist);
        if (dist <= maxDist) out.set(t, 0.45 * (q.length / (q.length + dist)));
      }
    }
    return out;
  }

  search(text: string, opts: SearchOptions = {}): Hit[] {
    const { docs, avg, delta } = this.header;
    const n = this.size || 1;
    const queryTerms = [...new Set(tokenize(text))];
    const scores = new Map<number, number>(); // base doc index, or -1 - delta index
    const matched = new Map<number, number>();
    const deltaDf = (term: string, f: number) =>
      delta.reduce((c, d) => c + ((d.tf[term]?.[f] ?? 0) > 0 ? 1 : 0), 0);
    for (const q of queryTerms) {
      const seen = new Set<number>();
      for (const [term, weight] of this.expand(q)) {
        const ti = this.termIndex(term);
        for (let f = 0; f < NF; f++) {
          let df = deltaDf(term, f);
          let s = 0;
          let e = 0;
          if (ti >= 0) {
            s = this.offsets[ti * NF + f]!;
            e = this.offsets[ti * NF + f + 1]!;
            df += e - s;
          }
          if (!df) continue;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          const add = (key: number, tf: number, len: number) => {
            const norm = (tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * len) / (avg[f] || 1)));
            scores.set(key, (scores.get(key) ?? 0) + weight * BOOST[f]! * idf * norm);
            seen.add(key);
          };
          for (let i = s; i < e; i++) {
            const doc = this.docIds[i]!;
            if (this.removed.has(doc)) continue;
            add(doc, this.tfs[i]!, this.fieldLens[doc * NF + f]!);
          }
          delta.forEach((d, di) => {
            const tf = d.tf[term]?.[f];
            if (tf) add(-1 - di, tf, d.len[f]!);
          });
        }
      }
      for (const key of seen) matched.set(key, (matched.get(key) ?? 0) + 1);
    }
    const metaOf = (key: number) => (key >= 0 ? docs[key]! : delta[-1 - key]!.meta);
    const hits: Hit[] = [];
    for (const [key, score] of scores) {
      const m = metaOf(key);
      if (opts.namespace && m.namespace !== opts.namespace) continue;
      if (opts.type && m.type.toLowerCase() !== opts.type.toLowerCase()) continue;
      if (!opts.includeDeprecated && m.status === "deprecated") continue;
      if (opts.exclude?.has(m.path)) continue;
      const coverage = (matched.get(key) ?? 1) / Math.max(1, queryTerms.length);
      hits.push({
        path: m.path,
        noteId: m.noteId,
        title: m.title,
        description: m.description,
        type: m.type,
        namespace: m.namespace,
        score: score * coverage,
      });
    }
    hits.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1));
    return hits
      .slice(0, opts.limit ?? 10)
      .map((h) => ({ ...h, score: Math.round(h.score * 100) / 100 }));
  }
}

/**
 * Opens the cached index, bringing it up to date with the files on disk. Changed files go into
 * the delta; the base is rebuilt from scratch when the delta passes {@link MAX_DELTA} notes.
 */
export function openIndex(
  vaultRoot: string,
  bundleRoot: string,
): { index: SearchIndex; rebuilt: number } {
  const cachePath = join(vaultRoot, CACHE_FILE);
  let index = load(cachePath);
  if (index && index.header.root !== bundleRoot) index = null;
  const { files, dirs } = scan(vaultRoot, bundleRoot, index?.header ?? null);
  if (!index) {
    index = buildBase(vaultRoot, bundleRoot, files, dirs);
    save(cachePath, index);
    return { index, rebuilt: files.size };
  }
  const h = index.header;
  const changed: string[] = [];
  for (const [path, stamp] of files) {
    const old = h.manifest[path];
    if (!old || old[0] !== stamp[0] || old[1] !== stamp[1]) changed.push(path);
  }
  const gone = Object.keys(h.manifest).filter((p) => !files.has(p));
  const dirsChanged = JSON.stringify(dirs) !== JSON.stringify(h.dirs);
  if (!changed.length && !gone.length) {
    if (dirsChanged) {
      h.dirs = dirs;
      save(cachePath, index);
    }
    return { index, rebuilt: 0 };
  }
  const baseIdx = new Map(h.docs.map((d, i) => [d.path, i]));
  const touched = new Set([...changed, ...gone]);
  const kept = h.delta.filter((d) => !touched.has(d.meta.path));
  const removed = new Set(h.removed);
  for (const p of touched) {
    const i = baseIdx.get(p);
    if (i !== undefined) removed.add(i);
  }
  const added = changed.map((p) =>
    tokenizeDoc(p, readFileSync(join(vaultRoot, p), "utf8"), bundleRoot),
  );
  if (kept.length + added.length > MAX_DELTA) {
    index = buildBase(vaultRoot, bundleRoot, files, dirs);
    save(cachePath, index);
    return { index, rebuilt: files.size };
  }
  const manifest = { ...h.manifest };
  for (const p of gone) delete manifest[p];
  for (const p of changed) manifest[p] = files.get(p)!;
  const next = new SearchIndex(
    {
      ...h,
      manifest,
      dirs,
      removed: [...removed].sort((a, b) => a - b),
      delta: [...kept, ...added],
    },
    index.offsets,
    index.docIds,
    index.tfs,
    index.fieldLens,
  );
  save(cachePath, next);
  return { index: next, rebuilt: touched.size };
}

export function search(index: SearchIndex, text: string, opts: SearchOptions = {}): Hit[] {
  return index.search(text, opts);
}
