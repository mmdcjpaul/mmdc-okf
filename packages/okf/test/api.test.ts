import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  API_FILE,
  changelogHas,
  describeApi,
  packageVersion,
  recordedVersion,
} from "../scripts/api.ts";

/**
 * Plans 2 and 3 code against the exports of `@lore/okf`. This fails when that surface changes
 * without the change being recorded, which also means without a version bump and a changelog
 * entry (see scripts/api.ts).
 */
describe("public API", () => {
  const recorded = readFileSync(API_FILE, "utf8");

  it("matches the recorded surface", () => {
    const body = recorded.slice(recorded.indexOf("\n") + 1);
    expect(
      describeApi(),
      "The public API changed. Bump the version, add a CHANGELOG.md entry, then run `pnpm --filter @lore/okf api:update`.",
    ).toBe(body);
  }, 120_000);

  it("is recorded for the current version, which has a changelog entry", () => {
    expect(recordedVersion(recorded)).toBe(packageVersion());
    expect(changelogHas(packageVersion())).toBe(true);
  });

  it("has the functions the plan names", () => {
    for (const name of [
      "loadVault",
      "parseNote",
      "serializeNote",
      "trustTier",
      "isStale",
      "newNote",
      "moveNote",
      "bump",
      "verify",
      "renameTerm",
      "mergeTerms",
      "lint",
      "fix",
      "extractLinks",
      "resolveLink",
      "buildGraph",
      "generateIndexes",
      "chunkNote",
      "requestTypeSchema",
      "actionParameterSchema",
    ]) {
      expect(recorded, name).toMatch(new RegExp(`^function ${name}: `, "m"));
    }
    for (const name of ["DiskSource", "MemorySource", "OverlaySource"]) {
      expect(recorded, name).toMatch(new RegExp(`^class ${name}: `, "m"));
    }
  });
});
