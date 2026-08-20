const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { performance } = require("node:perf_hooks");
const { EventEmitter } = require("node:events");
const { DomiIntegration } = require("../electron/domi-integration.cjs");
const { runLocalDomiSync } = require("../electron/local-domi-sync-runner.cjs");

function localHealth() {
  return {
    plugin: { ok: true, version: "test", displayName: "domi", root: "/tmp/domi-plugin" },
    lark: { ok: true, disabled: true, userName: "", appName: "本地资料库" },
    plaud: { ok: true, disabled: true, queueCount: 0, queueStages: {} }
  };
}

test("a deliberately slow local reindex leaves the main event loop responsive", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-sync-worker-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = {
    localDatabasePath: path.join(root, "domi.sqlite3"),
    localLibraryDir: path.join(root, "domi工作区")
  };

  let ticks = 0;
  let maximumGapMs = 0;
  let previousTick = performance.now();
  const interval = setInterval(() => {
    const now = performance.now();
    maximumGapMs = Math.max(maximumGapMs, now - previousTick);
    previousTick = now;
    ticks += 1;
  }, 10);
  const startedAt = performance.now();
  const first = await runLocalDomiSync(source, { testDelayMs: 300 });
  const elapsedMs = performance.now() - startedAt;
  clearInterval(interval);

  assert.equal(first.repositoryHealth.ok, true);
  assert.ok(elapsedMs >= 250, `expected a slow scan, got ${elapsedMs.toFixed(1)}ms`);
  assert.ok(ticks >= 15, `main loop only ticked ${ticks} times during the worker scan`);
  assert.ok(maximumGapMs < 100, `main loop stalled for ${maximumGapMs.toFixed(1)}ms`);

  const projectDirectory = path.join(
    source.localLibraryDir,
    "3.项目库",
    "AI",
    "Agent",
    "增量项目"
  );
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, "项目主页.md"), `---
entity_type: "project"
project_id: "prj_worker_fresh"
company_name: "增量项目"
domain: "AI"
subdomains: ["Agent"]
---
# 增量项目
`);

  const second = await runLocalDomiSync(source);
  assert.equal(second.workspaceIndex.unchanged, false);
  assert.ok(second.projects.some((project) => project.recordId === "prj_worker_fresh"));
});

test("concurrent local sync calls share one worker reindex and preserve the snapshot API", async () => {
  let resolveWorker;
  let workerCalls = 0;
  const workerResult = new Promise((resolve) => {
    resolveWorker = resolve;
  });
  const snapshots = [];
  const source = {
    backend: "local",
    localDatabasePath: "/tmp/domi-single-flight.sqlite3",
    localLibraryDir: "/tmp/domi-single-flight-library"
  };
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: (_key, snapshot) => snapshots.push(snapshot)
    },
    plaudOutputDir: "/tmp/domi-local-sync-single-flight",
    localSyncRunner: () => {
      workerCalls += 1;
      return workerResult;
    }
  });
  integration.findPlugin = () => localHealth().plugin;
  integration.readProjectConfig = () => source;
  integration.status = async () => localHealth();

  const first = integration.sync();
  const second = integration.sync();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(workerCalls, 1);

  resolveWorker({
    repositoryHealth: { ok: true },
    workspaceIndex: {
      projects: { discovered: 1, needsNameReview: 0, created: 0, linked: 0 },
      people: { discovered: 0, created: 0, linked: 0 }
    },
    projects: [{ recordId: "prj_shared", name: "共享结果" }],
    people: []
  });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.equal(firstResult.ok, true);
  assert.equal(secondResult.ok, true);
  assert.deepEqual(firstResult.snapshot.projects, secondResult.snapshot.projects);
  assert.equal(firstResult.snapshot.sources.projects.localDatabasePath, source.localDatabasePath);
  assert.equal(snapshots.length, 2);
});

test("a stuck local scan is terminated at the deadline instead of hanging the app", async () => {
  let terminated = false;
  class StuckWorker extends EventEmitter {
    terminate() {
      terminated = true;
      return Promise.resolve(0);
    }
  }

  await assert.rejects(
    runLocalDomiSync({
      localDatabasePath: "/tmp/domi-stuck-sync.sqlite3",
      localLibraryDir: "/tmp/domi-stuck-library"
    }, {
      WorkerClass: StuckWorker,
      timeoutMs: 40
    }),
    (error) => error?.code === "DOMI_LOCAL_SYNC_TIMEOUT"
      && /保留上次成功数据/.test(error.message)
  );
  assert.equal(terminated, true);
});
