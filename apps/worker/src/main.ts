/**
 * The worker process: runs index jobs from pg-boss, polls vaults for pushes made outside Lore,
 * and serves /health and the internal API. Shuts down gracefully on SIGINT and SIGTERM.
 */
import { createServer } from "node:http";
import { listVaults } from "@lore/db";
import { createApi } from "./api.ts";
import { loadConfig } from "./config.ts";
import { indexVault } from "./indexer/index-vault.ts";
import {
  createRuntime,
  enqueueIndex,
  mirrorFor,
  QUEUES,
  startBoss,
  VAULT_INDEXED,
  type IndexJobData,
} from "./runtime.ts";

const config = loadConfig();
const rt = await createRuntime(config);
const boss = await startBoss(config, rt.log);
let lastIndex: { at: string; vaultId: string; head: string | null } | null = null;

await boss.work<IndexJobData>(QUEUES.index, async ([job]) => {
  if (!job) return;
  const result = await indexVault(rt.deps, job.data.vaultId);
  lastIndex = { at: new Date().toISOString(), vaultId: result.vaultId, head: result.head };
  if (!result.skipped) {
    await boss.publish(VAULT_INDEXED, {
      vaultId: result.vaultId,
      head: result.head,
      changed: result.changed,
      processChanged: result.processChanged,
    });
  }
});

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
  server.close();
  await boss.stop({ graceful: true, timeout: 30_000 });
  await rt.close();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
