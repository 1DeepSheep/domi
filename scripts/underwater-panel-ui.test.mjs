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
  state.snapshot = snapshot;
  state.setSnapshot = value => setSnapshot(value);
  state.setLoading = value => setLoading(value);
  const save = async (kind, value) => {
    state.calls.push({ kind, value: structuredClone(value) });
    if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
    if (state.failSave) throw new Error("合成保存失败，请重试");
    setSnapshot(current => kind === "settings" ? { ...current, settings: { ...current.settings, ...value } } : kind === "focuses" ? { ...current, focuses: value } : { ...current, sources: value });
  };
  return <UnderwaterPanel snapshot={snapshot} loading={loading} preview
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
  await page.getByRole("button", { name: "重点实验室", exact: true }).click();
  assert.equal(await page.locator(".uw-candidate").count(), 1);
  await page.getByRole("button", { name: "全部", exact: true }).click();
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
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, sources: s.snapshot.sources.map((item, index) => index ? item : { ...item, focusIds: ["preview-focus-mmlab"], inScope: false }) }); });
  await page.getByText("关联关注对象已暂停或移除，本轮不搜索。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("switch", { name: "暂停关注 MMLab · 成员与校友", exact: true }).getAttribute("aria-checked"), "true", "Out-of-scope does not overwrite the original source toggle");
  await page.getByRole("button", { name: "MMLab · 成员与校友", exact: true }).click();
  await page.getByRole("textbox", { name: "来源名称" }).fill("MMLab · 编辑过的校友来源");
  await page.getByRole("button", { name: "保存来源", exact: true }).click();
  await page.waitForFunction(() => window.__underwaterTest.snapshot.sources[0].name === "MMLab · 编辑过的校友来源");
  assert.deepEqual(await page.evaluate(() => ({ focusIds: window.__underwaterTest.snapshot.sources[0].focusIds, inScope: window.__underwaterTest.snapshot.sources[0].inScope })), { focusIds: ["preview-focus-mmlab"], inScope: false }, "Editing a source preserves focus ownership and scope state");
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
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, run: { ...s.snapshot.run, status: "partial", coverage: { checked: 4, failed: 2, pending: 0 } } }); });
  await page.getByText("本次发现已保存；2 个来源未完成，后续会继续检查。").waitFor();
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, run: { ...s.snapshot.run, status: "failed", error: "合成搜索失败" } }); });
  await page.getByRole("alert").getByText("合成搜索失败 已保留上次成功结果。").waitFor();
  assert.equal(await page.locator(".uw-candidate").count(), 5);
  await page.evaluate(() => { const s = window.__underwaterTest; s.setSnapshot({ ...s.snapshot, candidates: [], run: { status: "idle" } }); });
  await page.getByRole("heading", { name: "从第一条创业线索开始" }).waitFor();
  await page.evaluate(() => { window.__underwaterTest.setSnapshot(null); window.__underwaterTest.setLoading(true); });
  await page.getByRole("heading", { name: "正在读取水下线索" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("underwater panel UI: filters, evidence, keyboard modal, responsive layout, source CRUD, duplicate protection, save failure, schedule, run/partial/error/empty states passed");
  await context.close();
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
