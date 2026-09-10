import assert from "node:assert/strict";
import test from "node:test";
import { CodexReadinessController, codexConnectionReady, codexTaskReady, codexReadinessPresentation,
  codexConnectionSettingsChanged } from "../src/codex-readiness.ts";

const ready = { ok: true, connectionOk: true, path: "/synthetic/codex", version: "test", authMode: "chatgpt",
  account: { email: "fixture@example.com" }, requiresOpenaiAuth: false, credentialStored: true,
  models: [{ id: "fixture" }], pluginSetup: { ok: true, status: "ready" } };
const failed = { ...ready, ok: false, connectionOk: false, error: "Synthetic unavailable" };
const transient = { ...ready, ok: false, pluginSetup: { ok: false, status: "check-failed", reason: "plugin-check-timeout" } };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function harness() {
  let id = 0;
  const scheduled = new Map();
  const calls = [], published = [], plans = [];
  const controller = new CodexReadinessController({
    check: options => { calls.push(options); return Promise.resolve(plans.shift() ?? ready); },
    publish: state => published.push(state),
    schedule: (callback, delay) => { scheduled.set(++id, { callback, delay }); return id; },
    cancel: timer => scheduled.delete(timer)
  });
  const tick = async () => { const next = scheduled.entries().next().value;
    if (!next) return; scheduled.delete(next[0]); next[1].callback(); await settle(); };
  return { controller, calls, published, plans, scheduled, tick };
}

test("connection and plugin readiness are independent; explicit failed connection wins over legacy ok", () => {
  assert.equal(codexConnectionReady(transient), true);
  assert.equal(codexTaskReady(transient, false), true);
  assert.equal(codexTaskReady(transient, true), false);
  assert.equal(codexConnectionReady({ ...ready, connectionOk: false }), false);
  assert.equal(codexConnectionReady({ ok: true }), true);
  assert.equal(codexTaskReady({ ok: true }, true), false);
});

test("checking is neutral, plugin failure is not a Codex outage, command paths never reach the card", () => {
  assert.equal(codexReadinessPresentation({ status: null, checking: true }).tone, "neutral");
  assert.deepEqual(codexReadinessPresentation({ status: transient, checking: false }),
    { tone: "warning", title: "Codex 已连接", detail: "domi 插件待检查" });
  const text = JSON.stringify(codexReadinessPresentation({ status: { ...failed, error: "Command failed: " + "/Users/" + "fixture/path" }, checking: false }));
  assert.doesNotMatch(text, /Users|secret|Command failed/);
  assert.equal(codexReadinessPresentation({ status: { ...failed, account: null, requiresOpenaiAuth: true }, checking: false }).title, "Codex 需要登录");
});

test("older startup failure cannot replace a newer verified result", async () => {
  const h = harness(), old = deferred(); h.plans.push(old.promise);
  const startup = h.controller.refresh();
  await h.controller.refresh(ready);
  old.resolve(failed); await startup;
  assert.equal(h.controller.snapshot.status, ready);
  assert.equal(h.calls.length, 1, "verified results cause no duplicate probe");
});

test("old recovery cannot cross a configuration change; optimistic running never grants readiness", async () => {
  const h = harness(), old = deferred();
  h.plans.push(old.promise);
  h.controller.observeRuntimeEvent(0); await h.tick();
  assert.equal(h.controller.snapshot.status, null);
  const save = h.controller.beginSave(true);
  h.controller.acceptSaved(save, failed);
  h.controller.observeRuntimeEvent(0);
  old.resolve(ready); await settle();
  assert.equal(h.controller.snapshot.status, failed);
  assert.equal(h.scheduled.size, 0);
});

test("event bursts coalesce into one read-only force probe and stop after success", async () => {
  const h = harness(); await h.controller.refresh(failed);
  for (let i = 0; i < 100; i++) h.controller.observeRuntimeEvent(0);
  assert.equal(h.scheduled.size, 1); await h.tick();
  assert.deepEqual(h.calls, [{ readOnly: true, force: true }]);
  assert.equal(h.controller.snapshot.status, ready);
  assert.equal(h.scheduled.size, 0);
});

test("runtime events cannot supersede an in-flight manual startup; failure consumes one deferred check", async () => {
  for (const outcome of [ready, failed]) {
    const h = harness(), pending = deferred(); h.plans.push(pending.promise);
    const refresh = h.controller.refresh(undefined, { readOnly: false, force: true });
    for (let i = 0; i < 10; i++) h.controller.observeRuntimeEvent(0);
    assert.equal(h.scheduled.size, 0);
    pending.resolve(outcome); await refresh;
    assert.equal(h.controller.snapshot.status, outcome);
    assert.equal(h.scheduled.size, outcome === ready ? 0 : 1);
    if (outcome === failed) await h.tick();
    assert.equal(h.controller.snapshot.status, ready);
  }
});

test("startup transient plugin failure retries without any task or model, bounded to three attempts", async () => {
  const h = harness(); h.plans.push(transient, transient, transient);
  await h.controller.refresh(transient);
  const delays = [];
  for (let i = 0; i < 3; i++) { delays.push([...h.scheduled.values()][0].delay); await h.tick(); }
  assert.deepEqual(delays, [0, 2000, 8000]);
  assert.equal(h.calls.length, 3); assert.equal(h.scheduled.size, 0);
  h.controller.observeRuntimeEvent(0); assert.equal(h.scheduled.size, 0);
  assert.ok(h.calls.every(call => call.readOnly && call.force));
});

test("missing plugins and explicit auth failures do not poll", async () => {
  for (const status of [
    { ...transient, pluginSetup: { ok: false, status: "missing" } },
    { ...transient, connectionOk: false, account: null, requiresOpenaiAuth: true }
  ]) {
    const h = harness(); await h.controller.refresh(status);
    assert.equal(h.scheduled.size, 0); assert.equal(h.calls.length, 0);
  }
});

test("saving blocks automatic events and rejects probe results while preserving verified metadata", async () => {
  const h = harness(); await h.controller.refresh(ready);
  const revision = h.controller.beginSave(true);
  assert.equal(codexConnectionReady(h.controller.snapshot.status), false);
  assert.equal(h.controller.snapshot.status.path, ready.path);
  h.controller.observeRuntimeEvent(h.controller.generation);
  assert.equal(h.scheduled.size, 0);
  assert.equal(h.controller.acceptSaved(revision, ready), true);
});

test("manual refresh can replace a stale save health snapshot without accepting it", async () => {
  const h = harness(); const revision = h.controller.beginSave(false);
  await h.controller.refresh(ready);
  assert.equal(h.controller.acceptSaved(revision, failed), false);
  assert.equal(h.controller.snapshot.status, ready);
});

test("a rejected or thrown connection save checks the surviving runtime without trusting stale readiness", async () => {
  for (const failure of ["backend-rejected", "ipc-error"]) {
    const h = harness(), pending = deferred(); await h.controller.refresh(ready);
    const revision = h.controller.beginSave(true);
    h.plans.push(pending.promise);
    try {
      if (failure === "ipc-error") throw new Error("synthetic IPC failure");
      const result = { ok: false };
      if (!result.ok) h.controller.failSave(revision);
    } catch { h.controller.failSave(revision); }
    assert.equal(codexConnectionReady(h.controller.snapshot.status), false);
    assert.equal(h.scheduled.size, 1);
    await h.tick();
    assert.deepEqual(h.calls, [{ readOnly: true, force: true }]);
    assert.equal(codexConnectionReady(h.controller.snapshot.status), false);
    pending.resolve(ready); await settle();
    assert.equal(codexConnectionReady(h.controller.snapshot.status), true);
    assert.equal(h.scheduled.size, 0);
  }
});

test("a newer verified result cancels a failed-save recheck", async () => {
  const h = harness(); await h.controller.refresh(ready);
  const revision = h.controller.beginSave(true); h.controller.failSave(revision);
  assert.equal(h.scheduled.size, 1);
  await h.controller.refresh(ready);
  assert.equal(h.scheduled.size, 0); assert.equal(h.calls.length, 0);
});

test("failed probes are caught and recover only by bounded checks; disposal ignores late events", async () => {
  const h = harness(); h.plans.push(Promise.reject(new Error("synthetic IPC rejection")));
  await h.controller.refresh(); assert.equal(h.controller.snapshot.checkFailed, true);
  assert.equal(h.scheduled.size, 1);
  h.controller.dispose(); h.controller.observeRuntimeEvent(0);
  assert.equal(h.scheduled.size, 0);
  h.controller.activate(); await h.controller.refresh(ready);
  assert.equal(h.controller.snapshot.status, ready);
});

test("only actual connection identity changes invalidate a connection", () => {
  const settings = { authMode: "chatgpt", codexPath: "/fixture", apiBaseUrl: "", apiModel: "", relayCredentialConfigured: false };
  assert.equal(codexConnectionSettingsChanged(settings, { ...settings, updateChannel: "stable" }), false);
  assert.equal(codexConnectionSettingsChanged(settings, { codexPath: "/other" }), true);
  assert.equal(codexConnectionSettingsChanged(settings, { apiModel: "changed" }), true);
});
