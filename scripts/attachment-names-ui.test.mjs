import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Render the real App, Markdown pipeline and PDF panel against a synthetic
// native bridge. No user data, filesystem attachment, model or service is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-attachment-ui-cache-"));
const screenshotDir = process.env.DOMI_ATTACHMENT_NAMES_UI_SCREENSHOTS_DIR
  || await fs.mkdtemp(path.join(os.tmpdir(), "domi-attachment-ui-screenshots-"));
await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_attachment_names_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const bpName = "【BP】示例公司.pdf";
const bpStoredName = `1700000000000-0-${bpName}`;
const bpPath = `/synthetic/library/示例公司/原始材料/${bpStoredName}`;
const bpFileUrl = `file://${encodeURI(bpPath)}`;
const uploadedName = "【BP】合成项目 AI.pdf";
const uploadedPath = `/synthetic/thread/attachments/1700000000001-0-${uploadedName}`;
const literalName = "1700000000002-0-客户指定版本.pdf";
const literalPath = `/synthetic/thread/attachments/${literalName}`;
const attachments = [
  { name: uploadedName, path: uploadedPath, size: 512 },
  { name: literalName, path: literalPath, size: 1024 }
];
const content = [
  "项目资料已归档，业务和融资信息已保存在项目资料库。",
  `原始 BP：:codex-file-citation{path=${JSON.stringify(bpPath)}}`,
  `历史显式引用：:codex-file-citation{path=${JSON.stringify(bpPath)} label=${JSON.stringify(bpStoredName)}}`,
  `普通文档链接：[${bpStoredName}](<${bpFileUrl}>)`,
  `引用式文档链接：[${bpStoredName}][bp]`,
  `材料说明：[融资及产品材料](<${encodeURI(bpPath)}>)`,
  `本次上传：:codex-file-citation{path=${JSON.stringify(uploadedPath)}}`,
  `原文件名中的数字保留：:codex-file-citation{path=${JSON.stringify(literalPath)}}`,
  `[bp]: <${bpFileUrl}>`
].join("\n\n");
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const fallback = (await import("/src/bridge?attachment-fixture-fallback")).workbench;
const state = window.__attachmentNamesTest = { pdfReads: [], resourceOpens: [], issues: [], modelRuns: 0 };
const settings = { ...(await fallback.loadSettings()).settings,
  onboardingComplete: true, codexPath: "/synthetic/codex", plaudConnectionMode: "disabled",
  localRepositoryDir: "/synthetic/library", localDatabasePath: "", localLibraryDir: "",
  radarFollowedDomains: [] };
const ready = { ...(await fallback.checkCodex()), ok: true, connectionOk: true,
  path: "/synthetic/codex", workspacePath: "/synthetic/thread", transport: "app-server",
  account: { type: "chatgpt", email: "fixture@example.com", planType: "test" },
  pluginSetup: { ok: true, status: "ready", version: "7.0.3" }, error: "" };
localStorage.clear();
window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings, updatedAt: Date.now() }),
  loadState: async defaults => ({ ok: true, isNew: false, updatedAt: Date.now(), state: {
    ...defaults, activeThreadId: "attachment-fixture", threads: [{ ...defaults.threads[0],
      id: "attachment-fixture", title: "BP 附件命名检查", manualTitle: true,
      workspacePath: "/synthetic/thread", codexThreadId: undefined,
      messages: [
        { id: "fixture-user", role: "user", content: "将项目资料研究并归档。", attachments: ${JSON.stringify(attachments)} },
        { id: "fixture-assistant", role: "assistant", status: "done", content: ${JSON.stringify(content)} }
      ]
    }]
  } }),
  checkCodex: async () => ready,
  readPdf: async request => {
    state.pdfReads.push(structuredClone(request));
    const path = request.resource.startsWith("file:")
      ? decodeURIComponent(new URL(request.resource).pathname) : decodeURI(request.resource);
    return { ok: true, document: { path, name: path.split("/").at(-1),
      previewUrl: "about:blank", size: 1024, mtimeMs: 1 } };
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
    plugins: [{ name: "attachment-names-fixture",
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
  const message = page.locator(".message.assistant .message-markdown");
  const bpLinks = message.getByRole("link", { name: bpName, exact: true });
  await bpLinks.first().waitFor();
  assert.equal(await bpLinks.count(), 4, "Implicit/explicit citations and inline/reference Markdown links display the clean BP name");
  assert.doesNotMatch(await message.innerText(), /1700000000000-0-|1700000000001-0-/);
  assert.equal(await message.getByRole("link", { name: "融资及产品材料", exact: true }).count(), 1);
  assert.equal(await message.getByRole("link", { name: uploadedName, exact: true }).count(), 1);
  assert.equal(await message.getByRole("link", { name: literalName, exact: true }).count(), 1,
    "Attachment metadata is authoritative even when the original name resembles an internal storage name");
  assert.equal(await message.locator(".message-file-citation").count(), 4);
  assert.deepEqual(await bpLinks.evaluateAll(links => links.map(link => link.getAttribute("href"))), [
    `domi-file-citation:${encodeURIComponent(bpPath)}`,
    `domi-file-citation:${encodeURIComponent(bpPath)}`,
    bpFileUrl,
    bpFileUrl
  ], "Rendering must not rewrite existing destinations");

  const uploadButtons = page.locator(".message.user .message-attachments");
  for (const file of attachments) {
    await uploadButtons.getByTitle(`打开 ${file.name}`, { exact: true }).click();
    assert.equal(await page.evaluate(() => window.__attachmentNamesTest.resourceOpens.at(-1)), file.path);
  }
  await page.screenshot({ path: path.join(screenshotDir, "attachment-messages.png"), fullPage: true, animations: "disabled" });

  for (const [index, resource] of [bpPath, bpPath, bpFileUrl, bpFileUrl].entries()) {
    await bpLinks.nth(index).click();
    await page.waitForFunction(count => window.__attachmentNamesTest.pdfReads.length === count, index + 1);
    assert.equal(await page.evaluate(() => window.__attachmentNamesTest.pdfReads.at(-1).resource), resource,
      "Clicking must pass the exact original destination to the document bridge");
    const panel = page.locator(".pdf-panel-shell");
    await panel.locator(".markdown-file-title strong").getByText(bpName, { exact: true }).waitFor();
    assert.equal(await panel.locator("iframe").getAttribute("title"), `${bpName} PDF 预览`);
    assert.equal(await panel.locator(".markdown-file-title small").getAttribute("title"), bpPath);
    if (index === 0) await page.screenshot({ path: path.join(screenshotDir, "attachment-pdf-preview.png"), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "关闭 PDF", exact: true }).click();
  }
  await message.getByRole("link", { name: literalName, exact: true }).click();
  await page.locator(".pdf-panel-shell .markdown-file-title strong").getByText(literalName, { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.__attachmentNamesTest.pdfReads.at(-1).resource), literalPath);
  assert.equal(await page.evaluate(() => window.__attachmentNamesTest.modelRuns), 0);
  assert.deepEqual(await page.evaluate(() => window.__attachmentNamesTest.issues), []);
  assert.deepEqual(errors, []);
  console.log("Attachment name UI checks passed: historical citations, Markdown links, original metadata, exact destinations and PDF titles.");
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
