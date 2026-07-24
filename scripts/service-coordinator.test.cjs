const assert = require("node:assert/strict");
const test = require("node:test");
const { ServiceCoordinator, TaskQueue } = require("../electron/service-coordinator.cjs");

test("service coordinator merges requests, retries and serves stale data", async () => {
  let now = 1000;
  const coordinator = new ServiceCoordinator({ now: () => now, sleep: async () => undefined });
  let calls = 0;
  const operation = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return { ok: true, value: calls };
  };
  const [first, second] = await Promise.all([
    coordinator.run("shared", operation, { ttlMs: 100 }),
    coordinator.run("shared", operation, { ttlMs: 100 })
  ]);
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
  assert.deepEqual(await coordinator.run("shared", operation, { ttlMs: 100 }), first);

  now += 101;
  let attempts = 0;
  const retried = await coordinator.run("retry", async () => {
    attempts += 1;
    if (attempts === 1) throw new Error("temporary");
    return { ok: true };
  }, { retries: 1 });
  assert.equal(retried.ok, true);
  assert.equal(attempts, 2);

  const stale = await coordinator.run("shared", async () => {
    throw new Error("offline");
  }, { force: true, allowStale: true });
  assert.equal(stale.stale, true);
  assert.match(stale.coordinatorError, /offline/);
});

test("task queue enforces its concurrency limit", async () => {
  const queue = new TaskQueue(2);
  let active = 0;
  let maximumActive = 0;
  const results = await Promise.all([1, 2, 3, 4].map((value) => queue.run(async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return value;
  })));
  assert.deepEqual(results, [1, 2, 3, 4]);
  assert.equal(maximumActive, 2);
  assert.deepEqual(queue.snapshot(), { activeCount: 0, pendingCount: 0 });
});
