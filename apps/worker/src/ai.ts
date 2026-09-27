/** The model gateway for this process, built from configuration and settings. */
import {
  AiSdkModelProvider,
  AiSettings,
  decryptSecret,
  FakeModelProvider,
  loadScripts,
  ModelGateway,
  parseEncryptionKey,
  scriptedProvider,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type UsageStore,
} from "@lore/ai";
import { getSetting, recordUsage, spentSince, type Db } from "@lore/db";
import type { Config } from "./config.ts";

export const AI_SETTINGS_KEY = "ai";

export async function aiSettings(db: Db): Promise<AiSettings> {
  return AiSettings.parse((await getSetting<unknown>(db, AI_SETTINGS_KEY)) ?? {});
}

export function usageStore(db: Db): UsageStore {
  return {
    record: (row) => recordUsage(db, row),
    spentSince: (since, filter) => spentSince(db, since, filter),
  };
}

/** Providers built from the keys in settings. Rebuilt when the keys change. */
class LiveProvider implements ModelProvider {
  private readonly db: Db;
  private readonly key: Buffer;
  private built: { fingerprint: string; provider: AiSdkModelProvider } | null = null;

  constructor(db: Db, key: Buffer) {
    this.db = db;
    this.key = key;
  }

  /** Reads the keys again. Called before each use, so a key saved in Admin works at once. */
  async refresh(): Promise<AiSdkModelProvider> {
    const stored = (await aiSettings(this.db)).keys;
    const fingerprint = JSON.stringify(stored);
    if (this.built?.fingerprint !== fingerprint) {
      const keys: Record<string, string> = {};
      for (const [provider, value] of Object.entries(stored)) {
        if (value) keys[provider] = decryptSecret(value, this.key, `keys.${provider}`);
      }
      this.built = { fingerprint, provider: new AiSdkModelProvider(keys) };
    }
    return this.built.provider;
  }

  available(provider: string): boolean {
    return this.built?.provider.available(provider) ?? false;
  }

  async generate<T>(
    provider: string,
    model: string,
    request: ModelRequest<T>,
  ): Promise<ModelResponse<T>> {
    return (await this.refresh()).generate(provider, model, request);
  }
}

export interface Ai {
  gateway: ModelGateway;
  /** The scripted provider when AI_MODE=fake, so tests can see what was called. */
  fake: FakeModelProvider | null;
  /** Reads provider keys from settings again. */
  refresh(): Promise<void>;
}

export function createAi(config: Config, db: Db): Ai {
  let provider: ModelProvider;
  let fake: FakeModelProvider | null = null;
  let refresh = async () => {};
  if (config.AI_MODE === "live") {
    const live = new LiveProvider(db, parseEncryptionKey(config.APP_ENCRYPTION_KEY!));
    provider = live;
    refresh = async () => void (await live.refresh());
  } else {
    fake = scriptedProvider(config.AI_MODE === "fake" ? loadScripts(config.AI_FAKE_SCRIPTS) : []);
    provider = fake;
  }
  return {
    fake,
    refresh,
    gateway: new ModelGateway({
      mode: config.AI_MODE,
      provider,
      settings: () => aiSettings(db),
      usage: usageStore(db),
    }),
  };
}
