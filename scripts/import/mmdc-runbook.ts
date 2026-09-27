// Translates the MMDC runbook bundle (OKF v0.1, mmdc-tech/mmdc-runbook) into a Lore vault.
//   node scripts/import/mmdc-runbook.ts <source checkout> <vault created with pnpm create-vault>
//
// The top half is the MMDC mapping (namespaces, themes, where each document goes). The bottom
// half is generic: link rewriting, provenance, image extraction, splitting oversized notes, and
// converting evals to golden questions. Re-running it produces the same ids and files.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import {
  applyTextEdits,
  buildNoteText,
  countWords,
  DiskSource,
  extractLinks,
  fix,
  generateIndexes,
  isExternalHref,
  lint,
  loadVault,
  parseNote,
  slugify,
  str,
  strList,
  type Issue,
} from "../../packages/okf/src/index.ts";

const SRC = process.argv[2] ?? "/Users/polaris/projects/mmdc/mmdc_runbook";
const OUT = process.argv[3] ?? "/Users/polaris/projects/mmdc/mmdc-vault";
const REPO_URL = "https://github.com/mmdc-tech/mmdc-runbook";
const SHA = execFileSync("git", ["rev-parse", "HEAD"], { cwd: SRC, encoding: "utf8" }).trim();
const SHA7 = SHA.slice(0, 7);
const TODAY = new Date().toISOString().slice(0, 10);
const IMPORTER = "process:mmdc-runbook-import";
const OWNER = "mmdc-tech";

// =================================================================================================
// MMDC mapping

const NAMESPACES: Record<string, { title: string; description: string }> = {
  platform: {
    title: "Platform",
    description:
      "Systems, integrations, AWS Lambda functions, deployments, and incident history run by the MMDC tech team.",
  },
  "enrollment-ops": {
    title: "Enrollment operations",
    description:
      "Term-by-term operating procedures: enrollment readiness and close-out, GSA, official receipts, ID cards, and reminders.",
  },
  "it-support": {
    title: "IT support",
    description:
      "Staff and learner accounts, service desk tooling, and endpoint security operations.",
  },
  documentation: {
    title: "Documentation program",
    description:
      "How MMDC's operational knowledge base is planned, audited, and governed, including migration records.",
  },
};

const THEMES: Record<
  string,
  { title: string; description: string; intro: string; aliases?: string[] }
> = {
  enrollment: {
    title: "Enrollment lifecycle",
    description:
      "The learner journey from website inquiry and Apply Now through admission, course enrollment, and activation.",
    intro:
      "Enrollment spans the website and Payload CMS, EnrollMate, Salesforce, n8n, Process Automations, and Camu. Start with the end-to-end process baseline and the stage-convergence workflow, then use the runbooks for readiness, stuck stages, and close-out.",
    aliases: ["enrolment", "admissions", "apply now"],
  },
  "learner-accounts": {
    title: "Learner accounts and credentials",
    description:
      "Learner identity after enrollment: MMDC Google Workspace accounts, Camu login credentials, EnrollMate login, and student ID cards.",
    intro:
      "Learner accounts are created by EnrollMate Serverless Functions in Google Workspace, written back to Salesforce, and then pushed to Camu by Process Automations. Most incidents here are sync failures between those steps.",
    aliases: ["credentials", "gmail accounts", "student accounts"],
  },
  "billing-and-payments": {
    title: "Billing and payments",
    description:
      "GSA assessments, payments, official receipts, and the SFTP and Camu steps that move them between systems.",
    intro:
      "Billing covers the GSA returned by MMCL, learner payments, official receipt ingestion, and manual payment uploads to Camu.",
    aliases: ["gsa", "payments", "official receipts"],
  },
  integrations: {
    title: "Integrations and data sync",
    description:
      "How data moves between Salesforce, EnrollMate, Camu, MMCL SFTP, Confluent Kafka, and n8n, and how to recover when it stops.",
    intro:
      "Integrations are where most operational incidents start. Each workflow note traces one cross-system flow; the runbooks cover diagnosis and recovery.",
    aliases: ["sync", "data sync"],
  },
  "cloud-operations": {
    title: "Cloud operations",
    description:
      "AWS infrastructure, the Lambda inventory, deployments and releases, runtime configuration, and cost.",
    intro:
      "Cloud operations covers the AWS accounts behind MMDC systems: Lambda functions, S3 and CloudFront, RDS, EC2, and the deploy paths for each application.",
    aliases: ["aws", "infrastructure", "devops"],
  },
  security: {
    title: "Security and credentials",
    description:
      "Credential handling and rotation, secret locations, endpoint security, and server hardening.",
    intro:
      "Secrets never live in this vault. These notes say where credentials are kept, how to rotate them, and how endpoint and server security findings are handled.",
    aliases: ["secrets", "hardening"],
  },
  "service-desk": {
    title: "Service desk",
    description: "Handling support requests for Camu, Google Workspace, and Zendesk agents.",
    intro: "Procedures the service desk and IT follow when staff or learners ask for help.",
    aliases: ["support", "helpdesk"],
  },
  documentation: {
    title: "Documentation program",
    description:
      "Plans, audits, ledgers, and conventions for keeping MMDC's operational knowledge answerable from this vault.",
    intro:
      "The documentation program exists so that an agent or a person can answer operational questions from this vault alone, without reopening source code or ClickUp.",
    aliases: ["knowledge base", "okf"],
  },
};

/** Tags from the source registry that stay tags. The system facet becomes `systems`. */
const KEEP_TAGS: Record<string, { description: string; facet: string }> = {
  incident: {
    description: "Reactive response to an alert, outage, or degradation.",
    facet: "function",
  },
  maintenance: {
    description: "Planned, routine upkeep (rotations, cleanups, upgrades).",
    facet: "function",
  },
  deployment: {
    description: "Releasing or rolling back software to an environment.",
    facet: "function",
  },
  sev1: { description: "Critical: customer-facing outage or data loss.", facet: "severity" },
  sev2: { description: "Major: significant degradation, workaround exists.", facet: "severity" },
  sev3: { description: "Minor: limited impact, non-urgent.", facet: "severity" },
  "on-call": { description: "Content the on-call engineer needs at 3am.", facet: "role" },
  dev: { description: "Primarily relevant to development work.", facet: "role" },
  ops: { description: "Primarily relevant to operations.", facet: "role" },
  "aws-lambda": {
    description: "An AWS Lambda function from the Lambda inventory.",
    facet: "resource",
  },
  "post-incident-review": {
    description: "A write-up of a past incident: timeline, root cause, and follow-ups.",
    facet: "function",
  },
};

interface Placement {
  ns: string;
  folder?: string;
  type: string;
  themes: string[];
  /** File name without .md; defaults to the source file name. */
  slug?: string;
  extraTags?: string[];
}

const P = (
  ns: string,
  folder: string | undefined,
  type: string,
  themes: string[],
  extra: Partial<Placement> = {},
): Placement => ({
  ns,
  ...(folder ? { folder } : {}),
  type,
  themes,
  ...extra,
});

const PLACEMENT: Record<string, Placement> = {
  // Workflows become Process notes.
  "workflows/clp-application-sync.md": P("platform", "workflows", "Process", [
    "enrollment",
    "integrations",
  ]),
  "workflows/enrollmate-application-to-gmail-credentials.md": P(
    "platform",
    "workflows",
    "Process",
    ["enrollment", "learner-accounts", "integrations"],
  ),
  "workflows/enrollment-email-sending.md": P("platform", "workflows", "Process", [
    "enrollment",
    "integrations",
  ]),
  "workflows/mmcl-enrollment-sftp-exchange.md": P("platform", "workflows", "Process", [
    "integrations",
    "enrollment",
  ]),
  "workflows/salesforce-appsys-docs-validated-sync.md": P("platform", "workflows", "Process", [
    "integrations",
    "enrollment",
  ]),
  "workflows/salesforce-email-archiving.md": P("platform", "workflows", "Process", [
    "integrations",
    "cloud-operations",
  ]),
  "workflows/salesforce-enrollment-stage-convergence.md": P("platform", "workflows", "Process", [
    "enrollment",
    "integrations",
  ]),

  "runbooks/deployment/deploy-enrollmate-frontend.md": P(
    "platform",
    "runbooks/deployment",
    "Runbook",
    ["cloud-operations"],
  ),
  "runbooks/deployment/deploy-mmdc-enrollment-audit.md": P(
    "platform",
    "runbooks/deployment",
    "Runbook",
    ["cloud-operations", "documentation"],
  ),
  "runbooks/deployment/setup-enrollmate-kafka-uat-environment.md": P(
    "platform",
    "runbooks/deployment",
    "Runbook",
    ["cloud-operations", "integrations"],
  ),

  "runbooks/incident/cloudfront-cost-jump.md": P("platform", "runbooks/incident", "Runbook", [
    "cloud-operations",
  ]),
  "runbooks/incident/n8n-workflow-execution-failure-notification.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["integrations"],
  ),
  "runbooks/incident/official-receipt-sftp-ingestion-failure.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["billing-and-payments", "integrations"],
  ),
  "runbooks/incident/orders-freshness-alert.md": P("platform", "runbooks/incident", "Runbook", [
    "integrations",
  ]),
  "runbooks/incident/recover-n8n-workflow-rollback-after-restart.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["integrations", "cloud-operations"],
  ),
  "runbooks/incident/triage-application-data-sender-failure.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["integrations", "enrollment"],
  ),
  "runbooks/incident/triage-camu-credential-sync-failure.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["learner-accounts", "integrations"],
  ),
  "runbooks/incident/triage-cortex-xdr-endpoint-incidents.md": P(
    "it-support",
    "runbooks/incident",
    "Runbook",
    ["security"],
  ),
  "runbooks/incident/triage-enrollmate-login-and-ppc-access.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["learner-accounts", "enrollment"],
  ),
  "runbooks/incident/triage-gsa-salesforce-governor-limit.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["billing-and-payments", "integrations"],
  ),
  "runbooks/incident/triage-learner-workspace-salesforce-sync-failure.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["learner-accounts", "integrations"],
  ),
  "runbooks/incident/triage-salesforce-enrollment-stuck-stages.md": P(
    "platform",
    "runbooks/incident",
    "Runbook",
    ["enrollment", "integrations"],
  ),

  "runbooks/maintenance/apply-msoc-server-hardening-findings.md": P(
    "it-support",
    "runbooks",
    "Runbook",
    ["security", "cloud-operations"],
  ),
  "runbooks/maintenance/audit-aws-lambda-inventory.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["cloud-operations"],
  ),
  "runbooks/maintenance/close-and-clean-up-after-enrollment.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["enrollment"],
  ),
  "runbooks/maintenance/connect-mmcl-enrollment-sftp.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["integrations"],
  ),
  "runbooks/maintenance/generate-and-update-student-id-cards.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["learner-accounts"],
  ),
  "runbooks/maintenance/handle-camu-service-desk-requests.md": P(
    "it-support",
    "runbooks",
    "Runbook",
    ["service-desk"],
  ),
  "runbooks/maintenance/manage-google-workspace-account-lifecycle.md": P(
    "it-support",
    "runbooks",
    "Runbook",
    ["learner-accounts", "service-desk"],
  ),
  "runbooks/maintenance/manage-re-enrollment-reminder-triggers.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["enrollment"],
  ),
  "runbooks/maintenance/manage-zendesk-agents.md": P("it-support", "runbooks", "Runbook", [
    "service-desk",
  ]),
  "runbooks/maintenance/migrate-camu-credential-provisioning-to-api.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["learner-accounts", "integrations"],
  ),
  "runbooks/maintenance/operate-salesforce-email-archiving.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["integrations", "cloud-operations"],
  ),
  "runbooks/maintenance/prepare-enrollment-readiness.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["enrollment"],
  ),
  "runbooks/maintenance/reconcile-gsa-sftp-salesforce-sync.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["billing-and-payments", "integrations"],
  ),
  "runbooks/maintenance/rightsize-enrollmate-better-auth-rds.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["cloud-operations"],
  ),
  "runbooks/maintenance/rotate-salesforce-integration-credentials.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["security", "integrations"],
  ),
  "runbooks/maintenance/run-gsa-unfinalization-and-reassessment.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["billing-and-payments", "enrollment"],
  ),
  "runbooks/maintenance/update-enrollmate-frontend-runtime-config.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["cloud-operations"],
  ),
  "runbooks/maintenance/upload-official-receipts-to-camu.md": P(
    "enrollment-ops",
    "runbooks",
    "Runbook",
    ["billing-and-payments"],
  ),
  "runbooks/maintenance/verify-n8n-workflow-backup.md": P(
    "platform",
    "runbooks/maintenance",
    "Runbook",
    ["integrations", "cloud-operations"],
  ),

  "references/application-data-sender-paramiko-incident-2026-08-03.md": P(
    "platform",
    "incidents",
    "Reference",
    ["integrations"],
    { extraTags: ["post-incident-review"] },
  ),
  "references/camu-credential-backfill-incident-2026-07-31.md": P(
    "platform",
    "incidents",
    "Reference",
    ["learner-accounts"],
    { extraTags: ["post-incident-review"] },
  ),
  "references/cloudfront-cost-jump-2026-07-09.md": P(
    "platform",
    "incidents",
    "Reference",
    ["cloud-operations"],
    { extraTags: ["post-incident-review"] },
  ),
  "references/learner-workspace-salesforce-sync-incident-2026-07-29.md": P(
    "platform",
    "incidents",
    "Reference",
    ["learner-accounts", "integrations"],
    { extraTags: ["post-incident-review"] },
  ),
  "references/salesforce-gsa-governor-limit-investigation-2026-07-23.md": P(
    "platform",
    "incidents",
    "Reference",
    ["billing-and-payments", "integrations"],
    { extraTags: ["post-incident-review"] },
  ),
  "references/camu-integration-map.md": P("platform", "reference", "Reference", ["integrations"]),
  "references/credential-handling-and-secret-locations.md": P(
    "platform",
    "reference",
    "Reference",
    ["security"],
  ),
  "references/enrollmate-gap-verification-2026-07-03.md": P("platform", "reference", "Reference", [
    "enrollment",
  ]),
  "references/enrollment-integration-live-audit-2026-09-08.md": P(
    "platform",
    "reference",
    "Reference",
    ["enrollment", "integrations"],
  ),
  "references/mmcl-enrollment-sftp-operational-notes.md": P("platform", "reference", "Reference", [
    "integrations",
  ]),
  "references/rds-cost-optimization-enrollmatebetterauthdb-2026-07-09.md": P(
    "platform",
    "reference",
    "Reference",
    ["cloud-operations"],
  ),
  "references/denn-agustin-knowledge-transfer.md": P(
    "platform",
    "references",
    "Source Document",
    [],
  ),
  "references/ken-knowledge-transfer.md": P("platform", "references", "Source Document", []),
  "references/clickup-exports-operational-ledger.md": P("documentation", undefined, "Reference", [
    "documentation",
  ]),
  "references/maintenance-runbook-documentation-plan.md": P(
    "documentation",
    undefined,
    "Reference",
    ["documentation"],
  ),
  "references/okf-process-audit-2026-07-07.md": P("documentation", undefined, "Reference", [
    "documentation",
  ]),
  "references/phase-0-baseline-ledger.md": P("documentation", undefined, "Reference", [
    "documentation",
  ]),
  "references/phase-7-governance-review.md": P("documentation", undefined, "Reference", [
    "documentation",
  ]),
  "references/system-link-target-ledger.md": P("documentation", undefined, "Reference", [
    "documentation",
  ]),
  "documentation_plan.md": P("documentation", undefined, "Reference", ["documentation"], {
    slug: "documentation-plan-v2",
  }),

  "mmdc-enrollment-audit/PROCESS.md": P("platform", "enrollment-audit", "Process", ["enrollment"], {
    slug: "mmdc-bachelor-enrollment-end-to-end-process",
  }),
  "mmdc-enrollment-audit/FIELD_CATALOG.md": P(
    "platform",
    "enrollment-audit",
    "Reference",
    ["enrollment", "integrations"],
    { slug: "application-field-catalog" },
  ),
  "mmdc-enrollment-audit/DESIGN.md": P(
    "platform",
    "enrollment-audit",
    "Reference",
    ["documentation", "enrollment"],
    { slug: "enrollment-audit-explorer-design-system" },
  ),
  "mmdc-enrollment-audit/PLAN.md": P(
    "platform",
    "enrollment-audit",
    "Reference",
    ["documentation", "enrollment"],
    { slug: "enrollment-audit-explorer-build-plan" },
  ),
  "mmdc-enrollment-audit/PRODUCT.md": P(
    "platform",
    "enrollment-audit",
    "Reference",
    ["documentation", "enrollment"],
    { slug: "enrollment-audit-explorer-product" },
  ),
};

/** Source links to files that are not notes in the vault point at the source repository instead. */
const FOLDER_TARGETS: Record<string, string> = {
  "": "kb/index.md",
  systems: "kb/_systems/index.md",
  "systems/lambda-functions": "kb/platform/lambda-functions/index.md",
  runbooks: "kb/platform/runbooks/index.md",
  "runbooks/incident": "kb/platform/runbooks/incident/index.md",
  "runbooks/maintenance": "kb/platform/runbooks/maintenance/index.md",
  "runbooks/deployment": "kb/platform/runbooks/deployment/index.md",
  workflows: "kb/platform/workflows/index.md",
  references: "kb/platform/reference/index.md",
  "mmdc-enrollment-audit": "kb/platform/enrollment-audit/index.md",
};
const FILE_TARGETS: Record<string, string> = {
  "index.md": "kb/index.md",
  "hub.md": "kb/index.md",
  "log.md": "kb/log.md",
};

/** Lambda notes: themes from the inferred purpose, always with cloud operations. */
function lambdaThemes(name: string, body: string): string[] {
  // The function name is the strongest signal; the inventory's purpose text lists several
  // guesses, so only its first clause is used as a fallback.
  const firstClause = (/Inferred purpose: ([^;.]*)/.exec(body)?.[1] ?? "").toLowerCase();
  const rules: [RegExp, string][] = [
    [
      /credential|gmail|mmdc-?email|workspace|login|password|student-?id|id-?generation|idcard/i,
      "learner-accounts",
    ],
    [/payment|gsa|receipt|billing|ppc|invoice|assessment|\bor\b|official/i, "billing-and-payments"],
    [
      /application|applicant|enrol|admission|docs|document|profile|form|welcome|school|geo|validated|submitted|course|section/i,
      "enrollment",
    ],
    [/sftp|sync|kafka|salesforce|export|import|webhook|n8n|camu/i, "integrations"],
  ];
  const themes = ["cloud-operations"];
  const pick = (text: string) => rules.find(([re]) => re.test(text))?.[1];
  const theme = pick(name.replace(/[_]/g, "-")) ?? pick(firstClause);
  if (theme) themes.push(theme);
  return themes;
}

// =================================================================================================
// Generic machinery

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** A ULID whose time part is the note's timestamp and whose random part is a hash of its source path. */
function stableId(key: string, time: number): string {
  let t = time;
  let timePart = "";
  for (let i = 0; i < 10; i++) {
    timePart = CROCKFORD[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const h = createHash("sha256").update(`mmdc-runbook:${key}`).digest();
  let rand = "";
  for (let i = 0; i < 16; i++) rand += CROCKFORD[h[i]! % 32];
  return `kb_${timePart}${rand}`;
}

const sourceUrl = (path: string) =>
  `${REPO_URL}/blob/${SHA}/${path.split("/").map(encodeURIComponent).join("/")}`;
const treeUrl = (path: string) => `${REPO_URL}/tree/${SHA}/${path}`;

function git(args: string[]): string {
  return execFileSync("git", args, { cwd: SRC, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

const tracked = git(["ls-files"]).split("\n").filter(Boolean);
const trackedSet = new Set(tracked);
const trackedDirs = new Set(
  tracked.flatMap((p) =>
    p
      .split("/")
      .slice(0, -1)
      .map((_, i, a) => a.slice(0, i + 1).join("/")),
  ),
);

interface Planned {
  src: string;
  dst: string; // repository path in the vault
  placement: Placement;
  data: Record<string, unknown>;
  body: string;
}

const planned = new Map<string, Planned>();
const files = new Map<string, string | Buffer>();
const report: string[] = [];
const splits: { src: string; parts: string[] }[] = [];

function read(path: string): string {
  return readFileSync(join(SRC, path), "utf8");
}

// ---- tags registry: which tags are systems ------------------------------------------------------
const tagsMd = read("tags.md");
const systemFacet = tagsMd.split("## Facet: system")[1]!.split("\n## ")[0]!;
const SYSTEM_TAGS = new Map<string, string>(); // slug -> description
for (const m of systemFacet.matchAll(/^- `([a-z0-9-]+)` — (.*)$/gm))
  SYSTEM_TAGS.set(m[1]!, m[2]!.trim());

function splitTags(tags: string[]): { systems: string[]; tags: string[] } {
  const systems = tags.filter((t) => SYSTEM_TAGS.has(t));
  const rest = tags.filter((t) => !SYSTEM_TAGS.has(t) && KEEP_TAGS[t]);
  const unknown = tags.filter((t) => !SYSTEM_TAGS.has(t) && !KEEP_TAGS[t]);
  if (unknown.length) report.push(`dropped unknown tags ${unknown.join(", ")}`);
  return { systems, tags: rest };
}

function timestampOf(data: Record<string, unknown>): string {
  const ts = data.timestamp;
  if (ts instanceof Date) return ts.toISOString();
  if (typeof ts === "string" && !Number.isNaN(Date.parse(ts))) return ts;
  return "2026-06-30T00:00:00+08:00";
}

function provenance(src: string, data: Record<string, unknown>): Record<string, unknown> {
  return {
    generated: { by: IMPORTER, at: timestampOf(data) },
    sources: [
      { id: "mmdc-runbook", resource: sourceUrl(src), title: `mmdc-runbook ${src} at ${SHA7}` },
    ],
  };
}

// ---- 1. System hubs -----------------------------------------------------------------------------
const systemFiles = tracked.filter(
  (p) => /^systems\/[^/]+\.md$/.test(p) && !p.endsWith("/index.md"),
);
for (const src of systemFiles) {
  const note = parseNote(read(src), src);
  const tags = strList(note.data, "tags");
  const slug = tags.find((t) => SYSTEM_TAGS.has(t));
  if (!slug) {
    report.push(`system file ${src} has no system tag; skipped`);
    continue;
  }
  const title = str(note.data, "title") ?? slug;
  const aliases = [
    ...new Set(
      [title.toLowerCase(), src.split("/").pop()!.replace(/\.md$/, "")].filter(
        (a) => a !== slug && a !== title,
      ),
    ),
  ];
  planned.set(src, {
    src,
    dst: `kb/_systems/${slug}.md`,
    placement: { ns: "_systems", type: "System", themes: [] },
    data: {
      type: "System",
      title,
      description: str(note.data, "description") ?? SYSTEM_TAGS.get(slug)!,
      id: stableId(src, Date.parse(timestampOf(note.data))),
      version: "1.0.0",
      ...(aliases.length ? { aliases } : {}),
      tags: splitTags(tags).tags,
      ...(str(note.data, "resource") ? { resource: str(note.data, "resource") } : {}),
      ...provenance(src, note.data),
      system_type: str(note.data, "type"),
    },
    body: note.body,
  });
}
for (const [slug, description] of SYSTEM_TAGS) {
  if ([...planned.values()].some((p) => p.dst === `kb/_systems/${slug}.md`)) continue;
  report.push(`system tag ${slug} has no system concept; created a hub from the tag registry`);
  files.set(
    `kb/_systems/${slug}.md`,
    buildNoteText(
      {
        type: "System",
        title: slug,
        description,
        id: stableId(`tag:${slug}`, Date.parse("2026-06-30T00:00:00Z")),
        version: "1.0.0",
        generated: { by: IMPORTER, at: `${TODAY}T00:00:00Z` },
      },
      `# Overview\n\n${description}\n`,
    ),
  );
}

// ---- 2. Theme hubs ------------------------------------------------------------------------------
for (const [slug, t] of Object.entries(THEMES)) {
  files.set(
    `kb/_themes/${slug}.md`,
    buildNoteText(
      {
        type: "Theme",
        title: t.title,
        description: t.description,
        id: stableId(`theme:${slug}`, Date.parse("2026-09-24T00:00:00Z")),
        version: "1.0.0",
        ...(t.aliases ? { aliases: t.aliases } : {}),
        generated: { by: IMPORTER, at: `${TODAY}T00:00:00Z` },
      },
      `# Overview\n\n${t.intro}\n\n# Members\n\n<!-- kb:members:start -->\n<!-- kb:members:end -->\n`,
    ),
  );
}

// ---- 3. Mapped documents ------------------------------------------------------------------------
for (const [src, placement] of Object.entries(PLACEMENT)) {
  if (!trackedSet.has(src)) {
    report.push(`mapped file ${src} is not in the source repository`);
    continue;
  }
  const note = parseNote(read(src), src);
  const { systems, tags } = splitTags(strList(note.data, "tags"));
  const slug = placement.slug ?? src.split("/").pop()!.replace(/\.md$/, "");
  const dst = ["kb", placement.ns, placement.folder, `${slug}.md`].filter(Boolean).join("/");
  const resource = str(note.data, "resource");
  planned.set(src, {
    src,
    dst,
    placement,
    data: {
      type: placement.type,
      title: str(note.data, "title") ?? slug,
      description: str(note.data, "description") ?? `Imported from ${src}.`,
      id: stableId(src, Date.parse(timestampOf(note.data))),
      version: "1.0.0",
      ...(placement.themes.length ? { themes: placement.themes } : {}),
      ...(systems.length ? { systems } : {}),
      ...(tags.length || placement.extraTags
        ? { tags: [...new Set([...tags, ...(placement.extraTags ?? [])])] }
        : {}),
      ...(resource && /^[a-z]+:\/\//i.test(resource) ? { resource } : {}),
      ...provenance(src, note.data),
      ...(str(note.data, "type") && str(note.data, "type") !== placement.type
        ? { source_type: str(note.data, "type") }
        : {}),
    },
    body: note.body,
  });
}

// ---- 4. Lambda functions ------------------------------------------------------------------------
for (const src of tracked.filter(
  (p) => /^systems\/lambda-functions\/[^/]+\.md$/.test(p) && !p.endsWith("/index.md"),
)) {
  const note = parseNote(read(src), src);
  const { systems, tags } = splitTags(strList(note.data, "tags"));
  const name = str(note.data, "title") ?? src;
  const purpose = /Inferred purpose: (.*)/.exec(note.body)?.[1]?.trim().replace(/\.$/, "");
  const env = /Environment classification: `([^`]+)`/.exec(note.body)?.[1];
  const status = /Cleanup status: `([^`]+)`/.exec(note.body)?.[1];
  const description =
    `AWS Lambda function ${name}` +
    (purpose
      ? `: ${/^[A-Z][a-z]/.test(purpose) ? purpose[0]!.toLowerCase() + purpose.slice(1) : purpose}`
      : "") +
    (status?.startsWith("candidate-unused") ? " (no invocations in the July 2026 inventory)" : "") +
    ".";
  planned.set(src, {
    src,
    dst: `kb/platform/lambda-functions/${src.split("/").pop()}`,
    placement: {
      ns: "platform",
      folder: "lambda-functions",
      type: "Reference",
      themes: lambdaThemes(name, note.body),
    },
    data: {
      type: "Reference",
      title: name,
      description,
      id: stableId(src, Date.parse(timestampOf(note.data))),
      version: "1.0.0",
      themes: lambdaThemes(name, note.body),
      ...(systems.length ? { systems } : {}),
      tags: [...new Set(["aws-lambda", ...tags])],
      ...(env ? { environment: env } : {}),
      ...provenance(src, note.data),
      source_type: str(note.data, "type"),
    },
    body: note.body,
  });
}

// ---- 5. Link rewriting --------------------------------------------------------------------------
const bySrc = new Map([...planned.values()].map((p) => [p.src, p]));
/** Heading anchors that moved into a later part of a split note: `${dst}#${anchor}` -> part path. */
const movedAnchors = new Map<string, string>();

function githubSlug(heading: string): string {
  return heading
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

function targetFor(fromSrc: string, href: string): string | null {
  if (isExternalHref(href) || href.startsWith("#")) return null;
  const hash = href.indexOf("#");
  const anchor = hash >= 0 ? href.slice(hash + 1) : "";
  let path = hash >= 0 ? href.slice(0, hash) : href;
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep
  }
  const resolved = path.startsWith("/")
    ? posix.normalize(path.slice(1))
    : posix.normalize(posix.join(posix.dirname(fromSrc), path));
  const clean = resolved.replace(/\/$/, "").replace(/^\.$/, "");
  // Already a vault path (written by this importer): the source has no such top-level folders.
  const top = clean.split("/")[0]!;
  if (path.startsWith("/") && (NAMESPACES[top] || top === "_themes" || top === "_systems"))
    return null;
  const withAnchor = (p: string) => {
    const moved = anchor ? movedAnchors.get(`${p}#${anchor}`) : undefined;
    return "/" + (moved ?? p).replace(/^kb\//, "") + (anchor ? `#${anchor}` : "");
  };
  const mapped = bySrc.get(clean);
  if (mapped) return withAnchor(mapped.dst);
  if (FILE_TARGETS[clean]) return withAnchor(FILE_TARGETS[clean]!);
  if (
    clean.endsWith("/index.md") &&
    FOLDER_TARGETS[clean.slice(0, -"/index.md".length)] !== undefined
  ) {
    return withAnchor(FOLDER_TARGETS[clean.slice(0, -"/index.md".length)]!);
  }
  if (FOLDER_TARGETS[clean] !== undefined) return withAnchor(FOLDER_TARGETS[clean]!);
  if (trackedSet.has(clean)) return sourceUrl(clean) + (anchor ? `#${anchor}` : "");
  if (trackedDirs.has(clean)) return treeUrl(clean);
  report.push(
    `${fromSrc}: link "${href}" points at nothing in the source repository; left as written`,
  );
  return null;
}

function rewriteBody(src: string, body: string): string {
  const pseudo = parseNote(body, src);
  const edits = extractLinks(pseudo)
    .filter((l) => l.kind !== "wikilink")
    .flatMap((l) => {
      const next = targetFor(src, l.href);
      return next && next !== l.href
        ? [{ start: l.hrefStart, end: l.hrefEnd, text: next.includes(" ") ? `<${next}>` : next }]
        : [];
    });
  return applyTextEdits(body, edits);
}

// ---- 6. Embedded images -------------------------------------------------------------------------
function extractImages(p: Planned): void {
  const slug = p.dst.split("/").pop()!.replace(/\.md$/, "");
  p.body = p.body.replace(
    /^\[([^\]]+)\]:\s*<data:image\/(png|jpe?g|gif|webp);base64,([^>]+)>\s*$/gm,
    (_m, label: string, ext: string, data: string) => {
      const bytes = Buffer.from(data, "base64");
      const name = `${slug}-${slugify(label)}.${ext === "jpeg" ? "jpg" : ext}`;
      const path = `kb/${p.placement.ns}/_assets/${name}`;
      files.set(path, bytes);
      if (bytes.length > 2 * 1024 * 1024)
        report.push(`${path} is ${(bytes.length / 1048576).toFixed(1)} MB, over the image limit`);
      return `[${label}]: /${p.placement.ns}/_assets/${name}`;
    },
  );
}

// ---- 7. Splitting oversized notes ---------------------------------------------------------------
const WORDS_ERROR = 2500;
const PART_TARGET = 1800;

interface Unit {
  headings: string[];
  text: string;
  words: number;
}

function wordsOf(text: string): number {
  return countWords(parseNote(`---\ntype: x\n---\n${text}`, "x.md"));
}

function sectionsAt(text: string, level: number): { heading: string | null; text: string }[] {
  const re = new RegExp(`^${"#".repeat(level)} (.+)$`, "gm");
  const out: { heading: string | null; text: string }[] = [];
  let last = 0;
  let heading: string | null = null;
  // Ignore headings inside fenced code.
  const fences = [...text.matchAll(/^```[\s\S]*?^```/gm)].map((m) => [
    m.index!,
    m.index! + m[0].length,
  ]);
  for (const m of text.matchAll(re)) {
    if (fences.some(([s, e]) => m.index! > s! && m.index! < e!)) continue;
    if (m.index! > last || heading !== null) out.push({ heading, text: text.slice(last, m.index) });
    heading = m[1]!.trim();
    last = m.index!;
  }
  out.push({ heading, text: text.slice(last) });
  return out.filter((s) => s.text.trim());
}

/** Splits a big table into row groups, repeating its header. */
function splitTable(text: string, budget: number): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l, i) => l.startsWith("|") && lines[i + 1]?.startsWith("| ---"));
  if (start < 0) return [text];
  let end = start + 2;
  while (end < lines.length && lines[end]!.startsWith("|")) end++;
  const before = lines.slice(0, start).join("\n");
  const header = lines.slice(start, start + 2).join("\n");
  const rows = lines.slice(start + 2, end);
  const after = lines.slice(end).join("\n");
  const groups: string[][] = [[]];
  let words = 0;
  for (const row of rows) {
    const w = wordsOf(row);
    if (words + w > budget && groups[groups.length - 1]!.length) {
      groups.push([]);
      words = 0;
    }
    groups[groups.length - 1]!.push(row);
    words += w;
  }
  return groups.map(
    (g, i) =>
      [i === 0 ? before : "", header, ...g, i === groups.length - 1 ? after : ""]
        .join("\n")
        .trim() + "\n",
  );
}

function unitsOf(body: string): Unit[] {
  const units: Unit[] = [];
  for (const s1 of sectionsAt(body, 1)) {
    const w1 = wordsOf(s1.text);
    if (w1 <= PART_TARGET) {
      units.push({ headings: s1.heading ? [s1.heading] : [], text: s1.text, words: w1 });
      continue;
    }
    for (const s2 of sectionsAt(s1.text, 2)) {
      const heading = s2.heading ?? s1.heading;
      const w2 = wordsOf(s2.text);
      if (w2 <= PART_TARGET) {
        units.push({ headings: heading ? [heading] : [], text: s2.text, words: w2 });
        continue;
      }
      splitTable(s2.text, PART_TARGET).forEach((t, i) => {
        const text = i === 0 ? t : `${s1.heading ? `# ${s1.heading} (continued)\n\n` : ""}${t}`;
        units.push({
          headings: heading ? [i ? `${heading} (continued)` : heading] : [],
          text,
          words: wordsOf(text),
        });
      });
    }
  }
  return units;
}

function splitNote(p: Planned): Planned[] {
  const units = unitsOf(p.body);
  const citations = units.filter((u) => /^citations$/i.test(u.headings[0] ?? ""));
  const content = units.filter((u) => !citations.includes(u));
  const parts: Unit[][] = [[]];
  let words = 0;
  for (const u of content) {
    if (words + u.words > PART_TARGET && parts[parts.length - 1]!.length) {
      parts.push([]);
      words = 0;
    }
    parts[parts.length - 1]!.push(u);
    words += u.words;
  }
  if (parts.length === 1) return [p];
  const title = String(p.data.title);
  const baseSlug = p.dst.split("/").pop()!.replace(/\.md$/, "");
  const folder = p.dst.slice(0, p.dst.lastIndexOf("/"));
  const citationText = citations.map((c) => c.text).join("\n");
  const describe = (us: Unit[]) => {
    const hs = us
      .flatMap((u) => u.headings)
      .filter(Boolean)
      .map((h) => h.replace(/\s*\(continued\)$/, ""));
    const uniq = [...new Set(hs)];
    return uniq.length <= 1 ? (uniq[0] ?? "continued") : `${uniq[0]} to ${uniq[uniq.length - 1]}`;
  };
  const out: Planned[] = parts.map((us, i) => {
    const label = describe(us);
    const partTitle = i === 0 ? title : `${title}: ${label}`;
    const dst = i === 0 ? p.dst : `${folder}/${baseSlug}--${slugify(label).slice(0, 50)}.md`;
    return {
      ...p,
      dst,
      data: {
        ...p.data,
        title: partTitle,
        ...(i === 0
          ? {}
          : {
              description: `Part ${i + 1} of ${parts.length} of "${title}": ${label}.`,
              id: stableId(
                `${p.src}#part${i + 1}`,
                Date.parse(String((p.data.generated as { at: string }).at)),
              ),
            }),
      },
      body: us.map((u) => u.text).join(""),
    };
  });
  out.forEach((part, i) => {
    for (const u of parts[i]!) {
      for (const h of u.headings) movedAnchors.set(`${p.dst}#${githubSlug(h)}`, part.dst);
    }
  });
  const link = (q: Planned) => `[${String(q.data.title)}](/${q.dst.replace(/^kb\//, "")})`;
  out.forEach((part, i) => {
    const nav = out
      .map((q, j) => `${j + 1}. ${j === i ? `${String(q.data.title)} (this note)` : link(q)}`)
      .join("\n");
    const intro =
      i === 0
        ? ""
        : `This note is part ${i + 1} of ${out.length} of ${link(out[0]!)}, split to keep each note under ${WORDS_ERROR} words.\n\n`;
    const usesCitations = citationText && /\[\d+\]/.test(part.body);
    part.body =
      intro +
      part.body.trimEnd() +
      `\n\n# Parts of this note\n\n${nav}\n` +
      (usesCitations ? `\n${citationText.trimEnd()}\n` : "");
    if (i === 0)
      part.data = {
        ...part.data,
        description: `${String(p.data.description)} (Part 1 of ${out.length}.)`,
      };
  });
  splits.push({ src: p.src, parts: out.map((q) => q.dst) });
  return out;
}

// ---- 8. Evals to golden questions ---------------------------------------------------------------
function evalQuestions(): string {
  const lines = [
    "# Golden questions for retrieval and answer evaluation (TECH_STACK 10.4).",
    `# Converted from the closed-book evals in mmdc-tech/mmdc-runbook at ${SHA7} (evals/*.md).`,
    "# must_include lists the facts a correct answer contains; expect_notes are the notes that hold them.",
  ];
  for (const src of tracked.filter(
    (p) => /^evals\/[^/]+\.md$/.test(p) && !p.endsWith("index.md"),
  )) {
    const note = parseNote(read(src), src);
    const evalTitle = str(note.data, "title") ?? src;
    for (const block of note.body.split(/^## /m).slice(1)) {
      const q = /^Q\d+:\s*(.+)$/m.exec(block)?.[1]?.trim();
      if (!q) continue;
      // Bullets start at column 0; continuation lines are indented.
      const bullets: string[] = [];
      for (const line of block.split("\n").slice(1)) {
        if (line.startsWith("- ")) bullets.push(line.slice(2));
        else if (/^\s+\S/.test(line) && bullets.length)
          bullets[bullets.length - 1] += " " + line.trim();
      }
      const field = (name: RegExp) =>
        bullets
          .find((b) => name.test(b))
          ?.replace(name, "")
          .replace(/\s+/g, " ")
          .trim();
      const must = field(/^Must include:\s*/i);
      const expected = field(/^Expected sources?:\s*/i) ?? "";
      const ids = [...expected.matchAll(/`([^`]+)`|\]\(([^)\s]+)\)/g)]
        .map((m) => (m[1] ?? m[2]!).replace(/^\//, "").replace(/#.*$/, ""))
        .map((p) => bySrc.get(p)?.data.id)
        .filter((x): x is string => typeof x === "string");
      lines.push(`- q: ${JSON.stringify(q)}`, "  intent: question");
      if (ids.length) lines.push(`  expect_notes: [${[...new Set(ids)].join(", ")}]`);
      if (must) lines.push(`  must_include: ${JSON.stringify(must)}`);
      lines.push(`  source_eval: ${JSON.stringify(evalTitle)}`);
    }
  }
  return lines.join("\n") + "\n";
}

// =================================================================================================
// Run

// Rewrite links and extract images before splitting so parts inherit correct links.
for (const p of planned.values()) {
  extractImages(p);
}
// First pass to learn where headings of split notes land, then rewrite links everywhere.
const finalNotes: Planned[] = [];
for (const p of planned.values()) {
  const probe = { ...p, body: rewriteBody(p.src, p.body) };
  const words = wordsOf(probe.body);
  if (words > WORDS_ERROR && p.placement.type !== "Source Document") {
    for (const part of splitNote(p)) finalNotes.push(part);
  } else finalNotes.push(p);
}
const HUB_RE = /\]\(\/_(themes|systems)\//;
for (const p of finalNotes) {
  p.body = rewriteBody(p.src, p.body);
  // Every note links a hub; notes that did not link a system concept get their themes.
  const themes = strList(p.data, "themes");
  if (
    !HUB_RE.test(p.body) &&
    themes.length &&
    !["System", "Theme", "Source Document"].includes(String(p.data.type))
  ) {
    p.body = `${p.body.trimEnd()}\n\n# Related hubs\n\n${themes.map((t) => `- [${THEMES[t]!.title}](/_themes/${t}.md)`).join("\n")}\n`;
  }
  files.set(p.dst, buildNoteText(p.data, p.body));
}

files.set(
  "kb/documentation/translate-the-mmdc-runbook-bundle-to-lore.md",
  buildNoteText(
    {
      type: "Decision",
      title: "Translate the MMDC runbook bundle to Lore",
      description:
        "How the OKF v0.1 runbook bundle in mmdc-tech/mmdc-runbook was mapped to this Lore vault, and what changed for readers and writers.",
      id: stableId("decision:translate", Date.parse("2026-09-24T00:00:00Z")),
      version: "1.0.0",
      themes: ["documentation"],
      tags: ["ops"],
      generated: { by: IMPORTER, at: `${TODAY}T00:00:00Z` },
      sources: [
        {
          id: "mmdc-runbook",
          resource: `${REPO_URL}/tree/${SHA}`,
          title: `mmdc-runbook at ${SHA7}`,
        },
      ],
    },
    `# Context

Until ${TODAY} MMDC's operational knowledge lived in [mmdc-tech/mmdc-runbook](${REPO_URL}/tree/${SHA}),
an OKF v0.1 bundle maintained by agents following its CLAUDE.md, with a Python validator,
a flat tag registry in \`tags.md\`, and \`/hub.md\` as the routing map. Lore needs OKF v0.2
notes with ids, versions, themes, governed vocabulary, and namespaces, so the bundle was
translated by \`scripts/import/mmdc-runbook.ts\` in the Lore product repository. The
translation is re-runnable and produces the same ids every time.

# Decision

| Old bundle | This vault |
| --- | --- |
| \`/systems/<system>.md\` (Service, SaaS Platform, ...) | System hubs in [/_systems/](/_systems/index.md); the old type is kept in \`system_type\` |
| System tags in \`tags.md\` (\`camu\`, \`n8n\`, ...) | \`systems:\` on each note, one hub per system |
| Function, severity, and role tags | Kept as governed tags in \`.kb/tags.yaml\`, plus \`aws-lambda\` and \`post-incident-review\` |
| \`/systems/lambda-functions/\` (type Worker) | Reference notes in [/platform/lambda-functions/](/platform/lambda-functions/index.md), with descriptions built from each function's inferred purpose |
| \`/runbooks/{incident,maintenance,deployment}/\` | Runbook notes in the \`platform\`, \`enrollment-ops\`, and \`it-support\` namespaces |
| \`/workflows/\` (type Workflow) | Process notes in [/platform/workflows/](/platform/workflows/index.md) |
| \`/references/\` incident write-ups | Reference notes in [/platform/incidents/](/platform/incidents/index.md) tagged \`post-incident-review\` |
| Knowledge-transfer documents | Source Document notes in \`/platform/references/\`; embedded screenshots moved to \`/platform/_assets/\` |
| Plans, ledgers, and audits | The [documentation](/documentation/index.md) namespace |
| \`/mmdc-enrollment-audit/*.md\` | [/platform/enrollment-audit/](/platform/enrollment-audit/index.md) |
| \`/evals/*.md\` | Golden questions in \`.kb/eval/questions.yaml\` with \`must_include\` facts |
| \`/hub.md\` and \`index.md\` files | Generated [root index](/index.md), folder indexes, hub member lists, and the [graph report](/_meta/graph-report.md) |
| \`/log.md\` | [Vault log](/log.md), history kept |
| \`/staging/\` (empty) | Not carried over: unverified facts become draft notes with \`TODO: verify\` |

Eight themes group notes across namespaces: enrollment, learner accounts, billing and
payments, integrations, cloud operations, security, service desk, and the documentation
program. Every note has 1 to 3 of them.

Notes over 2,500 words were split into linked parts at their headings, each with a
"Parts of this note" section. Links to headings that moved follow the part they moved to.

# Consequences

- Every imported note is unverified. \`generated.by\` is \`${IMPORTER}\` and \`sources\` points at
  the original file at commit ${SHA7}. Owners should read and run \`kb verify\` on the notes
  they stand behind, starting with runbooks.
- All namespaces are owned by the \`${OWNER}\` team for now. Change owners in
  \`.kb/namespaces.yaml\` once teams are set up in Lore.
- Links to files that are not notes (CLAUDE.md, skills, tools, ClickUp exports, evals) point at
  the old repository on GitHub at ${SHA7}, so they keep working after the old bundle is archived.
- The Python validator and \`tags.md\` are replaced by \`kb lint\` and \`kb taxonomy\`.

# Related hubs

- [Documentation program](/_themes/documentation.md)
`,
  ),
);

// Vault log: the source history, with links rewritten, under a new entry for the import.
const sourceLog = rewriteBody("log.md", read("log.md")).replace(/^# .*\n+/, "");
const importEntry = `## ${TODAY}

- Imported the MMDC runbook bundle ([mmdc-tech/mmdc-runbook at ${SHA7}](${REPO_URL}/tree/${SHA})) into this Lore vault: ${finalNotes.length} notes and ${Object.keys(THEMES).length + SYSTEM_TAGS.size} hubs. See [Translate the MMDC runbook bundle to Lore](/documentation/translate-the-mmdc-runbook-bundle-to-lore.md).

`;
files.set("kb/log.md", `# Vault log\n\n${importEntry}${sourceLog}`);

// Configuration.
files.set(
  ".kb/namespaces.yaml",
  Object.entries(NAMESPACES)
    .map(
      ([slug, n]) =>
        `${slug}:\n  title: ${n.title}\n  description: ${JSON.stringify(n.description)}\n  owner: ${OWNER}\n  visibility: company\n  publishing: manual\n  ai_processing: true\n`,
    )
    .join(""),
);
files.set(
  ".kb/tags.yaml",
  "# Governed tags. System tags from the old registry became System hubs in kb/_systems/.\n" +
    Object.entries(KEEP_TAGS)
      .map(
        ([slug, t]) =>
          `${slug}: { description: ${JSON.stringify(t.description)}, aliases: [], facet: ${t.facet} }`,
      )
      .join("\n") +
    "\n",
);
files.set(".kb/eval/questions.yaml", evalQuestions());

// Write: replace the template's kb/ content, keep the rest of the template.
rmSync(join(OUT, "kb"), { recursive: true, force: true });
for (const [path, content] of files) {
  const full = join(OUT, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
const profilePath = join(OUT, ".kb/profile.yaml");
if (existsSync(profilePath)) {
  writeFileSync(
    profilePath,
    readFileSync(profilePath, "utf8")
      .replace(/^teams: .*$/m, `teams: [${OWNER}]`)
      .replace(
        /^custom_fields: .*$/m,
        "custom_fields:\n  - { name: system_type, type: string, required: false, description: The system's kind in the old bundle, for example Student Information System }\n  - { name: source_type, type: string, required: false, description: The note's type in the old bundle when it differs }\n  - { name: environment, type: string, required: false, description: Environment classification from the Lambda inventory }",
      ),
  );
}

// Fix what is safe (wikilinks, aliases), regenerate indexes, and report.
let vault = await loadVault(new DiskSource(OUT));
const first = await lint(vault);
const fixOps = await fix(vault, first);
for (const op of fixOps) if (op.op === "put") writeFileSync(join(OUT, op.path), op.content);
vault = await loadVault(new DiskSource(OUT));
for (const op of await generateIndexes(vault)) {
  const full = join(OUT, op.path);
  if (op.op === "put") {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, op.content);
  } else rmSync(full, { force: true });
}
vault = await loadVault(new DiskSource(OUT));
const final = await lint(vault);
const byRule = new Map<string, number>();
for (const i of final.issues)
  byRule.set(`${i.severity} ${i.rule}`, (byRule.get(`${i.severity} ${i.rule}`) ?? 0) + 1);

const summary = {
  source: `${REPO_URL} @ ${SHA}`,
  notes: finalNotes.length,
  hubs: { themes: Object.keys(THEMES).length, systems: SYSTEM_TAGS.size },
  images: [...files.keys()].filter((p) => p.includes("/_assets/")).length,
  splits,
  lint: {
    errors: final.errors,
    warnings: final.warnings,
    byRule: Object.fromEntries([...byRule].sort()),
  },
  notes_on_import: [...new Set(report)],
  errors: final.issues
    .filter((i: Issue) => i.severity === "error")
    .map((i) => `${i.path}:${i.line ?? 1} ${i.rule} ${i.message}`),
};
mkdirSync(join(OUT, ".kb/.cache"), { recursive: true });
writeFileSync(join(OUT, ".kb/.cache/import-summary.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, errors: summary.errors.slice(0, 40) }, null, 2));
