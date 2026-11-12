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
  assert.ok(fs.existsSync(result.contextPath));
  t.after(() => fs.rmSync(path.dirname(result.contextPath), { recursive: true, force: true }));
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


test("configure forwards independent focuses and preserves omitted versus explicitly cleared fields", async t => {
  const requests = [];
  const f = fixture(t, async (_binary, args) => {
    requests.push(JSON.parse(fs.readFileSync(args[3], "utf8")));
    return { stdout: JSON.stringify({ ok: true, snapshot: snapshot({ focuses: [] }) }) };
  });
  await f.service.configure({ focuses: [{ name: "重点实验室", type: "lab", keywords: [], excludedKeywords: [], relations: ["alumni"], urls: [], enabled: true }] });
  await f.service.configure({ settings: { localHour: 8 } });
  await f.service.configure({ focuses: [] });
  assert.equal(requests[0].focuses[0].name, "重点实验室");
  assert.equal(Object.hasOwn(requests[0], "sources"), false);
  assert.equal(Object.hasOwn(requests[1], "focuses"), false);
  assert.deepEqual(requests[2].focuses, []);
});


test("review forwards only editable fields and leaves identity names/timestamps authoritative", async t => {
  const requests = [];
  const f = fixture(t, async (_binary, args) => {
    assert.equal(args[1], "review");
    requests.push(JSON.parse(fs.readFileSync(args[3], "utf8")));
    return { stdout: JSON.stringify({ ok: true, snapshot: snapshot() }) };
  });
  await f.service.review({ candidateId: "lead", read: false, note: "", disposition: "follow_up", sameEntity: { type: "project", id: "p", name: "forged", confirmedAt: 1 }, intake: { status: "created" }, userState: { readAt: 1 } });
  await f.service.review({ candidateId: "lead", sameEntity: null });
  assert.deepEqual(requests, [
    { candidateId: "lead", read: false, note: "", disposition: "follow_up", sameEntity: { type: "project", id: "p" } },
    { candidateId: "lead", sameEntity: null }
  ]);
});
test("library search returns real matches without forwarding arbitrary filters", async t => {
  const matches = [{ type: "project", id: "p", name: "Project" }];
  const f = fixture(t, async (_binary, args) => {
    assert.equal(args[1], "search-library");
    assert.deepEqual(JSON.parse(fs.readFileSync(args[3], "utf8")), { query: "Project", type: "project" });
    return { stdout: JSON.stringify({ ok: true, snapshot: snapshot(), matches }) };
  });
  const result = await f.service.searchLibrary({ query: "Project", type: "project", limit: 999, backend: "feishu" });
  assert.deepEqual(result.matches, matches);
});

test("discovery context pages preserve all sources and separate accumulated history", t => {
  const { prepareSourcingContext, PAGE_CHARS } = require("../electron/sourcing-context.cjs");
  const sources = Array.from({ length: 1800 }, (_, i) => ({ id: `src-${i}`, name: `Source ${i}`,
    url: `https://example.test/${i}`, type: "other", enabled: true, detail: "历史检查😀".repeat(300) }));
  sources.push({ id: "disabled", url: "https://example.test/off", enabled: false });
  const lease = snapshot({ runId: "r", ledgerPath: "/synthetic/ledger.json", sources });
  const before = JSON.stringify(lease);
  const context = prepareSourcingContext(lease);
  t.after(() => fs.rmSync(context.directory, { recursive: true, force: true }));
  const manifest = JSON.parse(fs.readFileSync(context.path, "utf8"));
  function readSection(name) {
    let value = "";
    for (let i = 1; i <= manifest.sections[name].pages; i++) {
      const page = fs.readFileSync(path.join(context.directory, `${name}-${i}.json.part`), "utf8");
      assert.ok(page.length <= PAGE_CHARS);
      value += page;
    }
    return JSON.parse(value);
  }
  assert.equal(readSection("sources").length, 1800);
  assert.equal(readSection("sources").at(-1).id, "src-1799");
  assert.equal(readSection("sources")[0].detail, undefined);
  assert.deepEqual(readSection("source_history").map(s => s.detail), sources.slice(0, 1800).map(s => s.detail));
  assert.deepEqual(readSection("excluded_source_urls"), ["https://example.test/off"]);
  assert.equal(JSON.stringify(lease), before);
});
