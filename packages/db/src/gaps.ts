/**
 * Knowledge gaps: clusters of questions that found nothing. The Desk records them (Plan 3,
 * DK-10) and hands them to the Library through this interface (Plan 4). The weekly digest
 * and the Gardener read from it. Until the Desk is connected the source is empty.
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
  /**
   * The gaps in the given namespaces since a date, most asked first. The caller passes
   * only namespaces its reader may read, and the source must return nothing from any other.
   */
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
