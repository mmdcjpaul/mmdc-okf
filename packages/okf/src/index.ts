/**
 * `@lore/okf`: parse, validate, and serialize OKF v0.2 notes with Lore's profile rules.
 *
 * Every mutation is a pure function that returns `FileOp[]`; every read goes through a
 * `FileSource`. The CLI applies ops to disk and the Library turns the same ops into a changeset.
 *
 * @packageDocumentation
 */

export type {
  Actor,
  ChangeClass,
  FileOp,
  Issue,
  Severity,
  TermKind,
  Verification,
} from "./types.ts";
export {
  DiskSource,
  MemorySource,
  OverlaySource,
  compactOps,
  gitBlobSha,
  readText,
  type FileSource,
} from "./source.ts";

export {
  buildNoteText,
  cloneNote,
  noteAst,
  parseMarkdown,
  parseNote,
  serializeNote,
  str,
  strList,
  type ParsedNote,
} from "./note.ts";
export { KEY_ORDER, renderFrontmatter, splitFrontmatter } from "./frontmatter.ts";
export {
  ActionSchema,
  ActorSchema,
  NoteDataSchema,
  RequestTypeSchema,
  StatusSchema,
  VerificationSchema,
  type NoteData,
} from "./schema.ts";
export {
  DEFAULT_TYPES,
  NAMESPACES_PATH,
  PROFILE_PATH,
  PROFILE_SCHEMA_VERSION,
  TAGS_PATH,
  loadConfig,
  parseProfile,
  type CustomField,
  type Namespace,
  type Profile,
  type Tag,
  type TypeConfig,
} from "./profile.ts";
export {
  addDays,
  bumpVersion,
  initialVersion,
  isStale,
  isValidId,
  isValidVersion,
  isoInstant,
  newId,
  parseActor,
  trustTier,
  verifications,
  type ParsedActor,
} from "./lifecycle.ts";
export {
  contentNotes,
  findNoteById,
  hasTerm,
  loadVault,
  termLookup,
  type Hub,
  type LoadOptions,
  type Vault,
} from "./vault.ts";
export {
  fromBundlePath,
  hubKindOf,
  makeHref,
  namespaceOf,
  normalizeNotePath,
  slugify,
  toBundlePath,
} from "./paths.ts";

export {
  lint,
  fix,
  RULES,
  type LintOptions,
  type LintReport,
  type Rule,
  type RuleConfig,
  type FixOptions,
} from "./lint/index.ts";
export {
  formatReport,
  formatHuman,
  formatJson,
  formatGithub,
  type ReportFormat,
} from "./lint/format.ts";

export {
  applyTextEdits,
  convertWikilinks,
  extractLinks,
  isExternalHref,
  noteLinks,
  resolveLink,
  resolveWikilink,
  rewriteLinks,
  type Link,
  type ResolvedLink,
} from "./links.ts";
export {
  buildGraph,
  communities,
  graphToJson,
  linkDegree,
  type Graph,
  type GraphJson,
  type GraphNode,
  type WantedNote,
} from "./graph.ts";
export { generateIndexes, type IndexOptions } from "./indexes.ts";
export { MEMBERS_END, MEMBERS_START, hubMembers } from "./hubs.ts";

export { bump, moveNote, newNote, verify, type NewNoteInput } from "./ops/notes.ts";
export { addTerm, mergeTerms, renameTerm } from "./ops/taxonomy.ts";
export { setNamespace, setProfileTeams, type NamespacePatch } from "./ops/config.ts";
export { appendLogEntry } from "./ops/logmd.ts";
export { TYPE_TEMPLATES, templateBody } from "./ops/templates.ts";

export {
  chunkNote,
  tiktokenCounter,
  type Chunk,
  type ChunkOptions,
  type TokenCounter,
} from "./chunk.ts";
export { actionParameterSchema, requestTypeSchema } from "./fields.ts";
export { countWords } from "./words.ts";
