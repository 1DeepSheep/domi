const assert = require("node:assert/strict");
const test = require("node:test");
const {
  isTransientNavigationError,
  safeError
} = require("../electron/plaud-worker.cjs");

test("PLAUD worker retries a refused local DevTools connection", () => {
  const error = new Error(
    "browserType.connectOverCDP: WebSocket error: connect ECONNREFUSED 127.0.0.1:64305"
  );
  assert.equal(isTransientNavigationError(error), true);
});

test("PLAUD worker hides raw CDP details behind an actionable message", () => {
  const error = new Error([
    "browserType.connectOverCDP: WebSocket error: connect ECONNREFUSED 127.0.0.1:64305",
    "Call log:",
    "ws://127.0.0.1:64305/devtools/browser/private-id"
  ].join("\n"));
  const message = safeError(error);
  assert.equal(
    message,
    "PLAUD 专用浏览器未能建立本机连接。请重新同步；domi 会清理旧连接后自动重试。"
  );
  assert.equal(message.includes("64305"), false);
  assert.equal(message.includes("devtools/browser"), false);
});
