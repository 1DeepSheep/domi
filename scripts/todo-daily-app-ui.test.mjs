import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// The production App uses the production scheduler in isolated temporary files.
// Its native bridge and Codex result are synthetic; user files are never read.
const require = createRequire(import.meta.url);
const { TodoDailyScheduler } = require("../electron/todo-daily-scheduler.cjs");
process.env.TZ = "Asia/Shanghai";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-todo-daily-app-"));
const fixture = "/__todo_daily_app_fixture__.tsx";
const fixturePath = path.join(root, fixture.slice(1));
const identity = "synthetic-repository-identity";
const cases = new Map();
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
const fallback = (await import("/src/bridge?todo-app-fallback")).workbench;
const config = window.__todoConfig;
const rpc = async (kind, request = {}) => {
  const response = await fetch("/__todo_test_rpc", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: config.id, kind, now: Date.now(), request }) });
  return response.json();
};
const task = (id, category, extra = {}) => ({ id, title: "跟进合成项目 " + id, summary: "确认试点计划",
  reason: "收到试点反馈，需要核对结果并安排下一次沟通", priority: "P2", category, status: "open", signalKey: id,
  source: { kind: "project", recordId: "synthetic-" + id, displayName: "合成项目 " + id }, dueAt: null,
  suggestedAction: { kind: "review", label: "核对试点结果并列出下一步问题", prompt: "读取合成测试资料" },
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", ...extra });
const tasks = [task("A", "key-milestone", { dueAt: "2026-10-26" }), task("B", "new-entry"),
  task("C", "relationship-follow-up", { status: "in_progress" }), task("D", "project-follow-up"),
  ...Array.from({ length: 12 }, (_, n) => task("extra-" + n, "new-entry"))];
const snapshot = { version: 1, backend: "local", syncedAt: Date.now(),
  health: { plugin: { ok: true, version: "7.0.18", displayName: "domi", root: "/synthetic/plugin" },
    lark: { ok: true, disabled: true, userName: "", appName: "" }, plaud: { ok: true, disabled: true, queueCount: 0, queueStages: {} } },
  sources: { projects: { name: "合成资料库", total: 0, localLibraryDir: "/synthetic/library", localDatabasePath: "/synthetic/db" }, people: { name: "合成人脉", total: 0 } }, projects: [], people: [] };
const state = window.__todoAppTest = { calls: [], issues: [], holdRun: Boolean(config.holdRun), holdForeground: Boolean(config.holdForeground),
  pendingRuns: new Map(), eventHandlers: new Set(), board: { ok: true, configured: true, stale: false, syncedAt: Date.now(), updatedAt: "2026-10-25T00:00:00Z",
    documentSha256: "b".repeat(64), ledgerSha256: "a".repeat(64), tasks } };
const settings = { ...(await fallback.loadSettings()).settings, onboardingComplete: true, storageBackend: "local", externalAccessMode: "always",
  localRepositoryDir: "/synthetic/library", localDatabasePath: "/synthetic/db", plaudConnectionMode: "disabled", radarFollowedDomains: [] };
localStorage.setItem("domi.weeklyNews.automation.v1", JSON.stringify({ lastLightSyncAt: Date.now(), lastRadarSuccessAt: Date.now(), nextRadarAt: Date.now() + 86400000, retryAttempt: 0 }));
window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings }),
  loadState: async defaults => ({ ok: true, isNew: false, state: defaults }),
  checkCodex: async () => ({ ok: true, connectionOk: true, pluginSetup: { ok: true, status: "ready", version: "7.0.18" },
    models: ["gpt-5.6-sol", "gpt-5.6-terra"].map(id => ({ id, name: "Synthetic policy model", supportedReasoningEfforts: [{ id: "medium" }, { id: "high" }, { id: "xhigh" }, { id: "max" }, { id: "ultra" }], serviceTiers: [{ id: "priority" }] })) }),
  loadDomiCache: async () => ({ ok: true, snapshot: structuredClone(snapshot) }),
  syncDomi: async request => { state.calls.push({ kind: "sync", request }); return { ok: true, snapshot: structuredClone(snapshot) }; },
  listDomiTasks: async () => structuredClone(state.board),
  listWeeklyNews: async () => ({ ok: true, items: [], total: 0, contentUpdatedAt: Date.now() - 60000, radarCheckedThrough: Date.now() }),
  todoDailyStatus: async () => { const result = await rpc("status"); state.calls.push({ kind: "status", result }); return result; },
  claimTodoSync: async request => { const result = await rpc("claim", request); state.calls.push({ kind: "claim", request, result }); return result; },
  finishTodoSync: async request => { const result = await rpc("finish", request); state.calls.push({ kind: "finish", request, result }); return result; },
  onCodexEvent: callback => { state.eventHandlers.add(callback); return () => state.eventHandlers.delete(callback); },
  runCodex: async request => {
    state.calls.push({ kind: "run", request });
    const result = await rpc("run", { workflowId: request.workflowId, runId: request.runId, background: request.background });
    if ((request.workflowId === "task" && state.holdRun) || (!request.background && state.holdForeground)) {
      await new Promise(resolve => { state.pendingRuns.set(request.runId, resolve); state.releaseRun = () => { state.pendingRuns.delete(request.runId); resolve(); }; });
    }
    if (request.workflowId !== "task") {
      state.eventHandlers.forEach(callback => callback({ runId: request.runId, type: "completed", output: "合成前台任务已完成。" }));
      return { ok: true, output: "合成前台任务已完成。", threadId: "synthetic-thread" };
    }
    if (result.fail) return { ok: false, error: "合成模型暂时不可用" };
    if (result.missingReceipt) return { ok: true, output: "合成无回执结果" };
    state.board.syncReceipt = { schema: "domi.todo-result.v1", runId: request.runId, ledgerSha256: state.board.ledgerSha256,
      documentSha256: state.board.documentSha256, verified: true, taskIds: state.board.tasks.map(task => task.id), updatedAt: new Date().toISOString() };
    return { ok: true, output: "<!-- DOMI_TODO_RESULT_V1 " + JSON.stringify(state.board.syncReceipt) + " -->" };
  },
  testCodexConnection: async () => { throw new Error("Real model probes forbidden in fixture"); },
  reportRendererIssue: issue => state.issues.push(issue)
};
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;

let server;
let browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: path.join(cache, "vite"), logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "todo-daily-app-fixture", resolveId(id) { if (id === fixture) return fixturePath; }, load(id) { if (id === fixturePath) return source; },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (request.url === "/__todo_test_rpc") {
          try {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const input = JSON.parse(Buffer.concat(chunks).toString());
            const item = cases.get(input.id); if (!item) throw new Error("Unknown test case");
            item.now = input.now;
            item.events.push({ kind: input.kind, request: input.request, now: input.now });
            let result;
            if (input.kind === "claim" && item.claimBusy) {
              result = { ...item.scheduler.status({ repositoryIdentity: identity }), repositoryIdentity: identity,
                claimed: false, token: null, reason: item.claimBusy };
            } else if (input.kind === "finish" && item.finishFailRemaining > 0) {
              item.finishFailRemaining--;
              result = { ok: false, accepted: false, error: "合成检查点暂时无法写入" };
            } else if (input.kind === "run") {
              result = { fail: item.failRemaining > 0, missingReceipt: Boolean(item.missingReceipt) };
              if (input.request.workflowId === "task" && item.failRemaining > 0) item.failRemaining--;
            } else {
              result = { ...item.scheduler[input.kind]({ repositoryIdentity: identity, ...input.request }), repositoryIdentity: identity };
            }
            response.setHeader("Content-Type", "application/json"); response.end(JSON.stringify(result));
          } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ ok: false, error: String(error) })); }
          return;
        }
        if (new URL(request.url, "http://localhost").pathname !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });

  async function open(id, options = {}) {
    const item = { now: new Date(options.time || "2026-10-26T02:00:00Z").getTime(), events: [], failRemaining: options.failRemaining || 0,
      missingReceipt: options.missingReceipt || false, claimBusy: options.claimBusy || false, finishFailRemaining: options.finishFailRemaining || 0 };
    item.scheduler = new TodoDailyScheduler({ filePath: path.join(cache, `${id}.json`), now: () => item.now });
    cases.set(id, item);
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, timezoneId: "Asia/Shanghai" });
    const external = []; await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url()); return route.abort();
    });
    await context.addInitScript(config => { window.__todoConfig = config; }, { id, ...options });
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date(item.now) });
    await page.goto(origin);
    await page.getByRole("button", { name: /^待办事项/ }).waitFor();
    await page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "status"));
    return { page, context, item, errors, external };
  }
  const modelRuns = item => item.events.filter(event => event.kind === "run" && event.request.workflowId === "task");
  const finishes = item => item.events.filter(event => event.kind === "finish");
  const focus = page => page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  async function navigate(page) {
    await page.getByRole("button", { name: /^待办事项/ }).click();
    await page.getByRole("heading", { name: "今天先做这几件事", exact: true }).waitFor();
  }
  async function close(ui) {
    assert.deepEqual(ui.errors, []); assert.deepEqual(ui.external, []);
    assert.deepEqual(await ui.page.evaluate(() => window.__todoAppTest.issues.filter(issue => issue.kind !== "workflow-metric")), []);
    await ui.context.close();
  }

  const daily = await open("daily", { holdRun: true });
  await daily.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "run")).catch(async error => {
    console.error("daily-startup", JSON.stringify({ events: daily.item.events, errors: daily.errors,
      browser: await daily.page.evaluate(() => ({ calls: window.__todoAppTest.calls, issues: window.__todoAppTest.issues, body: document.body.innerText.slice(-3500) })) }));
    throw error;
  });
  await navigate(daily.page);
  assert.equal(await daily.page.locator(".todo-priority").count(), 3);
  assert.equal(await daily.page.locator(".todo-priority h3").first().textContent(), "跟进合成项目 A");
  assert.equal(modelRuns(daily.item).length, 1);
  assert.equal(modelRuns(daily.item)[0].request.background, true);
  await focus(daily.page); await daily.page.clock.runFor(61000);
  assert.equal(modelRuns(daily.item).length, 1, "Active daily run is shared across navigation, focus and timer ticks");
  await daily.page.evaluate(() => { window.__todoAppTest.holdRun = false; window.__todoAppTest.releaseRun(); });
  await daily.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.request.success));
  assert.equal(finishes(daily.item).at(-1).request.success, true);
  await daily.page.clock.runFor(61000); await focus(daily.page);
  assert.equal(modelRuns(daily.item).length, 1);
  await daily.page.reload();
  await navigate(daily.page); await daily.page.clock.runFor(61000);
  assert.equal(modelRuns(daily.item).length, 1, "Reload reads the persisted daily success without another model run");
  if (process.env.DOMI_TODO_UI_SCREENSHOT) {
    await daily.page.setViewportSize({ width: 1280, height: 900 });
    await daily.page.evaluate(() => document.fonts.ready);
    await daily.page.screenshot({ path: process.env.DOMI_TODO_UI_SCREENSHOT, animations: "disabled" });
  }
  const scroll = daily.page.locator(".managed-task-board .task-board-scroll");
  assert.equal(await scroll.evaluate(element => { element.scrollTop = element.scrollHeight; return element.scrollTop > 0; }), true,
    "Top priorities must not make the lower task columns unreachable");
  await close(daily);

  const manual = await open("manual", { time: "2026-10-26T00:30:00Z" });
  await navigate(manual.page); await manual.page.clock.runFor(61000);
  assert.equal(modelRuns(manual.item).length, 0, "Before 09:00 automatic updates remain scheduled");
  await manual.page.locator(".task-board-generate").click();
  await manual.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.request.success));
  assert.equal(manual.item.events.find(event => event.kind === "claim").request.trigger, "manual");
  await manual.page.clock.runFor(31 * 60 * 1000); await focus(manual.page);
  assert.equal(modelRuns(manual.item).length, 1, "A verified manual update counts for the same day's automatic run");
  await close(manual);

  const failed = await open("failed", { failRemaining: 1 });
  await failed.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish"));
  await navigate(failed.page);
  assert.equal(finishes(failed.item)[0].request.success, false);
  assert.equal(await failed.page.locator(".todo-priority").count(), 3, "Failure keeps the last valid priorities visible");
  await focus(failed.page); await failed.page.clock.runFor(61000);
  assert.equal(modelRuns(failed.item).length, 1, "Failure waits for bounded retry, rather than rerunning on every focus");
  await failed.page.locator(".task-board-generate").click();
  await failed.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.request.success));
  assert.equal(modelRuns(failed.item).length, 2, "Manual retry remains available during automatic backoff");
  assert.equal(finishes(failed.item).at(-1).request.success, true);
  await close(failed);

  const unverified = await open("unverified", { missingReceipt: true });
  await unverified.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish"));
  assert.equal(finishes(unverified.item)[0].request.success, false, "Model success without a matching ledger receipt cannot mark the day complete");
  assert.equal(unverified.item.scheduler.status({ repositoryIdentity: identity }).state, "retrying");
  await close(unverified);

  const foreground = await open("foreground", { time: "2026-10-26T00:30:00Z", holdForeground: true });
  const composer = foreground.page.getByRole("textbox", { name: "输入投资任务", exact: true });
  await composer.fill("合成前台任务，只回复完成");
  await composer.press("Enter");
  await foreground.page.waitForFunction(() => window.__todoAppTest.pendingRuns.size > 0);
  await foreground.page.clock.runFor(31 * 60 * 1000); await focus(foreground.page);
  assert.equal(modelRuns(foreground.item).length, 0, "An active foreground task defers the due daily job");
  assert.equal(foreground.item.events.filter(event => event.kind === "claim").length, 0,
    "Deferral must not spend a retry attempt or acquire a lease");
  await foreground.page.evaluate(() => { window.__todoAppTest.holdForeground = false; window.__todoAppTest.releaseRun(); });
  await foreground.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.request.success));
  assert.equal(modelRuns(foreground.item).length, 1, "Daily work resumes once the foreground task completes");
  await close(foreground);

  for (const reason of ["busy", "running"]) {
    const queued = await open(`queue-${reason}`);
    await queued.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.result.accepted));
    await navigate(queued.page);
    queued.item.claimBusy = reason;
    const baselineClaims = queued.item.events.filter(event => event.kind === "claim").length;
    await queued.page.locator(".task-board-generate").click();
    await queued.page.getByRole("button", { name: "等待中", exact: true }).waitFor();
    await queued.page.clock.runFor(1000);
    assert.equal(queued.item.events.filter(event => event.kind === "claim").length - baselineClaims, 1,
      `${reason}: queuing a manual update must not immediately loop on denied claims`);
    await queued.page.clock.runFor(61000);
    await queued.page.waitForFunction(baseline => window.__todoAppTest.calls.filter(call => call.kind === "claim").length >= baseline + 2, baselineClaims);
    const whileBusy = queued.item.events.filter(event => event.kind === "claim").length - baselineClaims;
    assert.ok(whileBusy >= 2 && whileBusy <= 3, `${reason}: a busy native process is checked at a bounded cadence, got ${whileBusy} claims`);
    assert.equal(modelRuns(queued.item).length, 1, `${reason}: denied manual claims never start another model`);
    queued.item.claimBusy = false;
    await queued.page.clock.runFor(61000);
    await queued.page.waitForFunction(() => window.__todoAppTest.calls.filter(call => call.kind === "finish" && call.result.accepted).length === 2);
    assert.equal(queued.item.events.filter(event => event.kind === "claim").at(-1).request.trigger, "manual",
      `${reason}: the explicit queued manual request survives today's already-completed daily status`);
    assert.equal(finishes(queued.item).at(-1).request.success, true);
    await close(queued);
  }

  const finishRetry = await open("finish-retry", { finishFailRemaining: 2 });
  await finishRetry.page.waitForFunction(() => window.__todoAppTest.calls.some(call => call.kind === "finish" && call.result.accepted));
  assert.equal(modelRuns(finishRetry.item).length, 1, "Transient completion-checkpoint failure retries only the checkpoint, not the model");
  assert.equal(finishes(finishRetry.item).length, 3);
  assert.equal(new Set(finishes(finishRetry.item).map(event => event.request.token)).size, 1, "Completion retries keep the original lease token");
  assert.equal(finishRetry.item.scheduler.status({ repositoryIdentity: identity }).state, "completed");
  await finishRetry.page.reload();
  await navigate(finishRetry.page); await finishRetry.page.clock.runFor(61000);
  assert.equal(modelRuns(finishRetry.item).length, 1, "Recovered completion checkpoint remains durable after reload");
  await close(finishRetry);

  console.log("Daily todo App UI passed: startup catchup, one active lease, persisted reload, manual completion, foreground deferral, bounded busy queue, completion-checkpoint retry, model-failure backoff, receipt validation, priorities and lower-board scrolling.");
} finally {
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
