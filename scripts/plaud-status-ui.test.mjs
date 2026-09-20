import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real App/SetupCenter UI, with a disposable browser store and synthetic bridge.
// No PLAUD browser, Electron IPC, user files/database or model run is permitted.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-plaud-status-ui-"));
const screenshotDir = process.env.DOMI_PLAUD_UI_SCREENSHOTS_DIR;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_plaud_status_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const state = window.__plaudStatusTest = { calls: [], plans: { cache: [], list: [], sync: [], resume: [] }, pending: {}, issues: [], settings: null };
state.readerListeners = [];
const startup = window.__plaudStartupConfig || {};
const fallback = (await import("/src/bridge?plaud-status-fallback")).workbench;
if (startup.allowRun) window.workbench = { ...fallback };
const { workbench } = await import("/src/bridge");
const baseSettings = (await workbench.loadSettings()).settings;
state.settings = { ...baseSettings, onboardingComplete: true, plaudConnectionMode: "enabled", ...startup.settings };
state.snapshot = startup.snapshot || { ok: true, syncedAt: Date.now(), items: [], pendingCount: 0, queueCount: 0, hasMore: false, remoteStatus: "connected" };
// Real empty recovery is local-only and has no snapshot. Startup must fetch
// the list after this response without a manual refresh or generate request.
state.plans.resume.push(startup.resume || { result: { ok: true, status: "complete", resumePendingCount: 0 } });
if (startup.list) state.plans.list.push(startup.list);
state.plans.cache.push(startup.cache || { result: { ok: false, cached: false, cacheVerified: false, items: [], remoteStatus: "not_loaded" } });
const invoke = async (kind, payload) => {
  state.calls.push({ kind, payload });
  const plan = state.plans[kind].shift();
  if (plan?.hold) return new Promise(resolve => { state.pending[kind] = resolve; });
  if (plan?.error) throw new Error(plan.error);
  return structuredClone(plan?.result || (kind === "list" ? state.snapshot : { ok: true, status: "complete", resumePendingCount: 0 }));
};
workbench.loadSettings = async () => {
  if (startup.holdSettings) await new Promise(resolve => { state.pending.settings = resolve; });
  return { ok: true, settings: structuredClone(state.settings), updatedAt: Date.now() };
};
if (startup.allowRun) workbench.checkCodex = async () => ({
  ok: true, connectionOk: true, workspacePath: "/synthetic", path: "/synthetic/codex",
  pluginSetup: { ok: true, status: "ready", version: "7.0.9" },
  models: startup.models || [{ id: "gpt-5.6-sol", name: "Synthetic model", supportedReasoningEfforts: [{ id: "max" }], serviceTiers: [{ id: "priority" }] }]
});
if (startup.holdCodex) workbench.checkCodex = () => new Promise(resolve => { state.pending.codex = resolve; });
if (startup.allowRun) workbench.syncDomi = async () => ({ ok: true });
workbench.saveSettings = async request => {
  state.calls.push({ kind: "settings", payload: request });
  Object.assign(state.settings, structuredClone(request));
  return { ok: true, settings: structuredClone(state.settings), updatedAt: Date.now() };
};
workbench.loadState = async defaults => ({ ok: true, state: { ...defaults, threads: [{
  ...defaults.threads[0], title: "合成状态测试", manualTitle: true, messages: [
    { id: "fixture-user", role: "user", content: "查看合成状态" },
    { id: "fixture-assistant", role: "assistant", content: "合成测试已准备", status: "done" }
  ]
}] }, updatedAt: Date.now(), isNew: false });
workbench.listPlaud = request => invoke(request?.cacheOnly ? "cache" : "list", request);
workbench.syncPlaud = request => invoke("sync", request);
workbench.resumePlaudTranscripts = () => invoke("resume");
workbench.onPlaudReaderAvailability = callback => {
  state.readerListeners.push(callback);
  return () => { state.readerListeners = state.readerListeners.filter(listener => listener !== callback); };
};
workbench.onPrepareClose = callback => { state.prepareClose = callback; return () => { state.prepareClose = null; }; };
workbench.plaudWorkflowCompletion = async ({ fileId }) => {
  state.calls.push({ kind: "completion", payload: { fileId } });
  return { ok: false, fileId, stage: "", ...startup.completion };
};
workbench.loginPlaud = async () => {
  if (!startup.allowLogin) throw new Error("Automatic login is forbidden in this fixture");
  state.calls.push({ kind: "login" });
  return new Promise(resolve => { state.pending.login = resolve; });
};
workbench.checkPlaudConnection = async ({ browser }) => ({ ok: true, connected: true, browser, status: "connected", checkedAt: Date.now() });
workbench.renamePlaud = async request => {
  state.calls.push({ kind: "rename", payload: request });
  return { ok: true, fileId: request.fileId, fileName: request.fileName };
};
workbench.deletePlaud = async request => {
  state.calls.push({ kind: "delete", payload: request });
  return { ok: true, fileId: request.fileId, trashed: true };
};
workbench.runCodex = async request => {
  if (!startup.allowRun) throw new Error("Model calls are forbidden in this fixture");
  state.calls.push({ kind: "run", payload: request });
  return new Promise(resolve => { state.pending.run = result => {
    for (const listener of state.codexListeners || []) listener({ type: "completed", runId: request.runId, output: result.output });
    resolve(result);
  }; });
};
state.codexListeners = [];
if (startup.allowRun) workbench.onCodexEvent = callback => {
  state.codexListeners.push(callback);
  return () => { state.codexListeners = state.codexListeners.filter(listener => listener !== callback); };
};
workbench.showNotification = async request => {
  if (!startup.allowRun) throw new Error("OS alerts are forbidden in this fixture");
  state.calls.push({ kind: "notification", payload: request });
  return { ok: true };
};
workbench.reportRendererIssue = issue => state.issues.push(issue);
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(startup.strictMode ? <React.StrictMode><App /></React.StrictMode> : <App />);
`;
const item = (id, patch = {}) => ({ fileId: id, fileName: `合成录音 ${id}`, duration: 60,
  createdAt: 1, editedAt: 1, hasTranscript: false, hasSummary: false, processing: false,
  queueStage: "uploaded", transcriptPath: "", error: "", resumeEligible: false, ...patch });
const snapshot = (items, patch = {}) => ({ ok: true, items, pendingCount: 0, queueCount: items.length,
  syncedAt: Date.now(), hasMore: false, remoteStatus: "connected", ...patch });
const waiting = item("a", { queueStage: "generation_unknown", syncOutcome: "waiting", resumeEligible: true,
  error: "Timed out waiting for transcript", errorCode: "PLAUD_GENERATION_UNCONFIRMED" });
const ready = item("a", { queueStage: "transcript_ready", hasTranscript: true, transcriptPath: "/synthetic/a.md", syncOutcome: "ready" });
const failed = item("b", { queueStage: "generation_failed", syncOutcome: "failed", errorCode: "PLAUD_ACCESS_DENIED", error: "PLAUD_ACCESS_DENIED: synthetic refusal" });
const waitingResult = { ok: false, status: "waiting", waitingCount: 1, resumePendingCount: 1, snapshot: snapshot([waiting]) };
const readyResult = { ok: true, status: "complete", recoveredCount: 1, resumePendingCount: 0, snapshot: snapshot([ready]) };

let server;
let browser;
try {
  server = await createServer({
    configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "plaud-status-fixture",
      resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`);
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  await page.clock.install();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const calls = kind => page.evaluate(kind => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length, kind);
  const waitCalls = (kind, count) => page.waitForFunction(({ kind, count }) => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length === count, { kind, count });
  const plan = (kind, value) => page.evaluate(({ kind, value }) => window.__plaudStatusTest.plans[kind].push(value), { kind, value });
  const release = (kind, result) => page.evaluate(({ kind, result }) => window.__plaudStatusTest.pending[kind](result), { kind, result });
  const setSnapshot = value => page.evaluate(value => { window.__plaudStatusTest.snapshot = value; }, value);
  const sync = page.getByRole("button", { name: "同步 PLAUD 并生成文字稿", exact: true });
  const refresh = page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true });
  const row = id => page.locator(".plaud-queue-row").filter({ has: page.locator(".plaud-title-button", { hasText: `合成录音 ${id}` }) });
  const notice = page.locator(".plaud-inline-notice");
  const assertTone = async tone => {
    await page.locator(`.plaud-inline-notice.${tone}`).waitFor();
    const color = await notice.evaluate(element => getComputedStyle(element).color);
    if (tone !== "complete") assert.notEqual(color, "rgb(82, 107, 90)", "Non-complete feedback must not use the success color");
  };
  await page.goto(origin, { waitUntil: "networkidle" });
  await waitCalls("resume", 1);
  await sync.waitFor();
  assert.equal(await calls("list"), 1, "An empty local resume must automatically restore the recent list");
  assert.equal(await calls("sync"), 0, "Startup must resume existing work without submitting generation");

  await plan("sync", { result: waitingResult });
  await sync.click();
  await assertTone("waiting");
  assert.match(await row("a").innerText(), /等待提交确认/);
  assert.doesNotMatch(await notice.innerText(), /同步完成|需要重试/);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "waiting.png"), fullPage: true, animations: "disabled" });
  await plan("resume", { hold: true });
  await page.getByTitle("收起今日工作", { exact: true }).last().click();
  await page.clock.fastForward(90_001);
  await waitCalls("resume", 2);
  await page.clock.fastForward(180_001);
  assert.equal(await calls("resume"), 2, "Recovery must remain single-flight while the previous check is pending");
  await release("resume", readyResult);
  await page.getByTitle("展开今日工作", { exact: true }).click();
  await assertTone("complete");
  assert.match(await notice.innerText(), /已补下载 1 份/);
  await page.clock.fastForward(180_001);
  assert.equal(await calls("resume"), 2, "The last completed item must stop periodic recovery");
  assert.equal(await calls("sync"), 1, "Automatic recovery must never call the generating sync operation");

  await plan("sync", { result: { ok: false, status: "partial", recoveredCount: 1, failedCount: 1, resumePendingCount: 0, snapshot: snapshot([ready, failed]) } });
  await sync.click();
  await assertTone("partial");
  assert.match(await notice.innerText(), /1 份需要处理/);
  assert.match(await row("b").innerText(), /需要处理|账户权限/);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "partial.png"), fullPage: true, animations: "disabled" });
  await plan("list", { hold: true });
  await refresh.click();
  assert.equal(await notice.count(), 0, "Refresh must clear the previous operation's failure counts immediately");
  await release("list", snapshot([ready]));
  await row("b").waitFor({ state: "detached" });
  assert.equal(await notice.count(), 0, "A fresh list must not retain an old partial-failure banner");

  await plan("sync", { result: { ok: true, failedCount: 1, snapshot: snapshot([failed]), resumePendingCount: 0 } });
  await sync.click();
  await assertTone("failed");
  assert.doesNotMatch(await notice.innerText(), /同步完成/);
  await page.clock.fastForward(180_001);
  assert.equal(await calls("resume"), 2, "An explicit permanent failure must not be polled repeatedly");

  // Opening a rename editor does not freeze recovery. Saving waits for the
  // pending read, applies the title to its fresh snapshot and releases all locks.
  await plan("sync", { result: waitingResult });
  await sync.click();
  await row("a").locator(".plaud-title-button").click();
  await page.getByRole("textbox", { name: "录音标题", exact: true }).fill("合成录音 renamed");
  await plan("resume", { hold: true });
  await page.clock.fastForward(90_001);
  await waitCalls("resume", 3);
  await page.getByTitle("保存标题", { exact: true }).click();
  assert.equal(await calls("rename"), 0, "A title mutation must wait for the recovery read");
  await release("resume", waitingResult);
  await waitCalls("rename", 1);
  await row("renamed").waitFor();
  await setSnapshot(snapshot([{ ...waiting, fileName: "合成录音 renamed" }]));
  await refresh.click();
  await refresh.waitFor({ state: "visible" });
  await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);

  // A confirmation may stay open over a polling tick. Its approved mutation
  // must also wait; the read's finally must not leave a permanent busy flag.
  await row("renamed").getByRole("button", { name: "删除 PLAUD 录音“合成录音 renamed”", exact: true }).click();
  await page.locator(".app-confirm-dialog").waitFor();
  await plan("resume", { hold: true });
  await page.clock.fastForward(90_001);
  await waitCalls("resume", 4);
  await page.locator(".app-confirm-dialog").getByRole("button", { name: "移入回收站", exact: true }).click();
  assert.equal(await calls("delete"), 0, "Approved deletion must wait for the already-running read");
  await release("resume", { ...waitingResult, snapshot: snapshot([{ ...waiting, fileName: "合成录音 renamed" }]) });
  await waitCalls("delete", 1);
  await row("renamed").waitFor({ state: "detached" });
  await setSnapshot(snapshot([]));
  await refresh.click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);

  // Old results and their finally handlers must not overwrite a new browser's
  // snapshot or clear the new operation's single-flight state.
  await plan("sync", { hold: true });
  await sync.click();
  await plan("resume", { hold: true });
  await page.getByTitle("打开 Codex 设置", { exact: true }).click();
  const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
  await settings.getByRole("button", { name: "录音转写", exact: true }).click();
  await settings.getByRole("radio").filter({ hasText: "Tabbit" }).click();
  await settings.getByRole("button", { name: "重新检测", exact: true }).click();
  await settings.getByTitle("关闭设置", { exact: true }).click();
  assert.equal(await calls("resume"), 4, "A new browser must wait until the old backend single-flight operation settles");
  await release("sync", { ok: false, status: "failed", failedCount: 99, snapshot: snapshot([item("obsolete")]), error: "旧账户失败" });
  await waitCalls("resume", 5);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await refresh.isDisabled(), true, "An old finally must not unlock the new recovery request");
  const newItem = item("new-account", { ...ready, fileId: "new-account", fileName: "合成录音 new-account" });
  await release("resume", { ...readyResult, snapshot: snapshot([newItem]) });
  await row("new-account").waitFor();
  assert.equal(await row("obsolete").count(), 0);
  assert.doesNotMatch(await notice.innerText(), /99|旧账户/);
  await setSnapshot(snapshot([newItem]));
  await refresh.click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);

  // A startup check may find no local work. A later fresh list can discover
  // work submitted elsewhere, so its eligible items must restart recovery.
  await page.reload({ waitUntil: "networkidle" });
  await waitCalls("resume", 1);
  await sync.waitFor();
  assert.equal(await calls("sync"), 0);
  const submitted = item("fresh-submitted", { queueStage: "generating", syncOutcome: "waiting", resumeEligible: true,
    generationRequestedAt: "2026-09-08T01:00:00.000Z", generationAcceptedAt: "2026-09-08T01:00:01.000Z" });
  await setSnapshot(snapshot([submitted]));
  await refresh.click();
  await row("fresh-submitted").waitFor();
  assert.match(await row("fresh-submitted").innerText(), /等待远端生成/);
  await plan("resume", { result: { ...readyResult, snapshot: snapshot([
    item("fresh-submitted", { ...ready, fileId: "fresh-submitted", fileName: "合成录音 fresh-submitted" })
  ]) } });
  await page.clock.fastForward(90_001);
  await waitCalls("resume", 2);
  await assertTone("complete");
  assert.equal(await calls("sync"), 0, "Freshly discovered submitted work must resume without generating again");

  // The vendor may keep wait_pull set after both artifacts are ready. A
  // recording outside the local queue can offer notes without claiming that
  // remote generation is unfinished or silently starting a recovery task.
  const remoteReady = item("remote-ready", { hasTranscript: true, hasSummary: true, processing: true,
    queueStage: "", resumeEligible: false });
  await setSnapshot(snapshot([remoteReady]));
  await refresh.click();
  await row("remote-ready").waitFor();
  assert.equal(await row("remote-ready").getByRole("button", { name: "生成纪要并入库", exact: true }).count(), 1);
  assert.doesNotMatch(await row("remote-ready").innerText(), /等待远端生成|仍在处理|自动下载|自动补下载/);
  assert.equal(await calls("resume"), 2, "Remote-ready items with no local queue must not create recovery work");
  assert.equal(await calls("sync"), 0);

  // A refresh that confirms an existing local task's transcript is ready must
  // start download-only recovery now, without waiting for the 90-second tick.
  const localReady = { ...remoteReady, fileId: "local-ready", fileName: "合成录音 local-ready",
    queueStage: "generating", syncOutcome: "waiting", resumeEligible: true };
  await setSnapshot(snapshot([localReady]));
  await plan("resume", { hold: true });
  await refresh.click();
  await waitCalls("resume", 3);
  await row("local-ready").waitFor();
  assert.match(await row("local-ready").innerText(), /待自动补下载/);
  assert.doesNotMatch(await row("local-ready").innerText(), /等待远端生成|仍在处理/);
  await page.clock.fastForward(180_001);
  assert.equal(await calls("resume"), 3, "Immediate recovery and polling must share the same single-flight lock");
  assert.equal(await calls("sync"), 0, "Refresh recovery must never submit a generation request");
  await release("resume", { ...readyResult, snapshot: snapshot([
    { ...localReady, transcriptPath: "/synthetic/local-ready.md", queueStage: "transcript_ready", syncOutcome: "ready", resumeEligible: false }
  ]) });
  await assertTone("complete");
  await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);

  for (const patch of [{ stale: true }, { remoteStatus: "auth_required" }, { remoteStatus: "access_denied" }]) {
    await setSnapshot(snapshot([localReady], patch));
    await refresh.click();
    await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);
    assert.equal(await calls("resume"), 3, "A stale or unauthorized list must not immediately recover remote-ready rows");
  }
  const permanent = { ...localReady, errorCode: "PLAUD_ACCESS_DENIED", error: "PLAUD_ACCESS_DENIED: synthetic refusal" };
  await setSnapshot(snapshot([permanent]));
  await refresh.click();
  await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);
  assert.match(await row("local-ready").innerText(), /需要处理|权限/);
  assert.equal(await row("local-ready").getByRole("button", { name: "生成纪要并入库", exact: true }).count(), 0);
  await page.clock.fastForward(180_001);
  assert.equal(await calls("resume"), 3, "A permanent per-record refusal must block immediate and periodic recovery");
  assert.deepEqual(errors, [], "The real App must not throw during PLAUD recovery and mutation races");

  const startupScenario = async (config, verify) => {
    const isolated = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await isolated.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await isolated.addInitScript(config => { window.__plaudStartupConfig = config; }, { strictMode: true, ...config });
    const startupPage = await isolated.newPage();
    await startupPage.clock.install();
    startupPage.setDefaultTimeout(10_000);
    const startupErrors = [];
    startupPage.on("pageerror", error => startupErrors.push(error.message));
    const count = kind => startupPage.evaluate(kind => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length, kind);
    const wait = (kind, count) => startupPage.waitForFunction(({ kind, count }) => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length === count, { kind, count });
    const release = (kind, result) => startupPage.evaluate(({ kind, result }) => window.__plaudStatusTest.pending[kind](result), { kind, result });
    try {
      await startupPage.goto(origin, { waitUntil: "networkidle" });
      await verify({ page: startupPage, count, wait, release });
      if (!config.manualSync) assert.equal(await count("sync"), 0, "Startup must never call generating sync");
      assert.deepEqual(startupErrors, []);
    } catch (error) {
      console.error("Synthetic startup scenario failed", JSON.stringify(config), await startupPage.evaluate(() => ({
        calls: window.__plaudStatusTest.calls.map(call => call.kind), issues: window.__plaudStatusTest.issues,
        rowErrors: [...document.querySelectorAll('.plaud-item-detail')].map(node => node.textContent),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(node => node.textContent?.slice(-1000))
      })));
      throw error;
    } finally { await isolated.close(); }
  };
  const startupReady = item("startup-ready", { hasTranscript: true, queueStage: "", resumeEligible: false });
  const trustedCache = snapshot([item("saved-recording", { hasTranscript: true, queueStage: "" })], {
    cached: true, cacheVerified: true, stale: true, remoteStatus: "verification_pending", syncedAt: 1700000000000
  });
  const readFailure = { ok: false, stale: true, items: [], remoteStatus: "network_error", retryable: true,
    errorCode: "PLAUD_NETWORK_TIMEOUT", errorStage: "init", error: "PLAUD_NETWORK_TIMEOUT: synthetic read timeout" };
  await startupScenario({ holdCodex: true, cache: { result: trustedCache }, resume: { hold: true },
    list: { result: readFailure }, snapshot: readFailure }, async ({ page, count, wait, release }) => {
    await page.getByText("合成录音 saved-recording", { exact: true }).waitFor();
    await wait("resume", 1);
    assert.equal(await count("cache"), 1, "StrictMode reads the local cache once before background recovery");
    assert.equal(await count("list"), 0, "Cached rows appear while remote recovery and Codex readiness remain held");
    await release("resume", { ok: true, resumePendingCount: 0 });
    await wait("list", 1);
    await page.getByText("已保留录音，正在后台重连", { exact: true }).waitFor();
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    assert.equal(await page.getByText("合成录音 saved-recording", { exact: true }).count(), 1);
    for (const delay of [2001, 5001, 15001]) { await page.clock.fastForward(delay); await page.waitForTimeout(20); }
    await wait("list", 4);
    await page.getByText("已保留录音，暂未更新", { exact: true }).waitFor();
    await page.clock.fastForward(120000);
    assert.equal(await count("list"), 4, "Startup recovery has a finite read-only retry budget");
    await page.locator(".plaud-connection-status summary").click();
    assert.match(await page.locator(".plaud-connection-status").innerText(), /PLAUD_NETWORK_TIMEOUT.*init/);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "startup-cached-recordings.png") });
    await page.evaluate(() => { window.__plaudStatusTest.snapshot = { ok: true, remoteStatus: "connected", items: [], syncedAt: Date.now() }; });
    await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).click();
    await page.getByText("PLAUD 中暂无录音", { exact: true }).waitFor();
    assert.equal(await page.getByText("合成录音 saved-recording", { exact: true }).count(), 0,
      "A confirmed fresh empty response replaces older cached recordings");
  });
  await startupScenario({ cache: { result: trustedCache }, resume: { result: { ok: false, snapshot: {
    ...readFailure, retryable: false, remoteStatus: "auth_required", errorCode: "PLAUD_AUTH_REQUIRED", error: "PLAUD_AUTH_REQUIRED: expired"
  } } } }, async ({ page, count }) => {
    await page.getByText("合成录音 saved-recording", { exact: true }).waitFor();
    await page.getByText("PLAUD 登录已失效", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "重新登录", exact: true }).count(), 1);
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    await page.clock.fastForward(120000);
    assert.equal(await count("list"), 0, "A confirmed expired login must not trigger automatic remote requests");
  });
  await startupScenario({ cache: { result: trustedCache }, allowLogin: true, list: { hold: true } }, async ({ page, count, wait, release }) => {
    await page.getByText("合成录音 saved-recording", { exact: true }).waitFor();
    await wait("list", 1);
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("button", { name: "登录并验证", exact: true }).click();
    await wait("login", 1);
    assert.equal(await page.getByText("合成录音 saved-recording", { exact: true }).count(), 0,
      "Explicit same-browser login immediately clears the previous account's displayed recordings");
    await release("list", trustedCache);
    await page.waitForTimeout(20);
    assert.equal(await page.getByText("合成录音 saved-recording", { exact: true }).count(), 0,
      "An old read finishing after login starts must not repopulate the old account's cache");
    await page.evaluate(() => { window.__plaudStatusTest.snapshot = { ok: false, items: [], cacheInvalidated: true,
      remoteStatus: "auth_required", error: "PLAUD_AUTH_REQUIRED: synthetic new account" }; });
    await release("login", { ok: true, connected: true, browser: "chrome", status: "connected" });
    await wait("list", 2);
    assert.equal(await count("sync"), 0);
  });
  await startupScenario({ cache: { result: trustedCache }, list: { result: {
    ok: false, items: [], stale: true, retryable: false, remoteStatus: "authorization_pending",
    errorCode: "PLAUD_AUTH_CONTEXT_MISMATCH", errorStage: "init", apiStatus: -3901,
    error: "PLAUD 本轮账号验证未完成，请稍后重新检测。"
  } } }, async ({ page, count }) => {
    await page.getByText("已保留录音，暂未更新", { exact: true }).waitFor();
    await page.locator(".plaud-connection-status summary").click();
    assert.match(await page.locator(".plaud-connection-status").innerText(), /PLAUD_AUTH_CONTEXT_MISMATCH · init · API -3901/);
    assert.equal(await page.getByRole("button", { name: "重新登录", exact: true }).count(), 0,
      "A vendor auth-context mismatch is not proof that the user logged out");
    await page.clock.fastForward(120000);
    assert.equal(await count("list"), 1, "An unknown/unsupported vendor context failure must not gain generic retries");
  });
  await startupScenario({ snapshot: { ...readFailure, retryable: false } }, async ({ page }) => {
    await page.getByText("暂时无法读取录音", { exact: true }).waitFor();
    assert.equal(await page.getByText("PLAUD 中暂无录音", { exact: true }).count(), 0);
    assert.doesNotMatch(await page.locator(".plaud-connection-status").innerText(), /已保留录音|已显示|上次成功/);
  });
  await startupScenario({ holdSettings: true, snapshot: snapshot([startupReady]) }, async ({ page, count, wait, release }) => {
    assert.equal(await count("resume"), 0);
    assert.equal(await count("list"), 0, "No PLAUD access is allowed before settings finish loading");
    await release("settings");
    await wait("resume", 1);
    await wait("list", 1);
    await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
    assert.equal(await count("resume"), 1, "StrictMode must not duplicate startup recovery");
    assert.equal(await count("list"), 1, "StrictMode must not duplicate the fresh list");
    assert.equal(await page.getByText("按刷新读取", { exact: true }).count(), 0);
  });
  for (const settings of [{ plaudConnectionMode: "disabled" }, { onboardingComplete: false }]) {
    await startupScenario({ settings }, async ({ count }) => {
      assert.equal(await count("resume"), 0);
      assert.equal(await count("list"), 0, "Disabled/incomplete setup must not open PLAUD");
    });
  }
  await startupScenario({ list: { hold: true } }, async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await page.getByRole("button", { name: "正在读取最近录音", exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "正在同步并生成文字稿", exact: true }).count(), 0);
    assert.match(await page.locator(".plaud-queue-health").innerText(), /正在读取/);
    assert.equal(await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).isDisabled(), true);
    await page.getByRole("button", { name: "录音交流", exact: true }).click();
    await page.getByRole("button", { name: "录音交流", exact: true }).click();
    assert.equal(await count("list"), 1, "Reopening the panel must join the pending startup list");
    await release("list", snapshot([startupReady]));
    await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
  });
  await startupScenario({ resume: { result: readyResult } }, async ({ page, count }) => {
    await page.getByText("合成录音 a", { exact: true }).waitFor();
    assert.equal(await count("resume"), 1);
    assert.equal(await count("list"), 0, "Existing recovery already returns the recent snapshot");
  });
  const supersededSnapshot = snapshot([item("superseded")], { superseded: true, paused: true,
    stale: true, retryable: true, remoteStatus: "verification_pending" });
  await startupScenario({ snapshot: snapshot([startupReady]), resume: { result: {
    ok: true, superseded: true, snapshot: supersededSnapshot
  } } }, async ({ page, count, wait }) => {
    await wait("list", 1);
    await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
    assert.equal(await page.getByText("合成录音 superseded", { exact: true }).count(), 0);
    await page.evaluate(result => { window.__plaudStatusTest.plans.list.push({ result }); }, supersededSnapshot);
    await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).click();
    await wait("list", 2);
    await page.waitForFunction(() => !document.querySelector('[aria-label="刷新 PLAUD 最近录音"]').disabled);
    assert.equal(await page.getByText("合成录音 startup-ready", { exact: true }).count(), 1,
      "A superseded response must preserve trusted rows instead of accepting a new empty or paused snapshot");
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    assert.equal(await page.getByText("任务正在使用 PLAUD，完成后会自动更新最近录音。", { exact: true }).count(), 0);
    await page.clock.fastForward(90_001);
    assert.equal(await count("list"), 2, "Discarding an obsolete scope result must not schedule connection retries");
  });
  for (const remoteStatus of ["network_error", "auth_required"]) {
    const oldCache = snapshot([item("unverified-cache")]);
    await startupScenario({ list: { result: { ...oldCache, ok: false, stale: true, remoteStatus,
      error: remoteStatus === "auth_required" ? "PLAUD_AUTH_REQUIRED: synthetic login" : "Failed to fetch",
      lastSuccessfulSnapshot: oldCache } } }, async ({ page, count, wait }) => {
      await wait("list", 1);
      await page.getByRole("button", { name: "同步 PLAUD 并生成文字稿", exact: true }).waitFor();
      assert.equal(await page.getByText("合成录音 unverified-cache", { exact: true }).count(), 0);
      const health = await page.locator(".plaud-queue-health").innerText();
      assert.equal(health, remoteStatus === "auth_required" ? "需要登录" : "连接待检查");
      if (remoteStatus !== "auth_required") assert.doesNotMatch(await page.locator(".plaud-connection-status").innerText(), /重新登录|失效/);
      await page.evaluate(value => { window.__plaudStatusTest.snapshot = value; }, snapshot([startupReady]));
      await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).click();
      await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
      assert.equal(await count("list"), 2, "A later explicit successful read restores the list");
    });
  }
  await startupScenario({ resume: { hold: true } }, async ({ page, count, wait, release }) => {
    await wait("resume", 1);
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("radio").filter({ hasText: "暂时不用" }).click();
    await settings.getByRole("button", { name: "保存 PLAUD 设置", exact: true }).click();
    await release("resume", { ok: true, resumePendingCount: 0 });
    await page.getByText("PLAUD 未启用", { exact: true }).waitFor();
    assert.equal(await count("list"), 0, "Disabling PLAUD while startup is pending cancels its follow-up read");
  });
  await startupScenario({ list: { hold: true } }, async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await page.evaluate(() => { window.__plaudStatusTest.plans.resume.push({ hold: true }); });
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("radio").filter({ hasText: "Tabbit" }).click();
    await settings.getByRole("button", { name: "重新检测", exact: true }).click();
    await settings.getByTitle("关闭设置", { exact: true }).click();
    assert.equal(await count("resume"), 1, "New-browser startup must not join the old backend list operation");
    await release("list", snapshot([item("old-browser")]));
    await wait("resume", 2);
    const oldCache = snapshot([item("old-browser")]);
    await page.evaluate(result => { window.__plaudStatusTest.plans.list.push({ result }); },
      { ...oldCache, ok: false, stale: true, remoteStatus: "network_error", error: "Failed to fetch", lastSuccessfulSnapshot: oldCache });
    await release("resume", { ok: true, resumePendingCount: 0 });
    await wait("list", 2);
    await page.getByRole("button", { name: "同步 PLAUD 并生成文字稿", exact: true }).waitFor();
    assert.equal(await page.getByText("合成录音 old-browser", { exact: true }).count(), 0, "Neither the old response nor its global cache may populate the new scope");
    assert.equal(await page.evaluate(() => window.__plaudStatusTest.calls.filter(call => call.kind === "list").every(call => call.payload.fresh)), true);
  });
  const emitAvailability = (page, available, activeOwners, generation) => page.evaluate(status => {
    for (const listener of window.__plaudStatusTest.readerListeners) listener(status);
  }, { available, activeOwners, generation, browser: "chrome" });
  const pausedSnapshot = { ok: true, paused: true, stale: true, remoteStatus: "workflow_in_use", items: [], error: "", warning: "" };
  await startupScenario({ snapshot: snapshot([startupReady]) }, async ({ page, count, wait }) => {
    await wait("list", 1);
    await emitAvailability(page, false, 2, 1);
    await page.getByText("任务正在使用 PLAUD，完成后会自动更新最近录音。", { exact: true }).waitFor();
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    assert.match(await page.locator(".plaud-queue-header").innerText(), /上次成功/);
    await page.clock.fastForward(180_001);
    assert.equal(await count("list"), 1);
    assert.equal(await count("resume"), 1);
    await emitAvailability(page, false, 1, 2);
    await page.clock.fastForward(180_001);
    assert.equal(await count("list"), 1, "One remaining owner must keep background reads paused");
    await emitAvailability(page, true, 0, 3);
    await wait("list", 2);
    await page.getByRole("button", { name: "同步 PLAUD 并生成文字稿", exact: true }).waitFor();
    await emitAvailability(page, true, 0, 3);
    assert.equal(await count("list"), 2, "Duplicate release events cannot cause repeated refreshes");
  });
  await startupScenario({ list: { hold: true } }, async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await emitAvailability(page, false, 1, 1);
    await emitAvailability(page, true, 0, 2);
    await page.evaluate(value => { window.__plaudStatusTest.snapshot = value; }, snapshot([startupReady]));
    await release("list", pausedSnapshot);
    await wait("list", 2);
    await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
    assert.equal(await page.getByText("任务正在使用 PLAUD，完成后会自动更新最近录音。", { exact: true }).count(), 0,
      "A delayed paused response cannot override the newer available event");
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    assert.equal(await count("resume"), 1);
  });
  const transient = snapshot([], { ok: false, retryable: true, remoteStatus: "network_error", error: "Failed to fetch" });
  await startupScenario({ snapshot: transient }, async ({ page, count, wait }) => {
    await wait("list", 1);
    await page.getByText(/正在自动恢复最近录音/).waitFor();
    await page.evaluate(value => { window.__plaudStatusTest.snapshot = value; }, snapshot([startupReady]));
    await page.clock.fastForward(2_001);
    await wait("list", 2);
    await page.getByText("合成录音 startup-ready", { exact: true }).waitFor();
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
    await page.clock.fastForward(180_001);
    assert.equal(await count("list"), 2, "Successful recovery must cancel its remaining retry budget");
  });
  await startupScenario({ snapshot: transient }, async ({ page, count, wait }) => {
    await wait("list", 1);
    for (const [attempt, delay] of [2001, 5001, 15001].entries()) {
      await page.getByText(/正在自动恢复最近录音/).waitFor();
      await page.clock.fastForward(delay);
      await wait("list", attempt + 2);
    }
    await page.getByRole("button", { name: "重试", exact: true }).waitFor();
    await page.clock.fastForward(180_001);
    assert.equal(await count("list"), 4, "Automatic list recovery must stop after three retries");
  });
  await startupScenario({ snapshot: transient }, async ({ page, count, wait }) => {
    await wait("list", 1);
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("radio").filter({ hasText: "暂时不用" }).click();
    await settings.getByRole("button", { name: "保存 PLAUD 设置", exact: true }).click();
    await page.clock.fastForward(180_001);
    assert.equal(await count("list"), 1, "Disabling PLAUD must cancel an already scheduled list retry");
  });

  const preflightFailure = (patch = {}) => ({ ok: false, status: "failed", preflight: true, submissionStarted: false,
    retryable: true, recoveryScope: "synthetic-scope", errorCode: "PLAUD_NETWORK_TIMEOUT", errorStage: "list",
    error: "Failed to fetch", snapshot: transient, ...patch });
  const queuePlan = (page, kind, value) => page.evaluate(({ kind, value }) => {
    window.__plaudStatusTest.plans[kind].push(value);
  }, { kind, value });
  const syncButton = page => page.getByRole("button", { name: "同步 PLAUD 并生成文字稿", exact: true });
  const pendingNotice = page => page.getByText("已保留同步请求，连接恢复后自动继续。", { exact: true });
  const manualScenario = verify => startupScenario({ manualSync: true, snapshot: snapshot([startupReady]) }, verify);
  await manualScenario(async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await queuePlan(page, "sync", { result: preflightFailure({ errorCode: "PLAUD_READ_TRANSIENT", errorStage: "discovery" }) });
    await syncButton(page).click();
    await pendingNotice(page).waitFor();
    await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).click();
    await wait("list", 2);
    await pendingNotice(page).waitFor();
    assert.equal(await page.locator(".plaud-inline-notice.complete").count(), 0,
      "A successful read cannot clear or announce completion of the user's deferred sync");
    await queuePlan(page, "sync", { hold: true });
    await page.clock.fastForward(2_001);
    await wait("sync", 2);
    const continued = await page.evaluate(() => window.__plaudStatusTest.calls.filter(call => call.kind === "sync")[1]);
    assert.deepEqual(continued.payload, { expectedRecoveryScope: "synthetic-scope" });
    await page.clock.fastForward(180_001);
    assert.equal(await count("sync"), 2, "Automatic continuation uses the existing single-flight sync lock");
    assert.equal(await count("list"), 2, "Deferred sync must not also run a separate automatic list-retry loop");
    await release("sync", readyResult);
    await page.locator(".plaud-inline-notice.complete").waitFor();
    assert.equal(await pendingNotice(page).count(), 0);
    await page.clock.fastForward(180_001);
    assert.equal(await count("sync"), 2, "Successful generation clears the deferred user intent");
  });
  await manualScenario(async ({ page, count, wait }) => {
    await wait("list", 1);
    for (let attempt = 0; attempt < 4; attempt++) await queuePlan(page, "sync", { result: preflightFailure() });
    await syncButton(page).click();
    for (const [attempt, delay] of [2001, 5001, 15001].entries()) {
      await pendingNotice(page).waitFor();
      await page.clock.fastForward(delay);
      await wait("sync", attempt + 2);
    }
    await page.locator(".plaud-inline-notice.failed").waitFor();
    await page.clock.fastForward(900_001);
    assert.equal(await count("sync"), 4, "One manual sync has at most three automatic continuations");
    assert.equal(await pendingNotice(page).count(), 0);
    await page.locator(".plaud-inline-notice.failed").waitFor();
    assert.match(await page.locator(".plaud-inline-notice.failed").innerText(), /同步未完成/,
      "A later automatic successful list refresh must not erase an exhausted manual sync failure");
  });
  await manualScenario(async ({ page, count, wait }) => {
    await wait("list", 1);
    const retryAt = await page.evaluate(() => Date.now() + 90_000);
    await queuePlan(page, "sync", { result: preflightFailure({ errorCode: "PLAUD_RATE_LIMITED", retryAt, retryAfterMs: 60_000 }) });
    await queuePlan(page, "sync", { result: readyResult });
    await syncButton(page).click();
    await pendingNotice(page).waitFor();
    await emitAvailability(page, true, 0, 1);
    await page.clock.fastForward(89_000);
    assert.equal(await count("sync"), 1, "Owner release cannot bypass a server retry-at cooldown");
    assert.equal(await count("list"), 1, "Rate-limited continuation must not create extra automatic list calls");
    await page.clock.fastForward(1_001);
    await wait("sync", 2);
    await page.locator(".plaud-inline-notice.complete").waitFor();
  });
  await manualScenario(async ({ page, count, wait, release }) => {
    await wait("list", 1);
    const retryAt = await page.evaluate(() => Date.now() + 300_000);
    const rateLimited = { ...waiting, syncOutcome: "retryable", retryable: true, errorCode: "PLAUD_RATE_LIMITED", error: "PLAUD_RATE_LIMITED: synthetic cooldown" };
    await queuePlan(page, "sync", { result: { ok: false, status: "waiting", retryableCount: 1, resumePendingCount: 1,
      submissionStarted: true, snapshot: snapshot([rateLimited], { retryable: true, remoteStatus: "rate_limited", retryAt, retryAfterMs: 300_000 }) } });
    await syncButton(page).click();
    await queuePlan(page, "resume", { hold: true });
    await page.clock.fastForward(90_001);
    assert.equal(await count("resume"), 1, "A submitted task's recovery must honor Retry-After beyond the usual 90 seconds");
    await page.clock.fastForward(200_000);
    assert.equal(await count("resume"), 1);
    assert.equal(await count("list"), 1);
    await page.clock.fastForward(10_001);
    await wait("resume", 2);
    assert.equal(await count("sync"), 1, "Rate-limited submitted work resumes reads without replaying generation");
    await release("resume", readyResult);
    await page.locator(".plaud-inline-notice.complete").waitFor();
  });
  await manualScenario(async ({ page, count, wait }) => {
    await wait("list", 1);
    const retryAt = await page.evaluate(() => Date.now() + 300_000);
    await queuePlan(page, "sync", { result: { ok: false, status: "failed", submissionStarted: true,
      resumePendingCount: 0, error: "PLAUD_RATE_LIMITED: synthetic cooldown",
      snapshot: snapshot([startupReady], { stale: true, retryable: true, remoteStatus: "rate_limited", retryAt, retryAfterMs: 300_000 }) } });
    await syncButton(page).click();
    await emitAvailability(page, false, 1, 1);
    await page.clock.fastForward(30_000);
    await emitAvailability(page, true, 0, 2);
    assert.equal(await count("list"), 1, "An owner release at 30 seconds cannot bypass a 300-second server cooldown");
    await page.clock.fastForward(260_000);
    assert.equal(await count("list"), 1);
    assert.equal(await count("resume"), 1);
    await page.clock.fastForward(10_001);
    await wait("list", 2);
    assert.equal(await count("sync"), 1, "The deferred owner-release refresh remains read-only");
  });
  await manualScenario(async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await queuePlan(page, "sync", { hold: true });
    await syncButton(page).click();
    await emitAvailability(page, false, 1, 1);
    await release("sync", preflightFailure({ paused: true, status: "paused", errorCode: "PLAUD_WORKFLOW_IN_USE", snapshot: pausedSnapshot }));
    await page.getByText("已保留同步请求，任务完成后自动继续。", { exact: true }).waitFor();
    await page.clock.fastForward(15_001);
    assert.equal(await count("sync"), 1);
    await queuePlan(page, "sync", { result: readyResult });
    await emitAvailability(page, true, 0, 2);
    await wait("sync", 2);
    await page.locator(".plaud-inline-notice.complete").waitFor();
    assert.equal(await count("list"), 1, "The last owner's release continues the pending sync instead of replacing it with a list refresh");
  });
  await manualScenario(async ({ page, count, wait }) => {
    await wait("list", 1);
    for (const patch of [{ submissionStarted: undefined }, { submissionStarted: true }, { preflight: false },
      { recoveryScope: undefined }, { errorCode: "PLAUD_AUTH_REQUIRED" }, { errorCode: "PLAUD_ACCESS_DENIED" },
      { errorCode: "PLAUD_GENERATION_UNCONFIRMED" }]) {
      const before = await count("sync");
      await queuePlan(page, "sync", { result: preflightFailure({ snapshot: snapshot([]), ...patch }) });
      await syncButton(page).click();
      await wait("sync", before + 1);
      await page.clock.fastForward(180_001);
      assert.equal(await count("sync"), before + 1, "Unknown submissions, unsupported runtimes and permanent errors must never be replayed");
      assert.equal(await pendingNotice(page).count(), 0);
    }
  });
  for (const action of ["disable", "browser", "same-browser-login", "shutdown"]) {
    await manualScenario(async ({ page, count, wait }) => {
      await wait("list", 1);
      await queuePlan(page, "sync", { result: preflightFailure() });
      await syncButton(page).click();
      await pendingNotice(page).waitFor();
      if (action === "shutdown") {
        await page.evaluate(() => window.__plaudStatusTest.prepareClose());
      } else {
        await page.getByTitle("打开 Codex 设置", { exact: true }).click();
        const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
        await settings.getByRole("button", { name: "录音转写", exact: true }).click();
        if (action === "disable") {
          await settings.getByRole("radio").filter({ hasText: "暂时不用" }).click();
          await settings.getByRole("button", { name: "保存 PLAUD 设置", exact: true }).click();
        } else {
          if (action === "browser") await settings.getByRole("radio").filter({ hasText: "Tabbit" }).click();
          await settings.getByRole("button", { name: "重新检测", exact: true }).click();
        }
      }
      await page.clock.fastForward(900_001);
      assert.equal(await count("sync"), 1, `${action} must cancel the deferred manual intent`);
    });
  }
  await manualScenario(async ({ page, count, wait, release }) => {
    await wait("list", 1);
    await queuePlan(page, "sync", { hold: true });
    await syncButton(page).click();
    await page.evaluate(() => window.__plaudStatusTest.prepareClose());
    await release("sync", preflightFailure());
    await page.clock.fastForward(900_001);
    assert.equal(await count("sync"), 1, "A late preflight result cannot recreate an intent canceled during shutdown");
    assert.equal(await pendingNotice(page).count(), 0);
  });
  await manualScenario(async ({ page, count, wait }) => {
    await wait("list", 1);
    await queuePlan(page, "sync", { result: preflightFailure() });
    await queuePlan(page, "sync", { result: preflightFailure({ superseded: true }) });
    await syncButton(page).click();
    await pendingNotice(page).waitFor();
    await page.clock.fastForward(2_001);
    await wait("sync", 2);
    await page.clock.fastForward(900_001);
    assert.equal(await count("sync"), 2, "Backend rejection of a changed account/session scope ends the continuation");
    assert.equal(await pendingNotice(page).count(), 0);
  });
  await startupScenario({ allowRun: true, models: [], snapshot: snapshot([startupReady]) }, async ({ page, count, wait }) => {
    await wait("list", 1);
    await page.getByRole("button", { name: "生成纪要并入库", exact: true }).click();
    await page.locator(".plaud-item-detail.attention").filter({ hasText: "model/list" }).waitFor();
    assert.equal(await count("run"), 0);
    assert.equal(await page.locator(".domi-inline-error").count(), 0, "A notes preflight failure belongs to the recording, not the connection banner");
    await page.getByRole("button", { name: "刷新 PLAUD 最近录音", exact: true }).click();
    await page.locator(".plaud-item-detail.attention").filter({ hasText: "model/list" }).waitFor();
    assert.equal(await page.locator(".domi-inline-error").count(), 0);
  });
  for (const completion of [
    { ok: true, fileId: "startup-ready", stage: "context_pending", outcome: "waiting-input" },
    { ok: true, fileId: "startup-ready", stage: "notes_non_project", outcome: "completed" },
    { ok: false, fileId: "startup-ready", stage: "notes_non_project", errorCode: "NOT_VERIFIED" },
    { ok: true, fileId: "wrong-id", stage: "context_pending", outcome: "waiting-input" }
  ]) {
    await startupScenario({ allowRun: true, snapshot: snapshot([startupReady]), completion }, async ({ page, wait, release }) => {
      await wait("list", 1);
      await page.getByRole("button", { name: "生成纪要并入库", exact: true }).click();
      await wait("run", 1);
      await page.getByRole("button", { name: "正在执行", exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "正在启动", exact: true }).count(), 0, "Accepted tasks must not remain labelled starting for their entire run");
      const payload = await page.evaluate(() => window.__plaudStatusTest.calls.find(call => call.kind === "run").payload);
      assert.equal(payload.plaudAccess.kind, "recording");
      assert.equal(payload.plaudAccess.fileId, "startup-ready");
      await page.evaluate(() => {
        Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
        window.dispatchEvent(new Event("blur"));
      });
      await release("run", { ok: true, output: "合成交流结果", runId: payload.runId, workspacePath: "/synthetic" });
      await wait("completion", 1);
      await page.waitForFunction(() => window.__plaudStatusTest.calls.some(call => call.kind === "notification"));
      const issues = await page.evaluate(() => window.__plaudStatusTest.issues);
      const valid = completion.ok && completion.fileId === "startup-ready";
      assert.equal(issues.some(issue => /DOMI_ENTITY_RESULT_V1|本地工作流结果未通过核验/.test(issue.message)), !valid,
        "Only a verifier-approved exact recording may finish without an entity receipt");
      if (valid && completion.outcome === "waiting-input") await page.getByText("等待补充会议背景", { exact: true }).waitFor();
      assert.equal(await page.locator(".domi-inline-error").count(), 0, "Notes finalization errors must not be rendered as a PLAUD connection failure");
    });
  }
  console.log("PLAUD UI passed: bounded scoped preflight continuation; retry-at cooldown; owner release; no unknown POST replay; login/browser/disable/shutdown cancellation; late-response invalidation; startup/list/recovery/mutation/status and verified notes completion regressions.");
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
