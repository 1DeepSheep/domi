const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { PlaudSessionBroker } = require("../electron/plaud-browser-broker.cjs");

function fakePluginRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-broker-"));
  const logPath = path.join(root, "events.ndjson");
  const clientPath = path.join(root, "skills", "plaud", "vendor", "plaud-cli", "src", "plaud.js");
  fs.mkdirSync(path.dirname(clientPath), { recursive: true });
  fs.writeFileSync(clientPath, `
const fs = require("node:fs");
function log(event) { fs.appendFileSync(process.env.PLAUD_BROKER_TEST_LOG, JSON.stringify(event) + "\\n"); }
class PlaudClient {
  constructor(options = {}) { this.options = options; this.browserLabel = "Test Browser"; }
  async init() { log({ event: "init", headless: this.options.headless }); return this; }
  async close() { log({ event: "close" }); }
  async listFiles(options) {
    log({ event: "list-start", skip: options.skip });
    await new Promise((resolve) => setTimeout(resolve, 30));
    log({ event: "list-end", skip: options.skip });
    return [{ id: "recording-123456", filename: "录音", start_time: 1000 }];
  }
}
module.exports = { PlaudClient };
`);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { root, logPath };
}

function readEvents(logPath) {
  return fs.existsSync(logPath)
    ? fs.readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse)
    : [];
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

test("PLAUD broker reuses one explicitly headless client and serializes requests", async (t) => {
  const fixture = fakePluginRoot(t);
  const broker = new PlaudSessionBroker({
    executable: process.execPath,
    workerPath: path.join(__dirname, "..", "electron", "plaud-worker.cjs"),
    envProvider: () => ({ PLAUD_BROKER_TEST_LOG: fixture.logPath }),
    requestTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000
  });
  t.after(() => broker.stop("test-cleanup"));

  const [first, second] = await Promise.all([
    broker.request("list", ["50", "0"], fixture.root),
    broker.request("list", ["50", "50"], fixture.root)
  ]);
  assert.equal(first.items.length, 1);
  assert.equal(second.items.length, 1);

  await broker.stop("test-finished");
  const events = readEvents(fixture.logPath);
  assert.deepEqual(
    events.map((event) => event.event),
    ["init", "list-start", "list-end", "list-start", "list-end", "close"]
  );
  assert.equal(events[0].headless, true);
  assert.equal(events.filter((event) => event.event === "init").length, 1);
});

test("PLAUD broker closes the old hidden client before switching browser Profiles", async (t) => {
  const fixture = fakePluginRoot(t);
  const broker = new PlaudSessionBroker({
    executable: process.execPath,
    workerPath: path.join(__dirname, "..", "electron", "plaud-worker.cjs"),
    envProvider: () => ({ PLAUD_BROKER_TEST_LOG: fixture.logPath }),
    requestTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000
  });
  t.after(() => broker.stop("test-cleanup"));

  await broker.request("list", ["50", "0"], fixture.root, { sessionKey: "chrome" });
  await broker.request("list", ["50", "0"], fixture.root, { sessionKey: "tabbit" });
  await broker.stop("test-finished");

  const lifecycle = readEvents(fixture.logPath)
    .map((event) => event.event)
    .filter((event) => event === "init" || event === "close");
  assert.deepEqual(lifecycle, ["init", "close", "init", "close"]);
});

test("PLAUD broker releases its hidden browser after an idle result and reconnects on demand", async (t) => {
  const fixture = fakePluginRoot(t);
  const broker = new PlaudSessionBroker({
    executable: process.execPath,
    workerPath: path.join(__dirname, "..", "electron", "plaud-worker.cjs"),
    envProvider: () => ({ PLAUD_BROKER_TEST_LOG: fixture.logPath }),
    requestTimeoutMs: 5_000,
    shutdownTimeoutMs: 2_000,
    idleTimeoutMs: 1_000
  });
  t.after(() => broker.stop("test-cleanup"));

  await broker.request("list", ["50", "0"], fixture.root);
  await wait(1_250);
  assert.equal(broker.isRunning(), false);

  await broker.request("list", ["50", "0"], fixture.root);
  await broker.stop("test-finished");
  const lifecycle = readEvents(fixture.logPath)
    .map((event) => event.event)
    .filter((event) => event === "init" || event === "close");
  assert.deepEqual(lifecycle, ["init", "close", "init", "close"]);
});

test("unexpected worker exits have a recoverable code and diagnostics contain no request details", async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-exit-"));
  const workerPath = path.join(root, "synthetic-worker.cjs");
  fs.writeFileSync(workerPath, `
require("node:readline").createInterface({ input: process.stdin }).on("line", line => {
  const request = JSON.parse(line);
  if (request.args[0] === "crash") process.exit(9);
  process.stdout.write(JSON.stringify({id:request.id,ok:true,result:{ok:true,items:[]}}) + "\\n");
});
`);
  const diagnostics = [];
  const broker = new PlaudSessionBroker({ executable: process.execPath, workerPath,
    requestTimeoutMs: 5_000, shutdownTimeoutMs: 2_000, onDiagnostic: event => diagnostics.push(event) });
  t.after(async () => { await broker.stop("test-cleanup"); fs.rmSync(root, { recursive: true, force: true }); });
  await assert.rejects(broker.request("list", ["crash", "private-recording-name"], root), /PLAUD_WORKER_EXITED/);
  assert.deepEqual(diagnostics, [{ operation: "worker-exit", reason: "unexpected-exit", code: "9", pendingCount: 1 }]);
  assert.equal(broker.isRunning(), false);
  assert.equal((await broker.request("list", ["ok"], root)).ok, true, "the next explicit read can create a fresh worker");
  await broker.stop("test-finished");
  assert.deepEqual(diagnostics.at(-1), { operation: "worker-exit", reason: "test-finished", code: "SIGTERM", pendingCount: 0 });
  assert.doesNotMatch(JSON.stringify(diagnostics), /private-recording|synthetic-worker|domi-plaud-exit/);
});
