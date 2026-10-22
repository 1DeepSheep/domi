import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// The actual panel with an in-memory bridge. Network calls outside the local
// Vite fixture are blocked, and no Electron, user library or model is invoked.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-underwater-ui-"));
const screenshots = process.env.DOMI_SOURCING_SCREENSHOTS_DIR;
if (screenshots) await fs.mkdir(screenshots, { recursive: true });
const fixture = "/__underwater_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import UnderwaterPanel from "/src/components/UnderwaterPanel";
import { previewSourcingSnapshot } from "/src/sourcing-preview";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const state = window.__underwaterTest = { calls: [], failSave: false, holdSave: false };
function Fixture() {
  const [snapshot, setSnapshot] = useState(structuredClone(previewSourcingSnapshot));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  state.snapshot = snapshot;
  state.setSnapshot = value => setSnapshot(value);
  state.setLoading = value => setLoading(value);
  state.setError = value => setError(value);
  const save = async (kind, value) => {
    state.calls.push({ kind, value: structuredClone(value) });
    if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
    if (state.failSave) throw new Error("合成保存失败，请重试");
    setSnapshot(current => kind === "settings" ? { ...current, settings: { ...current.settings, ...value } } : kind === "focuses" ? { ...current, focuses: value } : { ...current, sources: value });
  };
  return <UnderwaterPanel snapshot={snapshot} loading={loading} error={error} preview
    onRefresh={() => state.calls.push({ kind: "refresh" })}
    onRun={() => { state.calls.push({ kind: "run" }); setSnapshot(current => ({ ...current, run: { ...current.run, status: "running" } })); }}
    onSaveSettings={value => save("settings", value)} onSaveSources={value => save("sources", value)} onSaveFocuses={value => save("focuses", value)}
    onOpenUrl={value => state.calls.push({ kind: "url", value })}
    onOpenRecord={(type, id) => state.calls.push({ kind: "record", value: { type, id } })} />;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;
let server;
let browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" }, optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "underwater-fixture", resolveId(id) { if (id === fixture) return resolvedFixture; }, load(id) { if (id === resolvedFixture) return source; }, configureServer(vite) { vite.middlewares.use((request, response, next) => {
      if (request.url !== "/") return next(); response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
    }); } }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1187, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  page.setDefaultTimeout(15000);
  await page.goto(origin);
  await page.getByRole("heading", { name: "水下项目", exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator(".uw-candidate").count(), 5);
  assert.equal(await page.locator(".uw-summary-grid").count(), 0, "Counts are shown once in filters");
  assert.ok((await page.locator(".uw-candidate").first().boundingBox()).y < 330, "First result is visible without a large summary dashboard");
  if (screenshots) await page.screenshot({ path: path.join(screenshots, "underwater-panel.png") });
  for (const width of [1187, 1027, 760]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector(".uw-page-scroll").scrollWidth > document.querySelector(".uw-page-scroll").clientWidth + 1), false, `No horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1187, height: 900 });
  await page.getByRole("button", { name: "待核验 3", exact: true }).click();
  assert.equal(await page.locator(".uw-candidate").count(), 3);
  await page.getByRole("button", { name: "已入库 2", exact: true }).click();
  assert.equal(await page.locator(".uw-candidate").count(), 2);
  await page.getByRole("button", { name: "全部 5", exact: true }).click();
  await page.getByRole("textbox", { name: "搜索项目、创始人" }).fill("许牧天");
  assert.equal(await page.locator(".uw-candidate").count(), 1);
  await page.getByRole("button", { name: "清空搜索" }).click();
  await page.getByRole("combobox", { name: "发现路径", exact: true }).selectOption("lab");
  assert.equal(await page.locator(".uw-candidate").count(), 1);
  await page.getByRole("combobox", { name: "发现路径", exact: true }).selectOption("all");
  // Contact and research context use explicit library identities and grounded evidence.
  await page.getByRole("button", { name: "查看 示例项目·研究助手 的联系路径", exact: true }).click();
  const contextDialog = page.getByRole("dialog", { name: "示例项目·研究助手", exact: true });
  await contextDialog.waitFor();
  assert.deepEqual(await contextDialog.locator("section > h3").allTextContents().then(headings => headings.slice(0, 3)), ["可以通过谁联系2 条线索", "与已有项目和方向的关联2 项", "为什么发现这条线索"]);
  assert.equal(await contextDialog.getByText("有库内关系依据", { exact: true }).count(), 1);
  assert.equal(await contextDialog.getByText("公开关系待确认", { exact: true }).count(), 1);
  await contextDialog.getByText("以下是可先询问的路径，关系与引荐意愿仍需确认。", { exact: true }).waitFor();
  assert.equal(await contextDialog.locator(".uw-contact-card").count(), 2);
  assert.equal(await contextDialog.locator(".uw-research-card").count(), 2);
  await contextDialog.getByText("相似产品", { exact: true }).waitFor();
  await contextDialog.getByText("同一研究方向", { exact: true }).waitFor();
  await contextDialog.getByText("研究助手聚焦学术文献与研究计划；知识助手侧重企业内部文档和团队知识协作。", { exact: true }).waitFor();
  await contextDialog.getByText("知识助手的产品负责人", { exact: true }).waitFor();
  await contextDialog.getByRole("button", { name: "打开人脉档案 示例联系人·陈女士", exact: true }).first().click();
  const firstEvidence = contextDialog.locator(".uw-contact-card").first().locator("summary");
  await firstEvidence.focus();
  await page.keyboard.press("Enter");
  assert.equal(await contextDialog.locator(".uw-contact-card").first().locator("details").getAttribute("open"), "");
  await contextDialog.locator(".uw-contact-card").first().getByRole("button", { name: "打开人脉档案 示例联系人·陈女士", exact: true }).last().click();
  const publicPath = contextDialog.locator(".uw-contact-card").nth(1);
  await publicPath.locator("summary").click();
  await publicPath.getByRole("button", { name: "打开项目档案 示例项目·知识助手", exact: true }).last().click();
  await publicPath.getByRole("button", { name: "公开来源 example.com", exact: true }).click();
  await contextDialog.locator(".uw-research-card").first().getByRole("button", { name: "打开项目档案 示例项目·知识助手", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__underwaterTest.calls.filter(call => ["record", "url"].includes(call.kind))), [
    { kind: "record", value: { type: "person", id: "preview-person-chen" } },
    { kind: "record", value: { type: "person", id: "preview-person-chen" } },
    { kind: "record", value: { type: "project", id: "preview-project-knowledge-assistant" } },
    { kind: "url", value: "https://example.com/research-meetup" },
    { kind: "record", value: { type: "project", id: "preview-project-knowledge-assistant" } }
  ]);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const state = window.__underwaterTest; state.contextOriginal = structuredClone(state.snapshot); state.calls = []; });

  // Missing, incomplete, current not-found, and historical conclusions stay distinct.
  const absentRow = page.locator(".uw-candidate").filter({ has: page.getByRole("button", { name: "查看 GenuX 详情", exact: true }) });
  assert.equal(await absentRow.locator(".uw-library-summary").getByText("尚未检查", { exact: true }).count(), 2);
  await page.getByRole("button", { name: "查看 GenuX 的已有项目关联", exact: true }).click();
  assert.equal(await page.getByRole("dialog").locator(".uw-context-empty").getByText("尚未检查", { exact: true }).count(), 2);
  await page.keyboard.press("Escape");
  const setContextState = async (status, checkedDelta, keepItems = false) => {
    await page.evaluate(({ status, checkedDelta, keepItems }) => {
      const state = window.__underwaterTest; const snapshot = structuredClone(state.contextOriginal);
      const candidate = snapshot.candidates.find(item => item.id === "preview-research-assistant");
      for (const field of ["contactPaths", "researchLinks"]) candidate[field] = {
        ...candidate[field], status, note: "合成检查状态说明", items: keepItems ? candidate[field].items : [],
        checkedAt: checkedDelta === null ? undefined : snapshot.run.lastAttemptAt + checkedDelta
      };
      state.setSnapshot(snapshot);
    }, { status, checkedDelta, keepItems });
    await page.waitForFunction(({ status, checkedDelta, keepItems }) => {
      const state = window.__underwaterTest; const result = state.snapshot.candidates.find(item => item.id === "preview-research-assistant").contactPaths;
      return result.status === status && result.items.length === (keepItems ? 2 : 0) && (checkedDelta === null ? result.checkedAt === undefined : result.checkedAt === state.snapshot.run.lastAttemptAt + checkedDelta);
    }, { status, checkedDelta, keepItems });
  };
  const syntheticRow = page.locator(".uw-candidate").filter({ has: page.getByRole("button", { name: "查看 示例项目·研究助手 详情", exact: true }) });
  await setContextState("not_found", 1000);
  assert.equal(await syntheticRow.locator(".uw-library-summary").getByText("本轮未找到", { exact: true }).count(), 2);
  await page.getByRole("button", { name: "查看 示例项目·研究助手 的联系路径", exact: true }).click();
  assert.equal(await contextDialog.locator(".uw-context-empty").getByText("本轮未找到", { exact: true }).count(), 2);
  await page.keyboard.press("Escape");
  await setContextState("not_found", -1000);
  assert.equal(await syntheticRow.locator(".uw-library-summary").getByText("上次未找到，本轮待复核", { exact: true }).count(), 2);
  await page.getByRole("button", { name: "查看 示例项目·研究助手 的联系路径", exact: true }).click();
  assert.equal(await contextDialog.getByText("本轮未找到", { exact: true }).count(), 0);
  assert.equal(await contextDialog.locator(".uw-context-empty").getByText("上次未找到，本轮待复核", { exact: true }).count(), 2);
  assert.equal(await contextDialog.locator(".uw-context-checked").count(), 2, "Historical checks retain their timestamps");
  await page.keyboard.press("Escape");
  await setContextState("found", -1000, true);
  assert.equal(await syntheticRow.locator(".uw-library-summary button").filter({ hasText: "本轮待复核" }).count(), 2);
  await page.getByRole("button", { name: "查看 示例项目·研究助手 的联系路径", exact: true }).click();
  assert.equal(await contextDialog.locator(".uw-contact-card").count(), 2, "Historical paths remain inspectable");
  assert.equal(await contextDialog.locator(".uw-research-card").count(), 2);
  await contextDialog.getByText("以下为上次检查的联系线索，本轮待复核。", { exact: true }).waitFor();
  await contextDialog.getByText("以下为上次检查的项目与方向关联，本轮待复核。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  for (const status of ["found", "not_found"]) {
    await setContextState(status, null, status === "found");
    assert.equal(await syntheticRow.locator(".uw-library-summary button").filter({ hasText: "本轮待复核" }).count(), 2, "Missing check time never implies current completion");
  }
  await setContextState("pending", null, true);
  assert.equal(await syntheticRow.locator(".uw-library-summary button").filter({ hasText: "检查未完成" }).count(), 2);
  await page.getByRole("button", { name: "查看 示例项目·研究助手 的联系路径", exact: true }).click();
  assert.equal(await contextDialog.locator(".uw-contact-card").count(), 2, "Incomplete checks can retain grounded partial paths");
  assert.equal(await contextDialog.locator(".uw-research-card").count(), 2);
  assert.equal(await contextDialog.getByText("尚未检查", { exact: true }).count(), 0);
  await contextDialog.getByText("联系路径检查未完成，以下为目前已有的线索。", { exact: true }).waitFor();
  await page.keyboard.press("Escape");
  await setContextState("pending", null);
  assert.equal(await syntheticRow.locator(".uw-library-summary").getByText("检查未完成", { exact: true }).count(), 2);
  await page.evaluate(() => { const state = window.__underwaterTest; state.setSnapshot(structuredClone(state.contextOriginal)); state.calls = []; });
  await page.getByRole("button", { name: "查看 PhAI lab 详情", exact: true }).click();
  await page.getByRole("dialog", { name: "PhAI lab" }).waitFor();
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "关闭线索详情");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.locator(":focus").textContent(), "打开项目档案");
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(":focus").getAttribute("aria-label"), "关闭线索详情");
  await page.getByRole("button", { name: "吴英成 · 个人主页", exact: false }).click();
  await page.getByRole("button", { name: "打开项目档案", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__underwaterTest.calls.filter(call => ["record", "url"].includes(call.kind))), [
    { kind: "url", value: "https://charles-wu.com/" }, { kind: "record", value: { type: "project", id: "preview-project-phai" } }
  ]);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, "underwater-detail.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
  await page.getByRole("tab", { name: "发现范围", exact: false }).click();
  if (screenshots) await page.screenshot({ path: path.join(screenshots, "underwater-sources.png") });
  assert.equal(await page.getByRole("button", { name: "添加来源", exact: true }).isVisible(), false, "Source controls start collapsed");
  assert.equal(await page.getByRole("switch", { name: "每日自动更新", exact: true }).isVisible(), false, "Daily settings start collapsed");
  await page.locator(".uw-disclosure > summary").filter({ hasText: "数据来源" }).click();
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, sources: s.snapshot.sources.map((item, index) => index ? item : { ...item, focusIds: ["preview-focus-mmlab"], inScope: false }) }); });
  await page.getByText("关联关注对象已暂停或移除，本轮不搜索。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "暂停关注 MMLab · 成员与校友", exact: true }).getAttribute("aria-checked"), "true", "Out-of-scope does not overwrite the original source toggle");
  await page.getByRole("button", { name: "MMLab · 成员与校友", exact: true }).click();
  await page.getByRole("textbox", { name: "来源名称" }).fill("MMLab · 编辑过的校友来源");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources[0].name === "MMLab · 编辑过的校友来源");
  assert.deepEqual(await page.evaluate(() => ({ focusIds: window.__underwaterTest.snapshot.sources[0].focusIds, inScope: window.__underwaterTest.snapshot.sources[0].inScope })), { focusIds: ["preview-focus-mmlab"], inScope: false }, "Editing a source preserves focus ownership and scope state");
  await page.getByRole("button", { name: "每日更新设置", exact: true }).click();
  await page.getByRole("combobox", { name: "每天更新时间" }).selectOption("10");
  await page.waitForFunction(() => window.__underwaterTest.snapshot.settings.localHour === 10);
  await page.getByRole("switch", { name: "每日自动更新", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.settings.enabled === false);
  await page.getByRole("switch", { name: "核验后自动入库", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.settings.autoIntake === false);
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  await page.getByRole("textbox", { name: "来源名称" }).fill("合成实验室");
  await page.getByRole("textbox", { name: "公开网址" }).fill("https://example.test/lab");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources.length === 7);
  await page.getByRole("button", { name: "合成实验室", exact: true }).click();
  await page.getByRole("textbox", { name: "来源名称" }).fill("已编辑实验室");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources.some(item => item.name === "已编辑实验室"));
  await page.getByRole("switch", { name: "暂停关注 已编辑实验室", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources.find(item => item.name === "已编辑实验室").enabled === false);
  await page.getByRole("button", { name: "添加来源", exact: true }).click();
  await page.getByRole("textbox", { name: "来源名称" }).fill("重复来源");
  await page.getByRole("textbox", { name: "公开网址" }).fill("https://example.test/lab");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await page.getByRole("alert").getByText("这个网址已在发现范围中。").waitFor();
  assert.equal(await page.evaluate(() => window.__underwaterTest.snapshot.sources.length), 7);
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => { window.__underwaterTest.failSave = true; });
  await page.getByRole("button", { name: "移除来源 已编辑实验室", exact: true }).click();
  await page.getByRole("alert").getByText("合成保存失败，请重试").waitFor();
  assert.equal(await page.evaluate(() => window.__underwaterTest.snapshot.sources.length), 7);
  await page.evaluate(() => { window.__underwaterTest.failSave = false; window.__underwaterTest.holdSave = true; });
  await page.getByRole("button", { name: "移除来源 已编辑实验室", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "添加来源", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__underwaterTest.holdSave = false; window.__underwaterTest.releaseSave(); });
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources.length === 6);
  await page.getByRole("tab", { name: "项目线索", exact: true }).click();
  await page.getByRole("button", { name: "立即搜索", exact: true }).click();
  await page.getByRole("status").getByText("正在检查公开来源、核验创业信号并与资料库查重").waitFor();
  assert.equal(await page.getByRole("button", { name: "正在发现", exact: true }).isDisabled(), true);
  // A first partial run can have persisted results without any successful full run.
  // Its warning is progress, while genuine read/run failures stay actionable alerts.
  const partialAttemptAt = Date.parse("2026-10-22T01:00:00Z");
  const partialSavedAt = partialAttemptAt + 5 * 60_000;
  await page.evaluate(({ partialAttemptAt, partialSavedAt }) => {
    const state = window.__underwaterTest;
    const snapshot = structuredClone(state.contextOriginal);
    snapshot.run = { status: "partial", lastAttemptAt: partialAttemptAt,
      error: "合成部分来源与关联未完成", coverage: { checked: 4, failed: 2, pending: 1 },
      focusCoverage: { checked: 0, failed: 0, pending: 1 } };
    snapshot.focuses = snapshot.focuses.slice(0, 1);
    snapshot.candidates = snapshot.candidates.map(candidate => ({ ...candidate, lastSeenAt: partialSavedAt }));
    snapshot.sources = snapshot.sources.map((source, index) => ({ ...source,
      lastCheckedAt: partialAttemptAt + 60_000, status: index < 4 ? "checked" : "failed" }));
    state.partialSnapshot = structuredClone(snapshot);
    state.setSnapshot(snapshot);
    state.setError(snapshot.run.error);
  }, { partialAttemptAt, partialSavedAt });
  const updateCopy = page.locator(".uw-update-copy");
  const formattedSavedAt = await page.evaluate(value => new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(value), partialSavedAt);
  await updateCopy.getByText(`本轮结果已更新 ${formattedSavedAt}`, { exact: true }).waitFor();
  assert.equal(await updateCopy.getByText("2 条已入库", { exact: true }).count(), 1);
  assert.equal(await page.getByRole("alert").count(), 0, "Partial run errors are not failure alerts");
  assert.equal(await page.getByText(/关注对象已检查 0 个/).count(), 0, "A single freeform scope is not represented as zero searched projects");
  assert.equal(await page.getByText("尚未更新", { exact: true }).count(), 0, "Saved partial results have a real update time");
  const progressToggle = page.getByRole("button", { name: "部分来源与关系待核", exact: true });
  assert.equal(await progressToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#uw-progress-details").count(), 0, "Details start collapsed");
  await progressToggle.focus();
  await page.keyboard.press("Enter");
  assert.equal(await progressToggle.getAttribute("aria-expanded"), "true");
  const progressDetails = page.locator("#uw-progress-details");
  await progressDetails.getByText("来源已检查 4 个，2 个访问失败，1 个待补查。", { exact: true }).waitFor();
  await progressDetails.getByText("关注范围仍有待补查内容，已发现的线索会继续保留。", { exact: true }).waitFor();
  await progressDetails.getByText("5 条线索的联系或研究关联仍待核验。", { exact: true }).waitFor();
  for (const width of [760, 390]) {
    await page.setViewportSize({ width, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector(".uw-page-scroll").scrollWidth > document.querySelector(".uw-page-scroll").clientWidth + 1), false, `Expanded update details have no horizontal overflow at ${width}`);
  }
  await page.setViewportSize({ width: 1187, height: 900 });
  if (screenshots) await page.screenshot({ path: path.join(screenshots, "underwater-partial-expanded.png") });
  await progressDetails.getByRole("button", { name: "查看来源", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "添加来源", exact: true }).isVisible(), true);
  await page.getByRole("tab", { name: "项目线索", exact: true }).click();
  await progressToggle.click();
  assert.equal(await progressToggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator("#uw-progress-details").count(), 0);
  if (screenshots) await page.screenshot({ path: path.join(screenshots, "underwater-partial-collapsed.png") });

  // Excluded references can retain a historic library match, but do not inflate
  // the intake summary or the filter count for the visible list.
  await page.evaluate(() => {
    const state = window.__underwaterTest;
    const excluded = { ...state.snapshot.candidates.find(candidate => candidate.intake.status === "created"),
      id: "synthetic-excluded-match", name: "合成已排除参考", stage: "excluded" };
    state.setSnapshot({ ...state.snapshot, candidates: [...state.snapshot.candidates, excluded] });
  });
  await page.waitForFunction(() => window.__underwaterTest.snapshot.candidates.length === 6);
  assert.equal(await updateCopy.getByText("2 条已入库", { exact: true }).count(), 1);
  await page.getByRole("button", { name: "已入库 2", exact: true }).click();
  assert.equal(await page.locator(".uw-candidate").count(), 2);
  await page.getByRole("button", { name: "全部 5", exact: true }).click();
  assert.equal(await page.locator(".uw-candidate").count(), 5);
  assert.equal(await page.getByText("合成已排除参考", { exact: true }).count(), 0);

  await page.evaluate(() => window.__underwaterTest.setError("合成读取失败"));
  await page.getByRole("alert").getByText("合成读取失败 已保存的结果仍保留。", { exact: true }).waitFor();
  await page.getByRole("alert").getByRole("button", { name: "刷新结果", exact: true }).click();
  assert.equal(await page.evaluate(() => window.__underwaterTest.calls.at(-1).kind), "refresh");
  await page.evaluate(() => {
    const state = window.__underwaterTest; state.setError("");
    state.setSnapshot({ ...state.snapshot, error: "合成资料库读取失败" });
  });
  await page.getByRole("alert").getByText("合成资料库读取失败 已保存的结果仍保留。", { exact: true }).waitFor();
  await page.evaluate(partialSavedAt => {
    const state = window.__underwaterTest;
    state.setSnapshot({ ...state.snapshot, error: undefined,
      run: { ...state.snapshot.run, lastAttemptAt: partialSavedAt + 60_000, status: "failed", error: "合成搜索失败" } });
  }, partialSavedAt);
  await page.getByRole("alert").getByText("合成搜索失败 已保存的结果仍保留。", { exact: true }).waitFor();
  await updateCopy.getByText(`结果更新 ${formattedSavedAt}`, { exact: true }).waitFor();
  assert.equal(await updateCopy.getByText(/本轮结果已更新/).count(), 0, "A later failed attempt does not present historical results as updated this run");
  assert.equal(await progressToggle.count(), 0);
  assert.equal(await page.locator(".uw-candidate").count(), 5);

  await page.evaluate(() => {
    const state = window.__underwaterTest;
    state.setSnapshot({ ...state.partialSnapshot, candidates: [],
      sources: state.partialSnapshot.sources.map(source => ({ ...source, status: "failed" })),
      run: { ...state.partialSnapshot.run, coverage: { checked: 0, failed: 6, pending: 0 } } });
  });
  await updateCopy.getByText("本轮尚无已保存结果", { exact: true }).waitFor();
  assert.equal(await updateCopy.getByText(/本轮结果已更新/).count(), 0, "Failed source timestamps cannot claim saved search results");
  assert.equal(await page.getByRole("alert").count(), 0);
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, candidates: [], run: { status: "idle" } }); });
  await page.getByRole("heading", { name: "从第一条创业线索开始" }).waitFor();
  await page.evaluate(() => { window.__underwaterTest.setSnapshot(null); window.__underwaterTest.setLoading(true); });
  await page.getByRole("heading", { name: "正在读取水下线索" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("underwater panel UI: contact routes, research comparisons, historical/partial check states, evidence callbacks, filters, keyboard modal, responsive layout, source CRUD, duplicate protection, save failure, schedule, truthful partial update times, collapsed details, visible-only counts, preserved failure alerts, run/error/empty states passed");
  await context.close();
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
