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
import { workbench } from "/src/bridge";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const state = window.__plaudStatusTest = { calls: [], plans: { list: [], sync: [], resume: [] }, pending: {}, issues: [], settings: null };
const startup = window.__plaudStartupConfig || {};
const baseSettings = (await workbench.loadSettings()).settings;
state.settings = { ...baseSettings, onboardingComplete: true, plaudConnectionMode: "enabled", ...startup.settings };
state.snapshot = startup.snapshot || { ok: true, syncedAt: Date.now(), items: [], pendingCount: 0, queueCount: 0, hasMore: false, remoteStatus: "connected" };
// Real empty recovery is local-only and has no snapshot. Startup must fetch
// the list after this response without a manual refresh or generate request.
state.plans.resume.push(startup.resume || { result: { ok: true, status: "complete", resumePendingCount: 0 } });
if (startup.list) state.plans.list.push(startup.list);
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
workbench.listPlaud = request => invoke("list", request);
workbench.syncPlaud = () => invoke("sync");
workbench.resumePlaudTranscripts = () => invoke("resume");
workbench.loginPlaud = async () => { throw new Error("Automatic login is forbidden in this fixture"); };
workbench.checkPlaudConnection = async ({ browser }) => ({ ok: true, connected: true, browser, status: "connected", checkedAt: Date.now() });
workbench.renamePlaud = async request => {
  state.calls.push({ kind: "rename", payload: request });
  return { ok: true, fileId: request.fileId, fileName: request.fileName };
};
workbench.deletePlaud = async request => {
  state.calls.push({ kind: "delete", payload: request });
  return { ok: true, fileId: request.fileId, trashed: true };
};
workbench.runCodex = async () => { throw new Error("Model calls are forbidden in this fixture"); };
workbench.showNotification = async () => { throw new Error("OS alerts are forbidden in this fixture"); };
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
    server: { host: "127.0.0.1", port: 0, hmr: false },
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
    startupPage.setDefaultTimeout(10_000);
    const startupErrors = [];
    startupPage.on("pageerror", error => startupErrors.push(error.message));
    const count = kind => startupPage.evaluate(kind => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length, kind);
    const wait = (kind, count) => startupPage.waitForFunction(({ kind, count }) => window.__plaudStatusTest.calls.filter(call => call.kind === kind).length === count, { kind, count });
    const release = (kind, result) => startupPage.evaluate(({ kind, result }) => window.__plaudStatusTest.pending[kind](result), { kind, result });
    try {
      await startupPage.goto(origin, { waitUntil: "networkidle" });
      await verify({ page: startupPage, count, wait, release });
      assert.equal(await count("sync"), 0, "Startup must never call generating sync");
      assert.deepEqual(startupErrors, []);
    } finally { await isolated.close(); }
  };
  const startupReady = item("startup-ready", { hasTranscript: true, queueStage: "", resumeEligible: false });
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
      if (remoteStatus !== "auth_required") assert.doesNotMatch(await page.locator(".domi-inline-error").innerText(), /重新登录|失效/);
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
  console.log("PLAUD UI passed: startup without resume snapshot; StrictMode; delayed/disabled settings; existing queue; slow list and panel reopen; cancellation; browser handoff; unverified cache rejection; offline/auth recovery; no automatic generation; existing recovery/mutation/status regressions.");
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
