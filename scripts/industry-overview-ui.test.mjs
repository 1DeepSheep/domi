import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real IndustryOverview and production styles, an isolated synthetic native
// bridge, and no real repository, model request, or external network access.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-industry-ui-"));
const screenshotDir = process.env.DOMI_INDUSTRY_UI_SCREENSHOTS_DIR;
if (screenshotDir) await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_industry_fixture__.tsx";
const fixturePath = path.join(root, fixture.slice(1));
const library = "/synthetic/资料库 空格#100%（本地）";
const entries = [
  ["AI", "", 2], ["AI", "AI 数据", 2], ["半导体", "", 1],
  ["半导体", "设计工具", 1], ["消费", "", 1], ["新能源", "", 0]
].map(([domain, subdomain, projectCount]) => ({ domain, subdomain, projectCount,
  title: `${subdomain || domain}行业速览`, path: `${library}/1.行业研究/${domain}/${subdomain ? `${subdomain}/` : ""}行业速览.md` }));
const companyName = "合成数研 A #100%（测试）";
const projectPath = `${library}/3.项目库/AI/AI 数据/${companyName}/项目主页.md`;
const encodePath = value => value.split("/").map(segment => encodeURIComponent(segment).replace(/[()]/g, value => `%${value.charCodeAt(0).toString(16)}`)).join("/");
const headers = ["公司／方向", "关键进展", "融资／估值", "投资判断", "跟进／资料日期"];
function overviewContent(entry) {
  const link = encodePath(path.posix.relative(path.posix.dirname(entry.path), projectPath));
  return `# ${entry.title}\n\n> 以下为界面测试的合成数据，不是真实投资结论。\n\n## 行业现状\n\n${entry.domain}：需求由试点向付费交付发展；头部与垂直团队并存。\n\n## 近期变化与风险\n\n测试资料截至 2026-09-01：客户复购与交付成本仍需核实。\n\n## 项目对照\n\n${entry.projectCount ? `| ${headers.join(" | ")} |\n| --- | --- | --- | --- | --- |\n| [${companyName}](${link}) · 模型数据质量工具 | 已完成 3 家付费客户试点；复购待核实。 | Pre-A；公司称拟融资 500 万美元；尚未完成。 | A 级；质量评估能力有优势，收入集中度待核实。 | 已交流；业务资料截至 2026-09-01。 |\n| 合成项目 B · 垂直数据服务 | 客户验收完成，收入数据待补充。 | 轮次、估值待补充。 | 现有评级 B；规模化成本待核实。 | 跟进中；资料日期待核实。 |` : "当前行业暂无已关联项目。"}\n\n## 研究依据\n\n本测试使用合成材料，正文保留来源与缺口说明。\n\n${Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 条研究补充：行业判断保留在当前页面，完整项目材料从公司名进入。`).join("\n\n")}`;
}
const projectContent = `<!-- domi:managed:start -->\n---\ndomi_schema: 7\nentity_type: project\nproject_id: synthetic-a\n---\n\n# ${companyName}\n\n## 投资摘要\n\n这是完整项目主页的合成正文，不是预览卡片。\n\n## 项目概览\n\n产品为模型数据质量工具，核心团队拥有数据工程交付经验。\n\n## 融资与估值\n\nPre-A 为融资计划，尚未完成。\n\n## 相关材料\n\n完整项目原始材料保留在唯一项目目录。\n\n## 完整正文末尾\n\n客户复购、单客收入和交付成本需要继续核实。\n<!-- domi:managed:end -->`;
const docs = Object.fromEntries(entries.map(entry => [entry.path, overviewContent(entry)]));
docs[projectPath] = projectContent;
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
const entries = ${JSON.stringify(entries)};
const docs = ${JSON.stringify(docs)};
const mode = new URL(location.href).searchParams.get("mode") || "ready";
const state = window.__industryTest = { calls: [], entries, docs, mode, failPaths: [], refreshFailure: false, pending: {}, refresh: null };
if (mode === "initial-read-failure") state.failPaths.push(entries[0].path);
const bridge = {
  refreshIndustryOverviews: async () => {
    state.calls.push({ kind: "refreshIndustryOverviews" });
    if (state.refreshFailure) return { ok: false, entries: [], error: "合成刷新失败，原资料仍保留" };
    if (mode === "conflict") return { ok: false, entries, conflicts: [{ path: entries[0].path }], warnings: ["合成资料缺口"] };
    return { ok: true, entries: mode === "empty-library" ? [] : entries };
  },
  readMarkdown: async ({ resource }) => {
    state.calls.push({ kind: "readMarkdown", resource });
    if (state.failPaths.includes(resource)) return { ok: false, error: "合成文档读取失败，文件仍保留" };
    if (!Object.hasOwn(state.docs, resource)) return { ok: false, error: "合成路径不存在：" + resource };
    return { ok: true, document: { path: resource, name: resource.split("/").pop(), content: state.docs[resource], mtimeMs: 1234 } };
  },
  openResource: async resource => { state.calls.push({ kind: "openResource", resource }); return { ok: true }; }
};
window.workbench = new Proxy(bridge, { get(target, name) {
  if (name in target) return target[name];
  return (...args) => { state.calls.push({ kind: String(name), args }); throw new Error("Unexpected bridge call: " + String(name)); };
} });
const { default: IndustryOverview, localMarkdownTarget } = await import("/src/IndustryOverview");
state.localMarkdownTarget = localMarkdownTarget;
function Harness() {
  const [refreshKey, setRefreshKey] = useState(0);
  state.refresh = () => setRefreshKey(key => key + 1);
  return <IndustryOverview refreshKey={refreshKey} onOpenAttachment={resource => { state.calls.push({ kind: "onOpenAttachment", resource }); }} />;
}
createRoot(document.getElementById("root")).render(<Harness />);
`;
let server;
let browser;
const contexts = [];
const results = [];
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "industry-fixture", resolveId(id) { if (id === fixture) return fixturePath; }, load(id) { if (id === fixturePath) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith("/?")) return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{width:100%;height:100%;margin:0;min-width:0}</style></head><body><div id="root"></div><script type="module" src="'+fixture+'"></script></body></html>');
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  async function open(mode = "ready", width = 1280) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); contexts.push(context);
    const externalRequests = [];
    await context.route("**/*", route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.setDefaultTimeout(4_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`, { waitUntil: "networkidle" });
    await page.getByRole("region", { name: "行业速览", exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector(".industry-overview-reader")?.getAttribute("aria-busy") === "false");
    return { page, context, errors, externalRequests };
  }
  async function scenario(name, callback, { mode = "ready", width = 1280 } = {}) {
    const ui = await open(mode, width);
    try {
      await callback(ui.page);
      assert.deepEqual(ui.errors, [], "No uncaught renderer exceptions");
      assert.deepEqual(ui.externalRequests, [], "The reader must not call external services");
      const calls = await ui.page.evaluate(() => window.__industryTest.calls);
      assert.deepEqual(calls.filter(call => !["readMarkdown", "refreshIndustryOverviews", "openResource", "onOpenAttachment"].includes(call.kind)), [], "Reading must not save Markdown, edit records, or invoke a model");
      results.push({ name, passed: true });
    } catch (error) {
      results.push({ name, passed: false, error: error.stack || String(error) });
      if (screenshotDir) await ui.page.screenshot({ path: path.join(screenshotDir, `${name}-failed.png`), fullPage: true, animations: "disabled" });
    } finally { await ui.context.close(); }
  }
  await scenario("all-industries-and-five-columns", async page => {
    const selector = page.getByRole("combobox", { name: "选择行业" });
    assert.equal(await selector.locator("option").count(), entries.length);
    assert.deepEqual(await page.locator(".industry-overview-table th").allTextContents(), headers);
    const row = page.locator(".industry-overview-table tbody tr").first();
    for (const fact of ["已完成 3 家付费客户试点", "Pre-A", "尚未完成", "A 级", "2026-09-01"]) assert((await row.textContent()).includes(fact), fact);
    for (const entry of entries) {
      await selector.selectOption(entry.path);
      await page.getByRole("heading", { name: entry.title, exact: true }).waitFor();
      assert.equal(await selector.inputValue(), entry.path);
      if (!entry.projectCount) await page.getByText("当前行业暂无已关联项目。", { exact: true }).waitFor();
    }
    assert.equal(await page.getByRole("button").count(), 0, "The overview should not add multiple shortcut actions");
  });
  await scenario("project-path-roundtrip-and-selection", async page => {
    const selected = entries[1];
    await page.getByRole("combobox", { name: "选择行业" }).selectOption(selected.path);
    await page.getByRole("heading", { name: selected.title, exact: true }).waitFor();
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "industry-overview-wide.png"), fullPage: true });
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    for (const title of ["投资摘要", "项目概览", "融资与估值", "相关材料", "完整正文末尾"]) await page.getByRole("heading", { name: title, exact: true }).waitFor();
    const renderedProject = await page.locator(".industry-overview-reader").innerText();
    assert.doesNotMatch(renderedProject, /domi_schema|entity_type|project_id|synthetic-a|domi:managed/, "The actual managed-block frontmatter must not leak into the project page");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByRole("complementary").count(), 0);
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).count(), 0);
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").at(-1).resource), projectPath);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "industry-project-full-page.png"), fullPage: true });
    await page.getByRole("button", { name: "返回行业速览", exact: true }).click();
    await page.getByRole("heading", { name: selected.title, exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).inputValue(), selected.path);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: selected.title, exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).inputValue(), selected.path);
  });
  await scenario("encoded-special-paths", async page => {
    const targets = [projectPath, `${library}/3.项目库/中 文 #50% (ASCII)/项目主页.md`, `${library}/3.项目库/字面%23号/项目主页.md`];
    for (const target of targets) {
      const href = encodePath(path.posix.relative(path.posix.dirname(entries[1].path), target));
      const resolved = await page.evaluate(({ href, base }) => window.__industryTest.localMarkdownTarget(href, base), { href, base: entries[1].path });
      assert.equal(resolved, target, "Chinese, spaces, hashes, percent signs and parentheses must survive exactly one decode");
    }
  });
  await scenario("office-attachments-use-native-opener-and-pdf-keeps-preview", async page => {
    const attachments = [
      { label: "演示材料 PPTX", name: "BP 演示 #100%（样例）.pptx", native: true },
      { label: "财务数据 XLSX", name: "Datapack 数据 #50% (样例).xlsx", native: true },
      { label: "研究报告 PDF", name: "研究 报告 #100%（样例）.pdf", native: false }
    ].map(item => ({ ...item, target: path.posix.join(path.posix.dirname(projectPath), "原始材料", item.name) }));
    const links = attachments.map(item => `- [${item.label}](${encodePath(path.posix.relative(path.posix.dirname(projectPath), item.target))})`).join("\n");
    await page.evaluate(({ projectPath, links }) => { window.__industryTest.docs[projectPath] += "\n\n" + links; }, { projectPath, links });
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    const readsBefore = await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length);
    for (const item of attachments) {
      await page.getByRole("link", { name: item.label, exact: true }).click();
      const calls = await page.evaluate(() => window.__industryTest.calls);
      assert.equal(calls.filter(call => call.kind === "readMarkdown").length, readsBefore, "Binary attachments must never enter the Markdown reader");
      if (item.native) {
        assert.equal(calls.filter(call => call.kind === "openResource" && call.resource === item.target).length, 1, `${item.name} must use the native resource opener`);
        assert.equal(calls.filter(call => call.kind === "onOpenAttachment").length, 0, "Office attachments must not reach the App PDF/Markdown preview callback");
      } else {
        assert.deepEqual(calls.filter(call => call.kind === "onOpenAttachment").map(call => call.resource), [item.target], "PDF must retain the App preview callback");
        assert.equal(calls.filter(call => call.kind === "openResource" && call.resource === item.target).length, 0);
      }
      await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "返回行业速览", exact: true }).click();
    await page.getByRole("heading", { name: entries[0].title, exact: true }).waitFor();
  });
  await scenario("industry-read-failure-keeps-selector", async page => {
    await page.evaluate(failed => window.__industryTest.failPaths.push(failed), entries[2].path);
    await page.getByRole("combobox", { name: "选择行业" }).selectOption(entries[2].path);
    await page.getByRole("alert").getByText("合成文档读取失败，文件仍保留", { exact: true }).waitFor();
    const selector = page.getByRole("combobox", { name: "选择行业" });
    assert.equal(await selector.isVisible(), true, "An unreadable industry must not trap the user in a false project detail view");
    await selector.selectOption(entries[0].path);
    await page.getByRole("heading", { name: entries[0].title, exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
  });
  await scenario("initial-read-failure-recovers", async page => {
    await page.getByRole("alert").waitFor();
    await page.getByRole("combobox", { name: "选择行业" }).selectOption(entries[1].path);
    await page.getByRole("heading", { name: entries[1].title, exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
  }, { mode: "initial-read-failure" });
  await scenario("project-read-failure-keeps-overview", async page => {
    await page.evaluate(failed => window.__industryTest.failPaths.push(failed), projectPath);
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).isVisible(), true);
    await page.getByRole("heading", { name: entries[0].title, exact: true }).waitFor();
  });
  await scenario("refresh-conflict-preserves-human-content", async page => {
    await page.getByText("1 页有人工修改，已保留，待合并后再更新。 部分资料尚不完整；各行业页已标明缺口。", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
    await page.getByRole("combobox", { name: "选择行业" }).selectOption(entries[1].path);
    await page.getByRole("heading", { name: entries[1].title, exact: true }).waitFor();
    await page.evaluate(() => window.__industryTest.refresh());
    await page.waitForFunction(() => window.__industryTest.calls.filter(call => call.kind === "refreshIndustryOverviews").length === 2);
    await page.getByRole("heading", { name: entries[1].title, exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).inputValue(), entries[1].path);
  }, { mode: "conflict" });
  await scenario("refresh-failure-preserves-navigation", async page => {
    await page.evaluate(() => { window.__industryTest.refreshFailure = true; window.__industryTest.refresh(); });
    await page.getByRole("alert").getByText("合成刷新失败，原资料仍保留", { exact: true }).waitFor();
    await page.getByRole("combobox", { name: "选择行业" }).selectOption(entries[1].path);
    await page.getByRole("heading", { name: entries[1].title, exact: true }).waitFor();
  });
  await scenario("safe-line-breaks-without-raw-html", async page => {
    await page.evaluate(selected => {
      window.__industryTest.docs[selected] += '\n\n| 安全换行 | 内容 |\n| --- | --- |\n| 第一行<br>第二行<br />第三行 | 保留内容 |\n\n<img src="https://invalid.example/blocked.png" onerror="window.__industryHtmlExecuted=true">\n\n<script>window.__industryHtmlExecuted=true</script>\n';
      window.__industryTest.refresh();
    }, entries[0].path);
    await page.getByRole("columnheader", { name: "安全换行", exact: true }).waitFor();
    const table = page.locator(".industry-overview-table").last();
    assert.equal(await table.locator("br").count(), 2, "Generated table line breaks must remain readable");
    assert.equal(await table.getByRole("cell", { name: "第一行 第二行 第三行", exact: true }).count(), 1);
    assert.equal(await page.locator(".industry-overview-reader img, .industry-overview-reader script, .industry-overview-reader [onerror]").count(), 0, "Supporting br must not enable arbitrary raw HTML");
    assert.equal(await page.evaluate(() => window.__industryHtmlExecuted), undefined);
  });
  await scenario("empty-library", async page => {
    await page.getByText("当前资料库尚无行业速览。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("combobox", { name: "选择行业" }).locator("option").textContent(), "暂无行业资料");
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), 0);
  }, { mode: "empty-library" });
  for (const width of [320, 390, 744]) await scenario(`narrow-${width}`, async page => {
    const dimensions = await page.evaluate(() => {
      const reader = document.querySelector(".industry-overview-reader");
      const table = document.querySelector(".industry-overview-table");
      return { viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        reader: reader.clientWidth, readerScroll: reader.scrollWidth, table: table.clientWidth, tableScroll: table.scrollWidth };
    });
    assert(dimensions.page <= width + 1 && dimensions.body <= width + 1, JSON.stringify(dimensions));
    assert(dimensions.readerScroll <= dimensions.reader + 1, "Only the table may scroll horizontally: " + JSON.stringify(dimensions));
    assert(dimensions.tableScroll >= dimensions.table);
    if (width < 620) assert(dimensions.tableScroll > dimensions.table, "Narrow tables must retain usable columns through internal scrolling");
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `industry-overview-${width}.png`), fullPage: true });
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await page.getByRole("button", { name: "返回行业速览", exact: true }).click();
    await page.getByRole("heading", { name: entries[0].title, exact: true }).waitFor();
  }, { width });
  const report = { ok: results.every(result => result.passed), scenarios: results.length, realProfileAccessed: false, externalNetworkUsed: false, results };
  if (screenshotDir) await fs.writeFile(path.join(screenshotDir, "industry-overview-ui-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, `${results.filter(result => !result.passed).length} industry overview scenarios failed`);
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
