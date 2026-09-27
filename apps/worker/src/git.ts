/**
 * Where vaults live: a bare repository on this machine, or GitHub with a mirror clone here.
 * The indexer and the changeset job read from the mirror, so reading a vault costs no API
 * calls, and commit through the provider.
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { git, LocalGitProvider, Mirror, type GitProvider } from "@lore/git";
import { GitHubProvider, parseRepository, type GitHubAuth } from "@lore/git/github";

export interface GitSettings {
  dataDir: string;
  github?: {
    auth: GitHubAuth;
    /** For GitHub Enterprise Server. */
    apiUrl?: string | undefined;
    /** Where repositories are cloned from. `https://github.com` unless it is Enterprise. */
    gitUrl: string;
    webhookSecret?: string | undefined;
  };
  vaultFor?: (repository: string, branch: string) => Promise<string | null>;
}

let settings: GitSettings | null = null;
let hub: GitHubProvider | null = null;

/** Called once at startup. Without it only `local:` repositories work. */
export function setupGit(next: GitSettings): void {
  settings = next;
  hub = next.github
    ? new GitHubProvider({
        auth: next.github.auth,
        ...(next.github.apiUrl ? { baseUrl: next.github.apiUrl } : {}),
        ...(next.github.webhookSecret ? { webhookSecret: next.github.webhookSecret } : {}),
        ...(next.vaultFor ? { vaultFor: next.vaultFor } : {}),
      })
    : null;
}

export function github(): GitHubProvider | null {
  return hub;
}

function mirrorDir(repository: string): string {
  if (!settings) throw new Error("Git is not set up");
  const { owner, repo } = parseRepository(repository);
  return join(settings.dataDir, "mirrors", `${owner}__${repo}.git`);
}

export function mirrorFor(repository: string): Mirror {
  if (repository.startsWith("local:")) return new Mirror(repository.slice("local:".length));
  if (repository.startsWith("github:")) return new Mirror(mirrorDir(repository));
  throw new Error(`Unknown kind of repository: ${repository}`);
}

/**
 * The provider that commits to a vault. `onPush` stands in for the push webhook: a local
 * repository has nobody to call us, so the provider does it after each commit.
 */
export function providerFor(
  repository: string,
  onPush?: (vaultId: string) => Promise<void> | void,
): GitProvider {
  if (repository.startsWith("local:"))
    return new LocalGitProvider(onPush ? { onPush: (e) => onPush(e.vaultId) } : {});
  if (repository.startsWith("github:")) {
    if (!hub)
      throw new Error(
        `${repository} needs GitHub credentials: set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, and GITHUB_INSTALLATION_ID`,
      );
    return hub;
  }
  throw new Error(`Unknown kind of repository: ${repository}`);
}

const syncing = new Map<string, Promise<void>>();

/**
 * Brings the mirror of a GitHub repository up to date, cloning it the first time. Does
 * nothing for a local repository, which is its own mirror. Two callers at once share one
 * fetch.
 */
export function syncMirror(repository: string): Promise<void> {
  if (!repository.startsWith("github:")) return Promise.resolve();
  const running = syncing.get(repository);
  if (running) return running;
  const run = fetchMirror(repository).finally(() => syncing.delete(repository));
  syncing.set(repository, run);
  return run;
}

async function fetchMirror(repository: string): Promise<void> {
  if (!settings?.github || !hub) throw new Error(`${repository} needs GitHub credentials`);
  const { owner, repo } = parseRepository(repository);
  const dir = mirrorDir(repository);
  const url = `${settings.github.gitUrl.replace(/\/$/, "")}/${owner}/${repo}.git`;
  // The token goes to git through the environment, so it is in no command line and in no
  // file: the mirror's config holds the address only.
  const token = await hub.token();
  const env: Record<string, string> = url.startsWith("http")
    ? {
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "http.extraHeader",
        GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
        GIT_TERMINAL_PROMPT: "0",
      }
    : { GIT_TERMINAL_PROMPT: "0" };
  if (!existsSync(join(dir, "HEAD"))) {
    await mkdir(dir, { recursive: true });
    await git(dir, ["init", "--bare", "--quiet", dir]);
    await git(dir, ["remote", "add", "origin", url]);
  }
  try {
    await git(
      dir,
      [
        "fetch",
        "--quiet",
        "--prune",
        "origin",
        "+refs/heads/*:refs/heads/*",
        "+refs/tags/*:refs/tags/*",
      ],
      { env },
    );
  } catch (err) {
    // Git's message can repeat the address and headers. Neither belongs in a log.
    (err as Error).message = String((err as Error).message).replace(
      /basic [A-Za-z0-9+/=]+/g,
      "basic [token]",
    );
    throw new Error(`The mirror of ${repository} could not be fetched`, { cause: err });
  }
}
