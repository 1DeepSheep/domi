const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isTransientNavigationError,
  list,
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

test("PLAUD worker pages through recordings with a one-item look-ahead", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clientPath = path.join(
    root,
    "skills",
    "plaud",
    "vendor",
    "plaud-cli",
    "src",
    "plaud.js"
  );
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  fs.writeFileSync(clientPath, `
class PlaudClient {
  async init() { return this; }
  async close() {}
  async listFiles(options) {
    globalThis.__domiPlaudListOptions = options;
    return Array.from({ length: 51 }, (_, index) => ({
      id: "recording-" + index,
      filename: "录音-" + index,
      start_time: 1000 - index
    }));
  }
}
module.exports = { PlaudClient };
`);

  const result = await list(root, 50, 100);

  assert.equal(result.offset, 100);
  assert.equal(result.limit, 50);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 150);
  assert.equal(result.items.length, 50);
  assert.equal(globalThis.__domiPlaudListOptions.limit, 51);
  assert.equal(globalThis.__domiPlaudListOptions.skip, 100);
  delete globalThis.__domiPlaudListOptions;
});

test("PLAUD worker preserves server order when the first page also counts pending recordings", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-worker-order-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const clientPath = path.join(
    root,
    "skills",
    "plaud",
    "vendor",
    "plaud-cli",
    "src",
    "plaud.js"
  );
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  fs.writeFileSync(clientPath, `
class PlaudClient {
  async init() { return this; }
  async close() {}
  async listFiles() {
    return Array.from({ length: 100 }, (_, index) => ({
      id: "server-rank-" + index,
      filename: "录音-" + index,
      start_time: index < 50 ? 1000 - index : 2000 - index
    }));
  }
}
module.exports = { PlaudClient };
`);

  const result = await list(root, 50, 0);

  assert.deepEqual(
    result.items.map((item) => item.fileId),
    Array.from({ length: 50 }, (_, index) => `server-rank-${index}`)
  );
});
