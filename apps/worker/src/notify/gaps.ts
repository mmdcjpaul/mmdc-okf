/**
 * Knowledge gaps: clusters of questions that found nothing. The Desk records them (Plan 3,
 * DK-10) and Plan 4 connects it here. Until then the source is empty, and the digest and
 * the Gardener simply have no gaps to show.
 */
export interface KnowledgeGap {
  /** A question that stands for the cluster. */
  question: string;
  /** How many times something like it was asked. */
  count: number;
  /** Where the askers were looking, when known. */
  namespace: string | null;
  lastAskedAt: Date;
}

export interface GapSource {
  gaps(query: {
    vaultId: string;
    namespaces: string[];
    since: Date;
    limit: number;
  }): Promise<KnowledgeGap[]>;
}

export const NO_GAPS: GapSource = {
  async gaps() {
    return [];
  },
};
