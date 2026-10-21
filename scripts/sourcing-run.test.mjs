import assert from "node:assert/strict";
import { test } from "node:test";
import { executeSourcingRun, sourcingRequestText } from "../src/sourcing-run.ts";

const lease = {
  ok: true, configured: true, started: true, runId: "synthetic-run", leaseToken: "synthetic-token",
  ledgerPath: "/synthetic/ledger.json", candidates: [], sources: [],
  settings: { enabled: true, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: false },
  run: { status: "running" }
};
test("busy and not-due claims never invoke the model or finish another owner's lease", async () => {
  const calls = [];
  await executeSourcingRun({ begin: async request => { calls.push(request); return { ...lease, started: false }; },
    execute: async () => { throw new Error("unexpected model call"); },
    finish: async () => { throw new Error("unexpected finish"); }, onSnapshot: () => {} });
  assert.deepEqual(calls, [{ force: false }]);
});
test("manual refresh forces a claim but persists completion only through the backend", async () => {
  const calls = [];
  const partial = { ...lease, run: { status: "partial", lastSuccessAt: 10 } };
  const result = await executeSourcingRun({ begin: async request => { calls.push(request); return lease; },
    execute: async () => ({ ok: true, output: "SOURCING_RESULT success" }),
    finish: async request => { calls.push(request); return partial; }, onSnapshot: value => calls.push(value.run.status) }, true);
  assert.equal(result.run.status, "partial");
  assert.equal(result.run.lastSuccessAt, 10);
  assert.deepEqual(calls, [{ force: true }, "running", { runId: lease.runId, leaseToken: lease.leaseToken }, "partial"]);
});
test("model exceptions and stopped runs release the correct lease as failures", async () => {
  for (const mode of ["throw", "stopped", "failed"]) {
    let finish;
    await executeSourcingRun({ begin: async () => lease, execute: async () => {
      if (mode === "throw") throw new Error("network unavailable");
      return { ok: mode === "stopped", stopped: mode === "stopped" };
    }, finish: async request => { finish = request; return { ...lease, run: { status: "failed" } }; }, onSnapshot: () => {} });
    assert.equal(finish.runId, lease.runId);
    assert.equal(finish.leaseToken, lease.leaseToken);
    assert.ok(finish.error);
  }
});
test("run context preserves disabled intake and exact source scope", () => {
  const source = { id: "lab", name: "Synthetic lab", url: "https://example.test/members", type: "lab", enabled: true };
  const text = sourcingRequestText({ ...lease, sources: [source] });
  assert.ok(text.includes('"autoIntake":false'));
  assert.ok(text.includes(`sources=${JSON.stringify([source])}`));
  assert.ok(text.includes("不新增或修改项目库、人脉库记录"));
  assert.ok(text.includes("first run requires a baseline"));
});

test("configured focus scope reaches the runner intact without paused objects or inherited news domains", () => {
  const focuses = [
    { id: "direction", name: "合成研究方向", type: "direction", keywords: ["检索关键词"], excludedKeywords: ["排除场景"], relations: [], urls: [], enabled: true },
    { id: "company", name: "合成公司", type: "company", keywords: ["身份限定"], excludedKeywords: [], relations: ["former_employees"], urls: ["https://example.test/team"], enabled: true },
    { id: "person", name: "已暂停人物", type: "person", keywords: [], excludedKeywords: [], relations: ["students"], urls: [], enabled: false }
  ];
  const sources = [{ id: "paused-source", name: "已暂停来源", type: "lab", url: "https://example.test/paused", enabled: false }];
  const text = sourcingRequestText({ ...lease, focuses, sources, followedDomains: ["与本板块无关的新闻领域"] });
  const line = prefix => text.split("\n").find(value => value.startsWith(prefix)).slice(prefix.length);
  assert.deepEqual(JSON.parse(line("focuses=")), focuses.slice(0, 2));
  assert.deepEqual(JSON.parse(line("paused_focus_ids=")), ["person"]);
  assert.deepEqual(JSON.parse(line("sources=")), []);
  assert.equal(line("scope_mode="), "configured_focuses");
  assert.ok(!text.includes("已暂停人物"));
  assert.ok(!text.includes("与本板块无关的新闻领域"));
  assert.ok(text.includes("focusResults"));
});

test("empty and all-paused focus scopes remain distinct", () => {
  assert.ok(sourcingRequestText(lease).includes("scope_mode=legacy_sources"));
  assert.ok(sourcingRequestText({ ...lease, focuses: [], focusConfigured: true }).includes("scope_mode=all_focuses_paused"));
  const text = sourcingRequestText({ ...lease, focuses: [{ id: "person", name: "Synthetic", type: "person", keywords: [], excludedKeywords: [], relations: [], urls: [], enabled: false }] });
  assert.ok(text.includes("scope_mode=all_focuses_paused"));
  assert.ok(!text.includes("scope_mode=legacy_sources"));
});

test("sources belonging to paused or removed focuses cannot leak into model search scope", () => {
  const active = { id: "b", name: "Lab B", type: "lab", keywords: [], excludedKeywords: [], relations: ["alumni"], urls: [], enabled: true };
  const sources = [
    { id: "a-source", name: "Old A", type: "lab", url: "https://example.test/a", enabled: true, focusIds: ["a"] },
    { id: "b-source", name: "B", type: "lab", url: "https://example.test/b", enabled: true, focusIds: ["b"] },
    { id: "manual", name: "Manual source", type: "other", url: "https://example.test/manual", enabled: true },
    { id: "excluded", name: "Out of scope", type: "lab", url: "https://example.test/excluded", enabled: true, inScope: false }
  ];
  const text = sourcingRequestText({ ...lease, focuses: [active], focusConfigured: true, sources });
  const sent = JSON.parse(text.split("\n").find(line => line.startsWith("sources=")).slice(8));
  assert.deepEqual(sent.map(source => source.id), ["b-source", "manual"]);
  assert.ok(!text.includes("https://example.test/a"));
  assert.ok(!text.includes("https://example.test/excluded"));
});

test("paused or deleted source URLs take precedence over a focus's saved URLs", () => {
  const paused = "https://example.test/paused", removed = "https://example.test/removed", active = "https://example.test/active";
  const focus = { id: "a", name: "Lab A", type: "lab", keywords: [], excludedKeywords: [], relations: ["alumni"], urls: [paused, removed, active], enabled: true };
  const text = sourcingRequestText({ ...lease, focuses: [focus], focusConfigured: true, excludedSourceUrls: [removed],
    sources: [{ id: "paused", name: "Paused", type: "lab", url: paused, enabled: false, focusIds: ["a"] }] });
  const line = prefix => JSON.parse(text.split("\n").find(value => value.startsWith(prefix)).slice(prefix.length));
  assert.deepEqual(line("focuses=")[0].urls, [active]);
  assert.deepEqual(line("sources="), []);
  assert.deepEqual(new Set(line("excluded_source_urls=")), new Set([paused, removed]));
  assert.deepEqual(focus.urls, [paused, removed, active], "building a run must preserve saved URL configuration");
});

test("explicitly adding a shared URL to an active focus keeps its source in scope", () => {
  const url = "https://example.test/shared";
  const focus = { id: "b", name: "Lab B", type: "lab", keywords: [], excludedKeywords: [], relations: [], urls: [url], enabled: true };
  const source = { id: "shared", name: "Shared", type: "lab", url, enabled: true, inScope: true, focusIds: ["a"] };
  const text = sourcingRequestText({ ...lease, focuses: [focus], focusConfigured: true, sources: [source] });
  assert.deepEqual(JSON.parse(text.split("\n").find(line => line.startsWith("sources=")).slice(8)), [source]);
});

test("mixed natural-language scope is preserved without forced entity classification", () => {
  const description = "关注机器人方向，看看合成实验室校友和某公司离职的人里有没有创业的。\n也跟一下王同名的学生，但先区分他所在机构；不要纯硬件。";
  const focus = { id: "mixed", name: description, type: "freeform", keywords: ["早期创业"], excludedKeywords: ["成熟上市公司"], relations: [], urls: ["https://example.test/research"], enabled: true };
  const text = sourcingRequestText({ ...lease, focusConfigured: true, focuses: [focus] });
  assert.deepEqual(JSON.parse(text.split("\n").find(line => line.startsWith("focuses=")).slice(8)), [focus]);
  assert.ok(text.includes("不把整段当作一个机构名称"));
  assert.ok(text.includes("空 relations 数组不表示禁止原文明确要求的关系搜索"));
  assert.ok(text.includes("只有所有分支及明确网址都完成才能 checked"));
});
