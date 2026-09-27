import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initBareRepo, LocalGitProvider } from "@lore/git";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { github, mirrorFor, providerFor, setupGit, syncMirror } from "../src/git.ts";

/**
 * The mirror of a repository that lives elsewhere. A folder of bare repositories stands in
 * for GitHub's git server here; fetching over HTTPS with a token is what the live job checks.
 */
describe("mirrors", () => {
  let dir: string;
  let remote: string;
  const origin = new LocalGitProvider();
  const vault = () => ({ id: "acme", repository: `local:${remote}`, branch: "main" });
  const add = async (path: string, content: string) =>
    (
      (await origin.commit(vault(), {
        ops: [{ op: "put", path, content }],
        message: `Add ${path}`,
        expectedHead: await origin.head(vault()),
      })) as { sha: string }
    ).sha;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "lore-mirror-"));
    remote = join(dir, "remotes/acme/kb.git");
    execFileSync("mkdir", ["-p", join(dir, "remotes/acme")]);
    await initBareRepo(remote);
    setupGit({
      dataDir: join(dir, "data"),
      github: { auth: { token: "ghs_test" }, gitUrl: `file://${join(dir, "remotes")}` },
    });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("is cloned the first time, and brought up to date after that", async () => {
    const first = await add("kb/a.md", "# A\n");
    await syncMirror("github:acme/kb");
    const mirror = mirrorFor("github:acme/kb");
    expect(mirror.gitDir).toBe(join(dir, "data/mirrors/acme__kb.git"));
    expect(await mirror.resolve("refs/heads/main")).toBe(first);

    const second = await add("kb/b.md", "# B\n");
    expect(await mirror.resolve("refs/heads/main")).toBe(first);
    await syncMirror("github:acme/kb");
    expect(await mirror.resolve("refs/heads/main")).toBe(second);
    expect((await mirror.listTree(second)).map((e) => e.path)).toEqual(["kb/a.md", "kb/b.md"]);
  });

  it("follows a branch that was rewritten, and tags", async () => {
    execFileSync("git", ["--git-dir", remote, "tag", "vault-2026-09", "main"]);
    execFileSync("git", ["--git-dir", remote, "update-ref", "refs/heads/main", "main~1"]);
    await syncMirror("github:acme/kb");
    const mirror = mirrorFor("github:acme/kb");
    expect(await mirror.resolve("refs/heads/main")).toBe(
      execFileSync("git", ["--git-dir", remote, "rev-parse", "main"], { encoding: "utf8" }).trim(),
    );
    expect(await mirror.resolve("refs/tags/vault-2026-09")).not.toBeNull();
  });

  it("two callers at once share one fetch", async () => {
    const a = syncMirror("github:acme/kb");
    const b = syncMirror("github:acme/kb");
    expect(a).toBe(b);
    await Promise.all([a, b]);
  });

  it("keeps the token out of the mirror's files", async () => {
    const config = execFileSync(
      "git",
      ["--git-dir", join(dir, "data/mirrors/acme__kb.git"), "config", "--list", "--local"],
      { encoding: "utf8" },
    );
    expect(config).not.toContain("ghs_test");
    expect(config).not.toMatch(/extraheader/i);
  });

  it("says which repository could not be fetched, and nothing about the token", async () => {
    await expect(syncMirror("github:acme/missing")).rejects.toThrow(
      "The mirror of github:acme/missing could not be fetched",
    );
  });

  it("has nothing to do for a local repository", async () => {
    await syncMirror(`local:${remote}`);
    expect(mirrorFor(`local:${remote}`).gitDir).toBe(remote);
  });

  it("gives the provider for each kind of repository", () => {
    expect(providerFor(`local:${remote}`)).toBeInstanceOf(LocalGitProvider);
    expect(providerFor("github:acme/kb")).toBe(github());
    expect(() => providerFor("gitlab:acme/kb")).toThrow(/Unknown kind/);
    setupGit({ dataDir: join(dir, "data") });
    expect(() => providerFor("github:acme/kb")).toThrow(/needs GitHub credentials/);
  });
});
