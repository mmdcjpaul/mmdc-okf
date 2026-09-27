#!/usr/bin/env node
// Writes the inputs of fixtures/vault-dirty: a shared _base vault plus one failing case per
// lint rule. Expected issues and --fix outputs are produced by `update-dirty-goldens.ts`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../fixtures/vault-dirty");

const fm = (lines) => `---\n${lines.join("\n")}\n---\n`;
const ok = (extra = [], { id = "kb_01J9ZAAAAAAAAAAAAAAAAAAAAA", title = "A note", type = "How-To" } = {}) =>
  fm([`type: ${type}`, `title: ${title}`, "description: A note used by a lint test.", `id: ${id}`, "version: 1.0.0", "themes: [general]", ...extra]);
const hubLink = "\n# Related\n\n- [General](/_themes/general.md)\n";
const words = (n) => Array.from({ length: n }, (_, i) => ["alpha", "beta", "gamma", "delta", "epsilon"][i % 5]).join(" ");

const base = {
  ".kb/profile.yaml": `okf_version: "0.2"\nteams: [team-a]\ncustom_fields:\n  - { name: audience, type: enum, values: [all-staff, managers], required: false }\n`,
  ".kb/namespaces.yaml": "docs:\n  title: Docs\n  description: Test namespace.\n  owner: team-a\n",
  ".kb/tags.yaml": "alpha: { description: First tag., aliases: [alfa] }\nbeta: { description: Second tag., aliases: [] }\n",
  "kb/_themes/general.md": fm([
    "type: Theme", "title: General", "description: Everything.", "id: kb_01J9ZBASE0000000000000000T", "version: 1.0.0", "aliases: [misc]",
  ]) + "\n# Overview\n\nThe general hub.\n\n# Members\n\n<!-- kb:members:start -->\n<!-- kb:members:end -->\n",
  "kb/_systems/tooling.md": fm([
    "type: System", "title: Tooling", "description: Internal tools.", "id: kb_01J9ZBASE0000000000000000S", "version: 1.0.0",
  ]) + "\n# Overview\n\nThe tooling hub.\n\n# Members\n\n<!-- kb:members:start -->\n<!-- kb:members:end -->\n",
};

const cases = {
  "okf/frontmatter": {
    "kb/docs/broken-yaml.md": "---\ntype: How-To\ntitle: [unclosed\n---\n\nBody.\n",
    "kb/docs/no-frontmatter.md": "# Just a heading\n\nNo frontmatter here.\n",
    "kb/docs/no-type.md": fm(["title: Missing type"]) + "\nBody.\n",
  },
  "okf/reserved-files": {
    "kb/index.md": "# Root index without okf_version\n",
    "kb/docs/index.md": fm(["title: Not allowed"]) + "\n# Docs\n",
    "kb/docs/log.md": "# Docs log\n\n## 2026-01-01\n\n- Old entry.\n\n## 2026-03-01\n\n- Out of order.\n\n## March 2026\n\n- Not a date.\n",
    "kb/docs/a-note.md": ok() + hubLink,
  },
  "lore/required": {
    "kb/docs/missing-fields.md": fm(["type: How-To", "title: Missing fields", "themes: [general]", "status: draft"]) + hubLink,
  },
  "lore/id-format": { "kb/docs/bad-id.md": ok([], { id: "kb_123" }) + hubLink },
  "lore/version-format": {
    "kb/docs/bad-version.md": ok().replace("version: 1.0.0", "version: \"1.0\"") + hubLink,
  },
  "lore/status": { "kb/docs/bad-status.md": ok(["status: published"]) + hubLink },
  "lore/provenance": {
    "kb/docs/bad-provenance.md": ok(["generated: { by: mreyes, at: yesterday }", "verified: [{ by: human:x }]", "stale_after: soon"]) + hubLink,
  },
  "lore/vocabulary": {
    "kb/docs/unknown-terms.md":
      fm([
        "type: Howto", "title: Unknown terms", "description: Uses terms that are not in the vocabulary.",
        "id: kb_01J9ZAAAAAAAAAAAAAAAAAAAAA", "version: 1.0.0", "themes: [misc, general]", "systems: [toolz]",
        "tags: [alfa, gamma]", "owner: team-z",
      ]) + hubLink,
  },
  "lore/limits": {
    "kb/docs/too-many.md": ok().replace("themes: [general]", "themes: [general, t2, t3, t4]") + hubLink,
    "kb/docs/too-many-tags.md": ok(["tags: [a, b, c, d, e, f, g, h, i]"], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Too many tags" }) + hubLink,
  },
  "lore/namespace": {
    "kb/root-note.md": ok() + hubLink,
    "kb/unregistered/note.md": ok([], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Unregistered" }) + hubLink,
    "kb/_drafts/note.md": ok([], { id: "kb_01J9ZCCCCCCCCCCCCCCCCCCCCC", title: "Drafts folder" }) + hubLink,
  },
  "lore/custom-fields": { "kb/docs/bad-audience.md": ok(["audience: everyone"]) + hubLink },
  "lore/wikilinks": {
    "kb/docs/target-note.md": ok([], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Target note" }) + hubLink,
    "kb/docs/uses-wikilinks.md":
      ok() + "\nSee [[Target note]] and [[Missing thing|a missing page]] and [[General#Overview]].\n\n`[[not a link in code]]`\n" + hubLink,
  },
  "lore/link-targets": {
    "kb/docs/broken-links.md": ok() + "\nSee [missing](/docs/missing.md), [outside](../../README.md), and [external](https://example.com).\n" + hubLink,
  },
  "lore/hub-link": { "kb/docs/no-hub.md": ok() + "\nA note with no links at all.\n" },
  "lore/link-style": {
    "kb/docs/target.md": ok([], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Target" }) + hubLink,
    "kb/docs/relative-links.md":
      ok() +
      "\nSee [target](./target.md#steps), [hub](../_themes/general.md), [folder](./), and [absolute](/docs/target.md).\n",
  },
  "lore/word-count": {
    "kb/docs/long.md": ok() + `\n${words(1300)}\n` + hubLink,
    "kb/docs/too-long.md": ok([], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Too long" }) + `\n${words(2600)}\n\n\`\`\`\n${words(3000)}\n\`\`\`\n` + hubLink,
  },
  "lore/duplicate-id": {
    "kb/docs/first.md": ok([], { title: "First" }) + hubLink,
    "kb/docs/second.md": ok([], { title: "Second" }) + hubLink,
  },
  "lore/duplicate-title": {
    "kb/docs/one.md": ok([], { title: "Same title" }) + hubLink,
    "kb/docs/two.md": ok([], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "same Title" }) + hubLink,
  },
  "lore/deprecated": {
    "kb/docs/no-successor.md": ok(["status: deprecated"]) + hubLink,
    "kb/docs/missing-successor.md":
      ok(["status: deprecated", "superseded_by: /docs/does-not-exist.md"], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Missing successor" }) + hubLink,
  },
  "lore/action": {
    "kb/docs/bad-action.md":
      ok(["execution: sometimes", "parameters:", "  - { name: Record-ID, type: uuid }", "executor: { receipt: [id] }"], { type: "Action" }) +
      "\n# When to use\n\nNever.\n\n# Manual procedure\n\n1. Do it by hand.\n" + hubLink,
    "kb/docs/approval-action.md":
      ok(["execution: approval", "risk: high", "parameters: []", "executor: { resource: gateway://tools/x }"], { id: "kb_01J9ZBBBBBBBBBBBBBBBBBBBBB", title: "Approval action", type: "Action" }) +
      "\n# Manual procedure\n\n1. Ask someone.\n\n# Rollback\n\nNothing to undo.\n" + hubLink,
  },
  "lore/request-type": {
    "kb/docs/bad-request.md":
      ok(["kind: ask", "route_to: team-a", "follow_up_after: 2 days", "runbook: /docs/missing-runbook.md", "fields:", "  - { name: choice, type: select, required: true }", "  - { name: choice, type: colour }"], { type: "Request Type" }) +
      "\n# What happens next\n\nSomething.\n" + hubLink,
  },
  "lore/secrets": {
    "kb/docs/leaks.md": ok() + "\nConnect with postgres://admin:hunter2secret@db.internal.example:5432/app to debug.\n" + hubLink,
  },
  "lore/images": {
    ".kb/profile.yaml": `okf_version: "0.2"\nteams: [team-a]\nlimits: { image_max_mb: 0.001 }\n`,
    "kb/docs/_assets/big.png": "x".repeat(2048),
    "kb/docs/images.md": ok() + "\n![missing](/docs/_assets/missing.png)\n\n![big](/docs/_assets/big.png)\n\n![remote](https://example.com/a.png)\n" + hubLink,
  },
  "lore/hub-members": {
    "kb/docs/member.md": ok() + hubLink,
  },
};

rmSync(ROOT, { recursive: true, force: true });
const write = (path, content) => {
  const full = join(ROOT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
};
for (const [path, content] of Object.entries(base)) write(`_base/${path}`, content);
for (const [rule, files] of Object.entries(cases)) {
  for (const [path, content] of Object.entries(files)) write(`${rule}/input/${path}`, content);
}
console.log(`Wrote ${Object.keys(cases).length} cases to ${ROOT}`);
