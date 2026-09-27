/**
 * What a call costs. Prices are US dollars per million tokens.
 *
 * Only models whose prices are known are listed. A model that is not here is logged with
 * its token counts and a cost of zero, marked unpriced, until an admin adds its price in
 * settings: a wrong price is worse than a missing one, because budgets act on it.
 */
export interface ModelPrice {
  input: number;
  output: number;
  /** Tokens read from the provider's prompt cache. */
  cacheRead: number;
  /** Tokens written to the provider's prompt cache. */
  cacheWrite: number;
  /** Multiplier for calls made through the provider's batch API. */
  batch: number;
}

/** Anthropic prices: cache reads cost a tenth of input, cache writes a quarter more. */
const anthropic = (input: number, output: number): ModelPrice => ({
  input,
  output,
  cacheRead: input * 0.1,
  cacheWrite: input * 1.25,
  batch: 0.5,
});

export const DEFAULT_PRICES: Record<string, ModelPrice> = {
  "anthropic:claude-opus-5": anthropic(5, 25),
  "anthropic:claude-sonnet-5": anthropic(2, 10),
  "anthropic:claude-haiku-4-5": anthropic(1, 5),
};

export interface TokenUsage {
  /** Input tokens that were neither read from nor written to the cache. */
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface Cost {
  usd: number;
  /** False when the model has no price, so the cost is zero and budgets cannot see it. */
  priced: boolean;
}

/** Strips a dated suffix, so `claude-haiku-4-5-20251001` is priced as `claude-haiku-4-5`. */
export function priceKey(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function costOf(
  model: string,
  usage: TokenUsage,
  opts: { batch?: boolean; prices?: Record<string, ModelPrice> } = {},
): Cost {
  const prices = { ...DEFAULT_PRICES, ...opts.prices };
  const price = prices[model] ?? prices[priceKey(model)];
  if (!price) return { usd: 0, priced: false };
  const usd =
    ((usage.input * price.input +
      usage.output * price.output +
      usage.cacheRead * price.cacheRead +
      usage.cacheWrite * price.cacheWrite) /
      1_000_000) *
    (opts.batch ? price.batch : 1);
  return { usd: Math.round(usd * 1e6) / 1e6, priced: true };
}
