const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { performance } = require("node:perf_hooks");
const { EventEmitter } = require("node:events");
const { Worker } = require("node:worker_threads");
const { DomiIntegration } = require("../electron/domi-integration.cjs");
const { runLocalDomiSync } = require("../electron/local-domi-sync-runner.cjs");
const { industryWorkerLock } = require("../electron/repository-worker.cjs");

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

function lockFixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-sync-lock-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = { localDatabasePath: path.join(root, "repository.sqlite3"), localLibraryDir: path.join(root, "library") };
  return { root, source, lockPath: industryWorkerLock(source).path };
}

async function until(predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "worker lifecycle did not complete");
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

test("terminating the real scanner inside overview generation releases the parent-owned lock", async t => {
  const data = lockFixture(t);
  const bootstrap = path.join(data.root, "blocked-scanner.cjs");
  fs.writeFileSync(bootstrap, `
    const fs = require('node:fs');
    const { workerData } = require('node:worker_threads');
    const originalWrite = fs.writeFileSync;
    fs.writeFileSync = function (file, ...args) {
      const result = originalWrite.call(this, file, ...args);
      if (String(file) === ${JSON.stringify(data.lockPath)}) {
        originalWrite.call(this, ${JSON.stringify(path.join(data.root, "received-token"))}, workerData.lockToken);
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10000);
      }
      return result;
    };
    require(${JSON.stringify(path.resolve(__dirname, "../electron/local-domi-sync-worker.cjs"))});
  `);
  let worker;
  class ObservedWorker extends Worker { constructor(...args) { super(...args); worker = this; } }
  const pending = runLocalDomiSync(data.source, { workerPath: bootstrap, WorkerClass: ObservedWorker, timeoutMs: 600 });
  const failed = assert.rejects(pending, error => error.code === "DOMI_LOCAL_SYNC_TIMEOUT");
  await until(() => fs.existsSync(path.join(data.root, "received-token")));
  assert.equal(fs.readFileSync(data.lockPath, "utf8"), fs.readFileSync(path.join(data.root, "received-token"), "utf8"),
    "the actual generator must use the parent's token, not create a worker-local token");
  await failed;
  await until(() => worker.threadId === -1 && !fs.existsSync(data.lockPath));
  const recovered = await runLocalDomiSync(data.source);
  assert.equal(recovered.repositoryHealth.ok, true);
});

test("normal completion, errors and unexpected exit clean only the scanner's own lock", async t => {
  for (const mode of ["success", "failure", "error", "exit"]) {
    for (const foreign of [false, true]) {
      await t.test(`${mode}, ${foreign ? "foreign" : "owned"} token`, async t => {
        const data = lockFixture(t);
        const other = JSON.stringify({ pid: process.pid, token: "another-worker" });
        class CompletingWorker extends EventEmitter {
          constructor(_file, options) {
            super();
            fs.writeFileSync(data.lockPath, foreign ? other : options.workerData.lockToken);
            queueMicrotask(() => {
              if (mode === "success") this.emit("message", { ok: true, value: { projects: ["preserved"] } });
              if (mode === "failure") this.emit("message", { ok: false, error: { code: "TEST_FAILURE", message: "scan failed" } });
              if (mode === "error") this.emit("error", new Error("worker failed"));
              if (mode === "exit") this.emit("exit", 9);
            });
          }
          terminate() { return Promise.resolve(1); }
        }
        const request = runLocalDomiSync(data.source, { WorkerClass: CompletingWorker });
        if (mode === "success") assert.deepEqual(await request, { projects: ["preserved"] });
        else await assert.rejects(request, /scan failed|worker failed|意外退出/);
        if (foreign) {
          await new Promise(resolve => setTimeout(resolve, 15));
          assert.equal(fs.readFileSync(data.lockPath, "utf8"), other);
        } else {
          await until(() => !fs.existsSync(data.lockPath));
        }
      });
    }
  }
});

test("a timeout keeps the lock and scanner slot until termination is confirmed", async t => {
  const data = lockFixture(t);
  let worker, finishTermination, calls = 0;
  class DelayedTermination extends EventEmitter {
    constructor(_file, options) {
      super(); worker = this; calls += 1;
      fs.writeFileSync(data.lockPath, options.workerData.lockToken);
    }
    terminate() { return new Promise(resolve => { finishTermination = resolve; }); }
  }
  const request = runLocalDomiSync(data.source, { WorkerClass: DelayedTermination, timeoutMs: 100 });
  await assert.rejects(request, error => error.code === "DOMI_LOCAL_SYNC_TIMEOUT");
  assert.equal(fs.existsSync(data.lockPath), true, "a still-live worker must keep its lock");
  assert.equal(runLocalDomiSync(data.source, { WorkerClass: DelayedTermination }), request);
  assert.equal(calls, 1, "retry must not start a second scanner before the first exits");
  const other = JSON.stringify({ pid: process.pid, token: "replacement-worker" });
  fs.writeFileSync(data.lockPath, other);
  finishTermination(1);
  worker.emit("exit", 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(fs.readFileSync(data.lockPath, "utf8"), other, "late cleanup must not delete a replacement lock");
});
