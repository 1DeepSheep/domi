import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Real FocusManager; all changes persist only to this fixture's memory.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-focus-ui-"));
const fixture = "/__sourcing_focus_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import SourcingFocusManager from "/src/components/SourcingFocusManager";
import "/src/styles.css";
import "/src/underwater.css";
const state = window.__focusTest = { calls: [], failSave: false, holdSave: false };
function Fixture() {
  const [focuses, setFocuses] = useState([]);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState([]);
  state.focuses = focuses; state.setRunning = setRunning; state.setResults = setResults;
  return <main className="underwater-panel"><div className="uw-page-scroll"><SourcingFocusManager focuses={focuses} configured results={results} running={running} onSaveFocuses={async next => {
    state.calls.push(structuredClone(next));
    if (state.holdSave) await new Promise(resolve => { state.releaseSave = resolve; });
    if (state.failSave) throw new Error("合成关注对象保存失败");
    setFocuses(next);
  }} /></div></main>;
}
createRoot(document.getElementById("root")).render(<Fixture />);
`;
let server, browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" }, optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "sourcing-focus-fixture", resolveId(id) { if (id === fixture) return resolvedFixture; }, load(id) { if (id === resolvedFixture) return source; }, configureServer(vite) { vite.middlewares.use((request, response, next) => {
      if (request.url !== "/") return next(); response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
    }); } }] });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1187, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin);
  await page.getByRole("heading", { name: "寻找他们周围，正在创业的人" }).waitFor();
  await page.getByRole("heading", { name: "尚未设置关注对象，请先添加" }).waitFor();
  const create = async (typeName, name) => {
    await page.getByRole("button", { name: `添加${typeName}`, exact: true }).click();
    await page.getByRole("textbox", { name: "名称", exact: true }).fill(name);
    await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
    await page.getByRole("heading", { name, exact: true }).waitFor();
  };
  await create("领域 / 方向", "合成 AI 方向");
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses[0].urls), [], "Name-only creation needs no URL");
  await create("重点实验室", "合成实验室");
  await create("公司 / 项目", "合成公司");
  await create("重要人物", "王同名");
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses.map(item => item.type)), ["direction", "lab", "company", "person"]);
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses[1].relations), ["members", "alumni", "students", "collaborators"]);
  await page.evaluate(() => { const s = window.__focusTest; s.setResults([{ focusId: s.focuses[1].id, status: "failed", detail: "校友主页暂时无法访问" }, { focusId: s.focuses[3].id, status: "pending", detail: "共同作者关系待核验" }]); });
  await page.locator(".uw-focus-row").filter({ has: page.getByRole("heading", { name: "合成实验室", exact: true }) }).getByText("校友主页暂时无法访问").waitFor();
  await page.locator(".uw-focus-row").filter({ has: page.getByRole("heading", { name: "王同名", exact: true }) }).getByText("共同作者关系待核验").waitFor();
  await page.getByRole("button", { name: "编辑关注对象 合成实验室", exact: true }).click();
  await page.getByRole("button", { name: "校友", exact: true }).click();
  await page.getByRole("button", { name: "细化搜索范围", exact: false }).click();
  await page.getByRole("textbox", { name: "补充关键词", exact: true }).fill("机器人，世界模型、机器人");
  await page.getByRole("textbox", { name: "排除词", exact: true }).fill("医疗;纯硬件");
  await page.getByRole("textbox", { name: "指定来源网址", exact: true }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
  await page.getByRole("alert").getByText(/请检查指定来源网址/).waitFor();
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses[1].keywords), [], "Invalid URL does not mutate saved focus");
  await page.getByRole("textbox", { name: "指定来源网址", exact: true }).fill("https://example.test/lab\nhttps://example.test/alumni\nhttps://example.test/lab");
  await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses[1].keywords.length === 2);
  const lab = await page.evaluate(() => window.__focusTest.focuses[1]);
  assert.deepEqual(lab.keywords, ["机器人", "世界模型"]);
  assert.deepEqual(lab.excludedKeywords, ["医疗", "纯硬件"]);
  assert.deepEqual(lab.urls, ["https://example.test/lab", "https://example.test/alumni"]);
  assert.deepEqual(lab.relations, ["members", "students", "collaborators"]);
  await page.getByRole("button", { name: "添加重要人物", exact: true }).click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("王同名");
  await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
  await page.getByRole("alert").getByText(/这个关注对象及其身份信息已存在/).waitFor();
  await page.getByRole("button", { name: "细化搜索范围", exact: false }).click();
  await page.getByRole("textbox", { name: "补充关键词", exact: true }).fill("另一所大学");
  await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.length === 5);
  assert.equal(await page.getByRole("heading", { name: "王同名", exact: true }).count(), 2, "Distinct identity keywords permit homonymous people");
  await page.getByRole("button", { name: "编辑关注对象 合成公司", exact: true }).click();
  await page.getByRole("combobox", { name: "对象类型", exact: true }).selectOption("person");
  assert.equal(await page.getByRole("button", { name: "共同作者", exact: true }).getAttribute("aria-pressed"), "true");
  assert.equal(await page.getByRole("button", { name: "离职员工", exact: true }).count(), 0);
  await page.getByRole("combobox", { name: "对象类型", exact: true }).selectOption("direction");
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("由公司改为方向");
  await page.getByRole("button", { name: "保存关注对象", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.some(item => item.name === "由公司改为方向"));
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses.find(item => item.name === "由公司改为方向").relations), [], "Type change clears inapplicable relations");
  await page.getByRole("switch", { name: "暂停关注对象 合成 AI 方向", exact: true }).click();
  await page.waitForFunction(() => !window.__focusTest.focuses[0].enabled);
  await page.getByRole("switch", { name: "开启关注对象 合成 AI 方向", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses[0].enabled);
  await page.evaluate(() => { window.__focusTest.failSave = true; });
  await page.getByRole("button", { name: "移除关注对象 合成实验室", exact: true }).click();
  await page.getByRole("alert").getByText("合成关注对象保存失败").waitFor();
  assert.equal(await page.getByRole("heading", { name: "合成实验室", exact: true }).count(), 1);
  await page.evaluate(() => { window.__focusTest.failSave = false; window.__focusTest.holdSave = true; });
  await page.getByRole("button", { name: "移除关注对象 合成实验室", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "添加关注对象", exact: true }).isDisabled(), true);
  await page.evaluate(() => { window.__focusTest.holdSave = false; window.__focusTest.releaseSave(); });
  await page.waitForFunction(() => window.__focusTest.focuses.length === 4);
  await page.getByRole("button", { name: "编辑关注对象 合成 AI 方向", exact: true }).click();
  await page.evaluate(() => window.__focusTest.setRunning(true));
  await page.getByRole("status").getByText("本轮搜索进行中，完成后可调整关注对象。").waitFor();
  for (const locator of [page.getByRole("button", { name: "添加关注对象", exact: true }), page.getByRole("button", { name: "保存关注对象", exact: true }), page.getByRole("textbox", { name: "名称", exact: true }), page.getByRole("switch", { name: "暂停关注对象 合成 AI 方向", exact: true }), page.getByRole("button", { name: "移除关注对象 合成 AI 方向", exact: true })]) assert.equal(await locator.isDisabled(), true);
  await page.evaluate(() => window.__focusTest.setRunning(false));
  await page.getByRole("button", { name: "取消", exact: true }).click();
  for (const width of [1187, 1027, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.querySelector(".uw-page-scroll").scrollWidth > document.querySelector(".uw-page-scroll").clientWidth + 1), false, `Focus controls fit width ${width}`);
  }
  await page.getByRole("button", { name: "筛选领域 / 方向", exact: true }).click();
  assert.equal(await page.locator(".uw-focus-row").count(), 2);
  await page.getByRole("button", { name: "显示全部", exact: false }).click();
  for (let index = 0; index < 4; index++) await page.getByRole("switch", { name: /^暂停关注对象 / }).first().click();
  await page.getByRole("status").getByText("全部关注对象已暂停，开启后继续发现。").waitFor();
  for (let index = 0; index < 4; index++) await page.getByRole("button", { name: /^移除关注对象 / }).first().click();
  await page.getByRole("heading", { name: "尚未设置关注对象，请先添加" }).waitFor();
  assert.ok((await page.evaluate(() => window.__focusTest.calls.length)) > 10, "Edits are passed through the persistence callback");
  assert.deepEqual(errors, []);
  console.log("sourcing focus UI: four types, name-only creation, relations, optional keywords/exclusions/URLs, identity disambiguation, CRUD/save failure, pending/run locks, all-paused and responsive layout passed");
  await context.close();
} finally { await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true }); }
