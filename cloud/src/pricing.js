// Anthropic list prices (USD per million tokens) and the conversion from an
// upstream call's usage to credits. Cache writes cost 1.25x the input price
// for the 5-minute TTL and 2x for the 1-hour TTL.

/** Models users can pick. Order is the menu order. */
export const MODELS = {
  'claude-opus-5-5': { name: 'Opus 5.5', tagline: 'Best for building', input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { name: 'Sonnet 5.5', tagline: 'Fast and capable', input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': {
    name: 'Haiku 5.5', tagline: 'Quickest, lowest cost', input: 0.1, output: 0.5, cacheRead: 0.01,
    // Prompts over 100K tokens are billed on a higher rate card.
    long: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05 },
  },
  'claude-fable-5-1': { name: 'Fable 5.1', tagline: 'Most capable', input: 10, output: 50, cacheRead: 0.25 },
};

/** Models a server-side refusal fallback can hand a request to; billed at their own rates. */
const FALLBACK_TARGETS = {
  'claude-opus-5': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.2 },
};

function ratesFor(model, promptTokens) {
  const base = MODELS[model] || FALLBACK_TARGETS[model];
  if (!base) return null;
  return base.long && promptTokens > base.long.above ? base.long : base;
}

const n = (v) => (Number.isFinite(v) && v > 0 ? v : 0);

/** One attempt's usage block → normalised token counts. */
export function tokensOf(usage = {}) {
  const write = usage.cache_creation || {};
  const write1h = n(write.ephemeral_1h_input_tokens);
  const writeTotal = n(usage.cache_creation_input_tokens);
  return {
    input: n(usage.input_tokens),
    output: n(usage.output_tokens),
    cacheRead: n(usage.cache_read_input_tokens),
    cacheWrite5m: Math.max(0, writeTotal - write1h),
    cacheWrite1h: write1h,
  };
}

/** Cost of one attempt in micro-USD (tokens x USD/MTok = micro-USD). */
function attemptCost(model, t) {
  const prompt = t.input + t.cacheRead + t.cacheWrite5m + t.cacheWrite1h;
  const r = ratesFor(model, prompt);
  if (!r) return null;
  return t.input * r.input + t.cacheRead * r.cacheRead + t.cacheWrite5m * r.input * 1.25
    + t.cacheWrite1h * r.input * 2 + t.output * r.output;
}

/**
 * What a response cost upstream. With refusal fallbacks, `usage.iterations`
 * lists every attempt and is the source of truth; each attempt is billed at
 * the rates of the model that ran it. An unknown model is billed at the
 * requested model's rates.
 * @param {string} requested model the user asked for (always a known model)
 * @param {string | null} served model that produced the message
 * @param {object} usage final usage block
 */
export function costMicros(requested, served, usage = {}) {
  const attempts = Array.isArray(usage.iterations) && usage.iterations.length
    ? usage.iterations.map((it) => ({ model: it.model || served || requested, t: tokensOf(it) }))
    : [{ model: served || requested, t: tokensOf(usage) }];
  let total = 0;
  for (const a of attempts) {
    total += attemptCost(a.model, a.t) ?? attemptCost(requested, a.t) ?? 0;
  }
  return Math.ceil(total);
}

/** Token totals across attempts, for the usage log. */
export function totalTokens(usage = {}) {
  const parts = Array.isArray(usage.iterations) && usage.iterations.length ? usage.iterations : [usage];
  return parts.reduce((sum, part) => {
    const t = tokensOf(part);
    sum.input += t.input;
    sum.output += t.output;
    sum.cacheRead += t.cacheRead;
    sum.cacheWrite += t.cacheWrite5m + t.cacheWrite1h;
    return sum;
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
}

/** micro-USD → millicredits, rounded up so no call is free. */
export function toMillicredits(micros, { creditsPerUsd, markup }) {
  if (micros <= 0) return 0;
  return Math.ceil((micros * creditsPerUsd * markup) / 1000);
}

/** How many times the default model's price a model is (for the menu). */
export function relativeCost(model, baseline) {
  const a = MODELS[model];
  const b = MODELS[baseline];
  if (!a || !b) return 1;
  // A typical agent call: mostly cached prompt plus some output.
  const typical = (r) => 20_000 * r.cacheRead + 4_000 * r.input + 2_000 * r.output;
  return Math.round((typical(a) / typical(b)) * 100) / 100;
}
