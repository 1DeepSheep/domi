const assert = require("node:assert/strict");
const test = require("node:test");

const {
  createRunUsageTracker,
  normalizeCodexUsage,
  observeRawResponseUsage,
  observeThreadTokenUsage,
  runUsageSnapshot
} = require("../electron/codex-token-usage.cjs");

test("usage normalization supports SDK and Responses shapes and clamps cached input", () => {
  assert.deepEqual(normalizeCodexUsage({
    inputTokens: 100,
    cachedInputTokens: 140,
    cacheWriteInputTokens: 12,
    outputTokens: 20,
    reasoningOutputTokens: 8
  }), {
    input_tokens: 100,
    cached_input_tokens: 100,
    cache_write_input_tokens: 12,
    output_tokens: 20,
    reasoning_output_tokens: 8
  });
  assert.deepEqual(normalizeCodexUsage({
    input_tokens: 80,
    input_tokens_details: { cached_tokens: 60, cache_write_tokens: 7 },
    output_tokens: 15,
    output_tokens_details: { reasoning_tokens: 5 }
  }), {
    input_tokens: 80,
    cached_input_tokens: 60,
    cache_write_input_tokens: 7,
    output_tokens: 15,
    reasoning_output_tokens: 5
  });
});

test("raw response usage accumulates every visible upstream completion for one run", () => {
  const tracker = createRunUsageTracker();
  observeRawResponseUsage(tracker, {
    inputTokens: 100,
    cachedInputTokens: 70,
    cacheWriteInputTokens: 9,
    outputTokens: 12,
    reasoningOutputTokens: 4
  });
  observeRawResponseUsage(tracker, {
    inputTokens: 140,
    cachedInputTokens: 100,
    cacheWriteInputTokens: 11,
    outputTokens: 18,
    reasoningOutputTokens: 6
  });

  assert.deepEqual(runUsageSnapshot(tracker, true), {
    input_tokens: 240,
    cached_input_tokens: 170,
    cache_write_input_tokens: 20,
    output_tokens: 30,
    reasoning_output_tokens: 10,
    usage_scope: "run_observed",
    usage_complete: true,
    usage_source: "raw_response",
    usage_samples: 2
  });
});

test("thread totals provide a deduplicated fallback and exact raw usage supersedes it", () => {
  const tracker = createRunUsageTracker();
  observeThreadTokenUsage(tracker, {
    total: {
      inputTokens: 1_000,
      cachedInputTokens: 800,
      cacheWriteInputTokens: 100,
      outputTokens: 100,
      reasoningOutputTokens: 40
    },
    last: {
      inputTokens: 100,
      cachedInputTokens: 80,
      cacheWriteInputTokens: 10,
      outputTokens: 10,
      reasoningOutputTokens: 4
    }
  });
  const secondTotal = {
    inputTokens: 1_150,
    cachedInputTokens: 920,
    cacheWriteInputTokens: 115,
    outputTokens: 120,
    reasoningOutputTokens: 46
  };
  observeThreadTokenUsage(tracker, {
    total: secondTotal,
    last: {
      inputTokens: 150,
      cachedInputTokens: 120,
      cacheWriteInputTokens: 15,
      outputTokens: 20,
      reasoningOutputTokens: 6
    }
  });
  observeThreadTokenUsage(tracker, { total: secondTotal, last: secondTotal });

  assert.deepEqual(runUsageSnapshot(tracker, false), {
    input_tokens: 250,
    cached_input_tokens: 200,
    cache_write_input_tokens: 25,
    output_tokens: 30,
    reasoning_output_tokens: 10,
    usage_scope: "run_observed",
    usage_complete: false,
    usage_source: "thread_updates",
    usage_samples: 2
  });

  observeRawResponseUsage(tracker, {
    inputTokens: 75,
    cachedInputTokens: 50,
    cacheWriteInputTokens: 5,
    outputTokens: 9,
    reasoningOutputTokens: 3
  });
  assert.deepEqual(runUsageSnapshot(tracker, true), {
    input_tokens: 75,
    cached_input_tokens: 50,
    cache_write_input_tokens: 5,
    output_tokens: 9,
    reasoning_output_tokens: 3,
    usage_scope: "run_observed",
    usage_complete: true,
    usage_source: "raw_response",
    usage_samples: 1
  });
});

test("failed or canceled terminal snapshots never claim complete usage", () => {
  const tracker = createRunUsageTracker();
  observeRawResponseUsage(tracker, {
    inputTokens: 50,
    cachedInputTokens: 25,
    outputTokens: 5,
    reasoningOutputTokens: 2
  });
  assert.equal(runUsageSnapshot(tracker, false).usage_complete, false);
});
