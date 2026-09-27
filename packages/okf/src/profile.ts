import { parse as parseYaml } from "yaml";
import { z } from "zod";
import { readText, type FileSource } from "./source.ts";
import { formatZodIssues } from "./schema.ts";
import type { Issue } from "./types.ts";

export const PROFILE_PATH = ".kb/profile.yaml";
export const NAMESPACES_PATH = ".kb/namespaces.yaml";
export const TAGS_PATH = ".kb/tags.yaml";

/** The profile schema version. The CLI's major version follows it. */
export const PROFILE_SCHEMA_VERSION = 1;

const DeskUse = z.enum(["answer", "team", "intake", "navigate", "none"]);

const TypeConfig = z.object({
  review_days: z.number().int().positive().optional(),
  desk: DeskUse.default("answer"),
  /** Skips word limits for types that hold verbatim or generated text. */
  word_limits: z.boolean().optional(),
});

export type TypeConfig = z.infer<typeof TypeConfig>;

const CustomField = z.object({
  name: z.string().min(1),
  type: z.enum(["string", "enum", "number", "boolean", "date", "list"]),
  values: z.array(z.string()).optional(),
  required: z.boolean().default(false),
  description: z.string().optional(),
});

export type CustomField = z.infer<typeof CustomField>;

export const DEFAULT_TYPES: Record<string, z.input<typeof TypeConfig>> = {
  "How-To": { review_days: 180, desk: "answer" },
  Process: { review_days: 180, desk: "answer" },
  Explanation: { review_days: 365, desk: "answer" },
  Reference: { review_days: 365, desk: "answer" },
  Policy: { review_days: 365, desk: "answer" },
  Decision: { desk: "answer" },
  Runbook: { review_days: 180, desk: "team" },
  "Request Type": { review_days: 365, desk: "intake" },
  Action: { review_days: 180, desk: "none" },
  Theme: { desk: "navigate" },
  System: { review_days: 365, desk: "navigate" },
  "Source Document": { desk: "none", word_limits: false },
  "Graph Report": { desk: "none", word_limits: false },
};

export const ProfileSchema = z.object({
  schema_version: z.number().int().default(PROFILE_SCHEMA_VERSION),
  /** Shown as the heading of the root index. */
  title: z.string().default("Knowledge base"),
  okf_version: z.string().default("0.2"),
  bundle_root: z.string().default("kb"),
  id_prefix: z.string().default("kb_"),
  required: z
    .array(z.string())
    .default(["type", "title", "description", "id", "version", "themes"]),
  limits: z
    .object({
      words_warn: z.number().int().positive().default(1200),
      words_error: z.number().int().positive().default(2500),
      max_tags: z.number().int().nonnegative().default(8),
      max_themes: z.number().int().positive().default(3),
      min_themes: z.number().int().nonnegative().default(1),
      image_max_mb: z.number().positive().default(2),
    })
    .prefault({}),
  types: z.record(z.string(), TypeConfig).default(() => structuredClone(DEFAULT_TYPES) as never),
  teams: z.array(z.string()).default([]),
  custom_fields: z.array(CustomField).default([]),
  /** How tooling writes links: bundle-absolute (`/ns/note.md`) or relative (`../ns/note.md`). */
  link_style: z.enum(["absolute", "relative"]).default("absolute"),
  /** Lint rule overrides: `off`, `warning`, or `error` per rule id. */
  rules: z.record(z.string(), z.enum(["off", "warning", "error"])).default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const NamespaceSchema = z.object({
  title: z.string().min(1),
  description: z.string().default(""),
  owner: z.string().optional(),
  visibility: z.enum(["company", "restricted"]).default("company"),
  publishing: z.enum(["auto", "manual"]).default("manual"),
  ai_processing: z.boolean().default(true),
});

export type Namespace = z.infer<typeof NamespaceSchema>;

export const TagSchema = z.object({
  description: z.string().default(""),
  aliases: z.array(z.string()).default([]),
  facet: z.string().optional(),
});

export type Tag = z.infer<typeof TagSchema>;

export interface VaultConfig {
  profile: Profile;
  namespaces: Record<string, Namespace>;
  tags: Record<string, Tag>;
  issues: Issue[];
}

async function loadYaml(src: FileSource, path: string, issues: Issue[]): Promise<unknown> {
  const text = await readText(src, path);
  if (text === null) return undefined;
  try {
    return parseYaml(text) ?? undefined;
  } catch (err) {
    issues.push({
      rule: "lore/config",
      severity: "error",
      path,
      message: `Invalid YAML: ${(err as Error).message.split("\n")[0]}`,
    });
    return undefined;
  }
}

function validate<T extends z.ZodType>(
  schema: T,
  value: unknown,
  path: string,
  issues: Issue[],
  fallback: z.infer<T>,
): z.infer<T> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  for (const message of formatZodIssues(result.error)) {
    issues.push({ rule: "lore/config", severity: "error", path, message });
  }
  return fallback;
}

/** Loads `.kb/profile.yaml`, `namespaces.yaml`, and `tags.yaml`, filling PRD defaults for anything missing. */
export async function loadConfig(src: FileSource): Promise<VaultConfig> {
  const issues: Issue[] = [];
  const defaults = ProfileSchema.parse({});
  const profile = validate(
    ProfileSchema,
    (await loadYaml(src, PROFILE_PATH, issues)) ?? {},
    PROFILE_PATH,
    issues,
    defaults,
  );
  const namespaces = validate(
    z.record(z.string(), NamespaceSchema),
    (await loadYaml(src, NAMESPACES_PATH, issues)) ?? {},
    NAMESPACES_PATH,
    issues,
    {},
  );
  const tags = validate(
    z.record(z.string(), z.union([TagSchema, z.null().transform(() => TagSchema.parse({}))])),
    (await loadYaml(src, TAGS_PATH, issues)) ?? {},
    TAGS_PATH,
    issues,
    {},
  );
  return { profile, namespaces, tags: tags as Record<string, Tag>, issues };
}

/** Parses a profile object, applying defaults. Throws on invalid input. */
export function parseProfile(value: unknown): Profile {
  return ProfileSchema.parse(value ?? {});
}
