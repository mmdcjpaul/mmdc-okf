import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  GitTreeSource,
  initBareRepo,
  LocalGitProvider,
  type PushEvent,
  type VaultRef,
} from "../src/index.ts";

let dir: string;
let vault: VaultRef;
let pushes: PushEvent[];
let provider: LocalGitProvider;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lore-git-test-"));
  const repo = join(dir, "vault.git");
  await initBareRepo(repo);
  vault = { id: "v1", repository: `local:${repo}`, branch: "main" };
  pushes = [];
  provider = new LocalGitProvider({ onPush: (e) => void pushes.push(e) });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const author = { name: "Alice Reyes", email: "alice@acme.test" };

describe("LocalGitProvider", () => {
  it("commits to an empty repository and emits a push event", async () => {
    expect(await provider.head(vault)).toBeNull();
    const res = await provider.commit(vault, {
      ops: [{ op: "put", path: "kb/a.md", content: "# A\n" }],
      message: "Add A\n\nChange-Class: addition\n",
      expectedHead: null,
      author,
    });
    expect("sha" in res).toBe(true);
    const head = await provider.head(vault);
    expect(head).toBe((res as { sha: string }).sha);
    expect(pushes).toEqual([{ vaultId: "v1", before: null, after: head }]);
    const file = await provider.readFile(vault, "kb/a.md");
    expect(new TextDecoder().decode(file!.content)).toBe("# A\n");
  });

  it("refuses a commit when the head has moved", async () => {
    const first = (await provider.commit(vault, {
      ops: [{ op: "put", path: "a.md", content: "1" }],
      message: "one",
      expectedHead: null,
    })) as { sha: string };
    await provider.commit(vault, {
      ops: [{ op: "put", path: "a.md", content: "2" }],
      message: "two",
      expectedHead: first.sha,
    });
    const stale = await provider.commit(vault, {
      ops: [{ op: "put", path: "b.md", content: "3" }],
      message: "three",
      expectedHead: first.sha,
    });
    expect(stale).toEqual({ headMoved: await provider.head(vault) });
  });

  it("deletes files, stores binary files, and reports diffs", async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255]);
    const a = (await provider.commit(vault, {
      ops: [
        { op: "put", path: "kb/a.md", content: "a" },
        { op: "put", path: "kb/_assets/x.png", content: png },
      ],
      message: "add",
      expectedHead: null,
    })) as { sha: string };
    const b = (await provider.commit(vault, {
      ops: [
        { op: "delete", path: "kb/a.md" },
        { op: "put", path: "kb/b.md", content: "b" },
      ],
      message: "swap",
      expectedHead: a.sha,
    })) as { sha: string };
    expect(await provider.readFile(vault, "kb/a.md")).toBeNull();
    expect((await provider.readFile(vault, "kb/_assets/x.png"))!.content).toEqual(png);
    const diff = await provider.diff(vault, a.sha, b.sha);
    expect(diff.sort((x, y) => x.path.localeCompare(y.path))).toEqual([
      { path: "kb/a.md", status: "D" },
      { path: "kb/b.md", status: "A" },
    ]);
  });

  it("detects renames and reads trailers from the log", async () => {
    const body = "x".repeat(400);
    const a = (await provider.commit(vault, {
      ops: [{ op: "put", path: "kb/old.md", content: body }],
      message: "add",
      expectedHead: null,
    })) as { sha: string };
    await provider.commit(vault, {
      ops: [
        { op: "delete", path: "kb/old.md" },
        { op: "put", path: "kb/new.md", content: body },
      ],
      message: "Move note\n\nChange-Class: fix\nCo-authored-by: Carol <carol@acme.test>\n",
      expectedHead: a.sha,
      author,
    });
    const log = await provider.mirror(vault).log(null, "refs/heads/main");
    expect(log).toHaveLength(2);
    expect(log[0]!.files).toMatchObject([{ path: "kb/new.md", status: "R", from: "kb/old.md" }]);
    expect(log[0]!.files[0]!.oldSha).toBe(log[0]!.files[0]!.newSha);
    expect(log[0]!.trailers["change-class"]).toBe("fix");
    expect(log[0]!.authorName).toBe("Alice Reyes");
    expect(log[1]!.files).toMatchObject([{ path: "kb/old.md", status: "A" }]);
    expect(log[1]!.files[0]!.oldSha).toBeUndefined();
  });

  it("serves a commit as a FileSource", async () => {
    await provider.commit(vault, {
      ops: [
        { op: "put", path: "kb/a.md", content: "a" },
        { op: "put", path: "kb/n/b.md", content: "b" },
        { op: "put", path: "README.md", content: "r" },
      ],
      message: "add",
      expectedHead: null,
    });
    const src = await new GitTreeSource(provider.mirror(vault), "refs/heads/main").load(["kb/"]);
    expect(await src.list("kb/")).toEqual(["kb/a.md", "kb/n/b.md"]);
    expect(await src.read("kb/n/b.md")).toBe("b");
    expect(await src.read("README.md")).toBe("r");
    expect(await src.read("missing.md")).toBeNull();
  });
});
