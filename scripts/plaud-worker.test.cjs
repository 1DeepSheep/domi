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

test("PLAUD worker retries Failed to fetch and closed sockets without calling them a logout", () => {
  for (const message of ["TypeError: Failed to fetch", "net::ERR_CONNECTION_CLOSED", "ECONNRESET"]) {
    assert.equal(isRetryableReadError(new Error(message)), true);
    assert.match(safeError(new Error(message)), /网络|超时/);
    assert.doesNotMatch(safeError(new Error(message)), /登录已失效/);
  }
});

test("PLAUD worker server read retry rebuilds sessions but never replays executed mutations", async (t) => {
  const { runServerCommand, closeServerClient } = require("../electron/plaud-worker.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-server-test-"));
  t.after(async () => { await closeServerClient(); fs.rmSync(root, { recursive: true, force: true }); delete globalThis.__plaudServerTest; });
  const clientPath = path.join(root, "skills", "plaud", "vendor", "plaud-cli", "src", "plaud.js");
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  fs.writeFileSync(clientPath, `module.exports.PlaudClient = class {
    async init() { globalThis.__plaudServerTest.inits++; }
    async close() { globalThis.__plaudServerTest.closes++; }
    async listFiles() { const s = globalThis.__plaudServerTest; s.reads++; if (s.reads === 1) throw new Error('Failed to fetch'); return []; }
    async api() { globalThis.__plaudServerTest.posts++; throw new Error('net::ERR_CONNECTION_CLOSED'); }
    async downloadTranscript(id, out) { const s = globalThis.__plaudServerTest; s.downloads++; s.id = id; s.out = out; if(s.downloads === 1) throw new Error('Failed to fetch'); return {mdPath: out + '/full.md', rawPath: out + '/raw.json'}; }
  };`);
  globalThis.__plaudServerTest = { inits: 0, closes: 0, reads: 0, posts: 0, downloads: 0 };
  const delays = [];
  const options = { sleep: async ms => { delays.push(ms); } };
  assert.equal((await runServerCommand(root, "connection", [], options)).connected, true);
  assert.deepEqual(delays, [400]); assert.equal(globalThis.__plaudServerTest.inits, 2);
  await assert.rejects(runServerCommand(root, "trash", ["recording-file-id"], options), /ERR_CONNECTION_CLOSED/);
  assert.equal(globalThis.__plaudServerTest.posts, 1);
  const recovered = await runServerCommand(root, "download", ["recording-file-id", root], options);
  assert.equal(recovered.transcriptPath, path.join(root, "full.md"));
  assert.equal(globalThis.__plaudServerTest.id, "recording-file-id");
  assert.equal(globalThis.__plaudServerTest.downloads, 2); assert.equal(globalThis.__plaudServerTest.posts, 1);
});

test("server releases the final broken client and a later request starts fresh", async t => {
  const { runServerCommand, closeServerClient } = require("../electron/plaud-worker.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-final-failure-"));
  const clientPath = path.join(root, "skills/plaud/vendor/plaud-cli/src/plaud.js");
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  globalThis.__plaudFinalFailure = { inits: 0, closes: 0, reads: 0 };
  fs.writeFileSync(clientPath, `module.exports.PlaudClient = class {
    async init() { globalThis.__plaudFinalFailure.inits++; }
    async close() { globalThis.__plaudFinalFailure.closes++; }
    async listFiles() { if (++globalThis.__plaudFinalFailure.reads <= 3) throw new Error('Failed to fetch'); return []; }
  };`);
  t.after(async () => { await closeServerClient(); delete globalThis.__plaudFinalFailure; fs.rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(runServerCommand(root, "list", [], { sleep: async () => {} }), /Failed to fetch/);
  assert.equal(globalThis.__plaudFinalFailure.closes, 3);
  await runServerCommand(root, "list", [], { sleep: async () => {} });
  assert.equal(globalThis.__plaudFinalFailure.inits, 4);
});

test("server passes one deadline through initialization and list and does not cold-retry an exhausted budget", async t => {
  const { runServerCommand, closeServerClient } = require("../electron/plaud-worker.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-read-deadline-"));
  const clientPath = path.join(root, "skills/plaud/vendor/plaud-cli/src/plaud.js");
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  globalThis.__plaudDeadline = { inits: 0, closes: 0, reads: 0 };
  fs.writeFileSync(clientPath, `module.exports.PlaudClient = class {
    constructor(options) { globalThis.__plaudDeadline.initDeadline = options.operationDeadlineAt; }
    async init() { globalThis.__plaudDeadline.inits++; }
    async close() { globalThis.__plaudDeadline.closes++; }
    async listFiles(options) { const s = globalThis.__plaudDeadline; s.reads++; s.readDeadline = options.deadlineAt; throw new Error('Failed to fetch'); }
  };`);
  t.after(async () => { await closeServerClient(); delete globalThis.__plaudDeadline; fs.rmSync(root, { recursive: true, force: true }); });
  const diagnostics = [];
  await assert.rejects(runServerCommand(root, "list", [], {
    now: () => 1000, deadlineAt: 5000, sleep: async () => { throw new Error("no retry budget remains"); },
    onDiagnostic: value => diagnostics.push(value)
  }), /Failed to fetch/);
  assert.deepEqual(globalThis.__plaudDeadline, { inits: 1, closes: 1, reads: 1, initDeadline: 5000, readDeadline: 5000 });
  assert.deepEqual(diagnostics.at(-1), { code: "PLAUD_NETWORK_TIMEOUT", stage: "list" });
});

test("structured worker diagnostics retain vendor Retry-After without private request data", () => {
  const { plaudErrorDetails } = require("../electron/plaud-worker.cjs");
  const syntheticAuthorization = ["Bearer", "fixture".repeat(3)].join(" ");
  const error = Object.assign(new Error(`HTTP 429 https://private.example/recording-secret Authorization: ${syntheticAuthorization}`),
    { code: "PLAUD_RATE_LIMITED", status: 429, retryAfterMs: 120000 });
  assert.deepEqual(plaudErrorDetails(error, "list"), { code: "PLAUD_RATE_LIMITED", stage: "list", httpStatus: 429, retryAfterMs: 120000 });
});

test("business auth-context rejection retains numeric diagnostics without repeating recovery", () => {
  const { plaudErrorDetails, isRetryableReadError, safeError } = require("../electron/plaud-worker.cjs");
  const error = Object.assign(new Error("List files failed: HTTP 200; API status -3901"),
    { status: 200, apiStatus: -3901 });
  assert.deepEqual(plaudErrorDetails(error, "list"), {
    code: "PLAUD_AUTH_CONTEXT_MISMATCH", stage: "list", httpStatus: 200, apiStatus: -3901
  });
  assert.equal(isRetryableReadError(error), false, "vendor owns the bounded credential recovery");
  assert.match(safeError(error), /会话尚未完成验证/);
  assert.equal(Object.hasOwn(plaudErrorDetails({ apiStatus: "private value" }), "apiStatus"), false);
});

test("server rebuilds failed tab compaction within one deadline and never replays a started write", async t => {
  const { runServerCommand, closeServerClient } = require("../electron/plaud-worker.cjs");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-compaction-"));
  const clientPath = path.join(root, "skills/plaud/vendor/plaud-cli/src/plaud.js");
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  const message = "PLAUD browser restored 2 tabs and could not be compacted safely.";
  fs.writeFileSync(clientPath, `module.exports.PlaudClient = class {
    constructor(options) { this.deadline = options.operationDeadlineAt; }
    async init() {
      const s = globalThis.__plaudCompaction; s.inits++; s.deadlines.push(this.deadline);
      if (s.failures-- > 0) {
        if (s.consumeBudget) s.clock = this.deadline - 1000;
        throw Object.assign(new Error(s.message), s.code ? {code:s.code} : {});
      }
    }
    async close() { globalThis.__plaudCompaction.closes++; }
    async listFiles() { globalThis.__plaudCompaction.reads++; return []; }
    async api() { globalThis.__plaudCompaction.writes++; throw new Error(${JSON.stringify(message)}); }
  };`);
  const fresh = failures => ({ inits: 0, closes: 0, reads: 0, writes: 0, deadlines: [], clock: 1000, failures, message });
  t.after(async () => { await closeServerClient(); delete globalThis.__plaudCompaction; fs.rmSync(root, { recursive: true, force: true }); });
  const delays = [], diagnostics = [];
  const options = { deadlineAt: 20000, now: () => globalThis.__plaudCompaction.clock,
    sleep: async delay => { delays.push(delay); globalThis.__plaudCompaction.clock += delay; },
    onDiagnostic: value => diagnostics.push(value) };
  globalThis.__plaudCompaction = fresh(2);
  await runServerCommand(root, "list", [], options);
  assert.equal(globalThis.__plaudCompaction.inits, 3);
  assert.equal(globalThis.__plaudCompaction.closes, 2);
  assert.equal(globalThis.__plaudCompaction.reads, 1);
  assert.deepEqual(globalThis.__plaudCompaction.deadlines, [20000, 20000, 20000]);
  assert.deepEqual(delays, [400, 1200]);
  assert.deepEqual(diagnostics.filter(value => value.code), [
    { code: "PLAUD_BROWSER_UNAVAILABLE", stage: "init" },
    { code: "PLAUD_BROWSER_UNAVAILABLE", stage: "init" }
  ]);
  await closeServerClient();

  globalThis.__plaudCompaction = fresh(3);
  await assert.rejects(runServerCommand(root, "list", [], options), error => error.code === "PLAUD_BROWSER_UNAVAILABLE" && error.stage === "init");
  assert.equal(globalThis.__plaudCompaction.inits, 3);
  assert.equal(globalThis.__plaudCompaction.closes, 3);
  await runServerCommand(root, "list", [], options);
  assert.equal(globalThis.__plaudCompaction.inits, 4, "A later read must construct a fresh client after final init failure");
  await closeServerClient();

  globalThis.__plaudCompaction = { ...fresh(3), consumeBudget: true };
  await assert.rejects(runServerCommand(root, "list", [], options), /could not be compacted safely/);
  assert.equal(globalThis.__plaudCompaction.inits, 1, "Do not rebuild after the shared deadline leaves insufficient startup time");
  assert.equal(globalThis.__plaudCompaction.closes, 1);

  globalThis.__plaudCompaction = fresh(0);
  await assert.rejects(runServerCommand(root, "rename", ["synthetic-recording-id", "Synthetic title"], options), /could not be compacted safely/);
  assert.equal(globalThis.__plaudCompaction.inits, 1);
  assert.equal(globalThis.__plaudCompaction.writes, 1, "Classification must not permit replaying a started PATCH or POST");
  for (const code of ["PLAUD_AUTH_REQUIRED", "PLAUD_ACCESS_DENIED", "PLAUD_RATE_LIMITED", "PLAUD_BROWSER_CONFIG_REQUIRED"]) {
    globalThis.__plaudCompaction = { ...fresh(3), code, message: `${code}: synthetic failure` };
    await assert.rejects(runServerCommand(root, "list", [], options), error => error.code === code);
    assert.equal(globalThis.__plaudCompaction.inits, 1, `${code} must not rebuild repeatedly`);
    assert.equal(globalThis.__plaudCompaction.closes, 1);
  }
});

test("typed browser init failures never expose native diagnostics or hide missing dependencies", () => {
  const { plaudErrorDetails } = require("../electron/plaud-worker.cjs");
  const error = Object.assign(new Error("Synthetic private recording; stderr https://private.invalid/synthetic-auth-url"),
    { code: "PLAUD_BROWSER_UNAVAILABLE", stage: "init" });
  assert.doesNotMatch(safeError(error), /Synthetic|private|stderr|https:/);
  assert.deepEqual(plaudErrorDetails(error), { code: "PLAUD_BROWSER_UNAVAILABLE", stage: "init" });
  assert.match(safeError(Object.assign(new Error("Cannot find module 'playwright'"),
    { code: "PLAUD_READ_FAILED", stage: "init" })), /缺少浏览器运行组件/);
  assert.equal(isRetryableReadError(new Error("PLAUD browser restored 2 tabs and could not be compacted safely.")), true);
  assert.equal(isRetryableReadError(new Error("Unrecognized synthetic startup failure")), false,
    "Do not treat arbitrary init failures as transient browser failures");
});
