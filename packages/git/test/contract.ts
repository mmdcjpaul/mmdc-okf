/**
 * What every `GitProvider` must do (plans/02-library.md, L2). Run against the local
 * provider in `pnpm test`, and against GitHub in the nightly `live` job.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GitProvider, VaultRef } from "../src/index.ts";

export interface ContractSetup {
  provider: GitProvider;
  /** A branch with at least one commit, that the tests may write to. */
  vault: VaultRef;
  /** The full message of a commit, trimmed. */
  messageOf(sha: string): Promise<string>;
  cleanup(): Promise<void>;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

export function providerContract(name: string, setup: () => Promise<ContractSetup>): void {
  describe(`${name}: the GitProvider contract`, () => {
    let s: ContractSetup;
    // Paths are unique to the run, so a shared scratch repository can be reused.
    const dir = `contract-${Date.now().toString(36)}`;
    const head = async () => (await s.provider.head(s.vault))!;

    beforeAll(async () => {
      s = await setup();
    });
    afterAll(() => s?.cleanup());

    it("commits on the head it expects, and the branch moves to the commit", async () => {
      const before = await head();
      const res = await s.provider.commit(s.vault, {
        ops: [{ op: "put", path: `${dir}/a.md`, content: "# A\n" }],
        message: "kb(test): add A\n\nChange-Class: addition\nSource: editor\n",
        expectedHead: before,
      });
      expect(res).toEqual({ sha: expect.stringMatching(/^[0-9a-f]{40}$/) });
      expect(await head()).toBe((res as { sha: string }).sha);
      const file = await s.provider.readFile(s.vault, `${dir}/a.md`);
      expect(text(file!.content)).toBe("# A\n");
      expect(file!.blobSha).toMatch(/^[0-9a-f]{40}$/);
    });

    it("refuses a commit based on a head the branch has left", async () => {
      const stale = await head();
      const moved = (await s.provider.commit(s.vault, {
        ops: [{ op: "put", path: `${dir}/b.md`, content: "b" }],
        message: "kb(test): add B",
        expectedHead: stale,
      })) as { sha: string };
      const res = await s.provider.commit(s.vault, {
        ops: [{ op: "put", path: `${dir}/c.md`, content: "c" }],
        message: "kb(test): add C",
        expectedHead: stale,
      });
      expect(res).toEqual({ headMoved: moved.sha });
      expect(await s.provider.readFile(s.vault, `${dir}/c.md`)).toBeNull();
      expect(await head()).toBe(moved.sha);
    });

    it("deletes files, keeps binary files byte for byte, and reports what changed", async () => {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0, 1, 2, 254, 255]);
      const a = (await s.provider.commit(s.vault, {
        ops: [
          { op: "put", path: `${dir}/_assets/x.png`, content: png },
          { op: "put", path: `${dir}/d.md`, content: "d\n" },
        ],
        message: "kb(test): add an image",
        expectedHead: await head(),
      })) as { sha: string };
      const b = (await s.provider.commit(s.vault, {
        ops: [
          { op: "delete", path: `${dir}/d.md` },
          { op: "put", path: `${dir}/a.md`, content: "# A, changed\n" },
          { op: "put", path: `${dir}/e.md`, content: "e\n" },
        ],
        message: "kb(test): swap",
        expectedHead: a.sha,
      })) as { sha: string };
      expect(await s.provider.readFile(s.vault, `${dir}/d.md`)).toBeNull();
      expect((await s.provider.readFile(s.vault, `${dir}/_assets/x.png`))!.content).toEqual(png);
      // A file as it was at an earlier commit.
      expect(text((await s.provider.readFile(s.vault, `${dir}/d.md`, a.sha))!.content)).toBe("d\n");
      const diff = (await s.provider.diff(s.vault, a.sha, b.sha)).map((d) => [d.path, d.status]);
      expect(diff.sort()).toEqual([
        [`${dir}/a.md`, "M"],
        [`${dir}/d.md`, "D"],
        [`${dir}/e.md`, "A"],
      ]);
    });

    it("of two commits on the same head, one lands and the other is told the head moved", async () => {
      const base = await head();
      const both = await Promise.all(
        ["x", "y"].map((n) =>
          s.provider.commit(s.vault, {
            ops: [{ op: "put", path: `${dir}/race-${n}.md`, content: n }],
            message: `kb(test): race ${n}`,
            expectedHead: base,
          }),
        ),
      );
      const landed = both.filter((r) => "sha" in r);
      const refused = both.filter((r) => "headMoved" in r);
      expect(landed).toHaveLength(1);
      expect(refused).toEqual([{ headMoved: (landed[0] as { sha: string }).sha }]);
    });

    it("keeps the commit message, trailers and all", async () => {
      const message =
        'kb(test): update "A"\n\nWhy it changed.\n\nChange-Class: fix\nChangeset: cs_1\nSource: editor\nCo-authored-by: Bob Chan <bob@acme.test>\n';
      const res = (await s.provider.commit(s.vault, {
        ops: [{ op: "put", path: `${dir}/a.md`, content: "# A, again\n" }],
        message,
        expectedHead: await head(),
      })) as { sha: string };
      expect(await s.messageOf(res.sha)).toBe(message.trim());
    });
  });
}
