"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { SourcingService } = require("../electron/sourcing-service.cjs");
function fixture(t, executeCommand, source = { backend: "local" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sourcing-service-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "scripts")); fs.writeFileSync(path.join(root, "scripts", "sourcing-ledger.cjs"), "");
  return { root, service: new SourcingService({ integration: { readProjectConfig: () => source, findPlugin: () => ({ root }), domiConfigPath: path.join(root, "current-config.json") }, executeCommand }) };
}
function snapshot(extra = {}) { return { ok: true, configured: true, candidates: [], sources: [], settings: { enabled: true, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true }, run: { status: "idle" }, ...extra }; }
test("adapter uses installed script/current config and removes private request file", async t => {
  let inputPath;
  const f = fixture(t, async (binary, args, options) => {
    assert.equal(binary, process.execPath);
    assert.equal(args[0], path.join(f.root, "scripts", "sourcing-ledger.cjs"));
    assert.equal(options.env.DOMI_CONFIG_PATH, path.join(f.root, "current-config.json"));
    assert.equal(options.env.ELECTRON_RUN_AS_NODE, "1");
    inputPath = args[3];
    assert.deepEqual(JSON.parse(fs.readFileSync(inputPath, "utf8")), { force: true });
    return { stdout: JSON.stringify({ ok: true, snapshot: snapshot({ run: { status: "running", runId: "r" } }), started: true, runId: "r", leaseToken: "token" }) };
  });
  const result = await f.service.begin({ force: true });
  assert.equal(result.started, true); assert.equal(result.leaseToken, "token"); assert.equal(result.run.status, "running");
  assert.equal(fs.existsSync(inputPath), false);
});
test("missing persisted receipt becomes failed state instead of false success", async t => {
  const calls = [];
  const f = fixture(t, async (_binary, args) => {
    calls.push(args[1]);
    if (args[1] === "complete") throw Object.assign(new Error("exit 1"), { stdout: JSON.stringify({ ok: false, code: "sourcing_receipt_missing", error: "Missing persisted receipt", snapshot: snapshot({ run: { status: "running", runId: "r" } }) }) });
    return { stdout: JSON.stringify({ ok: true, snapshot: snapshot({ run: { status: "failed", runId: "r", error: "Missing persisted receipt" } }) }) };
  });
  const result = await f.service.finish({ runId: "r", leaseToken: "token" });
  assert.deepEqual(calls, ["complete", "fail"]); assert.equal(result.ok, false); assert.equal(result.run.status, "failed");
});
test("legacy backend is rejected before any command", async t => {
  let invoked = false;
  const f = fixture(t, async () => { invoked = true; }, { backend: "feishu" });
  const result = await f.service.begin();
  assert.equal(result.configured, false); assert.equal(invoked, false); assert.match(result.error, /飞书/);
});
