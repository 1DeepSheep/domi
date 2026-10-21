import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercise the production App and useSourcing hook through synthetic native
// calls. Preview mode additionally proves that saves/runs never reach native APIs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-underwater-app-"));
const fixture = "/__underwater_app_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import { previewSourcingSnapshot } from "/src/sourcing-preview";
import "/src/styles.css";
import "/src/appearance/index.css";
const preview = new URLSearchParams(location.search).get("preview") === "underwater";
const config = window.__underwaterConfig || {};
const fallback = (await import(preview ? "/src/bridge" : "/src/bridge?underwater-app-fallback")).workbench;
const state = window.__underwaterAppTest = { calls: [], issues: [], holdRun: Boolean(config.holdRun), failRun: false, result: structuredClone(previewSourcingSnapshot) };
state.result.run.nextRunAt = Date.now() + (config.nextRunOffset ?? 86400000);
state.result.settings.enabled = config.enabled ?? true;
if (config.allFocusesPaused) state.result.focuses = state.result.focuses.map(focus => ({ ...focus, enabled: false }));
if (config.explicitEmptyFocus) { state.result.focuses = []; state.result.focusConfigured = true; }
state.result.ok = config.ok ?? true;
state.result.configured = config.configured ?? true;
if (config.failed) state.result.run = { ...state.result.run, status: "failed", error: "合成上次失败，等待重试" };
const settings = { ...(await fallback.loadSettings()).settings, onboardingComplete: true, storageBackend: "local", externalAccessMode: config.externalAccessMode || "always",
  localRepositoryDir: "/synthetic/library", localDatabasePath: "/synthetic/db", plaudConnectionMode: "disabled", radarFollowedDomains: [] };
const mock = { ...fallback,
  loadSettings: async () => ({ ok: true, settings }),
  loadState: async defaults => ({ ok: true, isNew: false, state: defaults }),
  checkCodex: async () => ({ ok: true, connectionOk: true, pluginSetup: { ok: true, status: "ready", version: "7.0.16" }, models: [{ id: "synthetic-model", name: "Synthetic model", supportedReasoningEfforts: [{ id: "high" }], serviceTiers: [{ id: "priority" }] }] }),
  syncDomi: async () => ({ ok: true }),
  listDomiTasks: async () => ({ ok: true, configured: true, tasks: [], syncedAt: Date.now() }),
  listWeeklyNews: async () => ({ ok: true, items: [], total: 0, radarCheckedThrough: Date.now() }),
  listSourcing: async () => { state.calls.push({ kind: "list" }); return structuredClone(state.result); },
  configureSourcing: async request => { state.calls.push({ kind: "configure", request }); state.result = { ...state.result, settings: { ...state.result.settings, ...request.settings }, sources: request.sources || state.result.sources, focuses: request.focuses || state.result.focuses }; return structuredClone(state.result); },
  beginSourcing: async request => { state.calls.push({ kind: "begin", request }); state.result.ok = true; state.result.run.status = "running"; state.result.run.error = undefined; return { ...structuredClone(state.result), started: true, runId: "synthetic-run", leaseToken: "synthetic-lease", ledgerPath: "/synthetic/sourcing.json" }; },
  finishSourcing: async request => { state.calls.push({ kind: "finish", request }); state.result.run = { ...state.result.run, status: request.error ? "failed" : "idle", error: request.error, nextRunAt: Date.now() + 86400000 }; return structuredClone(state.result); },
  runCodex: async request => { state.calls.push({ kind: "run", request }); if (state.holdRun) await new Promise(resolve => { state.releaseRun = resolve; }); if (state.failRun) throw new Error("合成搜索连接失败"); return { ok: true, output: "Synthetic run only" }; },
  testCodexConnection: async () => { throw new Error("No real model probe allowed"); },
  reportRendererIssue: issue => state.issues.push(issue)
};
if (preview) Object.assign(fallback, mock); else window.workbench = mock;
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;
let server, browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" }, optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "underwater-app-fixture", resolveId(id) { if (id === fixture) return resolvedFixture; }, load(id) { if (id === resolvedFixture) return source; }, configureServer(vite) { vite.middlewares.use((request, response, next) => {
      if (new URL(request.url, "http://localhost").pathname !== "/") return next(); response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
    }); } }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  for (const preview of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/${preview ? "?preview=underwater" : ""}`);
    const navigation = page.getByRole("button", { name: "水下项目", exact: true });
    await navigation.waitFor();
    await navigation.click();
    await page.getByRole("heading", { name: "水下项目", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".uw-candidate").length === 5);
    const navOrder = await page.locator(".sidebar-nav-item").allTextContents();
    assert.ok(navOrder.findIndex(item => item.includes("水下项目")) < navOrder.findIndex(item => item.includes("行业动态")), "Underwater appears above industry news");
    await page.getByRole("tab", { name: "发现范围", exact: false }).click();
    await page.getByRole("combobox", { name: "每天更新时间" }).selectOption("11");
    await page.getByText("每天 11:00 自动发现", { exact: true }).waitFor();
    await page.getByRole("button", { name: "添加来源", exact: true }).click();
    await page.getByRole("textbox", { name: "来源名称" }).fill("合成 App 来源");
    await page.getByRole("textbox", { name: "公开网址" }).fill("https://example.test/synthetic");
    await page.getByRole("button", { name: "保存来源", exact: true }).click();
    await page.getByRole("button", { name: "合成 App 来源", exact: true }).waitFor();
    await page.getByRole("textbox", { name: "关注描述", exact: true }).fill("合成重点领域，围绕合成实验室的校友及某家公司离职研究员找创业者");
    await page.getByRole("button", { name: "保存关注", exact: true }).click();
    await page.getByRole("heading", { name: "合成重点领域，围绕合成实验室的校友及某家公司离职研究员找创业者", exact: true }).waitFor();
    if (!preview) {
      const saved = await page.evaluate(() => window.__underwaterAppTest.calls.filter(call => call.kind === "configure"));
      assert.equal(saved.length, 3);
      assert.deepEqual(saved[0].request, { settings: { localHour: 11 } });
      assert.equal(saved[1].request.sources.length, 7);
      assert.equal(saved[2].request.focuses.length, 4);
      assert.equal(saved[2].request.focuses.at(-1).type, "freeform");
      assert.deepEqual(saved[2].request.focuses.at(-1).relations, []);
      assert.deepEqual(saved[2].request.focuses.at(-1).urls, []);
      await page.evaluate(() => { window.__underwaterAppTest.holdRun = true; });
      await page.getByRole("button", { name: "立即搜索", exact: true }).click();
      await page.waitForFunction(() => window.__underwaterAppTest.calls.some(call => call.kind === "run"));
      assert.equal(await page.getByRole("button", { name: "正在发现", exact: true }).isDisabled(), true);
      await page.getByRole("button", { name: "行业动态", exact: true }).click();
      await navigation.click();
      assert.equal(await page.getByRole("button", { name: "正在发现", exact: true }).isDisabled(), true);
      await page.evaluate(() => { window.__underwaterAppTest.holdRun = false; window.__underwaterAppTest.releaseRun(); });
      await page.getByRole("button", { name: "立即搜索", exact: true }).waitFor();
      const first = await page.evaluate(() => window.__underwaterAppTest.calls.filter(call => ["begin", "run", "finish"].includes(call.kind)));
      assert.deepEqual(first.map(call => call.kind), ["begin", "run", "finish"]);
      assert.equal(first[0].request.force, true);
      assert.equal(first[1].request.workflowId, "underwater-sourcing");
      assert.equal(first[1].request.allowUserInput, false);
      assert.equal(first[1].request.webSearch, true);
      assert.match(first[1].request.requestText, /mode=underwater_discover/);
      assert.match(first[1].request.requestText, /合成重点领域/);
      assert.deepEqual(first[2].request, { runId: "synthetic-run", leaseToken: "synthetic-lease" });
      await page.evaluate(() => { window.__underwaterAppTest.failRun = true; });
      await page.getByRole("button", { name: "立即搜索", exact: true }).click();
      await page.getByRole("alert").getByText("合成搜索连接失败 已保留上次成功结果。").waitFor();
      const finishes = await page.evaluate(() => window.__underwaterAppTest.calls.filter(call => call.kind === "finish"));
      assert.equal(finishes.length, 2);
      assert.equal(finishes[1].request.error, "合成搜索连接失败", "Failed execution releases and persists the run error");
      assert.equal(await page.getByRole("button", { name: "立即搜索", exact: true }).isEnabled(), true);
      await page.getByRole("tab", { name: "项目线索", exact: true }).click();
      assert.equal(await page.locator(".uw-candidate").count(), 5, "Failed run preserves last good candidates");
    } else {
      await page.getByRole("button", { name: "立即搜索", exact: true }).click();
      await page.getByRole("alert").getByText("这是界面预览，未执行真实搜索或入库。 已保留上次成功结果。").waitFor();
      assert.equal(await page.evaluate(() => window.__underwaterAppTest.calls.length), 0, "Preview does not list, configure, begin, finish or execute native sourcing");
    }
    assert.deepEqual(await page.evaluate(() => window.__underwaterAppTest.issues), []);
    assert.deepEqual(errors, []);
    await context.close();
  }
  // Fake time covers the actual mounted hook interval, without waiting a minute
  // or substituting the scheduler implementation under test.
  const schedulerScenarios = [
    { name: "due", enabled: true, nextRunOffset: -1000, holdRun: true, expectedRuns: 1 },
    { name: "not-due", enabled: true, nextRunOffset: 3600000, expectedRuns: 0 },
    { name: "disabled", enabled: false, nextRunOffset: -1000, expectedRuns: 0 },
    { name: "all-focuses-paused", enabled: true, allFocusesPaused: true, nextRunOffset: -1000, expectedRuns: 0 },
    { name: "explicit-empty-focus", enabled: true, explicitEmptyFocus: true, nextRunOffset: -1000, expectedRuns: 0 },
    { name: "no-automatic-access", enabled: true, nextRunOffset: -1000, externalAccessMode: "ask", expectedRuns: 0 },
    { name: "failed-retry", enabled: true, nextRunOffset: 120000, ok: false, configured: true, failed: true, expectedRuns: 1 },
    { name: "preview-due", enabled: true, nextRunOffset: -1000, preview: true, expectedRuns: 0 }
  ];
  for (const scenario of schedulerScenarios) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(config => { window.__underwaterConfig = config; }, scenario);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.clock.install({ time: new Date("2026-10-21T02:00:00Z") });
    await page.goto(`${origin}/${scenario.preview ? "?preview=underwater" : ""}`);
    const navigation = page.getByRole("button", { name: "水下项目", exact: true });
    await navigation.waitFor(); await navigation.click();
    await page.waitForFunction(() => document.querySelectorAll(".uw-candidate").length === 5);
    const runs = () => page.evaluate(() => window.__underwaterAppTest.calls.filter(call => call.kind === "run"));
    const begins = () => page.evaluate(() => window.__underwaterAppTest.calls.filter(call => call.kind === "begin"));
    assert.equal((await runs()).length, 0, `${scenario.name}: navigation itself does not start a model run`);
    await page.clock.runFor(61000);
    if (scenario.name === "failed-retry") {
      assert.equal((await runs()).length, 0, "Failed state waits for its retry deadline");
      await page.clock.runFor(61000);
      await page.waitForFunction(() => window.__underwaterAppTest.calls.some(call => call.kind === "finish"));
    } else if (scenario.expectedRuns) {
      await page.waitForFunction(() => window.__underwaterAppTest.calls.some(call => call.kind === "run"));
    }
    assert.equal((await runs()).length, scenario.expectedRuns, `${scenario.name}: correct scheduled execution count`);
    assert.equal((await begins()).length, scenario.expectedRuns, `${scenario.name}: correct lease count`);
    if (scenario.expectedRuns) {
      assert.equal((await begins())[0].request.force, false, `${scenario.name}: automatic requests defer to the daily lease`);
      assert.equal((await runs())[0].request.background, true, `${scenario.name}: automatic execution stays in the background`);
      assert.equal((await runs())[0].request.workflowId, "underwater-sourcing");
    }
    if (scenario.name === "due") {
      await page.getByRole("tab", { name: "发现范围", exact: false }).click();
      assert.equal(await page.getByRole("switch", { name: "核验后自动入库", exact: true }).isDisabled(), true, "An active run cannot have intake permission changed mid-flight");
      await page.getByRole("button", { name: "行业动态", exact: true }).click();
      await navigation.click();
      await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
      await page.clock.runFor(61000);
      assert.equal((await begins()).length, 1, "Navigation, focus and a second timer tick do not start another active run");
      assert.equal((await runs()).length, 1);
      await page.evaluate(() => { window.__underwaterAppTest.holdRun = false; window.__underwaterAppTest.releaseRun(); });
      await page.waitForFunction(() => window.__underwaterAppTest.calls.some(call => call.kind === "finish"));
      await page.clock.runFor(61000);
      assert.equal((await begins()).length, 1, "Successful completion waits for the next daily deadline");
    } else if (!scenario.expectedRuns) {
      await page.evaluate(() => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
      await page.clock.runFor(61000);
      assert.equal((await begins()).length, 0, `${scenario.name}: focus and further ticks also remain idle`);
    }
    if (scenario.preview) assert.equal(await page.evaluate(() => window.__underwaterAppTest.calls.length), 0, "Preview scheduling makes zero native calls");
    assert.deepEqual(await page.evaluate(() => window.__underwaterAppTest.issues), [], scenario.name);
    assert.deepEqual(errors, [], scenario.name);
    await context.close();
  }
  console.log("underwater App UI: navigation, saves, manual-run lifecycle, daily scheduling/due gates/failed retry, active-run deduplication, and preview isolation passed");
} finally {
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
