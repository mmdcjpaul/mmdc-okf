import type { z } from "zod";
import type { TokenUsage } from "./prices.ts";

/**
 * One request to a model. The parts are ordered from most stable to least, because prompt
 * caches match on a prefix: instructions change with releases, context (the vocabulary, the
 * profile) changes when the vault does, and the input changes on every call.
 */
export interface ModelRequest<T> {
  /** What the model is asked to do. The same for every call of a task. */
  instructions: string;
  /**
   * Reference material that changes rarely, such as the vocabulary. Cached after the
   * instructions.
   */
  context?: string[];
  /** This call's material: the document, the question. Never cached. */
  input: string;
  /** Images for models that read them, as bytes. */
  images?: { bytes: Uint8Array; mediaType: string }[];
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  signal?: AbortSignal;
}

export interface ModelResponse<T> {
  output: T;
  usage: TokenUsage;
}

/** A model behind a provider. The gateway picks one per task and handles everything else. */
export interface ModelProvider {
  /** True when the provider has what it needs (a key) to be called. */
  available(provider: string): boolean;
  generate<T>(provider: string, model: string, request: ModelRequest<T>): Promise<ModelResponse<T>>;
}

/**
 * Wraps material that came from outside (an uploaded document, a note body) so the model
 * reads it as data. Anything in it that looks like an instruction is part of the document.
 */
export function asData(label: string, text: string): string {
  // A document cannot close its own wrapper.
  const safe = text.replaceAll(/<\/?document\b[^>]*>/gi, (m) => m.replace("<", "&lt;"));
  return `<document label=${JSON.stringify(label)}>\n${safe}\n</document>`;
}
