import { z } from "zod";

/** Actor strings: `human:<id>`, `<job>/<model>`, or `process:<name>`. */
export const ActorSchema = z
  .string()
  .regex(
    /^(human:[^\s]+|process:[^\s]+|[^\s/:]+\/[^\s]+)$/,
    "Actor must be human:<id>, <job>/<model>, or process:<name>",
  );

const Instant = z.iso.datetime({ offset: true });

/** Schema of one `verified` entry. */
export const VerificationSchema = z.object({ by: ActorSchema, at: Instant });

/** Schema of one `sources` entry: where a note's content came from. */
export const SourceSchema = z
  .object({
    id: z.string().optional(),
    resource: z.string().optional(),
    title: z.string().optional(),
  })
  .loose();

/** The three lifecycle states of a note. */
export const StatusSchema = z.enum(["draft", "stable", "deprecated"]);

/** Lore's frontmatter fields. Unknown keys pass through untouched. */
export const NoteDataSchema = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    id: z.string(),
    version: z.string(),
    themes: z.array(z.string()),
    systems: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    owner: z.string().optional(),
    aliases: z.array(z.string()).optional(),
    resource: z.string().optional(),
    status: StatusSchema.optional(),
    generated: VerificationSchema.optional(),
    verified: z.union([VerificationSchema, z.array(VerificationSchema)]).optional(),
    stale_after: Instant.optional(),
    sources: z.array(SourceSchema).optional(),
    superseded_by: z.string().optional(),
  })
  .loose();

/** Typed view of a note's frontmatter. Unknown keys are kept. */
export type NoteData = z.infer<typeof NoteDataSchema>;

/** Field types a Request Type may ask for. */
export const REQUEST_FIELD_TYPES = [
  "email",
  "text",
  "select",
  "date",
  "number",
  "boolean",
] as const;

/** Schema of one intake field on a Request Type. */
export const RequestFieldSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, "Field names are snake_case"),
    type: z.enum(REQUEST_FIELD_TYPES),
    required: z.boolean().optional(),
    label: z.string().optional(),
    options: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  })
  .loose()
  .superRefine((f, ctx) => {
    if (f.type === "select" && (!f.options || f.options.length === 0)) {
      ctx.addIssue({ code: "custom", message: `Select field "${f.name}" needs options` });
    }
  });

/** Schema of the extra frontmatter on a Request Type note. */
export const RequestTypeSchema = z
  .object({
    kind: z.enum(["request", "incident"]),
    route_to: z.string().min(1),
    follow_up_after: z.iso.duration().optional(),
    self_service: z.string().optional(),
    runbook: z.string().optional(),
    fields: z.array(RequestFieldSchema).min(1),
    examples: z.array(z.string()).optional(),
  })
  .loose()
  .superRefine((rt, ctx) => {
    const seen = new Set<string>();
    for (const f of rt.fields) {
      if (seen.has(f.name))
        ctx.addIssue({ code: "custom", message: `Duplicate field name "${f.name}"` });
      seen.add(f.name);
    }
  });

/** Parameter types an Action may declare. */
export const PARAMETER_TYPES = [
  "string",
  "number",
  "integer",
  "boolean",
  "date",
  "email",
  "enum",
] as const;

/** Schema of one parameter on an Action. */
export const ActionParameterSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]*$/, "Parameter names are snake_case"),
    type: z.enum(PARAMETER_TYPES),
    required: z.boolean().optional(),
    description: z.string().optional(),
    values: z.array(z.union([z.string(), z.number()]).transform(String)).optional(),
  })
  .loose()
  .superRefine((p, ctx) => {
    if (p.type === "enum" && (!p.values || p.values.length === 0)) {
      ctx.addIssue({ code: "custom", message: `Enum parameter "${p.name}" needs values` });
    }
  });

/** Schema of the extra frontmatter on an Action note (PRD 11.3). */
export const ActionSchema = z
  .object({
    execution: z.enum(["auto", "approval", "manual"]),
    risk: z.enum(["low", "medium", "high"]),
    approvers: z.array(z.string()).optional(),
    runtime: z.string().optional(),
    parameters: z.array(ActionParameterSchema),
    executor: z
      .object({ resource: z.string().min(1), receipt: z.array(z.string()).optional() })
      .loose(),
  })
  .loose()
  .superRefine((a, ctx) => {
    const seen = new Set<string>();
    for (const p of a.parameters) {
      if (seen.has(p.name))
        ctx.addIssue({ code: "custom", message: `Duplicate parameter "${p.name}"` });
      seen.add(p.name);
    }
    if (a.execution === "approval" && (!a.approvers || a.approvers.length === 0)) {
      ctx.addIssue({
        code: "custom",
        message: "Actions with execution: approval need at least one approver",
      });
    }
  });

/** Formats zod issues as short strings with their path. */
export function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message));
}
