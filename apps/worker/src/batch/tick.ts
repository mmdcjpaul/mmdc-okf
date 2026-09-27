/**
 * One turn of the batch schedule. Every two hours in working hours the items that are
 * waiting in the queue are started, their model calls are collected, and the calls are
 * sent. Every ten minutes the batches that are out are asked whether they have ended.
 */
import { listIngestItems, listVaults, getSetting, setSetting, type Db } from "@lore/db";
import {
  BATCH_EVERY_MS,
  inWorkingHours,
  pollBatches,
  submitBatches,
  type BatchDeps,
  type Polled,
  type Submitted,
} from "./schedule.ts";

export const POLL_EVERY_MS = 10 * 60_000;
const WINDOW_KEY = "batch_window";

export interface TickDeps extends BatchDeps {
  /** Starts a queued item in batch mode. */
  startItem: (itemId: string) => Promise<void>;
}

export interface Tick {
  started: number;
  submitted: Submitted[];
  polled: Polled[];
}

interface Window {
  openedAt?: string;
  polledAt?: string;
}

async function windowOf(db: Db): Promise<Window> {
  return (await getSetting<Window>(db, WINDOW_KEY)) ?? {};
}

/** `force` ignores the clock: the window opens, and the providers are asked, now. */
export async function batchTick(deps: TickDeps, opts: { force?: boolean } = {}): Promise<Tick> {
  const now = deps.now?.() ?? new Date();
  const seen = await windowOf(deps.db);
  const since = (iso?: string) => (iso ? now.getTime() - new Date(iso).getTime() : Infinity);
  const out: Tick = { started: 0, submitted: [], polled: [] };

  const open =
    opts.force || (inWorkingHours(now, deps.timeZone) && since(seen.openedAt) >= BATCH_EVERY_MS);
  if (open) {
    for (const vault of await listVaults(deps.db)) {
      const queued = await listIngestItems(deps.db, {
        vaultId: vault.id,
        states: ["queued"],
        limit: 500,
      });
      for (const item of queued) await deps.startItem(item.id);
      out.started += queued.length;
    }
    seen.openedAt = now.toISOString();
    await setSetting(deps.db, WINDOW_KEY, seen);
  }
  // What the items started in this turn ask for is sent on the next turn, a minute later,
  // when they have run.
  out.submitted = await submitBatches(deps, opts);

  if (opts.force || since(seen.polledAt) >= POLL_EVERY_MS) {
    out.polled = await pollBatches(deps);
    seen.polledAt = now.toISOString();
    await setSetting(deps.db, WINDOW_KEY, {
      ...(await windowOf(deps.db)),
      polledAt: seen.polledAt,
    });
  }
  return out;
}
