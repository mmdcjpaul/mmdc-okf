// Separate entry point (`@lore/db/migrate`) so bundlers for the web app never see the
// migrations folder. Only the worker and CLI run migrations.
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import type { Db } from "./client.ts";

export const MIGRATIONS_DIR = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies pending migrations. Migrations are additive, so this is safe to run on every start. */
export async function migrateDb(db: Db): Promise<void> {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}
