import { z } from "zod";
import type { ParsedNote } from "./note.ts";
import { ActionSchema, RequestTypeSchema } from "./schema.ts";

type RequestField = z.infer<typeof RequestTypeSchema>["fields"][number];
type ActionParameter = z.infer<typeof ActionSchema>["parameters"][number];

function fieldSchema(f: RequestField): z.ZodType {
  let s: z.ZodType;
  switch (f.type) {
    case "email":
      s = z.email();
      break;
    case "text":
      s = f.required ? z.string().trim().min(1) : z.string();
      break;
    case "select":
      s = z.enum((f.options ?? []) as [string, ...string[]]);
      break;
    case "date":
      s = z.iso.date();
      break;
    case "number":
      s = z.number();
      break;
    case "boolean":
      s = z.boolean();
      break;
  }
  s = s.describe(f.label ?? f.name);
  return f.required ? s : s.optional();
}

function parameterSchema(p: ActionParameter): z.ZodType {
  let s: z.ZodType;
  switch (p.type) {
    case "string":
      s = z.string().min(1);
      break;
    case "number":
      s = z.number();
      break;
    case "integer":
      s = z.number().int();
      break;
    case "boolean":
      s = z.boolean();
      break;
    case "date":
      s = z.iso.date();
      break;
    case "email":
      s = z.email();
      break;
    case "enum":
      s = z.enum((p.values ?? []) as [string, ...string[]]);
      break;
  }
  s = s.describe(p.description ?? p.name);
  return p.required ? s : s.optional();
}

/**
 * The intake form of a Request Type note as a zod object. Labels become descriptions.
 * Throws when the note's `fields` are invalid (lint reports those first).
 */
export function requestTypeSchema(note: ParsedNote): z.ZodObject<any> {
  const rt = RequestTypeSchema.parse(note.data);
  return z.object(Object.fromEntries(rt.fields.map((f) => [f.name, fieldSchema(f)])));
}

/** An Action note's parameters as a zod object, used to validate calls before they run. */
export function actionParameterSchema(note: ParsedNote): z.ZodObject<any> {
  const action = ActionSchema.parse(note.data);
  return z.object(Object.fromEntries(action.parameters.map((p) => [p.name, parameterSchema(p)])));
}
