import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercise the real App, Markdown renderer and composer with synthetic data.
// No production state, native filesystem, external request or model is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-followup-app-cache-"));
const screenshotDir = process.env.DOMI_FOLLOWUP_APP_UI_SCREENSHOTS_DIR
  || await fs.mkdtemp(path.join(os.tmpdir(), "domi-followup-app-screenshots-"));
await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_followup_app_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const firstPrompt = '基于本次研究报告，为示例科技生成一份按优先级排序的创始人访谈提纲，保留“技术与商业”两组问题。';
const secondPrompt = '为示例科技制定组织蒸馏、Unreal-MAP 和低空安全系统的技术尽调清单与验收标准。';
const thirdPrompt = '基于补充的融资条款和经营数据，为示例科技建立天使轮回报与稀释情景模型。';
const otherPrompt = '整理另一项目的客户验证问题，保持当前任务独立。';
const pendingPrompt = '尚未完成的建议不能提前填入输入框。';
const initialDraft = "保留我的补充要求：重点核对商业落地。";
const otherDraft = "另一个任务原有草稿。";
const bpPath = "/synthetic/library/示例科技/原始材料/示例科技BP.pdf";
const attachment = { name: "追加研究材料.pdf", path: "/synthetic/thread/attachments/追加研究材料.pdf", size: 2048 };
const followup = (label, prompt) => `- :codex-followup[${label}]{prompt=${JSON.stringify(prompt)}}`;
const content = [
  "项目研究已完成。公司产品、客户进展和融资信息已归档。",
  `原始材料：:codex-file-citation{path=${JSON.stringify(bpPath)}}`,
  followup("准备创始人访谈", firstPrompt),
  followup("进入技术尽调", secondPrompt),
  followup("搭建回报情景", thirdPrompt)
].join("\n\n");
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const fallback = (await import("/src/bridge?followup-app-fixture-fallback")).workbench;
const state = window.__followupAppTest = { pdfReads: [], resourceOpens: [], issues: [], modelRuns: 0, fileSelections: [] };
const settings = { ...(await fallback.loadSettings()).settings,
  onboardingComplete: true, codexPath: "/synthetic/codex", plaudConnectionMode: "disabled",
  localRepositoryDir: "/synthetic/library", localDatabasePath: "", localLibraryDir: "",
  radarFollowedDomains: [] };
const ready = { ...(await fallback.checkCodex()), ok: true, connectionOk: true,
  path: "/synthetic/codex", workspacePath: "/synthetic/thread", transport: "app-server",
  account: { type: "chatgpt", email: "fixture@example.com", planType: "test" },
  pluginSetup: { ok: true, status: "ready", version: "7.0.9" }, error: "" };
localStorage.clear();
localStorage.setItem("domi.composerDrafts.v1", JSON.stringify({
  "followup-first": { input: ${JSON.stringify(initialDraft)}, attachments: [], attachmentError: "", selectedWorkflowId: "project-research" },
  "followup-other": { input: ${JSON.stringify(otherDraft)}, attachments: [], attachmentError: "" }
}));
window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings, updatedAt: Date.now() }),
  loadState: async defaults => ({ ok: true, isNew: false, updatedAt: Date.now(), state: {
    ...defaults, activeThreadId: "followup-first", threads: [
      { ...defaults.threads[0], id: "followup-first", title: "示例科技项目研究", manualTitle: true,
        workspacePath: "/synthetic/thread", codexThreadId: undefined, messages: [
          { id: "first-user", role: "user", content: "研究并归档这份项目材料。" },
          { id: "first-assistant", role: "assistant", status: "done", content: ${JSON.stringify(content)} }
        ] },
      { ...defaults.threads[0], id: "followup-other", title: "另一项目独立任务", manualTitle: true,
        workspacePath: "/synthetic/other-thread", codexThreadId: undefined, messages: [
          { id: "other-user", role: "user", content: "分析另一个项目。" },
          { id: "other-assistant", role: "assistant", status: "done", content: ${JSON.stringify(followup("整理客户问题", otherPrompt))} }
        ] },
      { ...defaults.threads[0], id: "followup-running", title: "生成中建议检查", manualTitle: true,
        workspacePath: "/synthetic/running-thread", codexThreadId: "synthetic-running-codex-thread", messages: [
          { id: "running-user", role: "user", content: "正在生成后续建议。" },
          { id: "running-assistant", role: "assistant", status: "running", content: ${JSON.stringify(followup("生成中的建议", pendingPrompt))} }
        ] }
    ]
  } }),
  checkCodex: async () => ready,
  recoverCodexThread: async threadId => {
    if (threadId !== "synthetic-running-codex-thread") throw new Error("Unexpected synthetic recovery request");
    return { ok: true, threadId, status: "running", runId: "synthetic-running-run" };
  },
  bindCodexRun: async runId => {
    if (runId !== "synthetic-running-run") throw new Error("Unexpected synthetic run binding");
    return { ok: true };
  },
  selectFiles: async workspacePath => { state.fileSelections.push(workspacePath); return { ok: true, canceled: false, files: [${JSON.stringify(attachment)}] }; },
  readPdf: async request => {
    state.pdfReads.push(structuredClone(request));
    return { ok: true, document: { path: ${JSON.stringify(bpPath)}, name: "示例科技BP.pdf", previewUrl: "about:blank", size: 1024, mtimeMs: 1 } };
  },
  openResource: async resource => { state.resourceOpens.push(resource); return { ok: true }; },
  runCodex: async () => { state.modelRuns++; throw new Error("No model request is allowed in this fixture"); },
  testCodexConnection: async () => { throw new Error("No model connection test is allowed in this fixture"); },
  listWeeklyNews: async () => ({ ok: true, items: [], total: 0, radarCheckedThrough: Date.now() }),
  listDomiTasks: async () => ({ ok: true, configured: true, tasks: [], syncedAt: Date.now(), updatedAt: null }),
  reportRendererIssue: issue => state.issues.push(issue)
};
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<App />);
`;

let server;
let browser;
try {
  server = await createServer({
    configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [{ name: "followup-app-fixture",
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
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  const composer = page.getByRole("textbox", { name: "输入投资任务", exact: true });
  const message = page.locator(".message.assistant.done .message-markdown");
  const firstButton = message.getByRole("button", { name: "准备创始人访谈", exact: true });
  await firstButton.waitFor();
  assert.equal(await message.locator(".message-followup").count(), 3);
  assert.equal(await message.locator("li.message-followup-item").count(), 3);
  assert.doesNotMatch(await message.innerText(), /:codex-followup|prompt=/);
  assert.equal(await composer.inputValue(), initialDraft);
  await page.getByRole("button", { name: "选择本地文件", exact: true }).click();
  await page.getByRole("button", { name: `移除 ${attachment.name}`, exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__followupAppTest.fileSelections), ["/synthetic/thread"]);
  const selectedWorkflow = page.locator(".selected-workflow");
  assert.equal(await selectedWorkflow.count(), 1);
  const workflowLabel = await selectedWorkflow.innerText();

  await firstButton.click();
  const firstDraft = `${initialDraft}\n\n${firstPrompt}`;
  assert.equal(await composer.inputValue(), firstDraft, "Selecting a followup retains the draft and appends the complete prompt");
  await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "输入投资任务");
  await firstButton.click();
  assert.equal(await composer.inputValue(), firstDraft, "Repeated clicks must not duplicate a suggested prompt");
  assert.equal(await selectedWorkflow.innerText(), workflowLabel, "Selecting a followup preserves the selected workflow");
  assert.equal(await page.getByRole("button", { name: `移除 ${attachment.name}`, exact: true }).count(), 1,
    "Selecting a followup preserves the existing attachment");
  await page.screenshot({ path: path.join(screenshotDir, "followup-conversation-and-draft.png"), fullPage: true, animations: "disabled" });

  await message.getByRole("button", { name: "进入技术尽调", exact: true }).click();
  const combinedDraft = `${firstDraft}\n\n${secondPrompt}`;
  assert.equal(await composer.inputValue(), combinedDraft);
  await firstButton.click();
  assert.equal(await composer.inputValue(), combinedDraft, "Selecting another suggestion must not enable duplication of an earlier prompt");
  assert.deepEqual(await page.evaluate(() => ({ runs: window.__followupAppTest.modelRuns, opens: window.__followupAppTest.resourceOpens, pdfs: window.__followupAppTest.pdfReads })),
    { runs: 0, opens: [], pdfs: [] }, "Followup buttons only edit the composer and never send or open a resource");

  await page.locator(".thread-item").filter({ hasText: "另一项目独立任务" }).click();
  await page.getByRole("button", { name: "整理客户问题", exact: true }).waitFor();
  assert.equal(await composer.inputValue(), otherDraft);
  await page.getByRole("button", { name: "整理客户问题", exact: true }).click();
  assert.equal(await composer.inputValue(), `${otherDraft}\n\n${otherPrompt}`);
  await composer.fill("");
  await page.getByRole("button", { name: "整理客户问题", exact: true }).click();
  assert.equal(await composer.inputValue(), otherPrompt, "An empty composer receives the full prompt without extra whitespace");
  assert.equal(await page.locator(".attachment-list .attachment-chip").count(), 0);
  assert.equal(await selectedWorkflow.count(), 0);
  await page.locator(".thread-item").filter({ hasText: "示例科技项目研究" }).click();
  await firstButton.waitFor();
  assert.equal(await composer.inputValue(), combinedDraft, "Switching tasks retains each task's own composer draft");
  assert.equal(await selectedWorkflow.innerText(), workflowLabel);
  assert.equal(await page.getByRole("button", { name: `移除 ${attachment.name}`, exact: true }).count(), 1);

  await message.getByRole("link", { name: "示例科技BP.pdf", exact: true }).click();
  await page.locator(".pdf-panel-shell .markdown-file-title strong").getByText("示例科技BP.pdf", { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__followupAppTest.pdfReads.at(-1).resource), bpPath,
    "Ordinary file citations retain their document-opening behavior");
  await page.getByRole("button", { name: "关闭 PDF", exact: true }).click();

  await page.locator(".thread-item").filter({ hasText: "生成中建议检查" }).click();
  const pendingButton = page.getByRole("button", { name: "生成中的建议", exact: true });
  await pendingButton.waitFor();
  assert.equal(await pendingButton.isDisabled(), true, "Streaming messages must not offer active followup buttons");
  assert.equal(await composer.inputValue(), "");
  assert.equal(await page.evaluate(() => window.__followupAppTest.modelRuns), 0);
  assert.deepEqual(await page.evaluate(() => window.__followupAppTest.resourceOpens), []);
  assert.deepEqual(await page.evaluate(() => window.__followupAppTest.issues), []);
  assert.deepEqual(errors, []);
  console.log("Followup App UI checks passed: real button clicks, complete prompts, retained drafts/attachments/workflow, task isolation, no auto-send, disabled streaming suggestions and file citations.");
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
