import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.ts";

export type Db = PostgresJsDatabase<typeof schema> & { $client: postgres.Sql };

export interface DbOptions {
  /** Pool size. The web app and worker each keep a small pool. */
  max?: number;
}

/** Opens a pooled connection. Call {@link closeDb} on shutdown. */
export function createDb(url: string, opts: DbOptions = {}): Db {
  const client = postgres(url, { max: opts.max ?? 10, onnotice: () => {} });
  return drizzle(client, { schema }) as Db;
}

export async function closeDb(db: Db): Promise<void> {
  await db.$client.end({ timeout: 5 });
}
