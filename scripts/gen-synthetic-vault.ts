// Generates a large synthetic vault with realistic link density for scale and latency tests.
//   node scripts/gen-synthetic-vault.ts [outDir] [noteCount]
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { buildNoteText } from "../packages/okf/src/note.ts";

const out = process.argv[2] ?? "bench-out/synthetic-vault";
const count = Number(process.argv[3] ?? 20000);

let seed = 20260924;
const rand = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const pick = <T>(xs: T[]): T => xs[Math.floor(rand() * xs.length)]!;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ulid = () => "01J9" + Array.from({ length: 22 }, () => pick([...CROCKFORD])).join("");

const WORDS = (
  "account access approval audit balance billing campus contact course deadline deposit document email enrollment " +
  "error export field form grade import invoice ledger login mapping payment policy portal record refund report " +
  "request review role schedule semester status student sync term ticket transcript upload user vendor workflow"
).split(" ");
const VERBS =
  "open check update create review approve export reconcile verify send close assign".split(" ");

const namespaces = Array.from({ length: 10 }, (_, i) => `team-${i + 1}`);
const themes = Array.from({ length: 20 }, (_, i) => `theme-${i + 1}`);
const systems = Array.from({ length: 20 }, (_, i) => `system-${i + 1}`);
const tags = Array.from({ length: 50 }, (_, i) => `tag-${i + 1}`);
const types = [
  "How-To",
  "How-To",
  "How-To",
  "Process",
  "Explanation",
  "Reference",
  "Policy",
  "Runbook",
];

const sentence = () => {
  const n = 8 + Math.floor(rand() * 12);
  const w = Array.from({ length: n }, () => pick(WORDS));
  w[0] = w[0]![0]!.toUpperCase() + w[0]!.slice(1);
  return w.join(" ") + ".";
};
const paragraph = () => Array.from({ length: 3 + Math.floor(rand() * 4) }, sentence).join(" ");

rmSync(out, { recursive: true, force: true });
const write = (p: string, c: string) => {
  const f = join(out, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, c);
};

write(
  ".kb/profile.yaml",
  `okf_version: "0.2"\ntitle: Synthetic vault\nteams: [${namespaces.join(", ")}]\n`,
);
write(
  ".kb/namespaces.yaml",
  namespaces
    .map((n) => `${n}:\n  title: ${n}\n  description: Synthetic namespace ${n}.\n  owner: ${n}\n`)
    .join(""),
);
write(
  ".kb/tags.yaml",
  tags.map((t) => `${t}: { description: Synthetic tag., aliases: [] }\n`).join(""),
);
for (const [folder, type, list] of [
  ["_themes", "Theme", themes],
  ["_systems", "System", systems],
] as const) {
  for (const slug of list) {
    write(
      `kb/${folder}/${slug}.md`,
      buildNoteText(
        {
          type,
          title: slug.replace("-", " "),
          description: `Hub for ${slug}.`,
          id: `kb_${ulid()}`,
          version: "1.0.0",
        },
        `# Overview\n\n${paragraph()}\n\n# Members\n\n<!-- kb:members:start -->\n<!-- kb:members:end -->\n`,
      ),
    );
  }
}

const paths: string[] = [];
const titles = new Set<string>();
for (let i = 0; i < count; i++) {
  const ns = namespaces[i % namespaces.length]!;
  let title = `${pick(VERBS)} ${pick(WORDS)} ${pick(WORDS)} ${i}`;
  title = title[0]!.toUpperCase() + title.slice(1);
  titles.add(title);
  const folder = rand() < 0.3 ? `/${pick(["guides", "runbooks", "reference"])}` : "";
  paths.push(`/${ns}${folder}/note-${i}.md`);
}

for (let i = 0; i < count; i++) {
  const path = paths[i]!;
  const ns = path.split("/")[1]!;
  const noteThemes = [...new Set([pick(themes), ...(rand() < 0.3 ? [pick(themes)] : [])])];
  const noteSystems =
    rand() < 0.7 ? [...new Set([pick(systems), ...(rand() < 0.3 ? [pick(systems)] : [])])] : [];
  const links = Array.from({ length: 2 + Math.floor(rand() * 5) }, () => {
    // Most links stay near: same namespace, nearby notes.
    const j =
      rand() < 0.7
        ? Math.max(0, Math.min(count - 1, i + Math.floor((rand() - 0.5) * 200)))
        : Math.floor(rand() * count);
    return `- [Related ${j}](${paths[j]})`;
  });
  if (rand() < 0.02) links.push(`- [Not written yet](/${ns}/wanted-${i}.md)`);
  const sections = ["When to use this", "Steps", "Details"].slice(0, 1 + Math.floor(rand() * 3));
  const body =
    sections
      .map(
        (s) =>
          `# ${s}\n\n${s === "Steps" ? Array.from({ length: 4 }, (_, k) => `${k + 1}. ${sentence()}`).join("\n") : paragraph()}\n`,
      )
      .join("\n") + `\n# Related\n\n- [Hub](/_themes/${noteThemes[0]}.md)\n${links.join("\n")}\n`;
  write(
    `kb${path}`,
    buildNoteText(
      {
        type: pick(types),
        title: `${pick(VERBS)} ${pick(WORDS)} ${pick(WORDS)} ${i}`.replace(/^\w/, (c) =>
          c.toUpperCase(),
        ),
        description: sentence(),
        id: `kb_${ulid()}`,
        version: "1.0.0",
        themes: noteThemes,
        ...(noteSystems.length ? { systems: noteSystems } : {}),
        tags: [...new Set(Array.from({ length: Math.floor(rand() * 4) }, () => pick(tags)))],
        generated: { by: "human:synthetic", at: "2026-01-01T00:00:00Z" },
      },
      body,
    ),
  );
}
console.log(`Wrote ${count} notes to ${out}`);
