import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real App and intake UI with anonymous fixtures. No user DB, remote PLAUD,
// system notifications, or model call can run through this disposable bridge.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-plaud-context-ui-"));
const screenshots = process.env.DOMI_PLAUD_CONTEXT_SCREENSHOTS_DIR;
if (screenshots) await fs.mkdir(screenshots, { recursive: true });
const fixture = "/__domi_plaud_context_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const fallback = (await import("/src/bridge?plaud-context-test-fallback")).workbench;
const config = window.__intakeConfig || {};
const state = window.__intakeTest = { calls: [], pending: {}, plans: {}, issues: [], listeners: [] };
const settings = { ...(await fallback.loadSettings()).settings, onboardingComplete: true,
  plaudConnectionMode: "enabled", plaudBrowser: "chrome", radarFollowedDomains: [], localRepositoryDir: "/synthetic/library" };
const item = { fileId: "synthetic-recording", fileName: "09-22 仓储机器人产品与融资交流", duration: 3480000,
  createdAt: 1790058600000, editedAt: 1790058600000, hasTranscript: true, hasSummary: true,
  processing: false, queueStage: "transcript_ready", transcriptPath: "/synthetic/transcript.md", error: "", ...config.item };
const defaultPrepared = { ok: true, fileId: item.fileId, accountScope: "synthetic-account",
  stage: "context_pending", recordRevision: "synthetic-revision", transcript: { path: item.transcriptPath, sha256: "synthetic-sha", bytes: 10000 },
  disposition: "needs_input", context: { contextStatus: "pending" },
  recall: { summary: "围绕仓库拣选机器人，讨论电商仓客户试点、量产成本与下一轮融资安排。", keywords: ["仓库拣选", "客户试点", "融资"],
    excerpts: ["我们现在主要做仓库里的拣选，客户先从电商仓开始试点。", "硬件是自己做还是采购通用设备，主要看量产之后的成本。"], source: "extract" } };
state.prepared = { ...defaultPrepared, ...config.prepared };
const invoke = async (kind, payload, defaultResult) => {
  state.calls.push({ kind, payload: structuredClone(payload) });
  const plan = (state.plans[kind] || []).shift() || config[kind];
  if (plan?.hold) return new Promise(resolve => { state.pending[kind] = resolve; });
  if (plan?.error) throw new Error(plan.error);
  return structuredClone(plan?.result ?? defaultResult);
};
window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings: structuredClone(settings), updatedAt: Date.now() }),
  saveSettings: async request => { Object.assign(settings, request); return { ok: true, settings: structuredClone(settings), updatedAt: Date.now() }; },
  loadState: async defaults => { const saved = localStorage.getItem("intake-fixture-state");
    return { ok: true, isNew: false, updatedAt: Date.now(), state: saved ? JSON.parse(saved) : { ...defaults, threads: [{ ...defaults.threads[0],
      title: "合成测试任务", messages: [{ id: "fixture-user", role: "user", content: "查看录音" }, { id: "fixture-assistant", role: "assistant", content: "合成测试", status: "done" }] }] } }; },
  saveStatePatch: async patch => { const saved = JSON.parse(localStorage.getItem("intake-fixture-state") || "{}");
    const byId = new Map((saved.threads || []).map(thread => [thread.id, thread]));
    for (const thread of patch.threads || []) byId.set(thread.id, thread);
    for (const id of patch.deletedThreadIds || []) byId.delete(id);
    const next = { ...saved, ...patch.meta, threads: (patch.threadOrder || [...byId.keys()]).map(id => byId.get(id)).filter(Boolean) };
    localStorage.setItem("intake-fixture-state", JSON.stringify(next)); return { ok: true, updatedAt: Date.now() }; },
  saveState: async state => { localStorage.setItem("intake-fixture-state", JSON.stringify(state)); return { ok: true, updatedAt: Date.now() }; },
  checkCodex: async () => ({ ok: true, connectionOk: true, path: "/synthetic/codex", workspacePath: "/synthetic",
    pluginSetup: { ok: true, status: "ready", version: "7.0.14" }, models: config.models || [{ id: "gpt-5.6-sol", name: "Synthetic model", supportedReasoningEfforts: [{ id: "max" }], serviceTiers: [{ id: "priority" }] }] }),
  listPlaud: async () => ({ ok: true, syncedAt: Date.now(), items: [item], pendingCount: 0, queueCount: 1, hasMore: false, remoteStatus: "connected" }),
  resumePlaudTranscripts: async () => ({ ok: true, status: "complete", resumePendingCount: 0 }),
  preparePlaudContext: request => invoke("prepare", request, state.prepared),
  summarizePlaudContext: request => invoke("summarize", request, { ok: false, fileId: item.fileId }),
  savePlaudContext: async request => { const result = await invoke("save", request, { ...state.prepared,
      disposition: "ready", stage: "context_ready", recordRevision: "saved-revision", contextPath: "/synthetic/context.json", context: request });
    if (result.ok) state.prepared = result; return result; },
  savePlaudContextDraft: request => invoke("draft", request, { ok: true }),
  selectFiles: workspace => invoke("selectFiles", { workspace }, { ok: true, canceled: false, files: [
    { name: "示例公司BP.pdf", path: "/synthetic/staging/101-0-示例公司BP.pdf", size: 3145728 },
    { name: "产品数据.xlsx", path: "/synthetic/staging/101-1-产品数据.xlsx", size: 24576 }
  ] }),
  getPathForFile: file => config.filePaths?.[file.name] || "",
  importFiles: (paths, workspace) => invoke("importFiles", { paths, workspace }, { ok: true, files: paths.map((path, i) => ({ name: path.split("/").at(-1), path: "/synthetic/staging/path-" + i + "-" + path.split("/").at(-1), size: 200 })) }),
  importFileData: (files, workspace) => invoke("importFileData", { names: files.map(file => file.name), bytes: files.map(file => file.data.byteLength), workspace }, { ok: true, files: files.map((file, i) => ({ name: file.name, path: "/synthetic/staging/drop-" + i + "-" + file.name, size: file.data.byteLength })) }),
  discardStagedAttachment: path => invoke("discard", { path }, { ok: true }),
  createProjectWorkspace: request => invoke("workspace", request, { ok: true, workspacePath: "/synthetic/thread" }),
  loginPlaud: request => invoke("login", request, { ok: true, connected: true, browser: "chrome", status: "connected" }),
  checkPlaudConnection: async () => ({ ok: true, connected: true, browser: "chrome", status: "connected" }),
  runCodex: request => invoke("run", request, { ok: false, error: "Synthetic run needs an explicit test plan" }),
  onCodexEvent: callback => { state.listeners.push(callback); return () => { state.listeners = state.listeners.filter(entry => entry !== callback); }; },
  syncDomi: async () => ({ ok: true }),
  showNotification: async () => { throw new Error("Real alerts are forbidden"); },
  testCodexConnection: async () => { throw new Error("Real model tests are forbidden"); },
  reportRendererIssue: issue => state.issues.push(issue)
};
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;
let server;
let browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "plaud-context-fixture", resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; }, configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next(); response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
      }); } }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const scenario = async (config, verify) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1060 } });
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(config => { window.__intakeConfig = config; }, { run: { hold: true }, ...config });
    const page = await context.newPage(); page.setDefaultTimeout(12000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    const calls = kind => page.evaluate(kind => window.__intakeTest.calls.filter(call => call.kind === kind), kind);
    const wait = (kind, count) => page.waitForFunction(({ kind, count }) => window.__intakeTest.calls.filter(call => call.kind === kind).length === count, { kind, count });
    const release = (kind, result) => page.evaluate(({ kind, result }) => window.__intakeTest.pending[kind](result), { kind, result });
    const plan = (kind, value) => page.evaluate(({ kind, value }) => { (window.__intakeTest.plans[kind] ||= []).push(value); }, { kind, value });
    const start = () => page.getByRole("button", { name: "生成纪要并入库", exact: true }).click();
    const card = page.getByRole("region", { name: "会议背景确认" });
    try {
      await page.goto(origin, { waitUntil: "networkidle" });
      await verify({ page, calls, wait, release, plan, start, card });
      assert.deepEqual(errors, [], "No uncaught renderer failures");
      assert.deepEqual(await page.evaluate(() => window.__intakeTest.issues), [], "No suppressed renderer failures");
    } catch (error) {
      console.error("Intake scenario failed", JSON.stringify(config), await page.evaluate(() => ({ calls: window.__intakeTest.calls.map(call => call.kind), text: document.querySelector('.plaud-context')?.textContent, issues: window.__intakeTest.issues })));
      throw error;
    } finally { await context.close(); }
  };

  await scenario({ prepare: { hold: true }, summarize: { hold: true } }, async ({ page, calls, wait, release, start, card }) => {
    const clickedAt = performance.now();
    await start(); await card.waitFor();
    const intakeLatencyMs = Math.round(performance.now() - clickedAt);
    assert.ok(intakeLatencyMs < 1000, `Editable card must appear before any held IPC, observed ${intakeLatencyMs} ms`);
    console.log(`PLAUD editable intake: ${intakeLatencyMs} ms with preparation held`);
    assert.equal((await calls("workspace")).length, 0, "Intake renders before workspace preparation");
    assert.equal((await calls("run")).length, 0, "Intake does not invoke the full workflow");
    assert.equal((await calls("prepare")).length, 1, "StrictMode shares context preparation");
    await card.getByRole("textbox", { name: /参会者/ }).fill("示例创始人；我和同事");
    await page.getByRole("button", { name: "确认会议信息", exact: true }).click();
    assert.equal((await calls("prepare")).length, 1, "Repeated list clicks reuse the same pending intake");
    await release("prepare", await page.evaluate(() => ({ ...window.__intakeTest.prepared, draft: { conversationType: "其他", projectName: "不应覆盖", participants: "旧草稿", extraContext: "" } })));
    await wait("summarize", 1);
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "示例创始人；我和同事");
    await card.getByRole("combobox", { name: /会议类型/ }).selectOption("创业公司交流");
    await card.getByRole("textbox", { name: /项目名称/ }).fill("示例机器人");
    await release("summarize", { ok: true, fileId: "synthetic-recording", accountScope: "synthetic-account", transcriptSha256: "synthetic-sha", recall: {
      summary: "这可能是一次仓储机器人公司的产品与融资交流。讨论电商仓试点、自研硬件与量产成本，以及下一轮融资计划。", keywords: ["客户试点", "量产", "融资"],
      excerpts: ["我们现在主要做仓库里的拣选，客户先从电商仓开始试点。"], source: "model" } });
    await card.getByText(/这可能是一次仓储机器人公司的产品与融资交流/).waitFor();
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "示例创始人；我和同事", "Late recap never changes user input");
    await card.getByText("查看文字稿片段", { exact: true }).click();
    await card.locator("blockquote").waitFor();
    if (screenshots) await page.screenshot({ path: path.join(screenshots, "meeting-context.png"), fullPage: true, animations: "disabled" });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("intake-fixture-state") || "{}").threads?.some(thread => thread.plaudIntake?.draft.participants === "示例创始人；我和同事"));
    await page.reload({ waitUntil: "networkidle" }); await card.waitFor();
    await wait("prepare", 1);
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "示例创始人；我和同事", "Unsubmitted draft survives reload");
    assert.equal((await calls("run")).length, 0);
  });

  await scenario({ save: { hold: true }, workspace: { result: { ok: false } } }, async ({ page, calls, wait, release, plan, start, card }) => {
    await start(); await card.getByRole("button", { name: "确认并生成纪要", exact: true }).waitFor();
    await card.getByRole("textbox", { name: /参会者/ }).fill("示例负责人\n投资团队");
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).dblclick();
    await wait("save", 1);
    assert.equal((await calls("run")).length, 0, "Full workflow waits for durable context receipt");
    const request = (await calls("save"))[0].payload;
    assert.equal(request.contextStatus, "provided");
    assert.equal(request.rawAnswer, "参会者：示例负责人\n投资团队");
    await release("save", await page.evaluate(request => ({ ...window.__intakeTest.prepared, disposition: "ready", recordRevision: "saved", contextPath: "/synthetic/context.json", context: request }), request));
    await card.getByRole("alert").filter({ hasText: "任务工作区" }).waitFor();
    await plan("workspace", { result: { ok: true, workspacePath: "/synthetic/thread" } });
    await plan("workspace", { result: { ok: true, workspacePath: "/synthetic/stage" } });
    await card.getByRole("button", { name: "继续生成纪要", exact: true }).click();
    await wait("run", 1);
    assert.equal((await calls("save")).length, 1, "A launch retry reuses saved context");
    const run = (await calls("run"))[0].payload;
    assert.match(run.prompt, /contextStatus=provided/);
    assert.match(run.prompt, /示例负责人\n投资团队/);
    assert.match(run.prompt, /全文阅读、信息覆盖、数字与实体核验/);
    assert.doesNotMatch(run.prompt, /先采用 domi 插件的 domi-router，并完整读取 PLAUD 投资录音工作流及各阶段 Skill/);
    await page.getByRole("button", { name: "正在执行", exact: true }).waitFor();
    assert.equal(await card.count(), 0, "Accepted task replaces intake with normal conversation");
  });

  await scenario({}, async ({ calls, wait, start, card }) => {
    await start(); await card.getByRole("button", { name: "暂不补充，直接处理", exact: true }).click();
    await wait("run", 1);
    assert.equal((await calls("save"))[0].payload.contextStatus, "skipped");
    assert.match((await calls("run"))[0].payload.prompt, /contextStatus=skipped/);
  });

  await scenario({ item: { transcriptPath: "", queueStage: "" }, prepared: { transcript: { path: "/synthetic/downloaded-transcript.md", sha256: "synthetic-downloaded-sha", bytes: 12000 } } }, async ({ page, calls, wait, start, card }) => {
    await start(); await card.getByRole("textbox", { name: /参会者/ }).fill("明确填写的参会者");
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).click();
    await wait("run", 1);
    const answer = (await calls("save"))[0].payload;
    const run = (await calls("run"))[0].payload;
    assert.equal(run.plaudAccess.transcriptPath, "/synthetic/downloaded-transcript.md", "Newly prepared local text wins over a stale remote-only sidebar row");
    assert.match(run.prompt, /已有本地文字稿：\/synthetic\/downloaded-transcript.md/);
    assert.match(run.prompt, /当前队列阶段：context_ready/);
    assert.doesNotMatch(run.prompt, /PLAUD 远端已有文字稿，本地尚未绑定文字稿路径/);
    const bound = await page.evaluate(() => JSON.parse(localStorage.getItem("intake-fixture-state")).threads.find(thread => thread.plaudIntake));
    assert.equal(bound.plaudIntake.sourceTurnId, answer.sourceTurnId, "The native form source turn is durable before the model launch");
    assert.equal(bound.plaudIntake.rawAnswer, answer.rawAnswer);
    assert.equal(bound.plaudIntake.item.transcriptPath, "/synthetic/downloaded-transcript.md");
    assert.equal(bound.plaudIntake.item.queueStage, "context_ready");
    await page.waitForFunction(sourceTurnId => JSON.parse(localStorage.getItem("intake-fixture-state") || "{}").threads?.some(thread => thread.messages?.some(message => message.role === "user" && message.plaudContextSourceTurnId === sourceTurnId)), answer.sourceTurnId);
  });

  await scenario({ prepared: { disposition: "ready", contextPath: "/synthetic/context.json", context: { contextStatus: "provided", participants: "已确认的参会者", rawAnswer: "参会者：已确认的参会者" } } }, async ({ calls, wait, start, card }) => {
    await start(); await card.getByRole("button", { name: "继续生成纪要", exact: true }).click();
    await wait("run", 1);
    assert.equal((await calls("save")).length, 0, "Existing provided context is never asked or written again");
    assert.equal((await calls("summarize")).length, 0);
    assert.match((await calls("run"))[0].payload.prompt, /已确认的参会者/);
  });

  await scenario({ prepared: { disposition: "advanced", stage: "managed" } }, async ({ page, calls, start, card }) => {
    await start(); await card.getByText("这条录音已处理完成", { exact: true }).waitFor();
    await page.getByRole("textbox", { name: "输入投资任务", exact: true }).waitFor();
    assert.equal(await card.getByRole("button", { name: /生成纪要/ }).count(), 0);
    assert.equal((await calls("run")).length, 0);
  });

  await scenario({ prepared: { disposition: "advanced", stage: "reviewed", context: { contextStatus: "provided", participants: "已确认的参会者" } } }, async ({ calls, start, card, wait }) => {
    await start(); await card.getByRole("button", { name: "继续后续处理", exact: true }).click();
    await wait("run", 1);
    assert.equal((await calls("save")).length, 0, "Advanced nonterminal queues resume without rewriting context");
    assert.equal((await calls("summarize")).length, 0);
    assert.match((await calls("run"))[0].payload.prompt, /当前队列阶段：reviewed/);
    assert.match((await calls("run"))[0].payload.prompt, /不重复生成已有纪要/);
  });

  await scenario({ prepare: { result: { ok: false, fileId: "synthetic-recording", error: "文字稿读取稍后可恢复" } } }, async ({ calls, start, card }) => {
    await start(); await card.getByRole("alert").waitFor();
    await card.getByRole("textbox", { name: /参会者/ }).fill("保留这份草稿");
    assert.equal(await card.getByRole("button", { name: "确认并生成纪要", exact: true }).isDisabled(), true);
    assert.equal((await calls("run")).length, 0);
  });
  await scenario({ save: { result: { ok: false, fileId: "synthetic-recording", errorCode: "PLAUD_CONTEXT_REVISION_CONFLICT", error: "会议信息已更新，请重新读取。" } } }, async ({ calls, start, card, wait, plan }) => {
    await start(); await card.getByRole("textbox", { name: /参会者/ }).fill("保留我的原始回答");
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).click();
    await card.getByRole("alert").waitFor();
    await card.getByRole("button", { name: "重新读取", exact: true }).click();
    await wait("prepare", 2);
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "保留我的原始回答");
    assert.equal((await calls("run")).length, 0, "A conflicting context revision never starts the workflow");
  });

  await scenario({ summarize: { hold: true }, login: { hold: true } }, async ({ page, calls, wait, release, start, card }) => {
    await start(); await wait("summarize", 1);
    await card.getByRole("textbox", { name: /参会者/ }).fill("保留原账号的草稿");
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("button", { name: "登录并验证", exact: true }).click();
    await wait("login", 1);
    await release("summarize", { ok: true, fileId: "synthetic-recording", accountScope: "synthetic-account", transcriptSha256: "synthetic-sha",
      recall: { source: "model", summary: "旧账号迟到的摘要不得出现", keywords: [], excerpts: [] } });
    await page.evaluate(() => { window.__intakeTest.prepared = { ...window.__intakeTest.prepared, accountScope: "different-account" }; });
    await release("login", { ok: true, connected: true, browser: "chrome", status: "connected" });
    await wait("prepare", 2);
    await settings.getByTitle("关闭设置", { exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "账号已变更" }).waitFor();
    assert.equal(await card.getByText("旧账号迟到的摘要不得出现", { exact: true }).count(), 0);
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "保留原账号的草稿");
    assert.equal(await card.getByRole("button", { name: "确认并生成纪要", exact: true }).isDisabled(), true);
    assert.equal((await calls("save")).length, 0);
    assert.equal((await calls("run")).length, 0);
  });

  await scenario({ login: { hold: true } }, async ({ page, calls, wait, release, plan, start, card }) => {
    await start(); await wait("prepare", 1);
    await card.getByRole("textbox", { name: /参会者/ }).fill("沿用这份已填信息");
    const original = await page.evaluate(() => structuredClone(window.__intakeTest.prepared));
    await page.getByTitle("打开 Codex 设置", { exact: true }).click();
    const settings = page.getByRole("dialog", { name: "domi 设置", exact: true });
    await settings.getByRole("button", { name: "录音转写", exact: true }).click();
    await settings.getByRole("button", { name: "登录并验证", exact: true }).click();
    await wait("login", 1);
    await page.evaluate(() => { window.__intakeTest.prepared = { ok: false, fileId: "synthetic-recording", errorCode: "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED", error: "请确认连接变更后的会议信息。",
      scopeRecovery: { previousAccountScope: "synthetic-account", accountScope: "reconnected-account", transcriptSha256: "synthetic-sha", recordRevision: "recovery-revision" } }; });
    await release("login", { ok: true, connected: true, browser: "chrome", status: "connected" });
    await wait("prepare", 2);
    await settings.getByTitle("关闭设置", { exact: true }).click();
    const recover = card.getByRole("button", { name: "确认沿用已填信息", exact: true });
    await recover.waitFor();
    assert.equal(await card.getByRole("button", { name: "确认并生成纪要", exact: true }).isDisabled(), true);
    assert.equal((await calls("prepare"))[1].payload.expectedTranscriptSha256, "synthetic-sha");
    assert.equal((await calls("run")).length, 0);
    await plan("save", { hold: true });
    await recover.dblclick(); await wait("save", 1);
    assert.equal((await calls("save"))[0].payload.action, "recover_scope");
    assert.equal((await calls("save"))[0].payload.confirmed, true);
    assert.equal((await calls("run")).length, 0, "Scope recovery is not permission to start a model");
    await release("save", { ...original, accountScope: "reconnected-account" });
    await wait("prepare", 3);
    await page.waitForFunction(() => !document.querySelector('.plaud-context-submit').disabled);
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "沿用这份已填信息");
    assert.equal((await calls("run")).length, 0, "Even successful scope recovery requires a separate generation confirmation");
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).click();
    await wait("run", 1);
    assert.equal((await calls("save"))[1].payload.accountScope, "reconnected-account");
    assert.equal((await calls("save"))[1].payload.participants, "沿用这份已填信息");
  });

  await scenario({}, async ({ page, calls, wait, release, start, card }) => {
    await start(); await card.getByRole("button", { name: "暂不补充，直接处理", exact: true }).click();
    await wait("run", 1);
    await release("run", { ok: false, error: "合成连接中断，尚未完成纪要。" });
    await card.getByRole("alert").filter({ hasText: "合成连接中断" }).waitFor();
    assert.equal((await calls("save")).length, 1);
    await card.getByRole("button", { name: "继续生成纪要", exact: true }).click();
    await wait("run", 2);
    assert.equal((await calls("save")).length, 1, "A failed run resumes with its original saved answer");
  });

  await scenario({}, async ({ page, calls, wait, start, card }) => {
    await start(); await card.getByRole("button", { name: /添加公司材料或 BP/ }).click();
    await card.getByText("示例公司BP.pdf", { exact: true }).waitFor();
    assert.equal((await calls("selectFiles"))[0].payload.workspace, undefined, "Intake materials are staged before project identity is known");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("intake-fixture-state")).threads.some(thread => thread.plaudIntake?.attachments?.length === 2));
    await page.reload({ waitUntil: "networkidle" }); await card.getByText("示例公司BP.pdf", { exact: true }).waitFor();
    assert.equal(await card.getByRole("listitem").count(), 2, "Materials survive a renderer restart");
    if (screenshots) await card.screenshot({ path: path.join(screenshots, "meeting-materials.png"), animations: "disabled" });
    await card.getByRole("button", { name: "移除材料 产品数据.xlsx", exact: true }).click(); await wait("discard", 1);
    assert.equal((await calls("discard"))[0].payload.path, "/synthetic/staging/101-1-产品数据.xlsx");
    await card.getByRole("button", { name: "按已有信息处理", exact: true }).click(); await wait("run", 1);
    assert.equal((await calls("save"))[0].payload.contextStatus, "provided", "Materials-only context must not be marked skipped");
    assert.match((await calls("save"))[0].payload.rawAnswer, /补充材料：示例公司BP.pdf/);
    const run = (await calls("run"))[0].payload;
    assert.deepEqual(run.attachmentPaths, ["/synthetic/staging/101-0-示例公司BP.pdf"]);
    assert.match(run.prompt, /不得把仅出现在 BP 的内容写成会上已讨论的事实/);
    assert.match(run.prompt, /"name":"示例公司BP.pdf","path":"\/synthetic\/staging\/101-0-示例公司BP.pdf"/);
    assert.doesNotMatch(run.prompt, /产品数据.xlsx/);
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("intake-fixture-state")).threads.some(thread => thread.messages?.some(message => message.role === "user" && message.attachments?.[0]?.name === "示例公司BP.pdf")));
  });

  await scenario({ selectFiles: { hold: true } }, async ({ page, calls, wait, release, start, card }) => {
    await start(); await card.getByRole("button", { name: /添加公司材料或 BP/ }).click(); await wait("selectFiles", 1);
    assert.equal(await card.getByRole("button", { name: "确认并生成纪要", exact: true }).isDisabled(), true);
    assert.equal((await calls("run")).length, 0);
    await page.getByRole("button", { name: "新建任务", exact: true }).click();
    await release("selectFiles", { ok: true, files: [{ name: "原会议BP.pdf", path: "/synthetic/staging/original.pdf", size: 1024 }] });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("intake-fixture-state")).threads.some(thread => thread.plaudIntake?.attachments?.[0]?.name === "原会议BP.pdf"));
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("intake-fixture-state")));
    assert.notEqual(saved.threads.find(thread => thread.plaudIntake).id, saved.activeThreadId, "Late picker results stay on the original meeting");
    assert.equal((await calls("run")).length, 0);
    await page.getByRole("button", { name: /09-22 仓储机器人产品与融资交流 纪要/ }).first().click();
    await card.getByText("原会议BP.pdf", { exact: true }).waitFor();
  });

  const drop = async (card, names) => {
    await card.locator(".plaud-context-materials-drop").evaluate((target, names) => {
      const transfer = new DataTransfer();
      for (const name of names) transfer.items.add(new File(["synthetic material"], name, { type: "text/plain" }));
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, names);
  };
  await scenario({}, async ({ calls, wait, start, card }) => {
    await start(); await card.getByRole("button", { name: /添加公司材料或 BP/ }).waitFor();
    await drop(card, ["公司简介.txt", "产品补充.txt"]); await wait("importFileData", 1);
    await card.getByText("公司简介.txt", { exact: true }).waitFor();
    assert.deepEqual((await calls("importFileData"))[0].payload.names, ["公司简介.txt", "产品补充.txt"]);
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).click(); await wait("run", 1);
    assert.equal((await calls("run"))[0].payload.attachmentPaths.length, 2);
  });
  await scenario({ filePaths: { "拖入BP.pdf": "/synthetic/source/拖入BP.pdf" }, importFileData: { error: "合成文件读取失败" } }, async ({ calls, wait, start, card }) => {
    await start(); await card.getByRole("textbox", { name: /参会者/ }).fill("保留参会者信息");
    await drop(card, ["拖入BP.pdf", "失败的补充.txt"]);
    await card.getByRole("alert").filter({ hasText: "合成文件读取失败" }).waitFor(); await wait("discard", 1);
    assert.equal(await card.getByRole("listitem").count(), 0, "A partial batch failure is rolled back");
    assert.equal(await card.getByRole("textbox", { name: /参会者/ }).inputValue(), "保留参会者信息");
    assert.equal((await calls("run")).length, 0);
  });
  await scenario({ selectFiles: { result: { ok: true, canceled: true, files: [] } } }, async ({ calls, wait, start, card }) => {
    await start(); await card.getByRole("button", { name: /添加公司材料或 BP/ }).click(); await wait("selectFiles", 1);
    assert.equal(await card.getByRole("listitem").count(), 0);
    assert.equal(await card.getByRole("alert").count(), 0);
    assert.equal((await calls("run")).length, 0);
  });
  await scenario({ workspace: { result: { ok: false } } }, async ({ page, calls, wait, plan, start, card }) => {
    await start(); await card.getByRole("button", { name: /添加公司材料或 BP/ }).click();
    await card.getByText("示例公司BP.pdf", { exact: true }).waitFor();
    await card.getByRole("button", { name: "确认并生成纪要", exact: true }).click();
    await card.getByRole("alert").filter({ hasText: "任务工作区" }).waitFor();
    await page.reload({ waitUntil: "networkidle" }); await card.getByText("示例公司BP.pdf", { exact: true }).waitFor();
    await plan("workspace", { result: { ok: true, workspacePath: "/synthetic/retry" } });
    await plan("workspace", { result: { ok: true, workspacePath: "/synthetic/retry-stage" } });
    await card.getByRole("button", { name: "继续生成纪要", exact: true }).click(); await wait("run", 1);
    assert.equal((await calls("save")).length, 0, "Restarted launch uses the already confirmed receipt");
    assert.equal((await calls("run"))[0].payload.attachmentPaths.length, 2, "Retry retains all submitted materials");
  });

  console.log("PLAUD intake UI passed: context recovery; materials selection/drop/removal; materials-only context; durable attachments; source-thread isolation; copy failure rollback; import-before-submit; saved-context attachment retry.");
} finally {
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
