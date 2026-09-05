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
for (const candidate of candidates.filter(item => item.status !== "available")) importedSkills.push({
  ...candidate, id: "user-skill:" + candidate.id, path: candidate.sourcePath, importedAt: 1,
  available: candidate.status === "imported", fingerprint: "synthetic"
});
const officialSkills = [{ id: "official:slides", name: "slides", title: "官方演示技能", description: "统一演示交付", path: "/synthetic/official/slides", version: "test-1" }];
workbench.manageSkillHub = async ({ id, action, enabled }) => {
  const skill = importedSkills.find(item => item.id === id);
  if (action === "enable") skill.enabled = enabled;
  if (action === "details") return { ok: true, skill, baselineAvailable: true, changes: ["修改 · SKILL.md"], upstreamVersion: "test-2" };
  if (action === "fork") {
    const copy = { ...importedSkills[0], id: "user-skill:official-copy", title: "官方演示技能副本", path: "/synthetic/skills/slides-personal", independentCopy: true, sourceVersion: "test-1" };
    importedSkills.push(copy);
    return { ok: true, skills: [...importedSkills], imported: [copy] };
  }
  return { ok: true, skills: [...importedSkills] };
};
workbench.listSkillHub = async () => ({ ok: true, skills: importedSkills, updatedAt: Date.now() });
workbench.scanSkillHub = async () => state.failScan
  ? { ok: false, error: "合成扫描失败，请重新扫描", candidates: [], imported: [], scannedAt: Date.now() }
  : { ok: true, candidates: candidates.map(item => ({ ...item, status: state.importedIds.includes(item.id) ? "imported" : item.status })), imported: [...importedSkills], official: officialSkills, scannedAt: Date.now() };
workbench.importSkillHub = async ({ candidateIds }) => {
  state.imports.push([...candidateIds]);
  if (state.failImport) return { ok: false, imported: [], skills: importedSkills, activation: "unchanged", error: "合成导入失败，请重试" };
  if (state.holdImport) await new Promise(resolve => { state.releaseImport = resolve; });
  state.importedIds.push(...candidateIds);
  for (const id of candidateIds) {
    const candidate = candidates.find(item => item.id === id);
    importedSkills.push({ ...candidate, id: "user-skill:" + id, path: candidate.sourcePath, independentCopy: true, fingerprint: "fixture", importedAt: 1 });
  }
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
  const header = page.locator(".sidebar-skill-hub-header");
  const toggle = page.locator(".sidebar-skill-hub-header .sidebar-section-toggle");
  const manage = page.getByRole("button", { name: "管理技能", exact: true });
  await toggle.waitFor();
  assert.equal(await header.getByRole("button").count(), 1, "Skill Hub header has only the disclosure button, like other sidebar sections");
  assert.equal(await header.locator(".sidebar-skill-hub-manage, .lucide-settings, .lucide-settings-2").count(), 0, "Management must not reappear as a header gear");
  if (await toggle.getAttribute("aria-expanded") === "true") await toggle.click();
  assert.equal(await manage.isVisible(), false, "Collapsed Skill Hub must hide its management footer");
  assert.equal(await page.locator(".sidebar-skill-hub-content").isVisible(), false);
  await toggle.click();
  await page.locator(".sidebar-workflows").waitFor();
  assert.equal(await manage.innerText(), "管理技能…");

  const archiveNav = page.getByRole("button", { name: "投资档案", exact: true });
  const documentsNav = page.getByRole("button", { name: "文档中心", exact: true });
  await archiveNav.click();
  await page.locator(".topbar .project-title > strong").filter({ hasText: /^投资档案$/ }).waitFor();
  await documentsNav.click();
  await page.locator(".topbar .project-title > strong").filter({ hasText: /^文档中心$/ }).waitFor();
  assert.equal(await page.locator(".sidebar-nav-item").filter({ hasText: /^(资料库|文档库)$/ }).count(), 0, "Navigation must distinguish investment records from document files");
  await archiveNav.click(); // Collapse the document tree before testing Skill Hub's space budget.

  const assertNavigationVisible = async (width, height, documentsExpanded) => {
    const navigation = await page.locator(".sidebar-primary-nav").evaluate(nav => {
      const bounds = element => {
        const value = element.getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom };
      };
      return {
        bounds: bounds(nav),
        buttons: [...nav.querySelectorAll(".sidebar-nav-item")].map(button => {
          const title = button.querySelector("strong");
          const range = document.createRange();
          range.selectNodeContents(title);
          return { title: title.textContent, bounds: bounds(button), text: bounds(range) };
        })
      };
    });
    assert.equal(navigation.buttons.length, 4, "All four primary navigation entries must remain present");
    for (const button of navigation.buttons) {
      const description = `${button.title} at ${width}×${height}, documents ${documentsExpanded ? "expanded" : "collapsed"}`;
      for (const [inner, outer, relation] of [[button.bounds, navigation.bounds, "button within navigation"], [button.text, button.bounds, "title within button"], [button.text, navigation.bounds, "title within navigation"]]) {
        assert.ok(inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1, `${description}: ${relation} must be fully visible, not clipped`);
      }
    }
  };

  for (const [width, height] of [[1440, 900], [1120, 720], [960, 640]]) {
    await page.setViewportSize({ width, height });
    await assertNavigationVisible(width, height, false);
    const layout = await page.evaluate(() => {
      const rect = selector => {
        const value = document.querySelector(selector).getBoundingClientRect();
        return { left: value.left, right: value.right, top: value.top, bottom: value.bottom, height: value.height };
      };
      const list = document.querySelector(".sidebar-workflows");
      const content = document.querySelector(".sidebar-skill-hub-content");
      const manage = document.querySelector(".sidebar-skill-hub-manage");
      const titleRange = document.createRange();
      titleRange.selectNodeContents(document.querySelector(".sidebar-skill-hub-header strong"));
      return {
        manage: rect(".sidebar-skill-hub-manage"), disclosure: rect(".sidebar-skill-hub-header .sidebar-nav-disclosure"),
        titleRight: titleRange.getBoundingClientRect().right, content: rect(".sidebar-skill-hub-content"),
        documents: rect(".sidebar-document-section"), documentsButton: rect(".sidebar-document-section > .sidebar-nav-item"),
        list: rect(".sidebar-workflows"), threads: rect(".sidebar-thread-section"),
        listFlexGrow: getComputedStyle(list).flexGrow, listMinHeight: getComputedStyle(list).minHeight,
        contentDisplay: getComputedStyle(content).display, contentDirection: getComputedStyle(content).flexDirection,
        manageFlex: getComputedStyle(manage).flex, manageIsSibling: list.parentElement === content && manage.parentElement === content,
        overflow: getComputedStyle(list).overflowY, scrollHeight: list.scrollHeight, clientHeight: list.clientHeight
      };
    });
    assert.ok(layout.documents.height >= layout.documentsButton.height - 1, `Collapsed document navigation must not clip its label in the ${width}×${height} window`);
    assert.ok(layout.titleRight + 3 <= layout.disclosure.left, `Title must not overlap the disclosure at ${width}px`);
    assert.ok(layout.content.height <= Math.min(220, height * 0.28) + 1, "The whole expanded Skill Hub, including management, must stay within the original height budget");
    assert.equal(layout.contentDisplay, "flex");
    assert.equal(layout.contentDirection, "column");
    assert.equal(layout.listFlexGrow, "1");
    assert.equal(layout.listMinHeight, "0px");
    assert.equal(layout.manageFlex, "0 0 auto", "Management footer must not shrink with or scroll inside the skill list");
    assert.equal(layout.manageIsSibling, true, "Management must be a fixed sibling of the scrollable skill list");
    assert.ok(layout.manage.top >= layout.list.bottom - 1, "Management must sit below the list without overlapping its rows");
    assert.ok(layout.manage.height >= 32 && layout.manage.bottom <= layout.content.bottom + 1, "Management must remain fully visible within the content budget");
    assert.ok(layout.threads.height >= 64, "Recent conversations must retain usable space");
    assert.ok(layout.threads.top >= layout.content.bottom, "Skill Hub and its footer must not overlap recent conversations");
    assert.ok(Math.min(layout.threads.bottom, height) - Math.max(layout.threads.top, 0) >= 64, `Recent conversations must remain visible in the ${width}×${height} window`);
    assert.equal(await page.locator(".thread-section-heading").isVisible(), true);
    assert.equal(layout.overflow, "auto");
    assert.ok(layout.scrollHeight > layout.clientHeight, "Many skills must use the local scrollbar");
    await page.locator(".sidebar-workflows").evaluate(element => { element.scrollTop = 0; });
    await page.locator(".sidebar-workflows").hover();
    await page.mouse.wheel(0, 240);
    await page.waitForFunction(() => document.querySelector(".sidebar-workflows").scrollTop > 0);
    const scrolledManage = await manage.boundingBox();
    assert.ok(Math.abs(scrolledManage.y - layout.manage.top) <= 1, "Trackpad scrolling must not move the management footer");
    assert.ok(Math.abs(scrolledManage.y + scrolledManage.height - layout.manage.bottom) <= 1, "Management must remain pinned while skills scroll");
    await documentsNav.click();
    await page.waitForFunction(() => document.querySelector(".sidebar-document-section > .sidebar-nav-item").getAttribute("aria-expanded") === "true");
    await assertNavigationVisible(width, height, true);
    await documentsNav.click();
    await page.waitForFunction(() => document.querySelector(".sidebar-document-section > .sidebar-nav-item").getAttribute("aria-expanded") === "false");
    await assertNavigationVisible(width, height, false);
  }

  await page.setViewportSize({ width: 1120, height: 720 });
  await toggle.click();
  assert.equal(await manage.isVisible(), false, "Collapsing after scrolling must also hide management");
  await toggle.click();
  if (process.env.DOMI_SKILL_HUB_SCREENSHOT) {
    await page.locator(".sidebar-workflows").evaluate(element => { element.scrollTop = 0; });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("aside.sidebar").screenshot({ path: path.resolve(process.env.DOMI_SKILL_HUB_SCREENSHOT) });
  }
  await manage.click();
  await page.getByRole("dialog", { name: "管理 Skill Hub" }).waitFor();
  if (process.env.DOMI_SKILL_HUB_MANAGER_SCREENSHOT) {
    await page.getByRole("button", { name: "复制并修改", exact: true }).waitFor();
    await page.getByRole("dialog").screenshot({ path: path.resolve(process.env.DOMI_SKILL_HUB_MANAGER_SCREENSHOT) });
  }
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
  const brokenCard = page.locator(".skill-hub-managed-item").filter({ hasText: "损坏技能" });
  assert.match(await brokenCard.innerText(), /缺少合法的 SKILL.md/);
  assert.equal(await brokenCard.getByRole("button", { name: "编辑", exact: true }).isEnabled(), true);
  const userCard = page.locator(".skill-hub-managed-item").filter({ hasText: "已导入技能" });
  await userCard.getByRole("button", { name: "停用", exact: true }).click();
  await userCard.getByRole("button", { name: "启用", exact: true }).waitFor();
  await userCard.getByRole("button", { name: "启用", exact: true }).click();
  await userCard.getByRole("button", { name: "来源与差异" }).click();
  await page.getByText(/相对导入时的文件差异/).waitFor();
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
  assert.equal(await page.locator(".skill-hub-managed-item").filter({ hasText: "合成分析技能" }).getByRole("button", { name: "编辑", exact: true }).isEnabled(), true);

  await page.getByRole("button", { name: /新建 Skill/ }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await page.waitForFunction(() => window.__skillHubTest.runs.length === 1);
  const run = await page.evaluate(() => window.__skillHubTest.runs[0]);
  assert.equal(run.workflowId, "skill-creator");
  assert.match(run.prompt, /\$skill-creator/);
  assert.match(run.requestText, /通过对话引导我创建/);
  await page.getByText("请告诉我这个 Skill 想完成什么任务；我们会通过对话逐步完善。", { exact: true }).waitFor();
  await manage.click();
  await page.getByRole("button", { name: "复制并修改", exact: true }).click();
  await page.waitForFunction(() => window.__skillHubTest.runs.length === 2);
  const editRun = await page.evaluate(() => window.__skillHubTest.runs[1]);
  assert.match(editRun.requestText, /修改自己的 Skill/);
  assert.match(editRun.requestText, /\/synthetic\/skills\/slides-personal/);
  assert.match(editRun.requestText, /不能修改官方插件/);
  assert.deepEqual(errors, [], "Skill Hub interactions must not raise browser runtime errors");
  assert.deepEqual(await page.evaluate(() => window.__skillHubTest.issues), [], "Skill Hub smoke must not emit renderer issue reports");
  console.log("Skill Hub browser smoke passed: renamed navigation/page titles, gear-free disclosure, three bounded viewport layouts, pinned management during wheel scroll, collapse/manage/close, scan recovery, explicit import/deferred activation and native creator conversation.");
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
