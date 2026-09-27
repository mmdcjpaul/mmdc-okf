/**
 * The worker process: runs index jobs from pg-boss, polls vaults for pushes made outside Lore,
 * and serves /health and the internal API. Shuts down gracefully on SIGINT and SIGTERM.
 */
import { createServer } from "node:http";
import {
  changesetsToProcess,
  failStuckGardenerRuns,
  getFeatures,
  listIngestItems,
  listVaults,
} from "@lore/db";
import { createApi } from "./api.ts";
import { collectQuestions, queueQuestions } from "./batch/doc2query.ts";
import { batchTick } from "./batch/tick.ts";
import { aiSettings } from "./ai.ts";
import { applyIndexEffects } from "./changesets/effects.ts";
import { processChangeset, type ChangesetDeps } from "./changesets/process.ts";
import { loadConfig } from "./config.ts";
import { indexVault } from "./indexer/index-vault.ts";
import { processIngestItem, type IngestDeps } from "./ingest/process.ts";
import { refreshHealth } from "./indexer/refresh-stale.ts";
import { runGardener } from "./gardener/run.ts";
import { sendDigests } from "./notify/digest.ts";
import { sendNotificationEmails } from "./notify/emails.ts";
import { createMailer } from "./notify/mailer.ts";
import {
  createRuntime,
  enqueueChangeset,
  enqueueGardener,
  enqueueIndex,
  enqueueIngest,
  mirrorFor,
  providerFor,
  QUEUES,
  startBoss,
  VAULT_INDEXED,
  type ChangesetJobData,
  type GardenerJobData,
  type IndexJobData,
  type IngestJobData,
} from "./runtime.ts";

const config = loadConfig();
const rt = await createRuntime(config);
const boss = await startBoss(config, rt.log);
let lastIndex: { at: string; vaultId: string; head: string | null } | null = null;

// Jobs are picked up within half a second, so a saved note is on its page in a moment.
const POLL = { pollingIntervalSeconds: 0.5 };

const questionDeps = {
  db: rt.db,
  meili: rt.deps.meili,
  embedder: rt.deps.embedder,
  gateway: rt.ai.gateway,
  settings: () => aiSettings(rt.db),
  log: rt.log,
};

await boss.work<IndexJobData>(QUEUES.index, POLL, async ([job]) => {
  if (!job) return;
  const result = await indexVault(rt.deps, job.data.vaultId);
  lastIndex = { at: new Date().toISOString(), vaultId: result.vaultId, head: result.head };
  const effects = await applyIndexEffects(rt.db, result);
  if (effects.resolved.length) await refreshHealth(rt.deps, result.vaultId, effects.resolved);
  if (effects.notified || effects.flagged || effects.resolved.length)
    rt.log.info(effects, "index effects");
  if (!result.skipped && config.BATCH_SCHEDULE === "on") {
    await rt.ai.refresh();
    const asked = await queueQuestions(questionDeps, result.vaultId, result.changed).catch(
      (err) => (rt.log.warn({ err }, "questions not asked for"), 0),
    );
    if (asked) rt.log.info({ vaultId: result.vaultId, notes: asked }, "questions asked for");
  }
  if (!result.skipped) {
    await boss.publish(VAULT_INDEXED, {
      vaultId: result.vaultId,
      head: result.head,
      changed: result.changed,
      processChanged: result.processChanged,
    });
  }
});

const changesetDeps: ChangesetDeps = {
  db: rt.db,
  log: rt.log,
  mirrorFor,
  providerFor: (repository) =>
    providerFor(repository, (vaultId) => enqueueIndex(boss, { vaultId, reason: "push" })),
};
await boss.work<ChangesetJobData>(QUEUES.changeset, POLL, async ([job]) => {
  if (job) await processChangeset(changesetDeps, job.data.changesetId);
});

const ingestDeps: IngestDeps = {
  db: rt.db,
  meili: rt.deps.meili,
  objects: rt.deps.objects,
  gateway: rt.ai.gateway,
  embedder: rt.deps.embedder,
  log: rt.log,
  mirrorFor,
  batch: {
    settings: () => aiSettings(rt.db),
    providers: async () => new Set((await rt.ai.batchClients()).keys()),
  },
};
await boss.work<IngestJobData>(QUEUES.ingest, POLL, async ([job]) => {
  if (!job) return;
  await rt.ai.refresh();
  const outcome = await processIngestItem(ingestDeps, job.data.itemId, {
    mode: job.data.mode ?? "now",
  });
  if (outcome.state === "done") await enqueueChangeset(boss, outcome.changesetId);
});

const gardenerDeps = {
  db: rt.db,
  meili: rt.deps.meili,
  log: rt.log,
  mirrorFor,
  onChangeset: (id: string) => enqueueChangeset(boss, id),
};
await failStuckGardenerRuns(rt.db, new Date(Date.now() - 30 * 60_000));
await boss.work<GardenerJobData>(QUEUES.gardener, async ([job]) => {
  if (!job) return;
  const { vaultId, namespace, requestedBy } = job.data;
  if (vaultId) {
    await runGardener(gardenerDeps, { vaultId, namespace, requestedBy });
    return;
  }
  // The weekly run. Admins switch it off under Branding and features.
  if (!(await getFeatures(rt.db)).gardener) return;
  for (const vault of await listVaults(rt.db))
    await runGardener(gardenerDeps, { vaultId: vault.id });
});

const tickDeps = {
  db: rt.db,
  log: rt.log,
  clients: () => rt.ai.batchClients(),
  gateway: rt.ai.gateway,
  settings: () => aiSettings(rt.db),
  usage: rt.ai.usage,
  timeZone: config.TIME_ZONE,
  startItem: (id: string) => enqueueIngest(boss, id, "batch"),
  onAnswered: async (kind: string, id: string) => {
    if (kind === "ingest") await enqueueIngest(boss, id, "batch");
    else if (kind === "doc2query") await collectQuestions(questionDeps, id);
  },
};
const runTick = async (force = false) => {
  await rt.ai.refresh();
  const tick = await batchTick(tickDeps, { force });
  if (tick.started || tick.submitted.length || tick.polled.length) rt.log.info(tick, "batch tick");
  return tick;
};
const batcher =
  config.BATCH_SCHEDULE === "on"
    ? setInterval(
        () => void runTick().catch((err) => rt.log.error({ err }, "batch tick failed")),
        60_000,
      )
    : null;

const mailer = createMailer(config);
const mail = { db: rt.db, mailer, log: rt.log, publicUrl: config.PUBLIC_URL.replace(/\/$/, "") };
if (!mailer.enabled) rt.log.info("SMTP_URL is not set: notifications stay in the app");
await boss.work(QUEUES.digest, async () => {
  rt.log.info(await sendDigests(mail), "weekly digest");
});
const emailer = setInterval(
  () =>
    void sendNotificationEmails(mail).catch((err) =>
      rt.log.error({ err }, "notification emails failed"),
    ),
  60_000,
);

/** Picks up changesets whose job was never queued or was lost, so no write is dropped. */
async function sweepChangesets(): Promise<void> {
  const stuckBefore = new Date(Date.now() - 2 * 60_000);
  for (const cs of await changesetsToProcess(rt.db, stuckBefore))
    await enqueueChangeset(boss, cs.id);
}

/**
 * Tries waiting items again: the budget may have been raised, the provider may be back.
 * Items that are queued stay queued until someone chooses Process now (AU-6).
 */
async function retryWaiting(): Promise<void> {
  for (const vault of await listVaults(rt.db)) {
    const waiting = await listIngestItems(rt.db, {
      vaultId: vault.id,
      states: ["waiting"],
      limit: 50,
    });
    for (const item of waiting) await enqueueIngest(boss, item.id);
  }
}
const retrier = setInterval(
  () => void retryWaiting().catch((err) => rt.log.error({ err }, "ingest retry failed")),
  10 * 60_000,
);
await sweepChangesets();
const sweeper = setInterval(
  () => void sweepChangesets().catch((err) => rt.log.error({ err }, "changeset sweep failed")),
  15_000,
);

async function pollAll(): Promise<void> {
  for (const v of await listVaults(rt.db))
    await enqueueIndex(boss, { vaultId: v.id, reason: "poll" });
}
await pollAll();
const poller = setInterval(
  () => void pollAll().catch((err) => rt.log.error({ err }, "poll failed")),
  config.POLL_SECONDS * 1000,
);

const api = createApi({
  db: rt.db,
  mirrorFor,
  onChangeset: (id) => enqueueChangeset(boss, id),
  onIngest: (id) => enqueueIngest(boss, id),
  testKey: (provider) => rt.ai.testKey(provider),
  onGardener: (data) => enqueueGardener(boss, data),
  onBatchTick: () => runTick(true),
  providerFor: (repository) => providerFor(repository),
  fakeCalls: () =>
    rt.ai.fake && config.AI_MODE === "fake"
      ? {
          count: rt.ai.fake.calls.length,
          last: rt.ai.fake.calls.at(-1)?.instructions.slice(0, 80) ?? null,
        }
      : null,
  onFeedback: async (vaultId, noteIds) => {
    await refreshHealth(rt.deps, vaultId, noteIds);
  },
  token: config.INTERNAL_API_TOKEN,
  health: () => ({ lastIndex }),
});
const server = createServer((req, res) => void api(req, res));
server.listen(config.WORKER_PORT, config.WORKER_HOST, () =>
  rt.log.info({ host: config.WORKER_HOST, port: config.WORKER_PORT }, "worker started"),
);

async function shutdown(signal: string) {
  rt.log.info({ signal }, "shutting down");
  clearInterval(poller);
  clearInterval(sweeper);
  clearInterval(retrier);
  clearInterval(emailer);
  if (batcher) clearInterval(batcher);
  await mailer.close?.();
  server.close();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await rt.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
