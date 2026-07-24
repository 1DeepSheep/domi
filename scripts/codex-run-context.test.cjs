const assert = require("node:assert/strict");
const test = require("node:test");
const {
  codexTurnContext,
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
