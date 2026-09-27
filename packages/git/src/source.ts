import type { FileSource } from "@lore/okf";
import type { Mirror } from "./mirror.ts";
import type { TreeEntry } from "./types.ts";

const TEXT_EXT = /\.(md|markdown|ya?ml|json|txt|csv|html|svg|toml)$/i;

/**
 * A `FileSource` over one commit of a repository, so `@lore/okf` can load a vault straight
 * from Git without a working copy. Text files under `prefixes` are read in one batch.
 */
export class GitTreeSource implements FileSource {
  readonly ref: string;
  private readonly mirror: Mirror;
  private entries: Map<string, TreeEntry> | null = null;
  private texts = new Map<string, string>();

  constructor(mirror: Mirror, ref: string) {
    this.mirror = mirror;
    this.ref = ref;
  }

  /** Lists the tree and preloads text files whose path starts with one of `prefixes`. */
  async load(prefixes: string[]): Promise<this> {
    const tree = await this.mirror.listTree(this.ref);
    this.entries = new Map(tree.map((e) => [e.path, e]));
    const wanted = tree.filter(
      (e) => TEXT_EXT.test(e.path) && prefixes.some((p) => e.path.startsWith(p)),
    );
    const blobs = await this.mirror.readBlobs(wanted.map((e) => e.blobSha));
    const decoder = new TextDecoder();
    for (const e of wanted) {
      const b = blobs.get(e.blobSha);
      if (b) this.texts.set(e.path, decoder.decode(b));
    }
    return this;
  }

  tree(): Map<string, TreeEntry> {
    if (!this.entries) throw new Error("GitTreeSource.load() has not run");
    return this.entries;
  }

  async list(prefix: string): Promise<string[]> {
    return [...this.tree().keys()].filter((p) => p.startsWith(prefix)).sort();
  }

  async read(path: string): Promise<string | Uint8Array | null> {
    const cached = this.texts.get(path);
    if (cached !== undefined) return cached;
    const entry = this.tree().get(path);
    if (!entry) return null;
    const bytes = (await this.mirror.readBlobs([entry.blobSha])).get(entry.blobSha) ?? null;
    if (bytes && TEXT_EXT.test(path)) {
      const text = new TextDecoder().decode(bytes);
      this.texts.set(path, text);
      return text;
    }
    return bytes;
  }

  async blobSha(path: string): Promise<string | null> {
    return this.tree().get(path)?.blobSha ?? null;
  }
}
