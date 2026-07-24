const assert = require("node:assert/strict");
const { classifyCodexTurnStatus } = require("../electron/codex-turn-status.cjs");

assert.equal(classifyCodexTurnStatus("completed"), "completed");
assert.equal(classifyCodexTurnStatus("failed"), "failed");
assert.equal(classifyCodexTurnStatus("interrupted"), "stopped");
assert.equal(classifyCodexTurnStatus("cancelled"), "stopped");
assert.equal(classifyCodexTurnStatus("canceled"), "stopped");
assert.equal(classifyCodexTurnStatus("unknown"), "unknown");
assert.equal(classifyCodexTurnStatus("failed", true), "running");

console.log("codex turn status tests passed");
