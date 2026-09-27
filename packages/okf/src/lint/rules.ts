import { toString as mdToString } from "mdast-util-to-string";
import { findMembersBlock, hubMembers, renderMembersBlock } from "../hubs.ts";
import { initialVersion, isValidId, isValidVersion } from "../lifecycle.ts";
import { extractLinks, noteLinks, resolveLink, convertWikilinks, rewriteLinks } from "../links.ts";
import { makeHref } from "../paths.ts";
import { noteAst, str, strList, type ParsedNote } from "../note.ts";
import {
  hubKindOf,
  isManagedPath,
  namespaceOf,
  bundleSegments,
  basename,
  isReserved,
} from "../paths.ts";
import {
  ActionSchema,
  formatZodIssues,
  RequestTypeSchema,
  SourceSchema,
  StatusSchema,
  VerificationSchema,
} from "../schema.ts";
import { parseFrontmatter, splitFrontmatter } from "../frontmatter.ts";
import { readText } from "../source.ts";
import type { Issue, TermKind } from "../types.ts";
import { termLookup, hasTerm, type Vault } from "../vault.ts";
import { countWords } from "../words.ts";
import { isLoreTarget, type Rule, type RuleContext } from "./engine.ts";
import { scanSecrets } from "./secrets.ts";
import { z } from "zod";

type NewIssue = Omit<Issue, "rule" | "severity"> & { severity?: Issue["severity"] };

function issue(rule: Rule, i: NewIssue): Issue {
  return { rule: rule.id, severity: i.severity ?? rule.severity, ...i } as Issue;
}

/** Line number of a top-level frontmatter key, for pointing issues at it. */
function keyLine(note: ParsedNote, key: string): number {
  const re = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`, "m");
  const m = re.exec(note.frontmatterRaw);
  if (!m) return 1;
  return note.frontmatterRaw.slice(0, m.index).split("\n").length + 1;
}

function loreTargets(ctx: RuleContext): ParsedNote[] {
  return ctx.targets.filter((n) => isLoreTarget(ctx.vault, n));
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
}

function headings(note: ParsedNote): string[] {
  const out: string[] = [];
  for (const node of noteAst(note).children) {
    if (node.type === "heading" && node.depth <= 3) out.push(mdToString(node).trim().toLowerCase());
  }
  return out;
}

/** The type config for a note, or undefined for unknown types. */
function typeConfig(vault: Vault, note: ParsedNote) {
  const t = str(note.data, "type");
  return t ? vault.profile.types[t] : undefined;
}

// ---------------------------------------------------------------------------------------------
// OKF rules

const frontmatter: Rule = {
  id: "okf/frontmatter",
  family: "okf",
  severity: "error",
  description: "Frontmatter parses and `type` is present",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of ctx.targets) {
      const parseIssues = note.issues.filter((i) => i.rule === this.id);
      if (parseIssues.length) {
        out.push(...parseIssues);
        continue;
      }
      if (!note.hasFrontmatter) {
        out.push(
          issue(this, {
            path: note.path,
            line: 1,
            message: "Missing YAML frontmatter; every note needs at least `type`",
          }),
        );
      } else if (isEmpty(note.data.type) || typeof note.data.type !== "string") {
        out.push(issue(this, { path: note.path, line: 1, message: "Frontmatter has no `type`" }));
      }
    }
    return out;
  },
};

const LOG_HEADING_RE = /^## (\d{4}-\d{2}-\d{2})\s*$/;

const reservedFiles: Rule = {
  id: "okf/reserved-files",
  family: "okf",
  severity: "error",
  description:
    "`index.md` has no frontmatter except the root `okf_version`; `log.md` is well formed",
  async check(ctx) {
    const out: Issue[] = [];
    const { vault } = ctx;
    const rootIndex = vault.root ? `${vault.root}/index.md` : "index.md";
    for (const path of vault.reserved) {
      const text = vault.aux.get(path) ?? (await readText(vault.src, path)) ?? "";
      const split = splitFrontmatter(text);
      if (basename(path) === "index.md") {
        if (path === rootIndex) {
          if (!split.hasFrontmatter) {
            out.push(
              issue(this, {
                path,
                line: 1,
                message: 'Root index.md must declare okf_version: "0.2"',
                fixable: true,
              }),
            );
            continue;
          }
          const fm = parseFrontmatter(split.raw);
          const keys = Object.keys(fm.data);
          if (
            fm.errors.length ||
            keys.some((k) => k !== "okf_version") ||
            fm.data.okf_version !== vault.profile.okf_version
          ) {
            out.push(
              issue(this, {
                path,
                line: 1,
                message: `Root index.md frontmatter may only hold okf_version: "${vault.profile.okf_version}"`,
                fixable: true,
              }),
            );
          }
        } else if (split.hasFrontmatter) {
          out.push(
            issue(this, {
              path,
              line: 1,
              message: "index.md is reserved and must not have frontmatter",
              fixable: true,
            }),
          );
        }
      } else {
        if (split.hasFrontmatter) {
          out.push(
            issue(this, {
              path,
              line: 1,
              message: "log.md is reserved and must not have frontmatter",
            }),
          );
        }
        const lines = text.split("\n");
        let previous: string | null = null;
        lines.forEach((line, i) => {
          if (!line.startsWith("## ")) return;
          const m = LOG_HEADING_RE.exec(line);
          if (!m || Number.isNaN(Date.parse(m[1]!))) {
            out.push(
              issue(this, {
                path,
                line: i + 1,
                message: `log.md sections must be dated "## YYYY-MM-DD", found "${line.trim()}"`,
              }),
            );
            return;
          }
          if (previous !== null && m[1]! > previous) {
            out.push(
              issue(this, {
                path,
                line: i + 1,
                message: `log.md must be newest first: ${m[1]} comes after ${previous}`,
              }),
            );
          }
          previous = m[1]!;
        });
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// Lore field rules

const required: Rule = {
  id: "lore/required",
  family: "lore",
  severity: "error",
  description: "The profile's required fields are present",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      for (const key of ctx.vault.profile.required) {
        if (
          key === "themes" &&
          ["Theme", "System", "Source Document"].includes(str(note.data, "type") ?? "")
        ) {
          // Hubs define themes and systems; source documents inherit context from the notes that cite them.
          continue;
        }
        if (isEmpty(note.data[key])) {
          out.push(
            issue(this, {
              path: note.path,
              line: 1,
              message: `Missing required field "${key}"`,
              fixable: key === "id" || key === "version",
              data: { key },
            }),
          );
        }
      }
    }
    return out;
  },
  fix(fc, issues) {
    for (const i of issues) {
      const key = i.data?.key;
      fc.update(i.path, (note) => {
        if (key === "id" && isEmpty(note.data.id)) note.data.id = fc.newId();
        if (key === "version" && isEmpty(note.data.version))
          note.data.version = initialVersion(str(note.data, "status"));
      });
    }
  },
};

const idFormat: Rule = {
  id: "lore/id-format",
  family: "lore",
  severity: "error",
  description: "`id` is the profile prefix plus a ULID",
  check(ctx) {
    const prefix = ctx.vault.profile.id_prefix;
    return loreTargets(ctx)
      .filter((n) => !isEmpty(n.data.id) && !isValidId(n.data.id, prefix))
      .map((n) =>
        issue(this, {
          path: n.path,
          line: keyLine(n, "id"),
          message: `Invalid id "${String(n.data.id)}"; expected ${prefix} plus a 26-character ULID`,
        }),
      );
  },
};

const versionFormat: Rule = {
  id: "lore/version-format",
  family: "lore",
  severity: "error",
  description: "`version` is MAJOR.MINOR.PATCH",
  check(ctx) {
    return loreTargets(ctx)
      .filter((n) => !isEmpty(n.data.version) && !isValidVersion(n.data.version))
      .map((n) =>
        issue(this, {
          path: n.path,
          line: keyLine(n, "version"),
          message: `Invalid version "${String(n.data.version)}"; expected MAJOR.MINOR.PATCH such as 1.0.0`,
        }),
      );
  },
};

const status: Rule = {
  id: "lore/status",
  family: "lore",
  severity: "error",
  description: "`status` is draft, stable, or deprecated",
  check(ctx) {
    return loreTargets(ctx)
      .filter((n) => n.data.status !== undefined && !StatusSchema.safeParse(n.data.status).success)
      .map((n) =>
        issue(this, {
          path: n.path,
          line: keyLine(n, "status"),
          message: `Invalid status "${String(n.data.status)}"; use draft, stable, or deprecated`,
        }),
      );
  },
};

const provenance: Rule = {
  id: "lore/provenance",
  family: "lore",
  severity: "error",
  description: "`generated`, `verified`, `stale_after`, and `sources` are well formed",
  check(ctx) {
    const out: Issue[] = [];
    const checks: [string, z.ZodType][] = [
      ["generated", VerificationSchema],
      ["verified", z.union([VerificationSchema, z.array(VerificationSchema)])],
      ["stale_after", z.iso.datetime({ offset: true })],
      ["sources", z.array(SourceSchema)],
    ];
    for (const note of loreTargets(ctx)) {
      for (const [key, schema] of checks) {
        if (note.data[key] === undefined) continue;
        const r = schema.safeParse(note.data[key]);
        if (!r.success) {
          out.push(
            issue(this, {
              path: note.path,
              line: keyLine(note, key),
              message: `Invalid ${key}: ${formatZodIssues(r.error).join("; ")}`,
            }),
          );
        }
      }
    }
    return out;
  },
};

const TERM_FIELDS: [TermKind, "themes" | "systems" | "tags"][] = [
  ["theme", "themes"],
  ["system", "systems"],
  ["tag", "tags"],
];

const vocabulary: Rule = {
  id: "lore/vocabulary",
  family: "lore",
  severity: "error",
  description: "Types, themes, systems, tags, and owners exist in the vocabulary",
  check(ctx) {
    const { vault } = ctx;
    const out: Issue[] = [];
    const lookups = new Map(TERM_FIELDS.map(([kind]) => [kind, termLookup(vault, kind)]));
    for (const note of loreTargets(ctx)) {
      const type = str(note.data, "type");
      if (type && !vault.profile.types[type]) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "type"),
            message: `Unknown type "${type}"; the profile allows ${Object.keys(vault.profile.types).join(", ")}`,
          }),
        );
      }
      for (const [kind, field] of TERM_FIELDS) {
        for (const value of strList(note.data, field)) {
          if (hasTerm(vault, kind, value)) continue;
          const canonical = lookups.get(kind)!.get(value.toLowerCase());
          out.push(
            issue(this, {
              path: note.path,
              line: keyLine(note, field),
              message: canonical
                ? `"${value}" is an alias; use the canonical ${kind} "${canonical}"`
                : `Unknown ${kind} "${value}"; run \`kb taxonomy list\` and reuse an existing term`,
              fixable: Boolean(canonical),
              data: { kind, field, value, ...(canonical ? { canonical } : {}) },
            }),
          );
        }
      }
      const owner = str(note.data, "owner");
      if (owner && vault.profile.teams.length && !vault.profile.teams.includes(owner)) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "owner"),
            message: `Unknown owner team "${owner}"`,
          }),
        );
      }
    }
    return out;
  },
  fix(fc, issues) {
    for (const i of issues) {
      const { field, value, canonical } = (i.data ?? {}) as {
        field?: string;
        value?: string;
        canonical?: string;
      };
      if (!field || !value || !canonical) continue;
      fc.update(i.path, (note) => {
        const list = strList(note.data, field);
        const next: string[] = [];
        for (const v of list) {
          const replaced = v === value ? canonical : v;
          if (!next.includes(replaced)) next.push(replaced);
        }
        note.data[field] = next;
      });
    }
  },
};

const limits: Rule = {
  id: "lore/limits",
  family: "lore",
  severity: "error",
  description: "1 to 3 themes and at most 8 tags",
  check(ctx) {
    const { limits: l } = ctx.vault.profile;
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      const themes = strList(note.data, "themes");
      if (
        note.data.themes !== undefined &&
        themes.length > 0 &&
        (themes.length < l.min_themes || themes.length > l.max_themes)
      ) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "themes"),
            message: `A note has ${l.min_themes} to ${l.max_themes} themes; found ${themes.length}`,
          }),
        );
      }
      const tags = strList(note.data, "tags");
      if (tags.length > l.max_tags) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "tags"),
            message: `A note has at most ${l.max_tags} tags; found ${tags.length}`,
          }),
        );
      }
    }
    return out;
  },
};

const MANAGED_FOLDERS = new Set(["_themes", "_systems", "_meta", "_assets"]);

const namespace: Rule = {
  id: "lore/namespace",
  family: "lore",
  severity: "error",
  description: "The top-level folder is a registered namespace",
  check(ctx) {
    const { vault } = ctx;
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      const segs = bundleSegments(vault.root, note.path);
      if (segs.length < 2) {
        out.push(
          issue(this, {
            path: note.path,
            line: 1,
            message: "Notes must live in a namespace folder, not at the bundle root",
          }),
        );
        continue;
      }
      const top = segs[0]!;
      if (top.startsWith("_")) {
        if (!MANAGED_FOLDERS.has(top))
          out.push(
            issue(this, { path: note.path, line: 1, message: `Unknown managed folder "${top}"` }),
          );
        else if ((top === "_themes" || top === "_systems") && segs.length !== 2) {
          out.push(
            issue(this, { path: note.path, line: 1, message: `Hubs live directly in ${top}/` }),
          );
        }
        continue;
      }
      if (!vault.namespaces[top]) {
        out.push(
          issue(this, {
            path: note.path,
            line: 1,
            message: `Namespace "${top}" is not registered in .kb/namespaces.yaml`,
          }),
        );
      }
    }
    return out;
  },
};

const customFields: Rule = {
  id: "lore/custom-fields",
  family: "lore",
  severity: "error",
  description: "Custom fields match the profile",
  check(ctx) {
    const out: Issue[] = [];
    const fields = ctx.vault.profile.custom_fields;
    if (!fields.length) return out;
    for (const note of loreTargets(ctx)) {
      if (hubKindOf(ctx.vault.root, note.path)) continue;
      for (const f of fields) {
        const v = note.data[f.name];
        if (v === undefined) {
          if (f.required)
            out.push(
              issue(this, {
                path: note.path,
                line: 1,
                message: `Missing custom field "${f.name}"`,
              }),
            );
          continue;
        }
        let ok = true;
        switch (f.type) {
          case "string":
            ok = typeof v === "string";
            break;
          case "number":
            ok = typeof v === "number";
            break;
          case "boolean":
            ok = typeof v === "boolean";
            break;
          case "date":
            ok = typeof v === "string" && !Number.isNaN(Date.parse(v));
            break;
          case "list":
            ok =
              Array.isArray(v) &&
              v.every((x) => typeof x === "string") &&
              (!f.values || v.every((x) => f.values!.includes(x)));
            break;
          case "enum":
            ok = typeof v === "string" && (f.values ?? []).includes(v);
            break;
        }
        if (!ok) {
          const expected = f.values ? `${f.type} of ${f.values.join(", ")}` : f.type;
          out.push(
            issue(this, {
              path: note.path,
              line: keyLine(note, f.name),
              message: `Custom field "${f.name}" must be ${expected}`,
            }),
          );
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// Link rules

const wikilinks: Rule = {
  id: "lore/wikilinks",
  family: "lore",
  severity: "warning",
  description: "Obsidian wikilinks are converted to standard links",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      for (const link of extractLinks(note)) {
        if (link.kind !== "wikilink") continue;
        out.push(
          issue(this, {
            path: note.path,
            line: link.line,
            column: link.column,
            message: `Wikilink [[${link.href}]] should be a standard markdown link`,
            fixable: true,
          }),
        );
      }
    }
    return out;
  },
  fix(fc, issues) {
    for (const path of new Set(issues.map((i) => i.path))) {
      const note = fc.note(path);
      if (note) fc.setText(path, convertWikilinks(fc.vault, note));
    }
  },
};

const linkTargets: Rule = {
  id: "lore/link-targets",
  family: "lore",
  severity: "warning",
  description: "Link targets exist; missing targets are wanted notes",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      for (const { link, resolved } of noteLinks(ctx.vault, note)) {
        if (resolved.outside) {
          out.push(
            issue(this, {
              path: note.path,
              line: link.line,
              column: link.column,
              message: `Link "${link.href}" points outside the bundle`,
            }),
          );
        } else if (resolved.wanted) {
          out.push(
            issue(this, {
              path: note.path,
              line: link.line,
              column: link.column,
              message: `Wanted note: "${link.href}" does not exist yet`,
              data: { target: resolved.path },
            }),
          );
        }
      }
    }
    return out;
  },
};

/** An internal link written in the other style: `/x.md` in a relative vault or `../x.md` in an absolute one. */
function offStyle(vault: Vault, href: string): boolean {
  if (href.startsWith("#")) return false;
  return vault.profile.link_style === "absolute" ? !href.startsWith("/") : href.startsWith("/");
}

const linkStyle: Rule = {
  id: "lore/link-style",
  family: "lore",
  severity: "warning",
  description: "Internal links use the profile's link style (absolute or relative)",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      for (const { link, resolved } of noteLinks(ctx.vault, note)) {
        if (resolved.outside || !offStyle(ctx.vault, link.href)) continue;
        out.push(
          issue(this, {
            path: note.path,
            line: link.line,
            column: link.column,
            message: `Link "${link.href}" should be ${ctx.vault.profile.link_style}`,
            fixable: true,
          }),
        );
      }
    }
    return out;
  },
  fix(fc, issues) {
    for (const path of new Set(issues.map((i) => i.path))) {
      const note = fc.note(path);
      if (!note) continue;
      const text = rewriteLinks(fc.vault, note, (link, resolved) => {
        if (
          link.kind === "image" ||
          resolved.outside ||
          !resolved.path ||
          !offStyle(fc.vault, link.href)
        )
          return null;
        let target = resolved.path;
        // Folder links resolve to index.md; keep pointing at the folder.
        const folderLink = /\/$/.test(link.href.split("#")[0]!);
        if (folderLink) target = target.replace(/index\.md$/, "");
        const href = makeHref(
          fc.vault.root,
          path,
          target,
          fc.vault.profile.link_style,
          resolved.anchor,
        );
        return folderLink && !href.endsWith("/") && !href.includes("#") ? href + "/" : href;
      });
      fc.setText(path, text);
    }
  },
};

const HUBLESS_TYPES = new Set(["Theme", "System", "Source Document", "Graph Report"]);

const hubLink: Rule = {
  id: "lore/hub-link",
  family: "lore",
  severity: "warning",
  description: "Every note links to at least one hub",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      if (HUBLESS_TYPES.has(str(note.data, "type") ?? "")) continue;
      const linksHub = noteLinks(ctx.vault, note).some(
        (l) => l.resolved.path && hubKindOf(ctx.vault.root, l.resolved.path),
      );
      if (!linksHub)
        out.push(
          issue(this, {
            path: note.path,
            line: note.bodyLine,
            message: "Add at least one link to a Theme or System hub",
          }),
        );
    }
    return out;
  },
};

const wordCount: Rule = {
  id: "lore/word-count",
  family: "lore",
  severity: "warning",
  description: "Warn above 1,200 words, fail above 2,500",
  check(ctx) {
    const { words_warn, words_error } = ctx.vault.profile.limits;
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      if (typeConfig(ctx.vault, note)?.word_limits === false) continue;
      const words = countWords(note);
      if (words > words_error) {
        out.push(
          issue(this, {
            severity: "error",
            path: note.path,
            line: note.bodyLine,
            message: `${words} words; notes over ${words_error} words must be split into atomic notes`,
            data: { words },
          }),
        );
      } else if (words > words_warn) {
        out.push(
          issue(this, {
            path: note.path,
            line: note.bodyLine,
            message: `${words} words; consider splitting notes over ${words_warn} words`,
            data: { words },
          }),
        );
      }
    }
    return out;
  },
};

const duplicateId: Rule = {
  id: "lore/duplicate-id",
  family: "lore",
  severity: "error",
  description: "Ids are unique across the vault",
  check(ctx) {
    const out: Issue[] = [];
    const targets = new Set(ctx.targets.map((t) => t.path));
    for (const [id, paths] of ctx.vault.byId) {
      if (paths.length < 2) continue;
      for (const path of paths) {
        if (!targets.has(path)) continue;
        const others = paths.filter((p) => p !== path);
        const note = ctx.vault.notes.get(path)!;
        out.push(
          issue(this, {
            path,
            line: keyLine(note, "id"),
            message: `Duplicate id ${id}, also used by ${others.join(", ")}`,
          }),
        );
      }
    }
    return out;
  },
};

const duplicateTitle: Rule = {
  id: "lore/duplicate-title",
  family: "lore",
  severity: "error",
  description: "Titles are unique within a namespace",
  check(ctx) {
    const { vault } = ctx;
    const groups = new Map<string, ParsedNote[]>();
    for (const note of vault.notes.values()) {
      if (!isLoreTarget(vault, note)) continue;
      const title = str(note.data, "title");
      if (!title) continue;
      const scope =
        namespaceOf(vault.root, note.path) ?? bundleSegments(vault.root, note.path)[0] ?? "";
      const key = `${scope}\u0000${title.trim().toLowerCase()}`;
      groups.set(key, [...(groups.get(key) ?? []), note]);
    }
    const targets = new Set(ctx.targets.map((t) => t.path));
    const out: Issue[] = [];
    for (const notes of groups.values()) {
      if (notes.length < 2) continue;
      for (const note of notes) {
        if (!targets.has(note.path)) continue;
        const others = notes.filter((n) => n !== note).map((n) => n.path);
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "title"),
            message: `Title "${str(note.data, "title")}" is also used by ${others.join(", ")}`,
          }),
        );
      }
    }
    return out;
  },
};

const deprecated: Rule = {
  id: "lore/deprecated",
  family: "lore",
  severity: "error",
  description: "Deprecated notes point at an existing replacement with `superseded_by`",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      if (note.data.status !== "deprecated") continue;
      const target = str(note.data, "superseded_by");
      if (!target) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "status"),
            message: "Deprecated notes need superseded_by pointing at the replacement",
          }),
        );
        continue;
      }
      const resolved = resolveLink(ctx.vault, note.path, target);
      if (!resolved.path || !ctx.vault.notes.has(resolved.path) || resolved.path === note.path) {
        out.push(
          issue(this, {
            path: note.path,
            line: keyLine(note, "superseded_by"),
            message: `superseded_by "${target}" does not point at another existing note`,
          }),
        );
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// Typed notes

const action: Rule = {
  id: "lore/action",
  family: "lore",
  severity: "error",
  description: "Actions have valid policy, parameters, executor, Manual procedure, and Rollback",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      if (note.data.type !== "Action") continue;
      const r = ActionSchema.safeParse(note.data);
      if (!r.success) {
        for (const m of formatZodIssues(r.error))
          out.push(issue(this, { path: note.path, line: 1, message: `Action: ${m}` }));
      }
      const hs = headings(note);
      for (const section of ["manual procedure", "rollback"]) {
        if (!hs.includes(section)) {
          const title = section[0]!.toUpperCase() + section.slice(1);
          out.push(
            issue(this, {
              path: note.path,
              line: note.bodyLine,
              message: `Actions need a "${title}" section`,
            }),
          );
        }
      }
    }
    return out;
  },
};

const requestType: Rule = {
  id: "lore/request-type",
  family: "lore",
  severity: "error",
  description:
    "Request Types have valid kind, route_to, follow_up_after, fields, and resolvable links",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      if (note.data.type !== "Request Type") continue;
      const r = RequestTypeSchema.safeParse(note.data);
      if (!r.success) {
        for (const m of formatZodIssues(r.error))
          out.push(issue(this, { path: note.path, line: 1, message: `Request Type: ${m}` }));
      }
      for (const key of ["self_service", "runbook"]) {
        const target = str(note.data, key);
        if (!target) continue;
        const resolved = resolveLink(ctx.vault, note.path, target);
        if (!resolved.external && (!resolved.path || !ctx.vault.notes.has(resolved.path))) {
          out.push(
            issue(this, {
              path: note.path,
              line: keyLine(note, key),
              message: `${key} "${target}" does not resolve to a note`,
            }),
          );
        }
      }
    }
    return out;
  },
};

// ---------------------------------------------------------------------------------------------
// Content safety and generated content

const secrets: Rule = {
  id: "lore/secrets",
  family: "lore",
  severity: "error",
  description: "No secrets (secretlint recommended rules)",
  async check(ctx) {
    const out: Issue[] = [];
    const notes = ctx.targets.filter((n) => !isManagedPath(ctx.vault.root, n.path));
    const results = await Promise.all(notes.map((n) => scanSecrets(n.path, n.text)));
    for (const r of results) out.push(...r);
    return out;
  },
};

const images: Rule = {
  id: "lore/images",
  family: "lore",
  severity: "warning",
  description: "Referenced images exist and are under the size limit",
  async check(ctx) {
    const out: Issue[] = [];
    const maxBytes = ctx.vault.profile.limits.image_max_mb * 1024 * 1024;
    for (const note of loreTargets(ctx)) {
      for (const link of extractLinks(note)) {
        if (link.kind !== "image") continue;
        const resolved = resolveLink(ctx.vault, note.path, link.href);
        if (resolved.external || !resolved.path) continue;
        const content = await ctx.vault.src.read(resolved.path);
        if (content === null) {
          out.push(
            issue(this, {
              path: note.path,
              line: link.line,
              column: link.column,
              message: `Image "${link.href}" does not exist`,
            }),
          );
          continue;
        }
        const size = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
        if (size > maxBytes) {
          const human =
            size >= 1048576 ? `${(size / 1048576).toFixed(1)} MB` : `${Math.ceil(size / 1024)} KB`;
          out.push(
            issue(this, {
              path: note.path,
              line: link.line,
              column: link.column,
              message: `Image "${link.href}" is ${human}; the limit is ${ctx.vault.profile.limits.image_max_mb} MB`,
            }),
          );
        }
      }
    }
    return out;
  },
};

const hubMembersRule: Rule = {
  id: "lore/hub-members",
  family: "lore",
  severity: "warning",
  description: "Generated hub member lists are current",
  check(ctx) {
    const out: Issue[] = [];
    for (const note of loreTargets(ctx)) {
      const kind = hubKindOf(ctx.vault.root, note.path);
      if (!kind || isReserved(note.path)) continue;
      const slug = basename(note.path).replace(/\.md$/, "");
      const expected = renderMembersBlock(ctx.vault, note.path, hubMembers(ctx.vault, kind, slug));
      const found = findMembersBlock(note.text);
      if (!found) {
        out.push(
          issue(this, {
            path: note.path,
            line: note.bodyLine,
            message: "Hub has no generated member list; run kb index",
            fixable: true,
          }),
        );
      } else if (note.text.slice(found.start, found.end) !== expected) {
        const line = note.text.slice(0, found.start).split("\n").length;
        out.push(
          issue(this, {
            path: note.path,
            line,
            message: "Hub member list is out of date; run kb index",
            fixable: true,
          }),
        );
      }
    }
    return out;
  },
};

/** Every rule, in the order they run and fix. */
export const RULES: Rule[] = [
  frontmatter,
  reservedFiles,
  required,
  idFormat,
  versionFormat,
  status,
  provenance,
  vocabulary,
  limits,
  namespace,
  customFields,
  wikilinks,
  linkTargets,
  linkStyle,
  hubLink,
  wordCount,
  duplicateId,
  duplicateTitle,
  deprecated,
  action,
  requestType,
  secrets,
  images,
  hubMembersRule,
];
