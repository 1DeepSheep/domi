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
  state.focuses = focuses; state.setRunning = setRunning; state.setResults = setResults; state.setFocuses = setFocuses;
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
  await page.getByRole("heading", { name: "我想关注什么" }).waitFor();
  await page.getByRole("heading", { name: "尚未设置关注对象，请先添加" }).waitFor();
  assert.equal(await page.locator(".uw-focus-types").count(), 0, "No category cards are required");
  assert.equal(await page.getByRole("combobox").count(), 0, "No forced type selector is exposed");
  const description = page.getByRole("textbox", { name: "关注描述", exact: true });
  assert.equal(await description.getAttribute("maxlength"), "4000");
  assert.equal(await page.getByRole("button", { name: "保存关注", exact: true }).isDisabled(), true);
  const firstText = "关注 AI Agent 与 MMLab 校友，围绕甲公司离职员工寻找华人创业者。\n也看乙教授的共同作者，暂不看纯硬件代工。";
  await description.fill(firstText);
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.length === 1);
  const first = await page.evaluate(() => window.__focusTest.focuses[0]);
  assert.equal(first.name, firstText, "Mixed multiline prose is preserved verbatim");
  assert.equal(first.type, "freeform");
  assert.deepEqual(first.relations, [], "No relationship expansion is inferred by the UI");
  assert.deepEqual(first.urls, [], "URLs are optional");
  await description.fill("围绕机器人实验室、丙公司的研究员和丁教授寻找新团队");
  await page.getByRole("button", { name: "补充搜索条件", exact: false }).click();
  await page.getByRole("textbox", { name: "补充关键词", exact: true }).fill("机器人，世界模型、机器人");
  await page.getByRole("textbox", { name: "排除词", exact: true }).fill("医疗;纯硬件");
  await page.getByRole("textbox", { name: "指定来源网址", exact: true }).fill("javascript:alert(1)");
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.getByRole("alert").getByText(/请检查指定来源网址/).waitFor();
  assert.equal(await page.evaluate(() => window.__focusTest.focuses.length), 1);
  await page.getByRole("textbox", { name: "指定来源网址", exact: true }).fill("https://example.test/lab\nhttps://example.test/alumni\nhttps://example.test/lab");
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.length === 2);
  const second = await page.evaluate(() => window.__focusTest.focuses[1]);
  assert.deepEqual(second.keywords, ["机器人", "世界模型"]);
  assert.deepEqual(second.excludedKeywords, ["医疗", "纯硬件"]);
  assert.deepEqual(second.urls, ["https://example.test/lab", "https://example.test/alumni"]);
  await description.fill(firstText);
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.getByRole("alert").getByText(/这条关注描述和补充条件已经存在/).waitFor();
  await page.getByRole("button", { name: "补充搜索条件", exact: false }).click();
  await page.getByRole("textbox", { name: "补充关键词", exact: true }).fill("另一所大学");
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.length === 3);
  const longText = "关注研究团队的创业信号。".repeat(150);
  await description.fill(longText);
  await page.getByRole("button", { name: "保存关注", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.length === 4);
  await page.getByRole("button", { name: "展开完整描述", exact: true }).click();
  assert.equal(await page.locator(".uw-focus-row-body h3.is-expanded").textContent(), longText);
  await page.getByRole("button", { name: "收起描述", exact: true }).click();
  const legacy = { id: "legacy-lab", name: "原有实验室", type: "lab", keywords: ["甲机构", "甲机构"], excludedKeywords: ["医疗"], relations: ["alumni", "students"], urls: ["https://example.test"], enabled: false };
  await page.evaluate(legacy => { const s = window.__focusTest; s.setFocuses([...s.focuses, legacy, { ...legacy, id: "legacy-self", name: "原有仅跟踪人物", type: "person", relations: [], enabled: true }]); }, legacy);
  await page.getByRole("button", { name: "编辑关注对象 原有实验室", exact: true }).click();
  await page.getByText("保留原有关联范围：校友、学生。修改描述会保留这些已有设置。", { exact: true }).waitFor();
  await page.getByRole("heading", { name: "修改原有名称（保留原范围）", exact: true }).waitFor();
  assert.equal(await description.getAttribute("maxlength"), "300");
  await description.fill("甲".repeat(4000));
  assert.equal((await description.inputValue()).length, 300, "Legacy names cannot accept a 4000-character freeform description");
  await page.getByText("这条保留原有名称和关联范围。如需混合新方向或人物，请取消编辑后另写一条关注。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("combobox").count(), 0);
  await description.fill("原有实验室，补充名称说明");
  await page.getByRole("button", { name: "保存修改", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.find(item => item.id === "legacy-lab").name === "原有实验室，补充名称说明");
  assert.deepEqual(await page.evaluate(() => window.__focusTest.focuses.find(item => item.id === "legacy-lab")), { ...legacy, name: "原有实验室，补充名称说明" }, "Editing existing typed prose preserves every other field without implicit expansion or normalization");
  await page.getByText("保留原有范围：只跟踪对象本身，不扩展关联人物", { exact: true }).waitFor();
  await page.evaluate(() => { const s = window.__focusTest; s.setResults([{ focusId: "legacy-lab", status: "failed", detail: "校友主页暂时无法访问" }, { focusId: "legacy-self", status: "pending", detail: "身份待核验" }]); });
  await page.getByText("校友主页暂时无法访问", { exact: true }).waitFor();
  await page.getByText("身份待核验", { exact: true }).waitFor();
  await page.getByRole("switch", { name: "开启关注对象 原有实验室，补充名称说明", exact: true }).click();
  await page.waitForFunction(() => window.__focusTest.focuses.find(item => item.id === "legacy-lab").enabled);
  await page.getByRole("switch", { name: "暂停关注对象 原有实验室，补充名称说明", exact: true }).click();
  await page.waitForFunction(() => !window.__focusTest.focuses.find(item => item.id === "legacy-lab").enabled);
  await page.evaluate(() => { window.__focusTest.failSave = true; });
  await page.getByRole("button", { name: "移除关注对象 原有实验室，补充名称说明", exact: true }).click();
  await page.getByRole("alert").getByText("合成关注对象保存失败").waitFor();
  assert.equal(await page.evaluate(() => window.__focusTest.focuses.length), 6);
  await page.evaluate(() => { window.__focusTest.failSave = false; window.__focusTest.holdSave = true; });
  await page.getByRole("button", { name: "移除关注对象 原有实验室，补充名称说明", exact: true }).click();
  assert.equal(await description.isDisabled(), true);
  await page.evaluate(() => { window.__focusTest.holdSave = false; window.__focusTest.releaseSave(); });
  await page.waitForFunction(() => window.__focusTest.focuses.length === 5);
  await page.getByRole("button", { name: "编辑关注对象 原有仅跟踪人物", exact: true }).click();
  await page.evaluate(() => window.__focusTest.setRunning(true));
  await page.getByRole("status").getByText("本轮搜索进行中，完成后可调整关注描述。").waitFor();
  for (const locator of [description, page.getByRole("button", { name: "保存修改", exact: true }), page.getByRole("switch", { name: "暂停关注对象 原有仅跟踪人物", exact: true }), page.getByRole("button", { name: "移除关注对象 原有仅跟踪人物", exact: true })]) assert.equal(await locator.isDisabled(), true);
  await page.evaluate(() => window.__focusTest.setRunning(false));
  await page.getByRole("button", { name: "取消编辑", exact: true }).click();
  for (const width of [1187, 1027, 760]) {
    await page.setViewportSize({ width, height: 1000 });
    assert.equal(await page.evaluate(() => document.querySelector(".uw-page-scroll").scrollWidth > document.querySelector(".uw-page-scroll").clientWidth + 1), false, `Natural-language controls fit width ${width}`);
  }
  for (let index = 0; index < 5; index++) await page.getByRole("switch", { name: /^暂停关注对象 / }).first().click();
  await page.getByRole("status").getByText("全部关注对象已暂停，开启后继续发现。").waitFor();
  for (let index = 0; index < 5; index++) await page.getByRole("button", { name: /^移除关注对象 / }).first().click();
  await page.getByRole("heading", { name: "尚未设置关注对象，请先添加" }).waitFor();
  assert.ok((await page.evaluate(() => window.__focusTest.calls.length)) > 10, "Changes are passed through the persistence callback");
  assert.deepEqual(errors, []);
  console.log("sourcing focus UI: mixed freeform prose, multiline text, optional conditions, legacy field preservation, CRUD/save failure, run locks, empty/paused and responsive layout passed");
  await context.close();
} finally { await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true }); }
