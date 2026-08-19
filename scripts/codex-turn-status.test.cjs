const assert = require("node:assert/strict");
const {
  classifyCodexTurnStatus,
  codexReconnectNotice
} = require("../electron/codex-turn-status.cjs");

assert.equal(classifyCodexTurnStatus("completed"), "completed");
assert.equal(classifyCodexTurnStatus("failed"), "failed");
assert.equal(classifyCodexTurnStatus("interrupted"), "stopped");
assert.equal(classifyCodexTurnStatus("cancelled"), "stopped");
assert.equal(classifyCodexTurnStatus("canceled"), "stopped");
assert.equal(classifyCodexTurnStatus("unknown"), "unknown");
assert.equal(classifyCodexTurnStatus("failed", true), "running");

assert.deepEqual(
  codexReconnectNotice({ message: "Reconnecting... 4/5" }),
  {
    message: "Reconnecting... 4/5",
    attempt: 4,
    total: 5,
    summary: "连接波动，正在自动恢复（4/5）"
  }
);
assert.deepEqual(
  codexReconnectNotice({ error: { message: "stream disconnected; retrying 2/5" } }),
  {
    message: "stream disconnected; retrying 2/5",
    attempt: 2,
    total: 5,
    summary: "连接波动，正在自动恢复（2/5）"
  }
);
assert.deepEqual(
  codexReconnectNotice({ message: "temporary transport error", willRetry: true }),
  {
    message: "temporary transport error",
    attempt: null,
    total: null,
    summary: "连接波动，正在自动恢复"
  }
);
assert.equal(
  codexReconnectNotice({ error: { message: "stream disconnected before completion" } }),
  null
);

console.log("codex turn status tests passed");
