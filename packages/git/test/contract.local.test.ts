import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git, initBareRepo, LocalGitProvider } from "../src/index.ts";
import { providerContract } from "./contract.ts";

providerContract("LocalGitProvider", async () => {
  const dir = await mkdtemp(join(tmpdir(), "lore-git-contract-"));
  const repo = join(dir, "vault.git");
  await initBareRepo(repo);
  const provider = new LocalGitProvider();
  const vault = { id: "v1", repository: `local:${repo}`, branch: "main" };
  await provider.commit(vault, {
    ops: [{ op: "put", path: "README.md", content: "# Vault\n" }],
    message: "First commit",
    expectedHead: null,
  });
  return {
    provider,
    vault,
    messageOf: async (sha) => (await git(repo, ["log", "-1", "--format=%B", sha])).trim(),
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
});
