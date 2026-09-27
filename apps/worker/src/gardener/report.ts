/**
 * What a Gardener run found (PRD 7.5, AU-11). Stored with the run and shown on the Hygiene
 * page, where each note is shown only to people who can read its namespace.
 */
import type { KnowledgeGap } from "../notify/gaps.ts";

export interface NoteRef {
  id: string;
  slug: string;
  title: string;
  type: string;
  namespace: string | null;
}

export interface DuplicateCluster {
  /** The note the others would be replaced by. */
  keep: NoteRef;
  others: NoteRef[];
  /** Vector similarity of the closest pair in the cluster, 0 to 1. */
  score: number;
  /** Share of title and description words the closest pair has in common. */
  wordsInCommon: number;
}

export interface WantedFinding {
  /** Bundle path of the note that does not exist, for example `/finance/x.md`. */
  path: string;
  namespace: string | null;
  wantedBy: NoteRef[];
}

export interface TermRef {
  kind: "theme" | "system" | "tag";
  slug: string;
  notes: number;
}

export interface GardenerReport {
  /** Notes looked at. */
  notes: number;
  duplicates: DuplicateCluster[];
  /** Notes nothing links to. */
  orphans: NoteRef[];
  wanted: WantedFinding[];
  stale: NoteRef[];
  unverified: NoteRef[];
  /** Notes with several open reports. */
  reported: (NoteRef & { reports: number })[];
  drift: {
    nearDuplicateTerms: { keep: TermRef; other: TermRef }[];
    tagsUsedOnce: TermRef[];
    /** Themes so small that they work as tags. */
    smallThemes: TermRef[];
    hubsWithoutDescription: TermRef[];
  };
  gaps: KnowledgeGap[];
  /** Proposals that were considered and not made, with the reason. */
  skipped: { what: string; why: string }[];
}

export interface GardenerSettings {
  /** Vector similarity at which two notes are taken to be the same (PRD 7.4). */
  likely: number;
  /** With a weaker vector match, the share of title and description words in common. */
  wordsInCommon: number;
  /** The weakest vector match that the words in common can vouch for. */
  floor: number;
  /** Open reports at which a note counts as heavily reported. */
  reports: number;
  /** A theme with fewer notes than this works as a tag. */
  smallTheme: number;
  /** Days before something that was proposed may be proposed again. */
  repeatAfterDays: number;
  /** Proposals per run, so one run cannot flood the review queue. */
  maxProposals: number;
}

export const DEFAULT_GARDENER: GardenerSettings = {
  likely: 0.92,
  wordsInCommon: 0.5,
  floor: 0.7,
  reports: 2,
  smallTheme: 3,
  repeatAfterDays: 90,
  maxProposals: 25,
};
