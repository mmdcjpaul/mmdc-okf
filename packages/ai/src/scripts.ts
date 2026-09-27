import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { FakeModelProvider, type Script } from "./fake.ts";

/**
 * A scripted answer on disk, for running Lore with `AI_MODE=fake`. The first script whose
 * conditions all hold answers the call.
 */
export interface ScriptFile {
  /** What this script stands in for, for people reading the folder. */
  name: string;
  when: {
    /** Text the instructions must contain, which tells tasks apart. */
    instructions?: string;
    /** Text the input must contain, which tells documents apart. */
    input?: string;
    /** Whether the call must carry files (a PDF or images). */
    images?: boolean;
  };
  output: unknown;
}

export function loadScripts(dir: string): ScriptFile[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as ScriptFile);
}

/** A fake provider that answers from a folder of scripts, and fails calls nothing matches. */
export function scriptedProvider(scripts: ScriptFile[]): FakeModelProvider {
  return new FakeModelProvider().otherwise((call): Script => {
    const hit = scripts.find(
      (s) =>
        (s.when.instructions === undefined || call.instructions.includes(s.when.instructions)) &&
        (s.when.input === undefined || call.input.includes(s.when.input)) &&
        (s.when.images === undefined || s.when.images === call.images > 0),
    );
    return hit
      ? { output: hit.output }
      : { error: new Error("No script matches this call (AI_MODE=fake)") };
  });
}
