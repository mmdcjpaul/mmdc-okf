import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { checkMigration } from "../src/migration-check.ts";

const DIR = fileURLToPath(new URL("../migrations", import.meta.url));
const reasons = (sql: string) => checkMigration("x.sql", sql).map((p) => p.reason);

describe("additive-only migrations", () => {
  it("accepts expanding statements", () => {
    expect(
      reasons(
        [
          'CREATE TABLE "a" ("id" text PRIMARY KEY NOT NULL);',
          "--> statement-breakpoint",
          'ALTER TABLE "notes" ADD COLUMN "stale" boolean DEFAULT false NOT NULL;',
          'ALTER TABLE "notes" ADD COLUMN "note" text;',
          'CREATE INDEX "i" ON "a" ("id");',
          'ALTER TABLE "a" ADD CONSTRAINT "fk" FOREIGN KEY ("id") REFERENCES "b"("id");',
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  it.each([
    ['DROP TABLE "a";', "drops a table"],
    ['ALTER TABLE "a" DROP COLUMN "b";', "drops a column"],
    ['ALTER TABLE "a" RENAME COLUMN "b" TO "c";', "renames"],
    ['ALTER TABLE "a" RENAME TO "z";', "renames"],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;', "required"],
    ['ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;', "type"],
    ['ALTER TABLE "a" ADD COLUMN "b" text NOT NULL;', "without a default"],
    ['TRUNCATE "a";', "deletes rows"],
  ])("refuses %s", (sql, reason) => {
    expect(reasons(sql).join("; ")).toContain(reason);
  });

  it("reports the file and line", () => {
    const [p] = checkMigration("0009_x.sql", 'CREATE TABLE "a" ();\n\nDROP TABLE "b";\n');
    expect(p).toMatchObject({ file: "0009_x.sql", line: 3 });
  });

  it("allows a contracting statement that says why it is safe", () => {
    const sql =
      '-- lore:contract no image since 1.4 reads this column\nALTER TABLE "a" DROP COLUMN "b";';
    expect(reasons(sql)).toEqual([]);
    expect(reasons('-- lore:contract\nALTER TABLE "a" DROP COLUMN "b";')).not.toEqual([]);
  });

  it("every migration after the first is additive", () => {
    const files = readdirSync(DIR)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    expect(files.length).toBeGreaterThan(1);
    const problems = files
      .slice(1)
      .flatMap((f) => checkMigration(f, readFileSync(join(DIR, f), "utf8")));
    expect(problems).toEqual([]);
  });
});
