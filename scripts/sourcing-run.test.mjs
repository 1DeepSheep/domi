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
  const text = sourcingRequestText({ ...lease, sources: [source] }, ["人工智能"]);
  assert.ok(text.includes('"autoIntake":false'));
  assert.ok(text.includes(`sources=${JSON.stringify([source])}`));
  assert.ok(text.includes("不新增或修改项目库、人脉库记录"));
  assert.ok(text.includes("first run requires a baseline"));
});
