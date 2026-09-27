/**
 * `@lore/git`: the `GitProvider` interface, the local bare-repository provider, and mirror
 * reads for the indexer. The GitHub provider is `@lore/git/github`, so only what commits to
 * GitHub loads Octokit.
 *
 * @packageDocumentation
 */
export type {
  CommitInfo,
  CommitInput,
  CommitResult,
  DiffEntry,
  FileChange,
  GitProvider,
  PushEvent,
  TreeEntry,
  VaultRef,
} from "./types.ts";
export { git, Mirror } from "./mirror.ts";
export { commitWorkingTree, initBareRepo, LocalGitProvider, localRepoPath } from "./local.ts";
export { GitTreeSource } from "./source.ts";
