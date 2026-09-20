import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real SetupCenter, synthetic native bridge, isolated browser storage. No real
// account, profile, model, file picker, Electron process, or external network.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-onboarding-ui-"));
const screenshotDir = process.env.DOMI_SETUP_UI_SCREENSHOTS_DIR;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_setup_fixture__.tsx";
const fixturePath = path.join(root, fixture.slice(1));
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
const fallback = (await import("/src/bridge?setup-fixture-fallback")).workbench;
const mode = new URL(location.href).searchParams.get("mode") || "ready";
const state = window.__setupTest = { mode, calls: [], loginReady: false, pending: {}, closed: false };
const baseSettings = { ...(await fallback.loadSettings()).settings, onboardingComplete: mode.startsWith("existing"),
  codexPath: "/synthetic/codex", authMode: "chatgpt", localRepositoryDir: "/synthetic/Documents/domi工作区",
  localDatabasePath: "/synthetic/app-data/library.sqlite3", plaudConnectionMode: "disabled" };
const ready = { ...(await fallback.checkCodex()), ok: true, connectionOk: true, authMode: "chatgpt",
  path: "/synthetic/codex", version: "synthetic", configuredModel: "synthetic-model", error: "",
  account: { type: "chatgpt", email: "fixture@example.com", planType: "test" }, requiresOpenaiAuth: false,
  pluginSetup: { ok: true, status: "ready", version: "synthetic" } };
if (mode === "provider") ready.account = null;
const initialStatus = mode.startsWith("login") ? { ...ready, ok: false, connectionOk: false, account: null, requiresOpenaiAuth: true }
  : mode.startsWith("network") ? { ...ready, ok: false, connectionOk: false, error: "Synthetic network timeout" }
  : mode === "plugin" ? { ...ready, ok: false, pluginSetup: { ok: false, status: "missing", error: "Synthetic plugin missing" } }
  : mode === "install" ? { ...ready, ok: false, connectionOk: false, path: "", account: null, requiresOpenaiAuth: true }
  : ready;
state.settings = baseSettings; state.status = initialStatus; state.ready = ready;
const record = (kind, data = {}) => state.calls.push({ kind, ...data });
window.workbench = { ...fallback,
  getUpdateStatus: async () => { if (mode === "existing-errors") throw new Error("Synthetic update unavailable"); return fallback.getUpdateStatus(); },
  getCodexRuntimeStatus: async () => ({ ok: true, managed: true, path: "/synthetic/codex", version: "synthetic", bundledVersion: "synthetic", rollbackAvailable: false }),
  onUpdateStatus: () => () => undefined,
  installCodex: async () => { record("install"); return new Promise(resolve => state.pending.install = resolve); },
  selectDirectory: async () => { record("directory"); return { ok: true, path: "/synthetic/Selected" }; },
  testCodexConnection: async request => {
    record("full-test", { request });
    const result = { ok: true, requestId: request.requestId, codex: structuredClone(ready), verification: { ok: true, detail: "Synthetic connection verified" } };
    if (mode === "cancel" || mode === "timeout" || mode === "folder-during-test") return new Promise(resolve => state.pending.fullTest = () => resolve(result));
    if (mode === "failure") return { ...result, ok: false, error: "Synthetic connection timeout" };
    return result;
  },
  cancelCodexConnectionTest: async request => { record("cancel", { request }); return { ok: true }; },
  getFeishuSetupStatus: async () => { record("feishu-status"); return { ok: true, connected: false, configured: false, cliAvailable: true, userName: "" }; },
  startFeishuSetupAuth: async () => { record("feishu-login"); return new Promise(resolve => state.pending.feishu = resolve); },
  checkPlaudConnection: async () => { record("plaud-check"); return { ok: true, connected: true, status: "connected", browserLabel: "Synthetic" }; },
  runCodex: async request => {
    record("model", { request });
    if (request.requestText !== "检测 Outlook 发送账号") throw new Error("Unexpected model invocation");
    return { ok: true, output: JSON.stringify({ email: "fixture@example.com" }) };
  },
  runDiagnostics: async () => { record("diagnose"); return { ok: false, checks: [{ id: "connection", label: "Synthetic network", ok: false, detail: "Synthetic failure" }], durationMs: 1 }; },
  exportDiagnostics: async report => { record("export", { report }); return { ok: true }; }
};
const { default: SetupCenter } = await import("/src/SetupCenter");
function Harness() {
  const [settings, setSettings] = useState(baseSettings);
  const [status, setStatus] = useState(initialStatus);
  const [closed, setClosed] = useState(false);
  const [checking, setChecking] = useState(false);
  const refresh = async (verified, readOnly = false) => {
    record(readOnly ? "readonly-check" : "check", { verified: Boolean(verified) });
    setChecking(true);
    try {
      if (mode === "login-held" && readOnly) await new Promise(resolve => state.pending.readonly = resolve);
      const next = verified || (state.loginReady || mode === "network" || mode === "plugin" ? ready : state.status);
      state.status = next; setStatus(next);
    } finally { setChecking(false); }
  };
  return closed ? <div role="status">Synthetic setup finished</div> : <SetupCenter settings={settings}
    required={!settings.onboardingComplete} codexStatus={status} codexChecking={checking}
    onSave={async request => {
      record("save", { request });
      Object.assign(state.settings, request);
      const saved = structuredClone(state.settings);
      setSettings(saved); return { ok: true, settings: saved };
    }}
    onLogin={async () => { record("login"); state.status = { ...initialStatus, ok: false, connectionOk: false }; setStatus(state.status); return { ok: true, authUrlOpened: true }; }}
    onRefresh={refresh} onReadOnlyRefresh={() => refresh(undefined, true)}
    onClose={() => { state.closed = true; setClosed(true); }} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
`;
let server;
let browser;
const contexts = [];
let checks = 0;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "setup-fixture", resolveId(id) { if (id === fixture) return fixturePath; }, load(id) { if (id === fixturePath) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/?")) return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><meta charset="utf-8"><body><div id="root"></div><script type="module" src="'+fixture+'"></script></body></html>');
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  async function open(mode = "ready") {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(context);
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.setDefaultTimeout(10_000); await page.clock.install();
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`, { waitUntil: "networkidle" });
    await page.getByRole("dialog", { name: "domi 设置", exact: true }).waitFor();
    const calls = kind => page.evaluate(kind => window.__setupTest.calls.filter(call => call.kind === kind), kind);
    const primary = page.locator(".setup-footer .setup-primary");
    const close = async () => { assert.deepEqual(errors, []); await context.close(); checks++; };
    return { page, primary, calls, close };
  }
  for (const mode of ["ready", "provider"]) {
    const ui = await open(mode);
    assert.equal(await ui.page.getByRole("radiogroup", { name: "Codex 连接方式（二选一）" }).isVisible(), false);
    assert.equal(await ui.page.getByRole("button", { name: "录音转写", exact: true }).count(), 0);
    if (mode === "provider") await ui.page.getByText("已找到可用的 Codex 连接", { exact: true }).waitFor();
    if (screenshotDir && mode === "ready") await ui.page.screenshot({ path: path.join(screenshotDir, "first-use-ready.png"), fullPage: true, animations: "disabled" });
    await ui.primary.click();
    await ui.page.getByText("Synthetic setup finished").waitFor();
    assert.equal((await ui.calls("full-test")).length, 1);
    const saved = (await ui.calls("save")).at(-1).request;
    assert.equal(saved.onboardingComplete, true); assert.equal(saved.plaudConnectionMode, "disabled");
    assert.equal(saved.localRepositoryDir, "/synthetic/Documents/domi工作区");
    for (const kind of ["login", "model", "feishu-status", "plaud-check"]) assert.equal((await ui.calls(kind)).length, 0, kind);
    assert.equal(Object.hasOwn(saved, "outlookCalendarRecipients"), false);
    await ui.close();
  }
  {
    const ui = await open(); await ui.page.getByRole("button", { name: "更改位置", exact: true }).click();
    assert.equal((await ui.calls("feishu-status")).length, 0);
    assert.equal(await ui.page.getByText("待办事项与日历", { exact: true }).count(), 0);
    await ui.page.getByRole("button", { name: "选择本地资料库目录", exact: true }).click();
    await ui.primary.click(); await ui.page.getByText("Synthetic setup finished").waitFor();
    assert.equal((await ui.calls("save")).at(-1).request.localRepositoryDir, "/synthetic/Selected/domi工作区");
    await ui.close();
  }
  {
    const ui = await open("folder-during-test");
    await ui.page.getByRole("button", { name: "更改位置", exact: true }).click();
    await ui.primary.click();
    await ui.page.getByRole("button", { name: "取消连接测试", exact: true }).waitFor();
    const directory = ui.page.locator(".local-library-setting input");
    await directory.fill("/synthetic/ChangedWhileVerifying");
    await ui.page.evaluate(() => window.__setupTest.pending.fullTest());
    await ui.page.getByText("Synthetic setup finished").waitFor();
    assert.equal((await ui.calls("save")).at(-1).request.localRepositoryDir, "/synthetic/ChangedWhileVerifying",
      "Finishing a slow connection test must save the latest directory, not its stale render closure");
    await ui.close();
  }
  {
    const ui = await open("login"); await ui.primary.click();
    await ui.page.getByText("等待浏览器登录，完成后会自动确认。", { exact: true }).waitFor();
    await ui.page.clock.runFor(1_600);
    assert.equal((await ui.calls("readonly-check")).length, 1);
    await ui.page.evaluate(() => { window.__setupTest.loginReady = true; });
    await ui.page.clock.runFor(1_600);
    await ui.page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await ui.page.getByText("账号已连接。点击“开始使用”即可继续。", { exact: true }).waitFor();
    assert.equal((await ui.calls("login")).length, 1);
    assert.equal((await ui.calls("full-test")).length, 0);
    await ui.primary.click(); await ui.page.getByText("Synthetic setup finished").waitFor(); await ui.close();
  }
  for (const mode of ["login", "login-held"]) {
    const ui = await open(mode); await ui.primary.click();
    await ui.page.clock.runFor(65_000);
    await ui.page.getByText("尚未确认登录。完成浏览器登录后，点击“重新检查连接”即可继续。", { exact: true }).waitFor();
    const count = (await ui.calls("readonly-check")).length;
    assert(count <= 6 && count > 0); await ui.page.clock.runFor(120_000);
    assert.equal((await ui.calls("readonly-check")).length, count);
    assert.equal((await ui.calls("login")).length, 1); assert.equal((await ui.calls("full-test")).length, 0);
    await ui.close();
  }
  {
    const ui = await open("network"); await ui.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
    await ui.page.getByText("已登录，可以开始使用", { exact: true }).waitFor();
    assert.equal((await ui.calls("check")).length, 1); assert.equal((await ui.calls("full-test")).length, 0); assert.equal((await ui.calls("login")).length, 0);
    await ui.close();
  }
  {
    const ui = await open("network-never");
    for (let index = 0; index < 10; index++) {
      await ui.page.clock.runFor(3_100);
      await ui.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
    }
    assert.equal((await ui.calls("check")).length, 6, "Repeated focus recovery must stop at the configured bound");
    assert.equal((await ui.calls("full-test")).length, 0); assert.equal((await ui.calls("login")).length, 0);
    await ui.close();
  }
  {
    const ui = await open("plugin"); await ui.page.getByText("Codex 已连接，domi 组件待准备", { exact: true }).waitFor();
    await ui.page.getByRole("button", { name: "重新准备 domi 组件", exact: true }).click();
    await ui.page.getByText("已登录，可以开始使用", { exact: true }).waitFor();
    assert.equal((await ui.calls("login")).length, 0); await ui.close();
  }
  {
    const ui = await open("existing"); await ui.page.getByRole("button", { name: "资料连接", exact: true }).click();
    const directory = ui.page.locator(".local-library-setting input"); await directory.fill("/synthetic/UnsavedFolder");
    await ui.page.getByRole("button", { name: "检测账号", exact: true }).click();
    await ui.page.getByText("已验证 Outlook 当前发送账号；实际发送前还会再次核对当前登录身份。", { exact: true }).waitFor();
    assert.equal(await directory.inputValue(), "/synthetic/UnsavedFolder", "Partial saves must retain the unsaved directory");
    await ui.page.locator(".calendar-timezone-setting input").fill("invalid/timezone");
    await ui.page.getByRole("button", { name: "Codex 连接", exact: true }).click(); await ui.primary.click();
    const request = (await ui.calls("save")).at(-1).request;
    assert.equal(Object.hasOwn(request, "outlookCalendarTimezone"), false);
    assert.equal(Object.hasOwn(request, "localRepositoryDir"), false);
    await ui.page.getByRole("button", { name: "资料连接", exact: true }).click();
    assert.equal(await directory.inputValue(), "/synthetic/UnsavedFolder");
    assert.equal(await ui.page.locator(".calendar-timezone-setting input").inputValue(), "invalid/timezone");
    await ui.close();
  }
  {
    const ui = await open("existing-errors");
    assert.equal(await ui.page.locator(".setup-feedback.error").count(), 0, "Background update failure must not become a Codex error");
    await ui.page.getByRole("button", { name: "资料连接", exact: true }).click();
    await ui.page.getByRole("button", { name: "连接飞书", exact: true }).click();
    await ui.page.getByRole("button", { name: "Codex 连接", exact: true }).click();
    await ui.page.evaluate(() => window.__setupTest.pending.feishu({ ok: false, error: "Synthetic optional connection failed" }));
    assert.equal(await ui.page.locator(".setup-feedback.error").count(), 0);
    await ui.page.getByRole("button", { name: "资料连接", exact: true }).click();
    await ui.page.locator(".setup-feedback.error").getByText("Synthetic optional connection failed", { exact: true }).waitFor();
    await ui.close();
  }
  for (const mode of ["failure", "cancel", "timeout"]) {
    const ui = await open(mode); await ui.primary.click();
    if (mode === "cancel") {
      await ui.page.evaluate(() => { window.dispatchEvent(new Event("online")); window.dispatchEvent(new Event("focus")); });
      assert.equal((await ui.calls("check")).length, 0, "Recovery must not interrupt the paid connection test");
      await ui.page.getByRole("button", { name: "取消连接测试", exact: true }).click();
      await ui.page.evaluate(() => window.__setupTest.pending.fullTest());
    } else if (mode === "timeout") {
      await ui.page.clock.runFor(96_000); await ui.page.evaluate(() => window.__setupTest.pending.fullTest());
    }
    await ui.page.locator(".setup-feedback.error").waitFor();
    if (mode === "failure") {
      const checksBeforeRecovery = (await ui.calls("check")).length;
      await ui.page.evaluate(() => window.dispatchEvent(new Event("online")));
      assert.equal((await ui.calls("check")).length, checksBeforeRecovery + 1, "A failed model test must allow network reconfiguration even when local identity remains ready");
      assert.equal((await ui.calls("full-test")).length, 1, "Network recovery must not repeat the paid model test");
    }
    assert.equal((await ui.calls("save")).filter(call => call.request.onboardingComplete).length, 0);
    if (mode !== "failure") assert.equal((await ui.calls("cancel")).length, 1);
    await ui.page.getByRole("button", { name: "导出诊断报告", exact: true }).click();
    await ui.page.waitForFunction(() => window.__setupTest.calls.some(call => call.kind === "export"));
    assert.equal((await ui.calls("diagnose")).length, 1); await ui.close();
  }
  {
    const ui = await open("install");
    assert.equal(await ui.primary.isDisabled(), true); assert.equal((await ui.calls("install")).length, 1);
    assert.equal((await ui.calls("save")).length, 0); assert.equal((await ui.calls("full-test")).length, 0); await ui.close();
  }
  console.log(JSON.stringify({ ok: true, scenarios: checks, realProfileAccessed: false, externalNetworkUsed: false }));
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
