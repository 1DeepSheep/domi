import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercise the real App and SetupCenter through an entirely synthetic native
// bridge. No Electron process, user database, network service or model is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-codex-readiness-ui-"));
const screenshotDir = process.env.DOMI_READINESS_UI_SCREENSHOTS_DIR
  || process.env.DOMI_CODEX_READINESS_UI_SCREENSHOTS_DIR;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_codex_readiness_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
// Load the browser's inert fallback under a separate module identity, then
// expose it as the synthetic native bridge before App imports the real bridge.
const fallback = (await import("/src/bridge?readiness-fixture-fallback")).workbench;
const state = window.__readinessTest = {
  calls: [], plans: [{ hold: true }], pending: [], issues: [], listeners: [],
  mode: new URL(location.href).searchParams.get("mode") || "default"
};
const settings = { ...(await fallback.loadSettings()).settings,
  onboardingComplete: true, codexPath: "/synthetic/codex", plaudConnectionMode: "disabled",
  radarFollowedDomains: [], localRepositoryDir: "", localDatabasePath: "", localLibraryDir: "" };
state.settings = settings;
const ready = { ...(await fallback.checkCodex()), ok: true, connectionOk: true,
  path: "/synthetic/codex", version: "codex synthetic", transport: "app-server",
  account: { type: "chatgpt", email: "fixture@example.com", planType: "test" },
  providerLabel: "个人 ChatGPT", credentialStored: true, requiresOpenaiAuth: false,
  configuredModel: "fixture-model", pluginSetup: { ok: true, status: "ready", version: "7.0.3" },
  models: [{ id: "fixture-model", name: "Fixture model", description: "Synthetic model; never invoked",
    isDefault: true, defaultReasoningEffort: "medium", supportedReasoningEfforts: [{ id: "medium", description: "medium" }], serviceTiers: [] }], error: "" };
state.ready = ready;
localStorage.clear();
if (state.mode === "queue") {
  let hash = 0x811c9dc5;
  for (const character of ["", "", ""].join("\\u0000")) { hash ^= character.codePointAt(0); hash = Math.imul(hash, 0x01000193); }
  localStorage.setItem("domi.queuedSubmissions.v1", JSON.stringify({ "fixture-thread": [{
    id: "fixture-queued", threadId: "fixture-thread", input: "Synthetic queued instruction",
    attachments: [], useDomiPlugin: false, requestOrigin: "user", userInstructionText: "Synthetic queued instruction",
    model: "default", reasoningEffort: "medium", serviceTier: "standard", createdAt: Date.now(),
    repositoryIdentity: "local:" + (hash >>> 0).toString(16).padStart(8, "0")
  }] }));
}
const workbench = window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings: structuredClone(settings), updatedAt: Date.now() }),
  saveSettings: async request => { Object.assign(settings, request); return { ok: true, settings: structuredClone(settings) }; },
  loadState: async defaults => ({ ok: true, isNew: false, updatedAt: Date.now(), state: {
    ...defaults, activeThreadId: "fixture-thread", threads: [{ ...defaults.threads[0],
      id: "fixture-thread", title: "合成连接测试", manualTitle: true, codexThreadId: undefined,
      messages: [{ id: "fixture-user", role: "user", content: "Synthetic prior instruction" },
        { id: "fixture-assistant", role: "assistant", content: "Synthetic prior result", status: "done" }]
    }]
  } }),
  checkCodex: async options => {
    state.calls.push({ kind: "check", options });
    const plan = state.plans.shift();
    if (!plan) throw new Error("Unplanned readiness probe");
    if (plan.hold) return new Promise(resolve => state.pending.push(resolve));
    return structuredClone(plan.result || ready);
  },
  onCodexEvent: listener => { state.listeners.push(listener); return () => { state.listeners = state.listeners.filter(item => item !== listener); }; },
  runCodex: async request => {
    state.calls.push({ kind: "run", request });
    if (state.mode !== "queue" || request.requestText !== "Synthetic queued instruction") throw new Error("Unplanned model request is forbidden");
    return { ok: true, runId: request.runId, threadId: "synthetic-codex-thread", output: "", workspacePath: "demo-workspace" };
  },
  testCodexConnection: async () => { state.calls.push({ kind: "full-test" }); throw new Error("Real model connection tests are forbidden"); },
  showNotification: async () => ({ ok: true }),
  reportRendererIssue: issue => state.issues.push(issue),
  listWeeklyNews: async () => ({ ok: true, items: [], total: 0, radarCheckedThrough: Date.now() }),
  listDomiTasks: async () => ({ ok: true, configured: true, tasks: [], syncedAt: Date.now(), updatedAt: null }),
  getCodexRuntimeStatus: async () => ({ ok: true, managed: true, path: "/synthetic/codex", version: "synthetic", bundledVersion: "synthetic", rollbackAvailable: false })
};
state.emit = event => state.listeners.forEach(listener => listener(event));
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

let server;
let browser;
const contexts = [];
try {
  server = await createServer({
    configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [{ name: "codex-readiness-fixture",
      resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/?") && request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`);
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  async function open(mode = "default") {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage();
    page.setDefaultTimeout(12_000);
    await page.clock.install();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__readinessTest?.pending.length === 1);
    const count = kind => page.evaluate(kind => window.__readinessTest.calls.filter(call => call.kind === kind).length, kind);
    const waitCount = (kind, count) => page.waitForFunction(({ kind, count }) => window.__readinessTest.calls.filter(call => call.kind === kind).length === count, { kind, count });
    const plan = result => page.evaluate(result => window.__readinessTest.plans.push(result), result);
    const release = patch => page.evaluate(patch => {
      const state = window.__readinessTest;
      const resolve = state.pending.shift();
      if (!resolve) throw new Error("No pending fixture probe");
      resolve({ ...structuredClone(state.ready), ...patch });
    }, patch);
    const status = page.getByTitle("打开 Codex 设置", { exact: true });
    const setup = async () => {
      await status.click();
      return page.getByRole("dialog", { name: "domi 设置", exact: true });
    };
    return { page, context, errors, count, waitCount, plan, release, status, setup };
  }
  const pluginFailure = { ok: false, connectionOk: true,
    pluginSetup: { ok: false, status: "check-failed", error: "Command failed: /private/synthetic/codex plugin list --json" },
    error: "Command failed: /private/synthetic/codex plugin list --json" };

  // Initial pending is neutral, and a plugin failure does not disable models
  // or falsely advertise a disconnected Codex connection.
  {
    const ui = await open();
    const { page } = ui;
    assert.match(await ui.status.innerText(), /正在检查 Codex/);
    assert.equal(await ui.status.locator(".status-dot.neutral").count(), 1);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "initial-checking.png"), fullPage: true, animations: "disabled" });
    const missing = { ...pluginFailure, pluginSetup: { ...pluginFailure.pluginSetup, status: "missing" } };
    await ui.release(missing);
    await ui.status.getByText("Codex 已连接", { exact: true }).waitFor();
    assert.match(await ui.status.innerText(), /domi 插件待检查/);
    assert.doesNotMatch(await ui.status.innerText(), /Command failed|\/private|未就绪/);
    assert.equal(await ui.status.locator(".status-dot.warning").count(), 1);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "plugin-warning-sidebar.png"), fullPage: true, animations: "disabled" });
    const model = page.getByRole("button", { name: "选择模型、推理强度和速度", exact: true });
    assert.equal(await model.isDisabled(), false);
    await model.click();
    await page.locator(".model-picker-menu").getByText("Fixture model", { exact: true }).waitFor();
    await model.click();
    await page.getByRole("textbox", { name: "输入投资任务", exact: true }).fill("Synthetic unsent instruction");
    assert.equal(await page.locator(".send-button").isDisabled(), true, "A missing plugin must still block plugin-dependent submissions");
    await page.getByRole("button", { name: "停用 domi 插件", exact: true }).click();
    assert.equal(await page.locator(".send-button").isDisabled(), false, "A connected plain task does not require the domi plugin");
    await page.getByRole("button", { name: "启用 domi 插件", exact: true }).click();
    await page.evaluate(() => {
      const state = window.__readinessTest;
      state.emit({ runId: "unbound-run", type: "started" });
      state.emit({ runId: "unbound-run", type: "assistant-delta", text: "Unbound synthetic output" });
    });
    await page.clock.fastForward(20_000);
    assert.equal(await ui.count("check"), 1, "Unknown run IDs cannot establish readiness or trigger recovery");
    const dialog = await ui.setup();
    assert.match(await dialog.innerText(), /ChatGPT 身份已就绪/);
    assert.match(await dialog.innerText(), /domi 插件尚待检查/);
    assert.doesNotMatch(await dialog.innerText(), /Command failed|\/private\/synthetic/);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "plugin-warning.png"), fullPage: true, animations: "disabled" });
    await ui.plan({});
    await dialog.getByRole("button", { name: "重新检查连接", exact: true }).click();
    await ui.status.getByText("Codex 已就绪", { exact: true }).waitFor();
    const manual = await page.evaluate(() => window.__readinessTest.calls.filter(call => call.kind === "check").at(-1));
    assert.deepEqual(manual.options, { readOnly: false, force: true }, "Manual recovery can initialize an absent server and bypass stale checks without a model call");
    assert.equal(await ui.count("full-test"), 0);
    await dialog.getByTitle("关闭设置", { exact: true }).click();
    assert.equal(await page.locator(".send-button").isDisabled(), false);
    assert.equal(await ui.count("run"), 0);
    assert.deepEqual(ui.errors, []);
    await ui.context.close();
  }

  // Automatic recovery is read-only, coalesces pending checks and stops after
  // three attempts. The test clock avoids real multi-second waits.
  {
    const ui = await open();
    await ui.plan({ hold: true });
    await ui.release(pluginFailure);
    await ui.waitCount("check", 2);
    await ui.page.clock.fastForward(30_000);
    assert.equal(await ui.count("check"), 2, "A pending automatic probe must stay single-flight");
    for (const expected of [3, 4]) {
      await ui.plan({ hold: true });
      await ui.release(pluginFailure);
      await ui.page.clock.fastForward(10_000);
      await ui.waitCount("check", expected);
    }
    await ui.release(pluginFailure);
    await ui.page.clock.fastForward(60_000);
    assert.equal(await ui.count("check"), 4, "Only three automatic attempts are allowed per recovery cycle");
    const automatic = await ui.page.evaluate(() => window.__readinessTest.calls.filter(call => call.kind === "check").slice(1));
    assert(automatic.every(call => call.options?.readOnly === true && call.options?.force === true));
    assert.equal(await ui.count("run"), 0);
    assert.equal(await ui.count("full-test"), 0);
    assert.deepEqual(ui.errors, []);
    await ui.context.close();
  }

  // A successful recovery cancels remaining retries.
  {
    const ui = await open();
    await ui.plan({});
    await ui.release(pluginFailure);
    await ui.status.getByText("Codex 已就绪", { exact: true }).waitFor();
    await ui.page.clock.fastForward(60_000);
    assert.equal(await ui.count("check"), 2);
    assert.equal(await ui.count("run"), 0);
    assert.equal(await ui.count("full-test"), 0);
    if (screenshotDir) await ui.page.screenshot({ path: path.join(screenshotDir, "recovered.png"), fullPage: true, animations: "disabled" });
    assert.deepEqual(ui.errors, []);
    await ui.context.close();
  }

  // Persisted queued work waits for startup readiness, then submits once. It
  // must not become permanently paused merely because startup was still busy.
  {
    const ui = await open("queue");
    await ui.page.clock.fastForward(10_000);
    assert.equal(await ui.count("run"), 0);
    assert.deepEqual(await ui.page.evaluate(() => JSON.parse(localStorage.getItem("domi.pausedQueuedSubmissions.v1") || "[]")), []);
    await ui.release({});
    await ui.waitCount("run", 1);
    assert.deepEqual(await ui.page.evaluate(() => JSON.parse(localStorage.getItem("domi.pausedQueuedSubmissions.v1") || "[]")), []);

    // A bound task is stronger evidence than an unknown event, but optimistic
    // local acceptance still cannot claim readiness. Actual output triggers a
    // fresh probe, and even that output must wait for its verified result.
    const dialog = await ui.setup();
    await ui.plan({ result: await ui.page.evaluate(() => ({ ...window.__readinessTest.ready,
      ok: false, connectionOk: true, pluginSetup: { ok: false, status: "missing" } })) });
    await dialog.getByRole("button", { name: "重新检查连接", exact: true }).click();
    await ui.status.getByText("Codex 已连接", { exact: true }).waitFor();
    await dialog.getByTitle("关闭设置", { exact: true }).click();
    const checksBeforeEvent = await ui.count("check");
    await ui.page.evaluate(() => {
      const state = window.__readinessTest;
      const runId = state.calls.find(call => call.kind === "run").request.runId;
      state.emit({ runId, type: "started" });
    });
    await ui.page.clock.fastForward(10_000);
    assert.equal(await ui.count("check"), checksBeforeEvent, "Optimistic task acceptance cannot prove readiness even for a bound run");
    await ui.plan({ hold: true });
    await ui.page.evaluate(() => {
      const state = window.__readinessTest;
      const runId = state.calls.find(call => call.kind === "run").request.runId;
      state.emit({ runId, type: "assistant-delta", text: "Synthetic live response" });
    });
    await ui.waitCount("check", checksBeforeEvent + 1);
    assert.match(await ui.status.innerText(), /Codex 已连接/);
    assert.doesNotMatch(await ui.status.innerText(), /Codex 已就绪/);
    const liveProbe = await ui.page.evaluate(() => window.__readinessTest.calls.filter(call => call.kind === "check").at(-1));
    assert.deepEqual(liveProbe.options, { readOnly: true, force: true });
    await ui.release({});
    await ui.status.getByText("Codex 已就绪", { exact: true }).waitFor();
    assert.equal(await ui.count("full-test"), 0);
    assert.deepEqual(ui.errors, []);
    await ui.context.close();
  }
  console.log("Codex readiness UI passed: neutral startup, separate plugin warnings, model availability, plugin-aware submission, unknown/optimistic-event isolation, verified live-event recovery, manual model-free recovery, bounded read-only single-flight retries, recovery stops retries, startup queue waits and resumes.");
} finally {
  await Promise.allSettled(contexts.map(context => context.close()));
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
