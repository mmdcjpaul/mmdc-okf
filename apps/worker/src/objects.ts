import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Where asset bytes live, keyed by blob SHA. Production uses the Lightsail bucket (S3 API);
 * locally the store is a folder, so the Library runs without MinIO.
 */
export interface ObjectStore {
  has(key: string): Promise<boolean>;
  put(key: string, bytes: Uint8Array): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
}

export class FsObjectStore implements ObjectStore {
  readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
  }

  private pathOf(key: string): string {
    if (!/^[0-9a-f]{40,64}$/.test(key)) throw new Error(`Invalid object key ${key}`);
    return join(this.dir, key.slice(0, 2), key.slice(2));
  }

  async has(key: string): Promise<boolean> {
    try {
      await stat(this.pathOf(key));
      return true;
    } catch {
      return false;
    }
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const p = this.pathOf(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, bytes);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(this.pathOf(key)));
    } catch {
      return null;
    }
  }
}
