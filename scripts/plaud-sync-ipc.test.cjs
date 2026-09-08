const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { ServiceCoordinator } = require("../electron/service-coordinator.cjs");

// Run the actual two registrations from main without booting Electron or any
// private services. This catches progress being lost at the IPC boundary even
// when integration and renderer unit tests both accept the richer result.
function fixture(integration) {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const start = source.indexOf('ipcMain.handle("domi:plaud-sync"');
  const end = source.indexOf('ipcMain.handle("domi:plaud-rename"', start);
  assert.ok(start >= 0 && end > start, "PLAUD IPC registration boundaries must exist");
  const handlers = new Map();
  const coordinator = new ServiceCoordinator();
  vm.runInNewContext(source.slice(start, end), {
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    serviceCoordinator: coordinator,
    getDomiIntegration: () => integration,
    Error
  });
  assert.equal(handlers.size, 2);
  return { call: name => handlers.get(name)(), coordinator };
}

test("sync and recovery IPC preserve failed and partial per-record results", async () => {
  const results = [
    { ok: false, status: "failed", failedCount: 1, error: "Synthetic access failure",
      results: [{ fileId: "synthetic-a", outcome: "failed", errorCode: "PLAUD_ACCESS_DENIED" }],
      snapshot: { ok: true, items: [{ fileId: "synthetic-a", error: "Synthetic access failure" }] } },
    { ok: true, status: "partial", recoveredCount: 1, waitingCount: 1,
      results: [{ fileId: "synthetic-b", outcome: "ready", transcriptPath: "/synthetic/b.md" }],
      snapshot: { ok: false, items: [] }, listRefreshFailed: true }
  ];
  const f = fixture({ syncPlaud: async () => results[0], resumePlaudTranscripts: async () => results[1] });
  assert.equal(await f.call("domi:plaud-sync"), results[0]);
  assert.equal(await f.call("domi:plaud-resume"), results[1]);
});

test("concurrent IPC requests share one operation and never replay thrown generation", async () => {
  let calls = 0, release;
  const f = fixture({
    syncPlaud: () => { calls++; return new Promise(resolve => { release = resolve; }); },
    resumePlaudTranscripts: async () => { throw new Error("Synthetic read unavailable"); }
  });
  const first = f.call("domi:plaud-sync");
  const second = f.call("domi:plaud-sync");
  assert.equal(calls, 1);
  const result = { ok: true, status: "waiting", waitingCount: 1 };
  release(result);
  assert.equal(await first, result);
  assert.equal(await second, result);
  f.coordinator.invalidate("domi:plaud-sync");
  const thrown = fixture({ syncPlaud: async () => { calls++; throw new Error("Synthetic uncertain submission"); } });
  const failure = await thrown.call("domi:plaud-sync");
  assert.equal(failure.ok, false);
  assert.equal(failure.error, "Synthetic uncertain submission");
  assert.equal(calls, 2, "An uncertain submission must never be replayed by IPC retry policy");
});
