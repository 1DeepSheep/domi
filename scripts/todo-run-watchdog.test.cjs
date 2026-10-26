"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const { TodoRunWatchdog, isTodoSyncRun, TODO_RUN_DEADLINE_MS, TODO_STOP_RETRY_MS } = require("../electron/todo-run-watchdog.cjs");
const { classifyCodexTurnStatus } = require("../electron/codex-turn-status.cjs");

const payload = { workflowId: "task", background: true, ephemeral: true };
const tick = () => new Promise(resolve => setImmediate(resolve));

function fixture(stop) {
  const timers = new Map();
  const running = new Set();
  const deadlines = [];
  let serial = 0;
  const watchdog = new TodoRunWatchdog({
    isRunning: id => running.has(id), stop,
    onDeadline: id => deadlines.push(id),
    setTimer: (callback, delay) => { const id = ++serial; timers.set(id, { callback, delay }); return id; },
    clearTimer: id => timers.delete(id)
  });
  return { watchdog, timers, running, deadlines,
    fire: async () => {
      const [id, timer] = timers.entries().next().value;
      timers.delete(id); timer.callback(); await tick();
    }
  };
}

test("only background ephemeral todo-sync task runs receive a deadline", () => {
  const f = fixture(async () => {});
  const rejected = [
    ["regular-user-task", payload],
    ["todo-sync-prefix-only", {}],
    ["todo-sync-foreground", { ...payload, background: false }],
    ["todo-sync-persistent", { ...payload, ephemeral: false }],
    ["todo-sync-other-workflow", { ...payload, workflowId: "desk-research" }],
    ["todo-sync-string-flags", { ...payload, background: "true" }]
  ];
  for (const [id, request] of rejected) {
    assert.equal(isTodoSyncRun(id, request), false);
    assert.equal(f.watchdog.arm(id, request), false);
  }
  assert.equal(f.timers.size, 0);
  assert.equal(f.watchdog.arm("todo-sync-eligible", payload), true);
  assert.equal([...f.timers.values()][0].delay, 9 * 60 * 1000);
});

test("rearming cannot extend the original deadline and a confirmed completion removes it", () => {
  const f = fixture(async () => {});
  f.watchdog.arm("todo-sync-one", payload);
  const initial = [...f.timers.keys()][0];
  assert.equal(f.watchdog.arm("todo-sync-one", payload), false);
  assert.deepEqual([...f.timers.keys()], [initial]);
  f.watchdog.clear("todo-sync-one");
  assert.equal(f.timers.size, 0);
  assert.equal(f.watchdog.entries.size, 0);
});

test("preflight and active tasks stop at the same main-process deadline despite renderer lifetime", async () => {
  const stopped = [];
  const f = fixture(async id => { stopped.push(id); f.running.delete(id); return { ok: true }; });
  for (const id of ["todo-sync-preflight", "todo-sync-active"]) {
    f.running.add(id); f.watchdog.arm(id, payload);
    assert.equal([...f.timers.values()][0].delay, TODO_RUN_DEADLINE_MS);
    await f.fire();
    assert.equal(f.watchdog.entries.has(id), false);
  }
  assert.deepEqual(stopped, ["todo-sync-preflight", "todo-sync-active"]);
});

test("uncertain stop retains ownership and retries once per minute, without duplicate in-flight stops", async () => {
  let release;
  let count = 0;
  const f = fixture(async () => { count++; await new Promise(resolve => { release = resolve; }); return { ok: true }; });
  f.running.add("todo-sync-uncertain");
  f.watchdog.arm("todo-sync-uncertain", payload);
  await f.fire();
  assert.equal(count, 1);
  assert.equal(f.timers.size, 0, "A pending stop is not invoked twice");
  release(); await tick();
  assert.equal(f.running.size, 1, "A successful RPC response is not itself termination proof");
  assert.equal([...f.timers.values()][0].delay, TODO_STOP_RETRY_MS);
  await f.fire();
  assert.equal(count, 2);
  f.running.delete("todo-sync-uncertain");
  f.watchdog.clear("todo-sync-uncertain");
  release(); await tick();
  assert.equal(f.timers.size, 0, "Terminal event during a pending stop prevents another timer");
  assert.equal(f.deadlines.length, 1);
});

test("stop RPC failure retains the guard until termination is actually observed", async () => {
  const f = fixture(async () => { throw new Error("synthetic connection failure"); });
  f.running.add("todo-sync-error"); f.watchdog.arm("todo-sync-error", payload);
  await f.fire();
  assert.equal([...f.timers.values()][0].delay, TODO_STOP_RETRY_MS);
  f.running.clear();
  await f.fire();
  assert.equal(f.timers.size, 0);
  assert.equal(f.watchdog.entries.size, 0);
});

function stopFixture({ protectedRun = true, turnStatus = "inProgress", preflight = false, missingTurn = false } = {}) {
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const start = source.indexOf("async function stopCodex(runId)");
  const end = source.indexOf("async function recoverCodexThread", start);
  assert.ok(start >= 0 && end > start);
  const activeRuns = new Map();
  const startingCodexRunIds = new Set();
  const cancelledCodexRunIds = new Set();
  const calls = [];
  const finished = [];
  const run = { runId: "todo-sync-main", threadId: "synthetic-thread", turnId: "synthetic-turn",
    todoSyncWatchdogProtected: protectedRun, pendingUserInputs: new Map() };
  if (preflight) startingCodexRunIds.add(run.runId);
  else activeRuns.set(run.runId, run);
  const context = vm.createContext({
    activeRuns, startingCodexRunIds, cancelledCodexRunIds, classifyCodexTurnStatus,
    Error, setTimeout: callback => { queueMicrotask(callback); return 1; },
    getDomiIntegration: () => ({ releasePlaudWorkflow() {} }),
    getCodexClient: () => ({
      cancelUserInput() {},
      request: async (method, args) => {
        calls.push({ method, args });
        return method === "thread/read"
          ? { thread: { turns: missingTurn ? [] : [{ id: run.turnId, status: turnStatus }] } } : {};
      }
    }),
    finishRun: (item, type) => { finished.push(type); activeRuns.delete(item.runId); }
  });
  vm.runInContext(source.slice(start, end), context);
  return { stop: () => context.stopCodex(run.runId), calls, activeRuns, cancelledCodexRunIds, finished, run };
}

test("actual main stop retains a protected todo run when interrupt is accepted but remote turn is still active", async () => {
  const f = stopFixture();
  const result = await f.stop();
  assert.equal(result.ok, false);
  assert.equal(f.activeRuns.size, 1);
  assert.deepEqual(f.finished, []);
  assert.deepEqual(f.calls.map(call => call.method), ["turn/interrupt", "thread/read"]);
});

test("actual main stop clears a protected todo run only after reading its terminal turn", async () => {
  const f = stopFixture({ turnStatus: "completed" });
  assert.equal((await f.stop()).ok, true);
  assert.equal(f.activeRuns.size, 0);
  assert.deepEqual(f.finished, ["stopped"]);
});

test("missing remote turn does not count as stop confirmation", async () => {
  const f = stopFixture({ missingTurn: true });
  assert.equal((await f.stop()).ok, false);
  assert.equal(f.activeRuns.size, 1);
});

test("ordinary user tasks retain their existing stop behavior", async () => {
  const f = stopFixture({ protectedRun: false });
  assert.equal((await f.stop()).ok, true);
  assert.deepEqual(f.calls.map(call => call.method), ["turn/interrupt"]);
  assert.deepEqual(f.finished, ["stopped"]);
});

test("a timed out preflight is cancelled before any turn can start", async () => {
  const f = stopFixture({ preflight: true });
  assert.equal((await f.stop()).ok, true);
  assert.equal(f.cancelledCodexRunIds.has(f.run.runId), true);
  assert.deepEqual(f.calls, []);
});
