const test = require("node:test");
const assert = require("node:assert/strict");
const { ServiceCoordinator } = require("../electron/service-coordinator.cjs");
const { loadIndustryOverviews } = require("../electron/industry-overview-service.cjs");

test("preserved edits remain readable through the coordinator without opening its failure circuit", async () => {
  const coordinator = new ServiceCoordinator();
  const conflict = { ok: false, entries: [{ title: "AI", path: "/synthetic/AI/行业速览.md" }], conflicts: [{ path: "edited" }], warnings: [] };
  let calls = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.deepEqual(await loadIndustryOverviews(coordinator, () => { calls += 1; return conflict; }), conflict);
  }
  assert.equal(calls, 5);
  const failure = await loadIndustryOverviews(coordinator, () => { throw new Error("source unavailable"); });
  assert.deepEqual(failure, { ok: false, entries: [], error: "source unavailable" });
  assert.deepEqual(await loadIndustryOverviews(coordinator, () => conflict), conflict);
});
