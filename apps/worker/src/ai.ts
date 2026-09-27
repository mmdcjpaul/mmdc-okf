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
  splitModelRef,
  taskConfig,
  TASKS,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type UsageStore,
} from "@lore/ai";
import { getSetting, recordUsage, spentSince, type Db } from "@lore/db";
import { z } from "zod";
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

export interface KeyTest {
  ok: boolean;
  /** The model that was asked, or null when no task uses this provider. */
  model: string | null;
  message: string;
  latencyMs: number;
}

export interface Ai {
  gateway: ModelGateway;
  /** Makes one small call with a provider's stored key, to see that the key works. */
  testKey(provider: string): Promise<KeyTest>;
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
    // A connection test has no script of its own; any key "works" against the fake.
    fake.otherwise((call) =>
      call.instructions.startsWith("Reply with ok") ? { output: { ok: true } } : undefined,
    );
    provider = fake;
  }
  const testKey = async (name: string): Promise<KeyTest> => {
    const settings = await aiSettings(db);
    const model =
      TASKS.map((t) => taskConfig(settings, t))
        .flatMap((c) => [c.primary, c.fallback])
        .find((m): m is string => !!m && splitModelRef(m).provider === name) ?? null;
    if (config.AI_MODE === "off")
      return { ok: false, model, message: "AI is turned off (AI_MODE=off)", latencyMs: 0 };
    await refresh();
    if (!provider.available(name))
      return { ok: false, model, message: `No key is saved for ${name}`, latencyMs: 0 };
    if (!model)
      return {
        ok: false,
        model,
        message: `No task uses ${name}, so there is no model to test the key with`,
        latencyMs: 0,
      };
    const started = Date.now();
    try {
      await provider.generate(name, splitModelRef(model).model, {
        instructions: "Reply with ok set to true.",
        input: "This is a connection test.",
        schema: z.object({ ok: z.boolean() }),
        maxOutputTokens: 200,
        signal: AbortSignal.timeout(30_000),
      });
      return { ok: true, model, message: "The key works", latencyMs: Date.now() - started };
    } catch (err) {
      // Provider errors can quote the request; a key must never come back in a message.
      const message = ((err as Error).message ?? "The call failed")
        .replace(/(sk|key|AIza)[-_A-Za-z0-9]{8,}/g, "[key]")
        .slice(0, 300);
      return { ok: false, model, message, latencyMs: Date.now() - started };
    }
  };
  return {
    fake,
    refresh,
    testKey,
    gateway: new ModelGateway({
      mode: config.AI_MODE,
      provider,
      settings: () => aiSettings(db),
      usage: usageStore(db),
    }),
  };
}
