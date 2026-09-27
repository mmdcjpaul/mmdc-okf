/**
 * `@lore/git`: the `GitProvider` interface, the local bare-repository provider, and mirror
 * reads for the indexer. The GitHub provider arrives with the GitHub App work (L2, Plan 4).
 *
 * @packageDocumentation
 */
export type {
  CommitInfo,
  CommitInput,
  CommitResult,
  DiffEntry,
  GitProvider,
  PushEvent,
  TreeEntry,
  VaultRef,
} from "./types.ts";
export { git, Mirror } from "./mirror.ts";
export { commitWorkingTree, initBareRepo, LocalGitProvider, localRepoPath } from "./local.ts";
export { GitTreeSource } from "./source.ts";
