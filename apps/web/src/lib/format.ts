const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

export function timeAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "never";
  const s = (date.getTime() - now.getTime()) / 1000;
  for (const [unit, secs] of UNITS) {
    if (Math.abs(s) >= secs) return rtf.format(Math.round(s / secs), unit);
  }
  return "just now";
}

const dateFmt = new Intl.DateTimeFormat("en", { year: "numeric", month: "short", day: "numeric" });

export function shortDate(date: Date | null | undefined): string {
  return date ? dateFmt.format(date) : "—";
}

export function plural(n: number, word: string, many = word + "s"): string {
  return `${n.toLocaleString("en")} ${n === 1 ? word : many}`;
}

export function titleCase(slug: string): string {
  return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
