/**
 * The contract suite against GitHub, in the nightly `live` job. It needs a scratch
 * repository with at least one commit and a token that can write to it:
 *
 *   LIVE_GITHUB_REPO=owner/scratch LIVE_GITHUB_TOKEN=... pnpm --filter @lore/git test:live
 *
 * Each run works on its own branch, which it deletes afterwards.
 */
import { describe, it } from "vitest";
import { GitHubProvider } from "../../src/github.ts";
import { providerContract } from "../contract.ts";

const repo = process.env.LIVE_GITHUB_REPO;
const token = process.env.LIVE_GITHUB_TOKEN;
const api = process.env.LIVE_GITHUB_API ?? "https://api.github.com";

if (!repo || !token) {
  describe("GitHubProvider: the GitProvider contract", () => {
    it.skip("needs LIVE_GITHUB_REPO and LIVE_GITHUB_TOKEN", () => {});
  });
} else {
  const call = (method: string, path: string) =>
    fetch(`${api}/repos/${repo}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/vnd.github+json",
        "user-agent": "lore-live-tests",
      },
    });
  providerContract("GitHubProvider", async () => {
    const provider = new GitHubProvider({ auth: { token }, baseUrl: api });
    const about = (await (await call("GET", "")).json()) as { default_branch: string };
    const base = { id: "live", repository: `github:${repo}`, branch: about.default_branch };
    const from = await provider.head(base);
    if (!from) throw new Error(`${repo} needs a first commit on ${about.default_branch}`);
    const branch = `lore-live-${Date.now().toString(36)}`;
    await provider.createBranch(base, branch, from);
    return {
      provider,
      vault: { ...base, branch },
      messageOf: async (sha) =>
        (
          (await (await call("GET", `/git/commits/${sha}`)).json()) as { message: string }
        ).message.trim(),
      cleanup: async () => void (await call("DELETE", `/git/refs/heads/${branch}`)),
    };
  });
}
