/**
 * Library tables from TECH_STACK section 7, minus the Desk, ticket, and action tables (Plan 3)
 * and the Better Auth tables, which arrive with real sign-in (L1).
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
    /** Whether `stale_after` has passed. Kept current by the worker's staleness refresh. */
    stale: boolean("stale").notNull().default(false),
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

// Changesets: every write, whatever its source, is one of these (plans/02-library.md, L6).

/** A file operation as stored: binary content is base64, so the column stays valid JSON. */
export type StoredOp =
  | { op: "put"; path: string; content: string; encoding?: "utf8" | "base64" }
  | { op: "delete"; path: string };

/**
 * An operation the submitter asked for that needs the whole vault to carry out, such as a
 * move that rewrites inbound links. The worker expands it into file operations.
 */
export type ChangesetIntent =
  | {
      /** Changes a note's body and chosen frontmatter keys, leaving every other byte alone. */
      type: "edit";
      path: string;
      /** The new body, or undefined to keep it. */
      body?: string;
      set?: Record<string, unknown>;
      unset?: string[];
    }
  | {
      type: "create";
      namespace: string;
      /** Subfolder inside the namespace. */
      folder?: string;
      data: Record<string, unknown>;
      body: string;
    }
  | { type: "move"; from: string; to: string }
  | { type: "delete"; path: string }
  | { type: "deprecate"; path: string; supersededBy: string }
  | { type: "verify"; path: string }
  | { type: "rename_term"; kind: "theme" | "system" | "tag"; from: string; to: string }
  | { type: "merge_terms"; kind: "theme" | "system" | "tag"; from: string[]; into: string }
  | { type: "add_term"; kind: "theme" | "system" | "tag"; slug: string; description: string };

export type ChangesetState =
  | "draft"
  | "submitted"
  | "in_review"
  | "changes_requested"
  | "approved"
  | "committing"
  | "committed"
  | "conflicted"
  | "rejected";

export type ChangesetSource = "editor" | "suggest" | "upload" | "capture" | "gardener" | "agent";

export interface StoredIssue {
  rule: string;
  severity: "error" | "warning";
  path: string;
  line?: number;
  message: string;
}

export interface StoredReviewReason {
  /** Rule number in PRD 7.3, 1 to 8. */
  rule: number;
  code: string;
  message: string;
  /** Who may approve a changeset this reason applies to. */
  level: "write" | "maintain";
}

export const changesets = pgTable(
  "changesets",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    submitterId: text("submitter_id").references(() => users.id, { onDelete: "set null" }),
    /** OKF actor of the writer: `human:<id>`, or `<job>/<model>` when AI drafted it. */
    actor: text("actor").notNull(),
    source: text("source").$type<ChangesetSource>().notNull(),
    aiDrafted: boolean("ai_drafted").notNull().default(false),
    changeClass: text("change_class", { enum: ["fix", "addition", "process"] }).notNull(),
    state: text("state").$type<ChangesetState>().notNull().default("draft"),
    /** Subject line of the commit, without the `kb(<namespace>):` prefix. */
    title: text("title").notNull(),
    /** Why the change was made. Required for suggestions. */
    reason: text("reason"),
    /** One line for the namespace log when the change class is process. */
    summary: text("summary"),
    /** The submitter ticked "I checked this is accurate". */
    verify: boolean("verify").notNull().default(false),
    /** What the submitter sent. */
    ops: jsonb("ops").$type<StoredOp[]>().notNull(),
    intents: jsonb("intents").$type<ChangesetIntent[]>().notNull().default([]),
    /** Blob SHA of each file the submitter started from; null for a file that did not exist. */
    baseShas: jsonb("base_shas").$type<Record<string, string | null>>().notNull().default({}),
    /** `ops` plus version bumps, verification, and log entries: what is committed. */
    finalOps: jsonb("final_ops").$type<StoredOp[]>(),
    /** The head `final_ops` was prepared and linted against. */
    preparedHead: text("prepared_head"),
    namespaces: text("namespaces")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Ids of the notes the changeset creates, changes, moves, or deletes. */
    noteIds: text("note_ids")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    aiSummary: text("ai_summary"),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    issues: jsonb("issues").$type<StoredIssue[]>().notNull().default([]),
    reviewReasons: jsonb("review_reasons").$type<StoredReviewReason[]>().notNull().default([]),
    approverLevel: text("approver_level", { enum: ["write", "maintain"] }),
    /** Feedback reports this changeset resolves (`Resolves-Report` trailers). */
    resolvesReports: text("resolves_reports")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Files that changed in Git after the draft was made, when state is conflicted. */
    conflicts: jsonb("conflicts").$type<string[]>().notNull().default([]),
    commitSha: text("commit_sha"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
    submittedAt: ts("submitted_at"),
    committedAt: ts("committed_at"),
  },
  (t) => [
    index("changesets_vault_state").on(t.vaultId, t.state),
    index("changesets_submitter").on(t.submitterId, t.createdAt),
    index("changesets_note_ids").using("gin", t.noteIds),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: serial("id").primaryKey(),
    changesetId: text("changeset_id")
      .notNull()
      .references(() => changesets.id, { onDelete: "cascade" }),
    reviewerId: text("reviewer_id").references(() => users.id, { onDelete: "set null" }),
    decision: text("decision", { enum: ["approve", "request_changes", "reject"] }).notNull(),
    comment: text("comment"),
    createdAt: created(),
  },
  (t) => [index("reviews_changeset").on(t.changesetId)],
);

export const ingestItems = pgTable(
  "ingest_items",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    changesetId: text("changeset_id").references(() => changesets.id, { onDelete: "set null" }),
    submitterId: text("submitter_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["upload", "capture"] }).notNull(),
    namespace: text("namespace").notNull(),
    /** Optional hints from the submitter: theme, tags, and the note a capture updates. */
    hints: jsonb("hints").$type<Record<string, unknown>>().notNull().default({}),
    fileKey: text("file_key"),
    fileName: text("file_name"),
    fileType: text("file_type"),
    fileSize: integer("file_size"),
    fileHash: text("file_hash"),
    /** An earlier item with the same file hash. */
    duplicateOf: text("duplicate_of"),
    state: text("state", {
      enum: ["queued", "extracting", "atomizing", "waiting", "done", "failed"],
    })
      .notNull()
      .default("queued"),
    /** Why the item is waiting or failed, in words a person can act on. */
    stateReason: text("state_reason"),
    batchId: text("batch_id"),
    extractedText: text("extracted_text"),
    createdAt: created(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("ingest_items_vault_state").on(t.vaultId, t.state),
    index("ingest_items_hash").on(t.vaultId, t.fileHash),
  ],
);

export const feedback = pgTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    noteId: text("note_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["helpful", "report"] }).notNull(),
    reason: text("reason", {
      enum: ["outdated", "incorrect", "unclear", "missing", "duplicate", "other"],
    }),
    comment: text("comment"),
    /** Where it came from: the note page, or a rating on a Desk answer that cited the note. */
    origin: text("origin", { enum: ["library", "desk"] })
      .notNull()
      .default("library"),
    state: text("state", { enum: ["open", "resolved", "dismissed"] })
      .notNull()
      .default("open"),
    /** The commit that resolved it, or the reason an owner dismissed it. */
    resolution: text("resolution"),
    resolvedBy: text("resolved_by"),
    createdAt: created(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    index("feedback_note").on(t.vaultId, t.noteId, t.state),
    index("feedback_user_day").on(t.userId, t.createdAt),
  ],
);

export const follows = pgTable(
  "follows",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vaultId: text("vault_id")
      .notNull()
      .references(() => vaults.id, { onDelete: "cascade" }),
    /** A note id, or a hub as `theme:<slug>` or `system:<slug>`. */
    target: text("target").notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.vaultId, t.target] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    vaultId: text("vault_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    /** Path in the Library the notification opens. */
    href: text("href"),
    /** Stops the same event from notifying a person twice. */
    dedupeKey: text("dedupe_key"),
    readAt: ts("read_at"),
    emailedAt: ts("emailed_at"),
    createdAt: created(),
  },
  (t) => [
    index("notifications_user").on(t.userId, t.readAt, t.createdAt),
    uniqueIndex("notifications_dedupe").on(t.userId, t.dedupeKey),
  ],
);

/** Notes flagged for their owners because a note they link to had a Process change. */
export const noteFlags = pgTable(
  "note_flags",
  {
    vaultId: text("vault_id").notNull(),
    noteId: text("note_id").notNull(),
    /** The note whose process changed. */
    causeNoteId: text("cause_note_id").notNull(),
    causeSha: text("cause_sha").notNull(),
    changedAt: ts("changed_at").notNull(),
    clearedAt: ts("cleared_at"),
    createdAt: created(),
  },
  (t) => [
    primaryKey({ columns: [t.vaultId, t.noteId, t.causeNoteId, t.causeSha] }),
    index("note_flags_open").on(t.vaultId, t.clearedAt),
  ],
);

export const llmUsage = pgTable(
  "llm_usage",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    task: text("task").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cachedTokens: integer("cached_tokens").notNull().default(0),
    /** US dollars, priced from the per-model table at the time of the call. */
    costUsd: real("cost_usd").notNull().default(0),
    userId: text("user_id"),
    vaultId: text("vault_id"),
    namespace: text("namespace"),
    latencyMs: integer("latency_ms").notNull().default(0),
    batch: boolean("batch").notNull().default(false),
    ok: boolean("ok").notNull().default(true),
    error: text("error"),
    at: ts("at").notNull().defaultNow(),
  },
  (t) => [index("llm_usage_at").on(t.at), index("llm_usage_user_day").on(t.userId, t.at)],
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
export type ChangesetRow = typeof changesets.$inferSelect;
export type NewChangesetRow = typeof changesets.$inferInsert;
export type ReviewRow = typeof reviews.$inferSelect;
export type IngestItemRow = typeof ingestItems.$inferSelect;
export type FeedbackRow = typeof feedback.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;
export type NoteFlagRow = typeof noteFlags.$inferSelect;
export type LlmUsageRow = typeof llmUsage.$inferSelect;
