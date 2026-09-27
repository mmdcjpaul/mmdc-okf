/** Words that say nothing about what a note covers. */
const STOP = new Set(
  (
    "a an and are as at be by for from has have how in into is it its of on or so that the " +
    "their them then this to two use used using when where which who will with you your"
  ).split(" "),
);

/** Singular form, roughly. Enough to match "contacts" with "contact". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.length > 4 && /(ss|x|ch|sh)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/** The words that carry meaning in a title and description. */
export function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.add(stem(w));
  }
  return out;
}

/** Shared words over all words: 1 for the same set, 0 for nothing in common. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/** The number of single-character edits between two strings. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j]! + 1,
        row[j - 1]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * True for two slugs that are probably the same term: the same words in another order or
 * number ("refund" and "refunds", "student-records" and "records-student"), or one typo apart.
 */
export function nearDuplicateSlugs(a: string, b: string): boolean {
  if (a === b) return false;
  const words = (s: string) => s.split("-").map(stem).sort().join("-");
  if (words(a) === words(b)) return true;
  const longest = Math.max(a.length, b.length);
  return longest >= 6 && editDistance(a, b) === 1;
}

/** Groups items that are connected by pairs, directly or through others. */
export function clusters<T>(pairs: [T, T][]): T[][] {
  const parent = new Map<T, T>();
  const find = (x: T): T => {
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root)!;
    parent.set(x, root);
    return root;
  };
  for (const [a, b] of pairs) {
    if (!parent.has(a)) parent.set(a, a);
    if (!parent.has(b)) parent.set(b, b);
    parent.set(find(a), find(b));
  }
  const groups = new Map<T, T[]>();
  for (const x of parent.keys()) {
    const root = find(x);
    groups.set(root, [...(groups.get(root) ?? []), x]);
  }
  return [...groups.values()];
}
