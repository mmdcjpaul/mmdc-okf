import "server-only";
import type { GardenerRunRow, ReadScope } from "@lore/db";

/** The worker's report, as the Hygiene page reads it (apps/worker/src/gardener/report.ts). */
export interface NoteRef {
  id: string;
  slug: string;
  title: string;
  type: string;
  namespace: string | null;
}
interface TermRef {
  kind: "theme" | "system" | "tag";
  slug: string;
  notes: number;
}
export interface GardenerView {
  notes: number;
  duplicates: { keep: NoteRef; others: NoteRef[]; score: number; wordsInCommon: number }[];
  orphans: NoteRef[];
  wanted: { path: string; namespace: string | null; wantedBy: NoteRef[] }[];
  reported: (NoteRef & { reports: number })[];
  drift: {
    nearDuplicateTerms: { keep: TermRef; other: TermRef }[];
    tagsUsedOnce: TermRef[];
    smallThemes: TermRef[];
    hubsWithoutDescription: TermRef[];
  };
  gaps: { question: string; count: number; namespace: string | null }[];
}

const list = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/**
 * A run's report with everything the reader may not see taken out. The Gardener looks at
 * every namespace; a finding is shown only when the reader can read every note it names.
 */
export function visibleReport(run: GardenerRunRow, scope: ReadScope): GardenerView {
  const r = run.report as Record<string, unknown>;
  const can = (n: { namespace: string | null }) =>
    n.namespace !== null && scope.namespaces.includes(n.namespace);
  const drift = (r.drift ?? {}) as Record<string, unknown>;
  return {
    notes: typeof r.notes === "number" ? r.notes : 0,
    duplicates: list<GardenerView["duplicates"][number]>(r.duplicates).filter(
      (d) => can(d.keep) && d.others.every(can),
    ),
    orphans: list<NoteRef>(r.orphans).filter(can),
    wanted: list<GardenerView["wanted"][number]>(r.wanted)
      .filter(can)
      .map((w) => ({ ...w, wantedBy: w.wantedBy.filter(can) }))
      .filter((w) => w.wantedBy.length > 0),
    reported: list<GardenerView["reported"][number]>(r.reported).filter(can),
    // The vocabulary is the same for everyone.
    drift: {
      nearDuplicateTerms: list(drift.nearDuplicateTerms),
      tagsUsedOnce: list(drift.tagsUsedOnce),
      smallThemes: list(drift.smallThemes),
      hubsWithoutDescription: list(drift.hubsWithoutDescription),
    },
    gaps: list<GardenerView["gaps"][number]>(r.gaps).filter(can),
  };
}
