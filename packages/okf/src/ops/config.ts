import { editFrontmatter, parseFrontmatter } from "../frontmatter.ts";
import { NAMESPACES_PATH, NamespaceSchema, PROFILE_PATH } from "../profile.ts";
import type { FileOp } from "../types.ts";
import type { Vault } from "../vault.ts";

const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export interface NamespacePatch {
  title?: string;
  description?: string;
  owner?: string | null;
  visibility?: "company" | "restricted";
  publishing?: "auto" | "manual";
  ai_processing?: boolean;
}

function edit(
  vault: Vault,
  path: string,
  fn: (data: Record<string, unknown>, set: Map<string, unknown>) => void,
): FileOp[] {
  const raw = vault.aux.get(path) ?? "";
  const parsed = parseFrontmatter(raw);
  if (parsed.errors.length) throw new Error(`${path} does not parse: ${parsed.errors[0]!.message}`);
  const set = new Map<string, unknown>();
  fn(parsed.data, set);
  if (set.size === 0) return [];
  const text = editFrontmatter(raw, parsed.doc, set, new Set());
  return text === raw ? [] : [{ op: "put", path, content: text }];
}

/**
 * Registers a namespace or changes one, in `.kb/namespaces.yaml`. Other entries, comments,
 * and formatting are kept. A new namespace starts with manual publishing, as the PRD asks.
 */
export function setNamespace(vault: Vault, slug: string, patch: NamespacePatch): FileOp[] {
  if (!SLUG.test(slug) || slug.startsWith("_"))
    throw new Error(
      `"${slug}" is not a valid namespace: use lowercase letters, digits, and hyphens`,
    );
  return edit(vault, NAMESPACES_PATH, (data, set) => {
    const current = (data[slug] ?? null) as Record<string, unknown> | null;
    if (!current && !patch.title) throw new Error(`The new namespace "${slug}" needs a title`);
    const next: Record<string, unknown> = { ...(current ?? { publishing: "manual" }) };
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      if (value === null || value === "") delete next[key];
      else next[key] = value;
    }
    const checked = NamespaceSchema.safeParse(next);
    if (!checked.success)
      throw new Error(`The namespace "${slug}" is not valid: ${checked.error.issues[0]!.message}`);
    if (JSON.stringify(current) !== JSON.stringify(next)) set.set(slug, next);
  });
}

/**
 * Sets the team slugs that may appear in `owner`, in `.kb/profile.yaml`, so `kb lint` can
 * check owners offline. Lore calls this when admins add or remove teams.
 */
export function setProfileTeams(vault: Vault, teams: string[]): FileOp[] {
  const next = [...new Set(teams)].sort();
  for (const t of next) if (!SLUG.test(t)) throw new Error(`"${t}" is not a valid team slug`);
  return edit(vault, PROFILE_PATH, (data, set) => {
    const current = Array.isArray(data.teams) ? [...(data.teams as string[])].sort() : [];
    if (JSON.stringify(current) !== JSON.stringify(next)) set.set("teams", next);
  });
}
