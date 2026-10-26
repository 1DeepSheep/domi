const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { DomiIntegration } = require("../electron/domi-integration.cjs");
const { ServiceCoordinator } = require("../electron/service-coordinator.cjs");

function ipcFixture(integration) {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf('ipcMain.handle("domi:sync"');
  const end = source.indexOf('ipcMain.handle("domi:migration-preview"', start);
  assert.ok(start >= 0 && end > start);
  let handler;
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (_name, callback) => { handler = callback; } },
    serviceCoordinator: new ServiceCoordinator(),
    getDomiIntegration: () => integration,
    getDomiPluginActivationGate: () => ({ withStableClient: callback => callback() }),
    Error
  });
  return request => handler(undefined, request);
}

test("a pending explicit file scan does not block ordinary IPC refreshes", async () => {
  let finishScan;
  const seen = [];
  const snapshot = { projects: [{ recordId: "synthetic-project" }], people: [] };
  const call = ipcFixture({
    sync: request => {
      seen.push(request.reindex);
      return request.reindex
        ? new Promise(resolve => { finishScan = resolve; })
        : Promise.resolve({ ok: true, snapshot });
    }
  });
  const scan = call({ reindex: true });
  const result = await call();
  assert.equal(result.snapshot, snapshot);
  assert.deepEqual(seen, [true, false]);
  finishScan({ ok: true });
  await scan;
});

test("failed manual scans retain the previous snapshot without replaying the scan", async () => {
  const snapshot = { projects: [{ recordId: "retained-project" }], people: [] };
  let calls = 0;
  const call = ipcFixture({
    sync: async () => { calls += 1; throw new Error("synthetic scan timeout"); },
    loadCache: () => ({ snapshot, updatedAt: 123 })
  });
  const result = await call({ reindex: true });
  assert.equal(result.ok, false);
  assert.equal(result.snapshot, snapshot);
  assert.equal(result.updatedAt, 123);
  assert.equal(calls, 1);
});

test("integration separates its own pending scans from fast database snapshots", async () => {
  let finishScan;
  const requests = [];
  const payload = { projects: [], people: [], workspaceIndex: {} };
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => {} },
    plaudOutputDir: "/synthetic/plaud",
    localSyncRunner: (_source, options) => {
      requests.push(options.reindex);
      return options.reindex
        ? new Promise(resolve => { finishScan = resolve; })
        : Promise.resolve(payload);
    }
  });
  integration.findPlugin = () => ({});
  integration.readProjectConfig = () => ({ backend: "local", localDatabasePath: "/synthetic/repository.db", localLibraryDir: "/synthetic/library" });
  integration.status = async () => ({});
  const scan = integration.sync({ reindex: true });
  const result = await integration.sync();
  assert.equal(result.ok, true);
  assert.deepEqual(requests, [true, false]);
  finishScan(payload);
  await scan;
});

for (const scanFinishesFirst of [true, false]) {
  test(`concurrent scan and read retain new indexed records when scan finishes ${scanFinishesFirst ? "first" : "last"}`, async () => {
    let cached;
    let finishScan;
    let finishRead;
    const source = { backend: "local", localDatabasePath: "/synthetic/repository.db", localLibraryDir: "/synthetic/library" };
    const integration = new DomiIntegration({
      stateStore: {
        loadCache: () => cached ? { value: cached } : null,
        saveCache: (_key, value) => { cached = value; }
      },
      plaudOutputDir: "/synthetic/plaud",
      localSyncRunner: (_source, options) => new Promise(resolve => {
        if (options.reindex) finishScan = resolve;
        else finishRead = resolve;
      })
    });
    integration.findPlugin = () => ({});
    integration.readProjectConfig = () => source;
    integration.status = async () => ({});
    const read = integration.sync();
    const scan = integration.sync({ reindex: true });
    await new Promise(resolve => setImmediate(resolve));
    const newProjects = [{ recordId: "new-indexed-project" }];
    const finishNew = async () => {
      finishScan({ projects: newProjects, people: [], workspaceIndex: {} });
      return scan;
    };
    const finishOld = async () => {
      finishRead({ projects: [], people: [], workspaceIndex: {} });
      return read;
    };
    if (scanFinishesFirst) {
      const scanResult = await finishNew();
      const lateReadResult = await finishOld();
      assert.equal(lateReadResult.snapshot, scanResult.snapshot);
      assert.deepEqual(lateReadResult.snapshot.projects, newProjects);
    } else {
      const readResult = await finishOld();
      const scanResult = await finishNew();
      assert.ok(scanResult.snapshot.syncedAt > readResult.snapshot.syncedAt);
    }
    assert.deepEqual(cached.projects, newProjects);
  });
}
