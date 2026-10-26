"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { TodoDailyScheduler, LEASE_MS } = require("../electron/todo-daily-scheduler.cjs");

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-todo-ipc-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const helpersStart = source.indexOf("function getTodoDailyScheduler()");
  const helpersEnd = source.indexOf("function getDesktopNotifications()", helpersStart);
  const ipcStart = source.indexOf('ipcMain.handle("domi:todo-daily-status"');
  const ipcEnd = source.indexOf('ipcMain.handle("domi:task-list"', ipcStart);
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart && ipcStart > helpersEnd && ipcEnd > ipcStart);
  const handlers = new Map();
  let now = new Date(2026, 9, 26, 9).getTime();
  const activeRuns = new Map();
  const startingCodexRunIds = new Set();
  const pendingRunPostProcessing = new Set();
  const settings = { onboardingComplete: true, storageBackend: "local",
    localRepositoryDir: "/synthetic/library", localDatabasePath: "/synthetic/library.sqlite3", localLibraryDir: "" };
  vm.runInNewContext(source.slice(helpersStart, helpersEnd) + source.slice(ipcStart, ipcEnd), {
    todoDailyScheduler: null,
    TodoDailyScheduler: class extends TodoDailyScheduler {
      constructor(options) { super({ ...options, now: () => now }); }
    },
    app: { getPath: () => directory },
    path, crypto, Date: { now: () => now }, Error,
    getAppSettings: () => ({ load: () => ({ settings }) }),
    activeRuns, startingCodexRunIds, pendingRunPostProcessing,
    ipcMain: { handle: (name, callback) => handlers.set(name, callback) }
  });
  assert.equal(handlers.size, 3);
  return {
    directory, settings, activeRuns, startingCodexRunIds, pendingRunPostProcessing,
    setTime: value => { now = value; },
    call: (name, request) => handlers.get(`domi:${name}`)(undefined, request)
  };
}

test("IPC derives opaque scope from saved settings and ignores caller scope for claims", t => {
  const f = fixture(t);
  const claim = f.call("todo-sync-claim", { trigger: "daily", repositoryIdentity: "forged", now: 0 });
  assert.equal(claim.claimed, true);
  assert.match(claim.repositoryIdentity, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(claim).includes("/synthetic"), false);
  assert.equal(claim.localDay, "2026-10-26");
  assert.equal(f.call("todo-daily-status").repositoryIdentity, claim.repositoryIdentity);
});

test("active foreground, preflight and postprocessing defer claims without spending an attempt", t => {
  const f = fixture(t);
  const busySources = [f.activeRuns, f.startingCodexRunIds, f.pendingRunPostProcessing];
  for (const busy of busySources) {
    if (busy instanceof Map) busy.set("foreground", { runId: "foreground", workflowId: "research" });
    else busy.add("foreground");
    const claim = f.call("todo-sync-claim", { trigger: "daily" });
    assert.equal(claim.claimed, false);
    assert.equal(claim.reason, "busy");
    assert.equal(claim.attempts, 0);
    busy.clear();
  }
  assert.equal(f.call("todo-sync-claim", { trigger: "daily" }).claimed, true);
});

test("a surviving todo model run blocks new work even after its persisted lease expired", t => {
  const f = fixture(t);
  f.call("todo-sync-claim", { trigger: "daily" });
  f.activeRuns.set("todo-sync-test", { runId: "todo-sync-test", workflowId: "task", finished: false });
  f.setTime(new Date(2026, 9, 26, 9).getTime() + LEASE_MS + 60 * 60 * 1000);
  const status = f.call("todo-daily-status");
  assert.equal(status.state, "running");
  assert.equal(status.due, false);
  assert.equal(f.call("todo-sync-claim", { trigger: "daily" }).reason, "busy");
  f.activeRuns.clear();
  assert.equal(f.call("todo-sync-claim", { trigger: "daily" }).claimed, true);
});

test("completion after switching repositories belongs to the original claim only", t => {
  const f = fixture(t);
  const original = f.call("todo-sync-claim", { trigger: "daily" });
  f.settings.localRepositoryDir = "/synthetic/second-library";
  const changedScope = f.call("todo-daily-status").repositoryIdentity;
  assert.notEqual(changedScope, original.repositoryIdentity);
  const finished = f.call("todo-sync-finish", {
    repositoryIdentity: original.repositoryIdentity, token: original.token, success: true
  });
  assert.equal(finished.accepted, true);
  assert.equal(finished.repositoryIdentity, original.repositoryIdentity);
  const newStatus = f.call("todo-daily-status");
  assert.equal(newStatus.due, true);
  assert.equal(newStatus.lastSuccessAt, null);
  assert.equal(f.call("todo-sync-claim", { trigger: "daily" }).claimed, true);
});

test("invalid completion and unconfigured library return structured errors without throwing", t => {
  const f = fixture(t);
  assert.equal(f.call("todo-sync-finish", { repositoryIdentity: "/synthetic/path", token: "bad", success: true }).ok, false);
  f.settings.onboardingComplete = false;
  assert.equal(f.call("todo-daily-status").ok, false);
  assert.equal(f.call("todo-sync-claim", { trigger: "daily" }).claimed, false);
  assert.equal(fs.existsSync(path.join(f.directory, "todo-daily-schedule.json")), false);
});

test("preload exposes only the intended typed scheduling IPC channels", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../electron/preload.cjs"), "utf8");
  const calls = [];
  let api;
  vm.runInNewContext(source, {
    require: name => {
      assert.equal(name, "electron");
      return { contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
        ipcRenderer: { invoke: async (...args) => { calls.push(args); return { ok: true }; } } };
    }
  });
  await api.todoDailyStatus();
  const claim = { trigger: "daily" };
  await api.claimTodoSync(claim);
  const finish = { repositoryIdentity: "scope", token: "token", success: true };
  await api.finishTodoSync(finish);
  assert.deepEqual(calls, [["domi:todo-daily-status"], ["domi:todo-sync-claim", claim], ["domi:todo-sync-finish", finish]]);
});
