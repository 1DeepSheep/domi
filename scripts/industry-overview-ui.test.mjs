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
  ["半导体", "设计工具", 1], ["消费", "", 1], ["新能源", "", 0],
  ["AI", "设计工具", 0]
].map(([domain, subdomain, projectCount]) => ({ domain, subdomain, projectCount,
  title: `${subdomain || domain}行业速览`, path: `${library}/1.行业研究/${domain}/${subdomain ? `${subdomain}/` : ""}行业速览.md` }));
const domains = entries.filter(entry => !entry.subdomain);
const ai = entries[0];
const aiData = entries[1];
const semiconductor = entries[2];
const indexPath = `${library}/1.行业研究/行业总览.md`;
const companyName = "合成数研 A #100%（测试）";
const projectPath = `${library}/3.项目库/AI/AI 数据/${companyName}/项目主页.md`;
const materialPath = `${library}/3.项目库/AI/AI 数据/${companyName}/研究/完整研究 #50%.md`;
const encodePath = value => value.split("/").map(segment => encodeURIComponent(segment).replace(/[()]/g, value => `%${value.charCodeAt(0).toString(16)}`)).join("/");
const headers = ["公司／方向", "关键进展", "融资／估值", "投资判断", "跟进／资料日期"];
function overviewContent(entry) {
  const link = encodePath(path.posix.relative(path.posix.dirname(entry.path), projectPath));
  return `# ${entry.title}\n\n> 以下为界面测试的合成数据，不是真实投资结论。\n\n## 行业现状\n\n${entry.domain}：需求由试点向付费交付发展；头部与垂直团队并存。\n\n## 近期变化与风险\n\n测试资料截至 2026-09-01：客户复购与交付成本仍需核实。\n\n## 项目对照\n\n${entry.projectCount ? `| ${headers.join(" | ")} |\n| --- | --- | --- | --- | --- |\n| [${companyName}](${link}) · 模型数据质量工具 | 已完成 3 家付费客户试点；复购待核实。 | Pre-A；公司称拟融资 500 万美元；尚未完成。 | A 级；质量评估能力有优势，收入集中度待核实。 | 已交流；业务资料截至 2026-09-01。 |\n| 合成项目 B · 垂直数据服务 | 客户验收完成，收入数据待补充。 | 轮次、估值待补充。 | 现有评级 B；规模化成本待核实。 | 跟进中；资料日期待核实。 |` : "当前行业暂无已关联项目。"}\n\n## 研究依据\n\n本测试使用合成材料，正文保留来源与缺口说明。\n\n${Array.from({ length: 15 }, (_, i) => `第 ${i + 1} 条研究补充：行业判断保留在当前页面，完整项目材料从公司名进入。`).join("\n\n")}`;
}
const projectContent = `<!-- domi:managed:start -->\n---\ndomi_schema: 7\nentity_type: project\nproject_id: synthetic-a\n---\n\n# ${companyName}\n\n## 投资摘要\n\n这是完整项目主页的合成正文，不是预览卡片。\n\n## 项目概览\n\n产品为模型数据质量工具，核心团队拥有数据工程交付经验。\n\n## 融资与估值\n\nPre-A 为融资计划，尚未完成。\n\n## 相关材料\n\n完整项目原始材料保留在唯一项目目录。\n\n## 完整正文末尾\n\n客户复购、单客收入和交付成本需要继续核实。\n<!-- domi:managed:end -->`;
const docs = Object.fromEntries(entries.map(entry => [entry.path, overviewContent(entry)]));
docs[projectPath] = projectContent + `\n\n[完整研究材料](${encodePath(path.posix.relative(path.posix.dirname(projectPath), materialPath))})\n`;
docs[materialPath] = "# 完整研究材料\n\n这是项目的完整研究正文，返回时应保留进入项目的行业。";
const fixtureNow = Date.now();
const dayMs = 24 * 60 * 60 * 1000;
const news = [
  ["data", "合成 AI 数据动态", "AI", "AI 数据", fixtureNow - dayMs],
  ["ai-design", "合成 AI 设计工具动态", "AI", "设计工具", fixtureNow - 2 * dayMs],
  ["chip-design", "合成半导体设计工具动态", "半导体", "设计工具", fixtureNow - 3 * dayMs],
  ["consumer", "合成消费动态", "消费", "", fixtureNow - 4 * dayMs],
  ["future", "不应展示的未来动态", "AI", "AI 数据", fixtureNow + dayMs],
  ["expired", "不应展示的过期动态", "AI", "AI 数据", fixtureNow - 31 * dayMs],
  ["undated", "不应展示的无日期动态", "AI", "AI 数据", null],
  ["ignored", "不应展示的无需关注动态", "AI", "AI 数据", fixtureNow - dayMs, false]
].map(([recordId, title, domain, subdomain, publishedAt, worthFollowing = true]) => ({ recordId, title,
  domains: [domain], subdomains: subdomain ? [subdomain] : [], publishedAt, worthFollowing, source: "合成信源",
  url: `https://example.test/news/${recordId}`, types: [], summary: "", investmentMeaning: "", companies: "",
  institutions: "", importance: 7, confidence: 8, evidenceStatus: "已核验", action: "跟踪" }));
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
const entries = ${JSON.stringify(entries)};
const docs = ${JSON.stringify(docs)};
const news = ${JSON.stringify(news)};
const indexPath = ${JSON.stringify(indexPath)};
const mode = new URL(location.href).searchParams.get("mode") || "ready";
const state = window.__industryTest = { calls: [], entries, docs, news, mode, failPaths: [], refreshFailure: mode === "initial-refresh-failure", pending: {}, deferredPaths: [], deferRefresh: mode === "initial-catalog-delay", pendingRefresh: [], refresh: null };
const bridge = {
  refreshIndustryOverviews: async () => {
    const call = { kind: "refreshIndustryOverviews", settled: false }; state.calls.push(call);
    const response = state.refreshFailure ? { ok: false, entries: [], error: "合成刷新失败，原资料仍保留" }
      : mode === "conflict" ? { ok: false, entries: [...state.entries], indexPath, conflicts: [{ path: entries[0].path }], warnings: ["合成资料缺口"] }
      : { ok: true, entries: mode === "empty-library" ? [] : [...state.entries], indexPath, projectCount: 4 };
    if (state.deferRefresh) await new Promise(resolve => state.pendingRefresh.push(resolve));
    call.settled = true; return response;
  },
  readMarkdown: async ({ resource }) => {
    const call = { kind: "readMarkdown", resource, settled: false }; state.calls.push(call);
    const response = state.failPaths.includes(resource) ? { ok: false, error: "合成文档读取失败，文件仍保留" }
      : !Object.hasOwn(state.docs, resource) ? { ok: false, error: "合成路径不存在：" + resource }
      : { ok: true, document: { path: resource, name: resource.split("/").pop(), content: state.docs[resource], mtimeMs: 1234 } };
    if (state.deferredPaths.includes(resource)) await new Promise(resolve => { (state.pending[resource] ||= []).push(resolve); });
    call.settled = true; return response;
  },
  openResource: async resource => { state.calls.push({ kind: "openResource", resource }); return { ok: true }; }
};
window.workbench = new Proxy(bridge, { get(target, name) {
  if (name in target) return target[name];
  return (...args) => { state.calls.push({ kind: String(name), args }); throw new Error("Unexpected bridge call: " + String(name)); };
} });
const { default: IndustryOverview, localMarkdownTarget, industryNews } = await import("/src/IndustryOverview");
state.localMarkdownTarget = localMarkdownTarget;
state.industryNews = industryNews;
function Harness() {
  const [refreshKey, setRefreshKey] = useState(0);
  state.refresh = () => setRefreshKey(key => key + 1);
  return <IndustryOverview refreshKey={refreshKey} news={news} onOpenAttachment={resource => { state.calls.push({ kind: "onOpenAttachment", resource }); }} />;
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
    await context.addInitScript(saved => localStorage.setItem("domi.industryOverview.selection.v1", saved), aiData.path);
    const page = await context.newPage(); page.setDefaultTimeout(4_000);
    const errors = []; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${origin}/?mode=${mode}`, { waitUntil: "networkidle" });
    await page.getByRole("region", { name: "行业看板", exact: true }).waitFor();
    if (mode !== "initial-catalog-delay") await page.waitForFunction(() => document.querySelector(".industry-overview-reader")?.getAttribute("aria-busy") === "false");
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
  async function idle(page) {
    await page.waitForFunction(() => document.querySelector(".industry-overview-reader")?.getAttribute("aria-busy") === "false");
  }
  const breadcrumb = page => page.getByRole("navigation", { name: "行业浏览路径", exact: true });
  async function home(page) {
    await breadcrumb(page).getByRole("button", { name: "全行业总览", exact: true }).click();
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    await idle(page);
  }
  async function enterDomain(page, domain = ai.domain) {
    await page.getByRole("button", { name: `查看${domain}行业`, exact: true }).click();
    await page.getByRole("heading", { name: `${domain}行业概况`, exact: true }).waitFor();
    await idle(page);
  }
  async function enterSubdomain(page, entry = aiData) {
    await enterDomain(page, entry.domain);
    await page.getByRole("button", { name: `查看${entry.subdomain}行业`, exact: true }).click();
    await page.getByRole("heading", { name: `${entry.subdomain}行业概况`, exact: true }).waitFor();
    await idle(page);
  }
  async function enterProject(page) {
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await idle(page);
  }
  async function refresh(page) {
    const previous = await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "refreshIndustryOverviews").length);
    await page.evaluate(() => window.__industryTest.refresh());
    await page.waitForFunction(previous => window.__industryTest.calls.filter(call => call.kind === "refreshIndustryOverviews").length > previous, previous);
    await idle(page);
  }
  async function releaseRead(page, resource) {
    await page.evaluate(resource => {
      const state = window.__industryTest;
      state.deferredPaths = state.deferredPaths.filter(value => value !== resource);
      for (const resolve of state.pending[resource] || []) resolve();
      delete state.pending[resource];
    }, resource);
    await page.waitForFunction(resource => window.__industryTest.calls.filter(call => call.kind === "readMarkdown" && call.resource === resource).every(call => call.settled), resource);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }
  await scenario("all-industries-start-page-and-counts", async page => {
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    assert.equal(await page.locator("select").count(), 0, "Hierarchy navigation must not use a select");
    for (const entry of domains) {
      const card = page.getByRole("button", { name: `查看${entry.domain}行业`, exact: true });
      assert.equal(await card.isVisible(), true);
      const text = await card.innerText();
      const childCount = entries.filter(child => child.domain === entry.domain && child.subdomain).length;
      assert.match(text, new RegExp(`${entry.projectCount}\\s*(?:个)?项目`), "Each top-level card shows its own project count");
      assert.match(text, new RegExp(`${childCount}\\s*(?:个)?子行业`), "Each top-level card shows its own subindustry count");
    }
    assert.equal(await page.getByRole("button", { name: "查看AI 数据行业", exact: true }).count(), 0, "Subindustries belong under their parent");
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), 0, "Home must not read an old saved industry");
    assert.doesNotMatch(await page.locator(".industry-overview-reader").innerText(), /需求由试点向付费交付发展|头部与垂直团队并存/, "Home must not invent trends from an arbitrary industry");
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "industry-dashboard-wide.png"), fullPage: true });
    await enterSubdomain(page);
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), 0, "Reload starts at home despite old localStorage");
  });
  await scenario("hierarchy-and-five-columns-preserve-research", async page => {
    for (const entry of domains) {
      await enterDomain(page, entry.domain);
      assert.equal(await breadcrumb(page).getByRole("button", { name: "全行业总览", exact: true }).isVisible(), true);
      for (const child of entries.filter(child => child.domain === entry.domain && child.subdomain)) assert.equal(await page.getByRole("button", { name: `查看${child.subdomain}行业`, exact: true }).isVisible(), true);
      await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
      if (screenshotDir && entry === ai) await page.screenshot({ path: path.join(screenshotDir, "industry-domain-wide.png"), fullPage: true });
      await page.getByText(`${entry.domain}：需求由试点向付费交付发展；头部与垂直团队并存。`, { exact: true }).waitFor();
      if (entry.projectCount) {
        assert.deepEqual(await page.locator(".industry-overview-table th").allTextContents(), headers);
        const row = page.locator(".industry-overview-table tbody tr").first();
        for (const fact of ["已完成 3 家付费客户试点", "Pre-A", "尚未完成", "A 级", "2026-09-01"]) assert((await row.textContent()).includes(fact), fact);
      } else await page.getByText("当前行业暂无已关联项目。", { exact: true }).waitFor();
      assert.equal(await page.locator("select").count(), 0);
      await home(page);
    }
    await enterSubdomain(page);
    await breadcrumb(page).getByRole("button", { name: "AI", exact: true }).click();
    await page.getByRole("heading", { name: "AI行业概况", exact: true }).waitFor();
  });
  await scenario("project-path-roundtrip-and-nested-material", async page => {
    await enterSubdomain(page);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "industry-overview-wide.png"), fullPage: true });
    await enterProject(page);
    for (const title of ["投资摘要", "项目概览", "融资与估值", "相关材料", "完整正文末尾"]) await page.getByRole("heading", { name: title, exact: true }).waitFor();
    assert.doesNotMatch(await page.locator(".industry-overview-reader").innerText(), /domi_schema|entity_type|project_id|synthetic-a|domi:managed/, "Managed-block metadata must not leak into project content");
    assert.equal(await page.getByRole("dialog").count(), 0);
    assert.equal(await page.getByRole("complementary").count(), 0);
    assert.equal(await page.locator("select").count(), 0);
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").at(-1).resource), projectPath);
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, "industry-project-full-page.png"), fullPage: true });
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
    await enterProject(page);
    await page.getByRole("link", { name: "完整研究材料", exact: true }).click();
    await page.getByRole("heading", { name: "完整研究材料", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").at(-1).resource), materialPath);
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
    await breadcrumb(page).getByRole("button", { name: "AI", exact: true }).click();
    await page.getByRole("heading", { name: "AI行业概况", exact: true }).waitFor();
    await enterProject(page);
    await page.getByRole("button", { name: "返回AI", exact: true }).click();
    await page.getByRole("heading", { name: "AI行业概况", exact: true }).waitFor();
  });
  await scenario("same-named-subindustries-keep-parent-identity", async page => {
    for (const entry of entries.filter(entry => entry.subdomain === "设计工具")) {
      await enterSubdomain(page, entry);
      await page.getByText(`${entry.domain}：需求由试点向付费交付发展；头部与垂直团队并存。`, { exact: true }).waitFor();
      assert.equal(await breadcrumb(page).getByRole("button", { name: entry.domain, exact: true }).isVisible(), true);
      assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").at(-1).resource), entry.path);
      await home(page);
    }
  });
  await scenario("home-navigation-does-not-cancel-initial-catalog", async page => {
    await page.waitForFunction(() => window.__industryTest.pendingRefresh.length === 1);
    await home(page);
    await page.evaluate(() => {
      const state = window.__industryTest; state.deferRefresh = false;
      for (const resolve of state.pendingRefresh.splice(0)) resolve();
    });
    await page.getByRole("button", { name: "查看AI行业", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "全行业总览", exact: true }).isVisible(), true);
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), 0);
    await enterDomain(page);
  }, { mode: "initial-catalog-delay" });
  await scenario("recent-news-scope-date-and-source-links", async page => {
    const newsRegion = page.getByRole("region", { name: "近期行业动态", exact: true });
    assert.deepEqual(await newsRegion.getByRole("link").allTextContents(), news.slice(0, 4).map(item => item.title));
    assert.doesNotMatch(await page.locator(".industry-overview-reader").innerText(), /不应展示/);
    await enterSubdomain(page);
    assert.deepEqual(await newsRegion.getByRole("link").allTextContents(), [news[0].title]);
    await newsRegion.getByRole("link", { name: news[0].title, exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.__industryTest.calls.at(-1)), { kind: "openResource", resource: news[0].url });
    await home(page);
    await enterSubdomain(page, entries[3]);
    assert.deepEqual(await newsRegion.getByRole("link").allTextContents(), [news[2].title], "Same-named subindustries cannot borrow another parent's news");
    await home(page);
    await enterDomain(page, "新能源");
    await newsRegion.getByText("当前资料库暂无该行业的近 30 天动态。", { exact: true }).waitFor();
    const selectedIds = await page.evaluate(({ now, dayMs }) => {
      const state = window.__industryTest; const item = state.news[0];
      return state.industryNews([
        { ...item, recordId: "boundary", publishedAt: now - 30 * dayMs },
        { ...item, recordId: "old", publishedAt: now - 30 * dayMs - 1 },
        { ...item, recordId: "now", publishedAt: now },
        { ...item, recordId: "future", publishedAt: now + 1 },
        { ...item, recordId: "missing", publishedAt: null },
        { ...item, recordId: "invalid", publishedAt: Number.NaN },
        { ...item, recordId: "ignored", publishedAt: now, worthFollowing: false },
        { ...item, recordId: "wrong-domain", publishedAt: now, domains: ["半导体"] },
        { ...item, recordId: "now", publishedAt: now }
      ], state.entries[1], now).map(item => item.recordId);
    }, { now: fixtureNow, dayMs });
    assert.deepEqual(selectedIds, ["now", "boundary"], "30-day window includes the boundary, excludes future/unknown/unwanted news, and deduplicates IDs");
  });
  await scenario("markdown-references-survive-news-insertion", async page => {
    const link = encodePath(path.posix.relative(path.posix.dirname(ai.path), projectPath));
    await page.evaluate(({ resource, link }) => {
      const state = window.__industryTest;
      state.docs[resource] = state.docs[resource].replace("## 项目对照", "跨段[完整项目引用][company-ref]，研究依据[^source]。\n\n## 项目对照")
        + "\n\n[company-ref]: " + link + "\n\n[^source]: 跨段脚注来源保留。\n";
    }, { resource: ai.path, link });
    await enterDomain(page);
    await page.getByRole("link", { name: "完整项目引用", exact: true }).waitFor();
    await page.getByText("跨段脚注来源保留。", { exact: false }).waitFor();
    assert.equal(await page.getByRole("region", { name: "近期行业动态", exact: true }).count(), 1);
    const order = await page.locator(".industry-overview-reader h2").allTextContents();
    assert(order.indexOf("近期动态") < order.indexOf("项目对照"), "Archived news appears before project comparison without splitting the Markdown document");
    await page.getByRole("link", { name: "完整项目引用", exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await page.getByRole("button", { name: "返回AI", exact: true }).click();
    await page.getByRole("heading", { name: "AI行业概况", exact: true }).waitFor();
  });
  await scenario("encoded-special-paths", async page => {
    const targets = [projectPath, `${library}/3.项目库/中 文 #50% (ASCII)/项目主页.md`, `${library}/3.项目库/字面%23号/项目主页.md`];
    for (const target of targets) {
      const href = encodePath(path.posix.relative(path.posix.dirname(aiData.path), target));
      assert.equal(await page.evaluate(({ href, base }) => window.__industryTest.localMarkdownTarget(href, base), { href, base: aiData.path }), target, "Special characters survive exactly one decode");
    }
    for (const href of ["javascript:alert(1)", "data:text/html,bad", "domi://project/example", "//invalid.example/项目主页.md"]) assert.equal(await page.evaluate(({ href, base }) => window.__industryTest.localMarkdownTarget(href, base), { href, base: aiData.path }), "");
  });
  await scenario("office-attachments-use-native-opener-and-pdf-keeps-preview", async page => {
    const attachments = [
      { label: "演示材料 PPTX", name: "BP 演示 #100%（样例）.pptx", native: true },
      { label: "财务数据 XLSX", name: "Datapack 数据 #50% (样例).xlsx", native: true },
      { label: "研究报告 PDF", name: "研究 报告 #100%（样例）.pdf", native: false }
    ].map(item => ({ ...item, target: path.posix.join(path.posix.dirname(projectPath), "原始材料", item.name) }));
    const links = attachments.map(item => `- [${item.label}](${encodePath(path.posix.relative(path.posix.dirname(projectPath), item.target))})`).join("\n");
    await page.evaluate(({ projectPath, links }) => { window.__industryTest.docs[projectPath] += "\n\n" + links; }, { projectPath, links });
    await enterSubdomain(page); await enterProject(page);
    const readsBefore = await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length);
    for (const item of attachments) {
      await page.getByRole("link", { name: item.label, exact: true }).click();
      const calls = await page.evaluate(() => window.__industryTest.calls);
      assert.equal(calls.filter(call => call.kind === "readMarkdown").length, readsBefore, "Binary attachments never enter the Markdown reader");
      if (item.native) {
        assert.equal(calls.filter(call => call.kind === "openResource" && call.resource === item.target).length, 1);
        assert.equal(calls.filter(call => call.kind === "onOpenAttachment").length, 0, "Office files must not reach the PDF preview callback");
      } else {
        assert.deepEqual(calls.filter(call => call.kind === "onOpenAttachment").map(call => call.resource), [item.target]);
        assert.equal(calls.filter(call => call.kind === "openResource" && call.resource === item.target).length, 0);
      }
      await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    }
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
  });
  await scenario("industry-read-failure-keeps-breadcrumb-and-retry", async page => {
    await page.evaluate(failed => window.__industryTest.failPaths.push(failed), semiconductor.path);
    await page.getByRole("button", { name: "查看半导体行业", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "合成文档读取失败，文件仍保留" }).waitFor();
    assert.equal(await breadcrumb(page).getByRole("button", { name: "全行业总览", exact: true }).isVisible(), true);
    await page.evaluate(() => { window.__industryTest.failPaths = []; });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByText("半导体：需求由试点向付费交付发展；头部与垂直团队并存。", { exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
    await home(page); await enterDomain(page);
  });
  await scenario("subindustry-read-failure-can-return-to-parent", async page => {
    await enterDomain(page);
    await page.evaluate(failed => window.__industryTest.failPaths.push(failed), aiData.path);
    await page.getByRole("button", { name: "查看AI 数据行业", exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await page.getByRole("button", { name: "重试", exact: true }).isVisible(), true);
    await breadcrumb(page).getByRole("button", { name: "AI", exact: true }).click();
    await page.getByRole("heading", { name: "AI行业概况", exact: true }).waitFor();
    await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
    assert.equal(await page.getByRole("alert").count(), 0);
  });
  await scenario("initial-refresh-failure-recovers", async page => {
    await page.getByRole("alert").filter({ hasText: "合成刷新失败，原资料仍保留" }).waitFor();
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    await page.evaluate(() => { window.__industryTest.refreshFailure = false; });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("button", { name: "查看AI行业", exact: true }).waitFor();
    await enterDomain(page);
    assert.equal(await page.getByRole("alert").count(), 0);
  }, { mode: "initial-refresh-failure" });
  await scenario("project-read-failure-retries-and-retains-origin", async page => {
    await enterSubdomain(page);
    await page.evaluate(failed => window.__industryTest.failPaths.push(failed), projectPath);
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.getByRole("alert").waitFor();
    assert.equal(await breadcrumb(page).getByRole("button", { name: "全行业总览", exact: true }).isVisible(), true);
    await page.evaluate(() => { window.__industryTest.failPaths = []; });
    await page.getByRole("button", { name: "重试", exact: true }).click();
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
  });
  await scenario("refresh-conflict-preserves-content-and-current-route", async page => {
    await page.getByText("1 页有人工修改，已保留，待合并后再更新。", { exact: true }).waitFor();
    await enterSubdomain(page);
    await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
    await refresh(page);
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
    await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
    await enterProject(page); await refresh(page);
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
  }, { mode: "conflict" });
  await scenario("refresh-failure-preserves-navigation", async page => {
    await enterSubdomain(page);
    await page.evaluate(() => { window.__industryTest.refreshFailure = true; });
    await refresh(page);
    await page.getByRole("alert").filter({ hasText: "合成刷新失败，原资料仍保留" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "重试", exact: true }).isVisible(), true);
    await home(page); await enterDomain(page, semiconductor.domain);
    await page.getByRole("heading", { name: "研究依据", exact: true }).waitFor();
  });
  await scenario("late-industry-read-cannot-replace-new-route", async page => {
    await page.evaluate(resource => window.__industryTest.deferredPaths.push(resource), ai.path);
    await page.getByRole("button", { name: "查看AI行业", exact: true }).click();
    await page.waitForFunction(resource => window.__industryTest.pending[resource]?.length === 1, ai.path);
    await home(page); await enterDomain(page, semiconductor.domain);
    await releaseRead(page, ai.path);
    await page.getByRole("heading", { name: "半导体行业概况", exact: true }).waitFor();
    await page.getByText("半导体：需求由试点向付费交付发展；头部与垂直团队并存。", { exact: true }).waitFor();
    assert.equal(await page.getByText("AI：需求由试点向付费交付发展；头部与垂直团队并存。", { exact: true }).count(), 0);
  });
  await scenario("late-project-read-cannot-reopen-after-return-home", async page => {
    await enterSubdomain(page);
    await page.evaluate(resource => window.__industryTest.deferredPaths.push(resource), projectPath);
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.waitForFunction(resource => window.__industryTest.pending[resource]?.length === 1, projectPath);
    await home(page); await releaseRead(page, projectPath);
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: companyName, exact: true }).count(), 0);
  });
  await scenario("late-refresh-cannot-restore-abandoned-industry", async page => {
    await enterSubdomain(page);
    await page.evaluate(() => { window.__industryTest.deferRefresh = true; window.__industryTest.refresh(); });
    await page.waitForFunction(() => window.__industryTest.pendingRefresh.length === 1);
    await home(page); await enterDomain(page, semiconductor.domain);
    await page.evaluate(() => {
      const state = window.__industryTest; state.deferRefresh = false;
      for (const resolve of state.pendingRefresh.splice(0)) resolve();
    });
    await page.waitForFunction(() => window.__industryTest.calls.filter(call => call.kind === "refreshIndustryOverviews").every(call => call.settled));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await idle(page);
    await page.getByRole("heading", { name: "半导体行业概况", exact: true }).waitFor();
    await page.getByText("半导体：需求由试点向付费交付发展；头部与垂直团队并存。", { exact: true }).waitFor();
  });
  await scenario("catalog-return-does-not-cancel-pending-company-navigation", async page => {
    await enterDomain(page);
    await page.evaluate(() => { window.__industryTest.deferRefresh = true; window.__industryTest.refresh(); });
    await page.waitForFunction(() => window.__industryTest.pendingRefresh.length === 1);
    await page.getByRole("button", { name: "查看AI 数据行业", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
    await idle(page);
    await page.evaluate(resource => window.__industryTest.deferredPaths.push(resource), projectPath);
    await page.getByRole("link", { name: companyName, exact: true }).click();
    await page.waitForFunction(resource => window.__industryTest.pending[resource]?.length === 1, projectPath);
    const readsBefore = await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length);
    await page.evaluate(() => {
      const state = window.__industryTest; state.deferRefresh = false;
      for (const resolve of state.pendingRefresh.splice(0)) resolve();
    });
    await page.waitForFunction(() => window.__industryTest.calls.filter(call => call.kind === "refreshIndustryOverviews").every(call => call.settled));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), readsBefore,
      "A catalog result must not issue a competing read after the user starts navigating");
    await releaseRead(page, projectPath);
    await page.getByRole("heading", { name: companyName, exact: true }).waitFor();
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
  });
  await scenario("safe-line-breaks-and-links-without-raw-html", async page => {
    await page.evaluate(selected => {
      window.__industryTest.docs[selected] += '\n\n| 安全换行 | 内容 |\n| --- | --- |\n| 第一行<br>第二行<br />第三行 | 保留内容 |\n\n<img src="https://invalid.example/blocked.png" onerror="window.__industryHtmlExecuted=true">\n\n<script>window.__industryHtmlExecuted=true</script>\n\n[危险脚本](javascript:window.__industryHtmlExecuted=true)\n\n[网络路径](//invalid.example/blocked.md)\n\n[官网](https://example.test/research)\n';
    }, ai.path);
    await enterDomain(page);
    await page.getByRole("columnheader", { name: "安全换行", exact: true }).waitFor();
    const table = page.locator(".industry-overview-table").last();
    assert.equal(await table.locator("br").count(), 2, "Generated table line breaks remain readable");
    assert.equal(await table.getByRole("cell", { name: "第一行 第二行 第三行", exact: true }).count(), 1);
    assert.equal(await page.locator(".industry-overview-reader img, .industry-overview-reader script, .industry-overview-reader [onerror]").count(), 0, "br support must not enable arbitrary HTML");
    const before = await page.evaluate(() => window.__industryTest.calls.length);
    await page.getByText("危险脚本", { exact: true }).click();
    await page.getByRole("link", { name: "网络路径", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__industryTest.calls.length), before, "Unsafe links never reach the native bridge");
    assert.equal(await page.evaluate(() => window.__industryHtmlExecuted), undefined);
    await page.getByRole("link", { name: "官网", exact: true }).click();
    assert.equal(await page.evaluate(() => window.__industryTest.calls.at(-1).kind), "openResource");
    assert.equal(await page.evaluate(() => window.__industryTest.calls.at(-1).resource), "https://example.test/research");
  });
  await scenario("empty-library", async page => {
    await page.getByRole("heading", { name: "全行业总览", exact: true }).waitFor();
    await page.getByText(/当前资料库尚无行业/).waitFor();
    assert.equal(await page.locator("select").count(), 0);
    assert.equal(await page.getByRole("button", { name: /^查看.+行业$/ }).count(), 0);
    assert.equal(await page.evaluate(() => window.__industryTest.calls.filter(call => call.kind === "readMarkdown").length), 0);
  }, { mode: "empty-library" });
  for (const width of [320, 390, 744]) await scenario(`narrow-${width}`, async page => {
    const homeDimensions = await page.evaluate(() => ({ viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
    assert(homeDimensions.page <= width + 1 && homeDimensions.body <= width + 1, "Home cards fit narrow windows: " + JSON.stringify(homeDimensions));
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `industry-dashboard-${width}.png`), fullPage: true });
    await enterSubdomain(page);
    const dimensions = await page.evaluate(() => {
      const reader = document.querySelector(".industry-overview-reader"); const table = document.querySelector(".industry-overview-table");
      return { viewport: innerWidth, page: document.documentElement.scrollWidth, body: document.body.scrollWidth,
        reader: reader.clientWidth, readerScroll: reader.scrollWidth, table: table.clientWidth, tableScroll: table.scrollWidth };
    });
    assert(dimensions.page <= width + 1 && dimensions.body <= width + 1, JSON.stringify(dimensions));
    assert(dimensions.readerScroll <= dimensions.reader + 1, "Only the table scrolls horizontally: " + JSON.stringify(dimensions));
    assert(dimensions.tableScroll >= dimensions.table);
    if (width < 620) assert(dimensions.tableScroll > dimensions.table, "Narrow tables retain usable columns with internal scrolling");
    if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, `industry-overview-${width}.png`), fullPage: true });
    await enterProject(page);
    await page.getByRole("button", { name: "返回AI 数据", exact: true }).click();
    await page.getByRole("heading", { name: "AI 数据行业概况", exact: true }).waitFor();
    await home(page);
  }, { width });
  const report = { ok: results.every(result => result.passed), scenarios: results.length, realProfileAccessed: false, externalNetworkUsed: false, results };
  if (screenshotDir) await fs.writeFile(path.join(screenshotDir, "industry-overview-ui-results.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  assert.equal(report.ok, true, `${results.filter(result => !result.passed).length} industry overview scenarios failed`);
} finally {
  await Promise.all(contexts.map(context => context.close().catch(() => undefined)));
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
