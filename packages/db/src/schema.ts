/**
 * Library tables from TECH_STACK section 7, minus the Desk, ticket, and action tables (Plan 3).
 *
 * Everything in the note tables (`notes`, `note_links`, `taxonomy_terms`, `commits`,
 * `note_commits`, `assets`) can be rebuilt from the vault with `lore reindex`. The rest is
 * backed up. Schema changes are additive first so rolling back means deploying the previous image.
 */
import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const created = () => ts("created_at").notNull().defaultNow();

// Identity. Better Auth owns these in production (L1); the dev login reads the same rows.

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  handle: text("handle").notNull().unique(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  role: text("role", { enum: ["member", "admin", "owner"] })
    .notNull()
    .default("member"),
  serviceAccount: boolean("service_account").notNull().default(false),
  createdAt: created(),
});

export const teams = pgTable("teams", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: created(),
});

export const teamMembers = pgTable(
  "team_members",
  {
    teamId: text("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// Vaults and namespaces.

export const vaults = pgTable("vaults", {
  id: text("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  /** `local:<path to bare repository>` or `github:<owner>/<repo>`. */
  repository: text("repository").notNull(),
  branch: text("branch").notNull().default("main"),
  bundleRoot: text("bundle_root").notNull().default("kb"),
  /** Parsed `.kb/profile.yaml`, refreshed when `.kb/` changes. */
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  lastIndexedHead: text("last_indexed_head"),
  lastIndexedAt: ts("last_indexed_at"),
  createdAt: created(),
});

export const namespaces = pgTable(
  "namespaces",
  {
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    visibility: text("visibility", { enum: ["company", "restricted"] })
      .notNull()
      .default("company"),
    publishing: text("publishing", { enum: ["auto", "manual"] })
      .notNull()
      .default("manual"),
    aiProcessing: boolean("ai_processing").notNull().default(true),
    ownerTeam: text("owner_team"),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.slug] })],
);

export const namespaceGrants = pgTable(
  "namespace_grants",
  {
    id: serial("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    namespace: text("namespace").notNull(),
    teamId: text("team_id").references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["read", "write", "maintain"] }).notNull(),
    createdAt: created(),
  },
  (t) => [index("namespace_grants_vault_ns").on(t.vaultId, t.namespace)],
);

// Parsed notes. One row per note in the vault's current head.

export type TrustTier = "unverified" | "machine" | "human";

export const notes = pgTable(
  "notes",
  {
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    path: text("path").notNull(),
    slug: text("slug").notNull(),
    /** Top-level folder. Null for Theme and System hubs, which every member can read. */
    namespace: text("namespace"),
    /** Folder below the namespace, for example `runbooks/incident`. Empty at the namespace root. */
    folder: text("folder").notNull().default(""),
    hubKind: text("hub_kind", { enum: ["theme", "system"] }),
    type: text("type").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    themes: text("themes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    systems: text("systems")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    frontmatter: jsonb("frontmatter").$type<Record<string, unknown>>().notNull(),
    /** Markdown after the frontmatter. Hub bodies omit the generated member list. */
    body: text("body").notNull(),
    version: text("version"),
    status: text("status").notNull().default("stable"),
    trustTier: text("trust_tier").$type<TrustTier>().notNull(),
    staleAfter: ts("stale_after"),
    owner: text("owner"),
    supersededBy: text("superseded_by"),
    contentHash: text("content_hash").notNull(),
    blobSha: text("blob_sha").notNull(),
    wordCount: integer("word_count").notNull().default(0),
    healthScore: integer("health_score").notNull().default(100),
    /** Hash of every derived column, so the indexer writes only rows that changed. */
    rowHash: text("row_hash").notNull(),
    lastCommitSha: text("last_commit_sha"),
    lastChangedAt: ts("last_changed_at"),
    lastChangedBy: text("last_changed_by"),
    /** When the note last had a Process change (a major version bump). Drives the Changed badge. */
    processChangedAt: ts("process_changed_at"),
    indexedAt: ts("indexed_at").notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.id] }),
    uniqueIndex("notes_vault_path").on(t.vaultId, t.path),
    index("notes_vault_ns").on(t.vaultId, t.namespace),
    index("notes_vault_type").on(t.vaultId, t.type),
    index("notes_themes").using("gin", t.themes),
    index("notes_systems").using("gin", t.systems),
    index("notes_tags").using("gin", t.tags),
  ],
);

export const noteLinks = pgTable(
  "note_links",
  {
    vaultId: text("vault_id").notNull(),
    sourceId: text("source_id").notNull(),
    /** The href exactly as written in the note. */
    href: text("href").notNull(),
    /** Repository path of the target (a note, asset, or folder). */
    targetPath: text("target_path").notNull(),
    /** Resolved note id; null when the target is not a note or does not exist. */
    targetId: text("target_id"),
    kind: text("kind", { enum: ["body", "image", "supersedes"] }).notNull(),
    /** A markdown target that does not exist yet: a wanted note. */
    wanted: boolean("wanted").notNull().default(false),
    anchor: text("anchor"),
    label: text("label").notNull().default(""),
  },
  (t) => [
    index("note_links_source").on(t.vaultId, t.sourceId),
    index("note_links_target").on(t.vaultId, t.targetId),
    index("note_links_target_path").on(t.vaultId, t.targetPath),
  ],
);

export const taxonomyTerms = pgTable(
  "taxonomy_terms",
  {
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["theme", "system", "tag"] }).notNull(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    aliases: text("aliases")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    facet: text("facet"),
    state: text("state", { enum: ["active", "proposed", "retired"] })
      .notNull()
      .default("active"),
    /** The hub note for themes and systems. */
    hubNoteId: text("hub_note_id"),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.kind, t.slug] })],
);

export const commits = pgTable(
  "commits",
  {
    vaultId: text("vault_id").notNull(),
    sha: text("sha").notNull(),
    authorName: text("author_name").notNull(),
    authorEmail: text("author_email").notNull(),
    committedAt: ts("committed_at").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull().default(""),
    /** From the `Change-Class` trailer, or inferred from version bumps for external commits. */
    changeClass: text("change_class", { enum: ["fix", "addition", "process"] }),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.sha] })],
);

export const noteCommits = pgTable(
  "note_commits",
  {
    vaultId: text("vault_id").notNull(),
    noteId: text("note_id").notNull(),
    sha: text("sha").notNull(),
    path: text("path").notNull(),
    status: text("status", { enum: ["A", "M", "D", "R"] }).notNull(),
    fromVersion: text("from_version"),
    toVersion: text("to_version"),
    changeClass: text("change_class", { enum: ["fix", "addition", "process"] }),
    committedAt: ts("committed_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.noteId, t.sha] }),
    index("note_commits_time").on(t.vaultId, t.committedAt),
  ],
);

/** Files under `_assets/`. Bytes live in the object store under their blob SHA. */
export const assets = pgTable(
  "assets",
  {
    vaultId: text("vault_id").notNull(),
    path: text("path").notNull(),
    namespace: text("namespace"),
    blobSha: text("blob_sha").notNull(),
    mime: text("mime").notNull(),
    size: integer("size").notNull(),
  },
  (t) => [primaryKey({ columns: [t.vaultId, t.path] })],
);

export const embeddingCache = pgTable(
  "embedding_cache",
  {
    model: text("model").notNull(),
    contentHash: text("content_hash").notNull(),
    vector: real("vector").array().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.model, t.contentHash] })],
);

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actorId: text("actor_id"),
    action: text("action").notNull(),
    target: text("target"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("audit_log_at").on(t.at)],
);

export type User = typeof users.$inferSelect;
export type Vault = typeof vaults.$inferSelect;
export type NamespaceRow = typeof namespaces.$inferSelect;
export type Grant = typeof namespaceGrants.$inferSelect;
export type NoteRow = typeof notes.$inferSelect;
export type NewNoteRow = typeof notes.$inferInsert;
export type NoteLinkRow = typeof noteLinks.$inferSelect;
export type TermRow = typeof taxonomyTerms.$inferSelect;
export type CommitRow = typeof commits.$inferSelect;
export type NoteCommitRow = typeof noteCommits.$inferSelect;
export type AssetRow = typeof assets.$inferSelect;
