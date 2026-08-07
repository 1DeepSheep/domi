const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isRetryableReadError,
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

test("PLAUD worker rebuilds a detached background page without treating it as logout", () => {
  const error = new Error("page.reload: Protocol error (Page.reload): Not attached to an active page");
  assert.equal(isTransientNavigationError(error), true);
  assert.equal(isRetryableReadError(error), true);
  assert.match(safeError(error), /无需重新登录/);
});

test("PLAUD worker never retries a confirmed authentication failure", () => {
  assert.equal(
    isRetryableReadError(new Error("PLAUD_AUTH_REQUIRED: account sign-in is required")),
    false
  );
});

test("PLAUD worker does not immediately retry vendor rate limits", () => {
  assert.equal(isRetryableReadError(new Error("List files failed: HTTP 429")), false);
  assert.equal(isRetryableReadError(new Error("too many requests: rate limit")), false);
});

test("PLAUD worker never maps generic 401, 403 or 429 responses to a visible login", () => {
  assert.match(safeError(new Error("List files failed: HTTP 401")), /PLAUD_UNAUTHORIZED/);
  assert.match(safeError(new Error("List files failed: HTTP 403")), /PLAUD_ACCESS_DENIED/);
  assert.match(safeError(new Error("List files failed: HTTP 429")), /服务暂时限流/);
  assert.doesNotMatch(safeError(new Error("List files failed: HTTP 403")), /登录已失效/);
  assert.doesNotMatch(safeError(new Error("List files failed: HTTP 429")), /登录已失效/);
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

test("PLAUD background modules contain no foreground activation path", () => {
  const sources = [
    path.join(__dirname, "..", "electron", "plaud-worker.cjs"),
    path.join(__dirname, "..", "electron", "plaud-browser-broker.cjs")
  ].map((filePath) => fs.readFileSync(filePath, "utf8")).join("\n");
  assert.doesNotMatch(
    sources,
    /shell\.openExternal|\/usr\/bin\/open|osascript|bringToFront|\.activate\(/i
  );
  assert.match(sources, /new PlaudClient\(\{ headless: true \}\)/);
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

test("PLAUD worker retries a transient read in a fresh private browser session", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-worker-retry-"));
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
  async init() {
    globalThis.__domiPlaudRetryInitCount = (globalThis.__domiPlaudRetryInitCount || 0) + 1;
    return this;
  }
  async close() {}
  async listFiles() {
    globalThis.__domiPlaudRetryListCount = (globalThis.__domiPlaudRetryListCount || 0) + 1;
    if (globalThis.__domiPlaudRetryListCount === 1) {
      throw new Error("PLAUD API request timed out after 15000 ms");
    }
    return [{ id: "recording-recovered", filename: "已恢复录音" }];
  }
}
module.exports = { PlaudClient };
`);

  const result = await list(root, 50, 0);

  assert.equal(result.items[0].fileId, "recording-recovered");
  assert.equal(globalThis.__domiPlaudRetryInitCount, 2);
  assert.equal(globalThis.__domiPlaudRetryListCount, 2);
  delete globalThis.__domiPlaudRetryInitCount;
  delete globalThis.__domiPlaudRetryListCount;
});

test("PLAUD worker performs only one remote read when the vendor returns 429", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-worker-rate-limit-"));
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
  async init() {
    globalThis.__domiPlaudRateLimitInitCount = (globalThis.__domiPlaudRateLimitInitCount || 0) + 1;
    return this;
  }
  async close() {}
  async listFiles() {
    globalThis.__domiPlaudRateLimitReadCount = (globalThis.__domiPlaudRateLimitReadCount || 0) + 1;
    throw new Error("List files failed: HTTP 429");
  }
}
module.exports = { PlaudClient };
`);

  await assert.rejects(list(root, 50, 0), /HTTP 429/);
  assert.equal(globalThis.__domiPlaudRateLimitInitCount, 1);
  assert.equal(globalThis.__domiPlaudRateLimitReadCount, 1);
  delete globalThis.__domiPlaudRateLimitInitCount;
  delete globalThis.__domiPlaudRateLimitReadCount;
});
