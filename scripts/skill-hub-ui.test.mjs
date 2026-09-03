import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Actual App and SkillHubManager components, backed only by synthetic browser
// bridge responses. No Electron IPC, Codex call, user directory or external
// service is used by this test.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-skill-hub-ui-"));
const fixture = "/__domi_skill_hub_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import { workbench } from "/src/bridge";
import "/src/styles.css";
const state = window.__skillHubTest = { failScan: false, failImport: false, holdImport: false, imports: [], runs: [], issues: [], importedIds: [] };
const importedSkills = Array.from({ length: 18 }, (_, index) => ({
  id: "user-skill:fixture-" + index, name: "fixture-" + index, title: "合成用户技能 " + (index + 1),
  description: "仅用于浏览器回归测试，不访问真实用户材料", path: "/synthetic/skills/fixture-" + index + "/SKILL.md",
  sourcePath: "/synthetic/skills/fixture-" + index, fingerprint: "synthetic", importedAt: 1
}));
const candidates = [
  { id: "candidate-one", name: "analysis-one", title: "合成分析技能", description: "按需分析合成资料", sourcePath: "/synthetic/codex/skills/analysis-one", sourceLabel: "Codex 用户 Skill", status: "available", suggestedName: "analysis-one", officialNameConflict: false, nameCollision: false, sourceIsDestination: true },
  { id: "candidate-two", name: "slides", title: "自定义展示技能", description: "基于官方 Skill 自行改编的测试副本", sourcePath: "/synthetic/agents/skills/slides", sourceLabel: "Agents 用户 Skill", status: "available", suggestedName: "slides-user", officialNameConflict: true, nameCollision: true, sourceIsDestination: false },
  { id: "candidate-broken", name: "broken", title: "损坏技能", description: "必须保留可见错误", sourcePath: "/synthetic/skills/broken", sourceLabel: "Codex 用户 Skill", status: "unavailable", error: "缺少合法的 SKILL.md 描述", suggestedName: "broken", officialNameConflict: false, nameCollision: false, sourceIsDestination: true },
  { id: "candidate-added", name: "already-added", title: "已导入技能", description: "已加入 Skill Hub", sourcePath: "/synthetic/skills/already-added", sourceLabel: "Codex 用户 Skill", status: "imported", suggestedName: "already-added", officialNameConflict: false, nameCollision: false, sourceIsDestination: true }
];
workbench.listSkillHub = async () => ({ ok: true, skills: importedSkills, updatedAt: Date.now() });
workbench.scanSkillHub = async () => state.failScan
  ? { ok: false, error: "合成扫描失败，请重新扫描", candidates: [], imported: [], scannedAt: Date.now() }
  : { ok: true, candidates: candidates.map(item => ({ ...item, status: state.importedIds.includes(item.id) ? "imported" : item.status })), imported: importedSkills, scannedAt: Date.now() };
workbench.importSkillHub = async ({ candidateIds }) => {
  state.imports.push([...candidateIds]);
  if (state.failImport) return { ok: false, imported: [], skills: importedSkills, activation: "unchanged", error: "合成导入失败，请重试" };
  if (state.holdImport) await new Promise(resolve => { state.releaseImport = resolve; });
  state.importedIds.push(...candidateIds);
  return { ok: true, imported: candidateIds.map(id => ({ ...importedSkills[0], id })), skills: importedSkills, activation: "after-current-tasks", failures: [] };
};
workbench.runCodex = async (request) => {
  state.runs.push(request);
  return { ok: true, runId: request.runId, output: "请告诉我这个 Skill 想完成什么任务；我们会通过对话逐步完善。", workspacePath: "/synthetic/workspace", eventCount: 0 };
};
workbench.reportRendererIssue = report => state.issues.push(report);
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
    plugins: [{
      name: "skill-hub-ui-fixture",
      resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; },
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`);
        });
      }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "管理 Skill Hub", exact: true }).waitFor();
  const toggle = page.locator(".sidebar-skill-hub-header .sidebar-section-toggle");
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await page.locator(".sidebar-workflows").waitFor();

  for (const [width, height] of [[1440, 900], [1120, 720], [960, 640]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, height: value.height };
      };
      const list = document.querySelector(".sidebar-workflows");
      const titleRange = document.createRange();
      titleRange.selectNodeContents(document.querySelector(".sidebar-skill-hub-header strong"));
      return {
        manage: rect(".sidebar-skill-hub-manage"), disclosure: rect(".sidebar-skill-hub-header .sidebar-nav-disclosure"),
        titleRight: titleRange.getBoundingClientRect().right, list: rect(".sidebar-workflows"), threads: rect(".sidebar-thread-section"),
        overflow: getComputedStyle(list).overflowY, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight
      };
    });
    assert.ok(layout.manage.right + 3 <= layout.disclosure.left, `Manage and disclosure buttons must remain separate at ${width}px`);
    assert.ok(layout.titleRight + 3 <= layout.manage.left, `Title must not overlap management at ${width}px`);
    assert.ok(layout.list.height <= Math.min(220, height * 0.28) + 1, "Expanded Skill Hub must have bounded height");
    assert.ok(layout.threads.height >= 64, "Recent conversations must retain usable space");
    assert.ok(layout.threads.top >= layout.list.bottom, "Skill list must not overlap recent conversations");
    assert.equal(layout.overflow, "auto");
    assert.ok(layout.scrollHeight > layout.clientHeight, "Many skills must use the local scrollbar");
    await page.locator(".sidebar-workflows").evaluate(element => { element.scrollTop = 0; });
    await page.locator(".sidebar-workflows").hover();
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector(".sidebar-workflows").scrollTop > 0);
  }

  await page.setViewportSize({ width: 1120, height: 720 });
  const manage = page.getByRole("button", { name: "管理 Skill Hub", exact: true });
  await manage.click();
  await page.getByRole("dialog", { name: "管理 Skill Hub" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await manage.click();
  await page.getByRole("button", { name: "关闭 Skill Hub", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.evaluate(() => { window.__skillHubTest.failScan = true; });
  await manage.click();
  await page.getByRole("alert").filter({ hasText: "合成扫描失败" }).waitFor();
  assert.equal(await page.getByRole("button", { name: /导入所选/ }).isDisabled(), true);
  await page.evaluate(() => { window.__skillHubTest.failScan = false; });
  await page.getByRole("button", { name: "重新扫描" }).click();
  await page.getByRole("button", { name: /合成分析技能/ }).waitFor();
  assert.equal(await page.getByRole("button", { name: /损坏技能/ }).isDisabled(), true);
  assert.equal(await page.getByRole("button", { name: /已导入技能/ }).isDisabled(), true);
  assert.match(await page.getByRole("button", { name: /自定义展示技能/ }).innerText(), /与 \$domi:slides 独立共存/);
  assert.deepEqual(await page.evaluate(() => window.__skillHubTest.imports), [], "Scanning must not import skills without selection");
  await page.getByRole("textbox", { name: "搜索本机 Skill" }).fill("不存在的合成技能");
  await page.getByText("没有匹配的 Skill", { exact: true }).waitFor();
  await page.getByRole("button", { name: "清空搜索" }).click();
  await page.getByRole("button", { name: /合成分析技能/ }).click();
  await page.getByRole("button", { name: /自定义展示技能/ }).click();
  assert.equal(await page.getByRole("button", { name: "导入所选 2", exact: true }).isEnabled(), true);
  await page.evaluate(() => { window.__skillHubTest.failImport = true; });
  await page.getByRole("button", { name: "导入所选 2", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "合成导入失败" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "导入所选 2", exact: true }).isEnabled(), true, "A failed import must preserve the selected candidates for retry");
  await page.evaluate(() => { window.__skillHubTest.failImport = false; window.__skillHubTest.holdImport = true; });
  await page.getByRole("button", { name: "导入所选 2", exact: true }).click();
  await page.getByRole("button", { name: "正在导入", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "关闭 Skill Hub", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), true, "Import cannot be dismissed mid-flight");
  await page.evaluate(() => window.__skillHubTest.releaseImport());
  await page.getByRole("status").filter({ hasText: "已导入 2 个 Skill" }).waitFor();
  assert.match(await page.getByRole("status").innerText(), /当前任务结束后自动生效/);
  assert.deepEqual(await page.evaluate(() => window.__skillHubTest.imports), [["candidate-one", "candidate-two"], ["candidate-one", "candidate-two"]]);
  assert.equal(await page.getByRole("button", { name: /合成分析技能/ }).isDisabled(), true);

  await page.getByRole("button", { name: /新建 Skill/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__skillHubTest.runs.length === 1);
  const run = await page.evaluate(() => window.__skillHubTest.runs[0]);
  assert.equal(run.workflowId, "skill-creator");
  assert.match(run.prompt, /\$skill-creator/);
  assert.match(run.requestText, /通过对话引导我创建/);
  await page.getByText("请告诉我这个 Skill 想完成什么任务；我们会通过对话逐步完善。", { exact: true }).waitFor();
  assert.deepEqual(errors, [], "Skill Hub interactions must not raise browser runtime errors");
  assert.deepEqual(await page.evaluate(() => window.__skillHubTest.issues), [], "Skill Hub smoke must not emit renderer issue reports");
  console.log("Skill Hub browser smoke passed: three viewport layouts, wheel scroll, manage/close, scan recovery, explicit import/deferred activation and native creator conversation.");
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
