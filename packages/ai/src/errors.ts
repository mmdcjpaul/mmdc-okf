/**
 * No model could answer: AI is off, no key is configured, or the primary and the fallback
 * both failed. Callers degrade (search-only answers, uploads saved as drafts) instead of
 * failing.
 */
export class AiUnavailableError extends Error {
  readonly reason: "off" | "not_configured" | "failed";
  constructor(reason: AiUnavailableError["reason"], message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AiUnavailableError";
    this.reason = reason;
  }
}

/** A budget is used up. The work can wait; nothing is wrong with it. */
export class BudgetExceededError extends Error {
  readonly scope: "organization" | "task" | "person";
  readonly limitUsd: number;
  readonly spentUsd: number;
  constructor(
    scope: BudgetExceededError["scope"],
    limitUsd: number,
    spentUsd: number,
    what: string,
  ) {
    super(`${what} has used $${spentUsd.toFixed(2)} of its $${limitUsd.toFixed(2)} budget`);
    this.name = "BudgetExceededError";
    this.scope = scope;
    this.limitUsd = limitUsd;
    this.spentUsd = spentUsd;
  }
}

/** The model answered, but not with something that fits the schema. */
export class InvalidOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "InvalidOutputError";
  }
}
