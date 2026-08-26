const EMPTY_CODEX_USAGE = Object.freeze({
  input_tokens: 0,
  cached_input_tokens: 0,
  cache_write_input_tokens: 0,
  output_tokens: 0,
  reasoning_output_tokens: 0
});

function tokenCount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function nestedValue(source, path) {
  let current = source;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = current[key];
  }
  return current;
}

function firstTokenCount(source, paths) {
  for (const path of paths) {
    const value = nestedValue(source, path);
    if (value !== undefined && value !== null) return tokenCount(value);
  }
  return 0;
}

function normalizeCodexUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = firstTokenCount(usage, [
    ["input_tokens"],
    ["inputTokens"],
    ["prompt_tokens"],
    ["promptTokens"]
  ]);
  const rawCachedInputTokens = firstTokenCount(usage, [
    ["cached_input_tokens"],
    ["cachedInputTokens"],
    ["input_tokens_details", "cached_tokens"],
    ["inputTokensDetails", "cachedTokens"],
    ["prompt_tokens_details", "cached_tokens"],
    ["promptTokensDetails", "cachedTokens"]
  ]);
  const cachedInputTokens = Math.min(inputTokens, rawCachedInputTokens);
  const cacheWriteInputTokens = firstTokenCount(usage, [
    ["cache_write_input_tokens"],
    ["cacheWriteInputTokens"],
    ["input_tokens_details", "cache_write_tokens"],
    ["inputTokensDetails", "cacheWriteTokens"],
    ["prompt_tokens_details", "cache_write_tokens"],
    ["promptTokensDetails", "cacheWriteTokens"]
  ]);
  return {
    input_tokens: inputTokens,
    cached_input_tokens: cachedInputTokens,
    cache_write_input_tokens: cacheWriteInputTokens,
    output_tokens: firstTokenCount(usage, [
      ["output_tokens"],
      ["outputTokens"],
      ["completion_tokens"],
      ["completionTokens"]
    ]),
    reasoning_output_tokens: firstTokenCount(usage, [
      ["reasoning_output_tokens"],
      ["reasoningOutputTokens"],
      ["output_tokens_details", "reasoning_tokens"],
      ["outputTokensDetails", "reasoningTokens"],
      ["completion_tokens_details", "reasoning_tokens"],
      ["completionTokensDetails", "reasoningTokens"]
    ])
  };
}

function addCodexUsage(left = EMPTY_CODEX_USAGE, right = EMPTY_CODEX_USAGE) {
  return {
    input_tokens: tokenCount(left.input_tokens) + tokenCount(right.input_tokens),
    cached_input_tokens: tokenCount(left.cached_input_tokens) + tokenCount(right.cached_input_tokens),
    cache_write_input_tokens: tokenCount(left.cache_write_input_tokens)
      + tokenCount(right.cache_write_input_tokens),
    output_tokens: tokenCount(left.output_tokens) + tokenCount(right.output_tokens),
    reasoning_output_tokens: tokenCount(left.reasoning_output_tokens)
      + tokenCount(right.reasoning_output_tokens)
  };
}

function subtractCodexUsage(current, previous) {
  if (!current || !previous) return null;
  return normalizeCodexUsage({
    input_tokens: Math.max(0, current.input_tokens - previous.input_tokens),
    cached_input_tokens: Math.max(0, current.cached_input_tokens - previous.cached_input_tokens),
    cache_write_input_tokens: Math.max(
      0,
      current.cache_write_input_tokens - previous.cache_write_input_tokens
    ),
    output_tokens: Math.max(0, current.output_tokens - previous.output_tokens),
    reasoning_output_tokens: Math.max(
      0,
      current.reasoning_output_tokens - previous.reasoning_output_tokens
    )
  });
}

function usageHasTokens(usage) {
  return Boolean(usage && Object.values(usage).some((value) => tokenCount(value) > 0));
}

function createRunUsageTracker() {
  return {
    usage: { ...EMPTY_CODEX_USAGE },
    samples: 0,
    source: "none",
    rawResponseSeen: false,
    lastThreadTotal: null
  };
}

function observeRawResponseUsage(tracker, rawUsage) {
  const usage = normalizeCodexUsage(rawUsage);
  if (!usage) return null;
  if (!tracker.rawResponseSeen) {
    // Raw-response notifications are exact per upstream completion. Discard
    // any earlier thread-update fallback estimate before switching sources.
    tracker.usage = { ...EMPTY_CODEX_USAGE };
    tracker.samples = 0;
    tracker.source = "raw_response";
    tracker.rawResponseSeen = true;
  }
  tracker.usage = addCodexUsage(tracker.usage, usage);
  tracker.samples += 1;
  return usage;
}

function observeThreadTokenUsage(tracker, tokenUsage) {
  const total = normalizeCodexUsage(tokenUsage?.total);
  const last = normalizeCodexUsage(tokenUsage?.last);
  const previousTotal = tracker.lastThreadTotal;
  if (total) tracker.lastThreadTotal = total;
  if (tracker.rawResponseSeen) return null;

  const observed = previousTotal && total
    ? subtractCodexUsage(total, previousTotal)
    : last;
  if (!usageHasTokens(observed)) return null;
  tracker.usage = addCodexUsage(tracker.usage, observed);
  tracker.samples += 1;
  tracker.source = "thread_updates";
  return observed;
}

function runUsageSnapshot(tracker, complete = false) {
  return {
    ...addCodexUsage(EMPTY_CODEX_USAGE, tracker?.usage),
    usage_scope: "run_observed",
    usage_complete: Boolean(complete && tracker?.samples > 0),
    usage_source: tracker?.source || "none",
    usage_samples: tokenCount(tracker?.samples)
  };
}

module.exports = {
  EMPTY_CODEX_USAGE,
  addCodexUsage,
  createRunUsageTracker,
  normalizeCodexUsage,
  observeRawResponseUsage,
  observeThreadTokenUsage,
  runUsageSnapshot,
  subtractCodexUsage
};
