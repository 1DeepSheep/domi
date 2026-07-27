const assert = require("node:assert/strict");
const test = require("node:test");
const {
  codexTurnContext,
  requestCodexTurn,
  runtimeAdditionalContext,
  threadPersistenceOptions
} = require("../electron/codex-run-context.cjs");

test("background runs create ephemeral Codex threads", () => {
  assert.deepEqual(threadPersistenceOptions({ ephemeral: true }), { ephemeral: true });
  assert.deepEqual(threadPersistenceOptions({ ephemeral: false }), {});
  assert.deepEqual(threadPersistenceOptions({}), {});
});

test("runtime preflight is application context instead of user prompt text", () => {
  assert.deepEqual(runtimeAdditionalContext("飞书预检已通过"), {
    "domi-runtime": {
      kind: "application",
      value: "飞书预检已通过"
    }
  });
  assert.equal(runtimeAdditionalContext("  "), undefined);
  assert.deepEqual(codexTurnContext("更新行业动态", "飞书预检已通过"), {
    input: [{ type: "text", text: "更新行业动态" }],
    additionalContext: {
      "domi-runtime": {
        kind: "application",
        value: "飞书预检已通过"
      }
    }
  });
});

test("stable compatibility mode never sends additionalContext", () => {
  const context = codexTurnContext("更新行业动态", "飞书预检已通过", {
    capabilities: { experimentalApi: false }
  });
  assert.equal(Object.hasOwn(context, "additionalContext"), false);
  assert.match(context.input[0].text, /^更新行业动态/);
  assert.match(context.input[0].text, /mode="compatibility"/);
  assert.match(context.input[0].text, /飞书预检已通过/);
});

test("turn start retries once with stable input when additionalContext is rejected", async () => {
  const calls = [];
  const compatibilityEvents = [];
  const client = {
    capabilities: () => ({ experimentalApi: true }),
    request: async (method, params) => {
      calls.push({ method, params });
      if (calls.length === 1) {
        throw new Error("turn/start.additionalContext requires experimentalApi capability");
      }
      return { turn: { id: "turn-compatible" } };
    }
  };

  const result = await requestCodexTurn(
    client,
    { threadId: "thread-1", cwd: "/tmp/project" },
    "更新行业动态",
    "飞书预检已通过",
    { onCompatibility: (event) => compatibilityEvents.push(event) }
  );

  assert.equal(result.turn.id, "turn-compatible");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].params.additionalContext);
  assert.equal(Object.hasOwn(calls[1].params, "additionalContext"), false);
  assert.match(calls[1].params.input[0].text, /飞书预检已通过/);
  assert.equal(compatibilityEvents[0].reason, "additional-context-rejected");
});

test("stable clients use compatibility input without a failed first request", async () => {
  const calls = [];
  const compatibilityEvents = [];
  const client = {
    capabilities: () => ({ experimentalApi: false }),
    request: async (method, params) => {
      calls.push({ method, params });
      return { turn: { id: "turn-stable" } };
    }
  };

  const result = await requestCodexTurn(
    client,
    { threadId: "thread-2" },
    "更新行业动态",
    "飞书预检已通过",
    { onCompatibility: (event) => compatibilityEvents.push(event) }
  );

  assert.equal(result.turn.id, "turn-stable");
  assert.equal(calls.length, 1);
  assert.equal(Object.hasOwn(calls[0].params, "additionalContext"), false);
  assert.equal(compatibilityEvents[0].reason, "stable-client");
});
