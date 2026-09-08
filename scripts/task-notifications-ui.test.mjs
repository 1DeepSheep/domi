import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercise the actual App, task recovery/event handling, persistence effect and
// sidebar. Only the external bridge is synthetic: no Electron IPC, OS alerts,
// Codex calls, user database or private files are touched. localStorage belongs
// to this disposable browser context. Native delivery needs a signed-app check.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-task-notifications-ui-"));
const fixture = "/__domi_task_notifications_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import { workbench } from "/src/bridge";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const key = "task-notification-ui-fixture";
const read = (suffix, fallback) => JSON.parse(localStorage.getItem(key + suffix) || JSON.stringify(fallback));
const write = (suffix, value) => localStorage.setItem(key + suffix, JSON.stringify(value));
const ids = ["visible", "other", "background", "failed", "stopped", "waiting", "denied", "settling"];
const state = window.__taskNotificationsTest = {
  notifications: read(":notifications", []), dockCounts: [], issues: [], bound: [],
  notificationFailure: false, consumeCount: 0, saves: 0,
  terminal: read(":terminal", {}), snapshot: read(":snapshot", null),
  emit(id, type, output) {
    const payload = {
      runId: "run-" + id, threadId: "codex-" + id, type,
      output: output || "合成任务结果：" + id,
      ...(type === "failed" ? { error: "合成运行失败" } : {}), eventCount: 1
    };
    state.terminal[id] = payload;
    write(":terminal", state.terminal);
    state.codexListener(payload);
  },
  click(target) {
    write(":pending", target);
    state.notificationListener(target);
  },
  setPending(target) { write(":pending", target); }
};
workbench.loadState = async (defaultState) => {
  if (!state.snapshot) state.snapshot = {
    ...defaultState, activeThreadId: "task-visible", threads: ids.map((id, index) => ({
      id: "task-" + id, codexThreadId: "codex-" + id, projectId: "synthetic-" + id,
      title: "通知测试 " + id, project: "合成任务", updatedAt: "刚刚",
      lastActiveAt: Date.now() - index, pinned: false, manualTitle: true,
      timeline: [], lastUsage: null, messages: [
        { id: "user-" + id, role: "user", content: "运行合成检查 " + id },
        { id: "assistant-" + id, role: "assistant", content: "正在检查", status: "running", runId: "run-" + id }
      ]
    }))
  };
  return { ok: true, state: structuredClone(state.snapshot), updatedAt: Date.now(), isNew: false };
};
workbench.saveStatePatch = async (patch) => {
  const next = structuredClone(state.snapshot);
  Object.assign(next, structuredClone(patch.meta || {}));
  const threads = new Map(next.threads.map(thread => [thread.id, thread]));
  for (const id of patch.deletedThreadIds || []) threads.delete(id);
  for (const thread of patch.threads || []) threads.set(thread.id, structuredClone(thread));
  next.threads = (patch.threadOrder || [...threads.keys()]).map(id => threads.get(id)).filter(Boolean);
  state.snapshot = next;
  state.saves++;
  write(":snapshot", next);
  return { ok: true, updatedAt: Date.now() };
};
workbench.recoverCodexThread = async (threadId) => {
  const id = threadId.slice("codex-".length);
  const terminal = state.terminal[id];
  return { ok: true, threadId, runId: "run-" + id,
    status: terminal?.type || "running", output: terminal?.output || "正在检查",
    ...(terminal?.error ? { error: terminal.error } : {}) };
};
workbench.bindCodexRun = async runId => { state.bound.push(runId); return { ok: true }; };
workbench.onCodexEvent = callback => { state.codexListener = callback; return () => { state.codexListener = null; }; };
const fallbackSync = workbench.syncDomi;
workbench.syncDomi = async () => {
  if (!state.holdFinalization) return fallbackSync();
  state.settling = true;
  return new Promise(resolve => { state.releaseFinalization = resolve; });
};
workbench.showNotification = async notification => {
  state.notifications.push(structuredClone(notification));
  write(":notifications", state.notifications);
  return state.notificationFailure ? { ok: false, error: "合成系统通知权限未开启" } : { ok: true };
};
workbench.setUnreadTaskCount = async count => { state.dockCounts.push(count); return { ok: true }; };
workbench.onNotificationClicked = callback => { state.notificationListener = callback; return () => { state.notificationListener = null; }; };
workbench.consumePendingNotification = async () => {
  state.consumeCount++;
  const target = read(":pending", null);
  write(":pending", null);
  return target;
};
workbench.readMarkdown = async request => {
  state.markdownReads = [...(state.markdownReads || []), structuredClone(request)];
  return new Promise(resolve => { state.releaseMarkdown = resolve; });
};
workbench.readPdf = async request => {
  state.pdfReads = [...(state.pdfReads || []), structuredClone(request)];
  return new Promise(resolve => { state.releasePdf = resolve; });
};
workbench.saveMarkdown = async request => {
  state.markdownSaves = [...(state.markdownSaves || []), structuredClone(request)];
  if (state.markdownSaveConflict) return { ok: false, conflict: true, error: "合成保存冲突，草稿必须保留" };
  return { ok: true, document: {
    path: request.path, name: "notification-old-task.md", content: request.content,
    size: request.content.length, mtimeMs: request.expectedMtimeMs + 1
  } };
};
workbench.runCodex = async () => { throw new Error("No model run is permitted in this fixture"); };
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
      name: "task-notifications-ui-fixture",
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
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const row = id => page.locator(".thread-item").filter({ has: page.locator("strong", { hasText: new RegExp(`^通知测试 ${id}$`) }) });
  const select = async id => {
    await page.bringToFront();
    await row(id).click();
    await page.waitForFunction(id => [...document.querySelectorAll(".thread-item.active strong")].some(element => element.textContent === "通知测试 " + id), id);
  };
  const emit = (id, type = "completed", output) => page.evaluate(({ id, type, output }) => window.__taskNotificationsTest.emit(id, type, output), { id, type, output });
  const dock = count => page.waitForFunction(count => window.__taskNotificationsTest.dockCounts.at(-1) === count, count);
  const notified = count => page.waitForFunction(count => window.__taskNotificationsTest.notifications.length === count, count);
  const unread = async (id, expected) => {
    await row(id).locator(".thread-state-indicator.unread").waitFor({ state: expected ? "visible" : "detached" });
    assert.equal(await row(id).locator(".thread-state-indicator.unread").count(), expected ? 1 : 0);
  };
  const persisted = predicate => page.waitForFunction(predicate);
  const completed = id => page.waitForFunction(id => window.__taskNotificationsTest.snapshot?.threads.find(thread => thread.id === "task-" + id)?.messages.at(-1)?.status === "done", id);

  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__taskNotificationsTest.bound.length === 8);
  await select("visible");
  assert.equal(await page.evaluate(() => document.hasFocus()), true);
  await emit("visible", "completed", "合成任务结果。\n\n[打开合成旧文档](/synthetic/notification-old-task.md)\n\n[打开合成旧 PDF](/synthetic/notification-old-task.pdf)");
  await completed("visible");
  await unread("visible", false);
  await dock(0);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 0, "The focused, visible conversation must not alert its reader");

  await emit("other");
  await unread("other", true);
  await notified(1);
  await dock(1);
  assert.equal(await row("other").locator(".thread-state-indicator.unread").getAttribute("aria-label"), "任务有未读结果");
  const unreadColor = await row("other").locator(".thread-state-indicator.unread").evaluate(element => getComputedStyle(element).backgroundColor);
  const colorChannels = unreadColor.match(/[\d.]+/g)?.map(Number) || [];
  assert.ok(colorChannels[0] > colorChannels[1] && colorChannels[0] > colorChannels[2], `The unread indicator must appear red, received ${unreadColor}`);
  const target = await page.evaluate(() => window.__taskNotificationsTest.notifications[0]);
  assert.equal(target.threadId, "task-other");
  assert.ok(target.notificationId, "A terminal result must carry a stable notification identity");
  await emit("other");
  await completed("other");
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 1, "Repeated terminal events must not post a second notification");
  await persisted(() => window.__taskNotificationsTest.snapshot.threads.find(thread => thread.id === "task-other")?.hasUnreadCompletion === true);
  await page.reload({ waitUntil: "networkidle" });
  await unread("other", true);
  await dock(1);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 1, "Reload must retain unread state without re-posting the result");
  await page.evaluate(target => window.__taskNotificationsTest.click(target), target);
  await page.waitForFunction(() => document.querySelector(".thread-item.active strong")?.textContent === "通知测试 other");
  await unread("other", false);
  await dock(0);
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("task-notification-ui-fixture:pending"))), null, "A delivered click must consume its pending target");

  await select("background");
  // Headless Chromium keeps every tab focused even after bringToFront. Dispatch
  // the window lifecycle event into the actual App listener; do not replace its
  // visibility predicate. Native window blur/restore still needs signed-app QA.
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
  await emit("background");
  await unread("background", true);
  await notified(2);
  await dock(1);
  await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
  await unread("background", false);
  await dock(0);

  await select("visible");
  await emit("failed", "failed");
  await unread("failed", true);
  await notified(3);
  await dock(1);
  const failureNotification = await page.evaluate(() => window.__taskNotificationsTest.notifications.at(-1));
  assert.match(failureNotification.title + " " + failureNotification.body, /失败|未完成|需要处理/, "Failure must not be announced as successful completion");
  await emit("stopped", "stopped");
  await completed("stopped");
  await unread("stopped", false);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 3, "A stopped task must not post a completion alert");
  await emit("waiting", "waiting-input");
  await unread("waiting", true);
  await notified(4);
  await dock(2);
  const waitingNotification = await page.evaluate(() => window.__taskNotificationsTest.notifications.at(-1));
  assert.match(waitingNotification.title + " " + waitingNotification.body, /等待|补充|输入/, "Waiting for input must not be announced as a completed deliverable");

  await page.evaluate(() => { window.__taskNotificationsTest.notificationFailure = true; });
  await emit("denied");
  await unread("denied", true);
  await notified(5);
  await dock(3);
  await select("denied");
  await unread("denied", false);
  await dock(2);
  await select("visible");
  await persisted(() => window.__taskNotificationsTest.snapshot.activeThreadId === "task-visible" && window.__taskNotificationsTest.snapshot.threads.find(thread => thread.id === "task-denied")?.hasUnreadCompletion === false);

  const failedTarget = { threadId: "task-failed", notificationId: failureNotification.notificationId };
  await page.evaluate(target => window.__taskNotificationsTest.setPending(target), failedTarget);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector(".thread-item.active strong")?.textContent === "通知测试 failed");
  await unread("failed", false);
  await unread("waiting", true);
  await dock(1);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 5, "Recovering a failed result after reload must not re-notify it");
  await select("visible");
  await persisted(() => window.__taskNotificationsTest.snapshot.activeThreadId === "task-visible");
  await page.reload({ waitUntil: "networkidle" });
  await row("visible").waitFor();
  assert.equal(await row("visible").getAttribute("class"), "thread-item active", "Consumed clicks must not navigate again on another reload");
  await dock(1);

  await page.evaluate(() => { window.__taskNotificationsTest.holdFinalization = true; });
  await emit("settling", "completed", '合成输出。\n<!-- DOMI_ENTITY_RESULT_V1 {"entityType":"project","recordId":"fixture-project","name":"合成项目"} -->');
  await page.waitForFunction(() => window.__taskNotificationsTest.settling === true);
  await completed("settling");
  await unread("settling", false);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 5, "A model terminal event must not notify before entity finalization settles");
  await dock(1);
  await page.evaluate(() => window.__taskNotificationsTest.releaseFinalization({ ok: false, error: "合成资料归档失败" }));
  await unread("settling", true);
  await notified(6);
  await dock(2);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.at(-1).title), "domi 任务未完成", "A failed archive must never be advertised as successful completion");
  await persisted(() => window.__taskNotificationsTest.snapshot.threads.find(thread => thread.id === "task-settling")?.messages.at(-1)?.taskNotificationOutcome === "failed");

  // Add legacy storage fixtures only at the bridge boundary, then let the real
  // App recover them. One old error lacks new notification metadata; another
  // background task has an unread previous result and a new running turn.
  await page.evaluate(() => {
    const state = window.__taskNotificationsTest;
    const template = state.snapshot.threads.find(thread => thread.id === "task-visible");
    for (const id of ["old-error", "running-unread"]) {
      state.snapshot.threads.push({
        ...structuredClone(template), id: "task-" + id, codexThreadId: "codex-" + id,
        projectId: "synthetic-" + id, title: "通知测试 " + id,
        hasUnreadCompletion: id === "running-unread", timeline: [], messages: [
          ...(id === "running-unread" ? [{ id: "previous-assistant", role: "assistant", content: "上轮合成结果", status: "done", taskNotificationId: "previous-result", taskNotificationOutcome: "completed", taskNotificationRead: false }] : []),
          { id: "user-" + id, role: "user", content: "合成历史任务" },
          { id: "assistant-" + id, role: "assistant", content: "历史合成输出", status: id === "old-error" ? "error" : "running", runId: "run-" + id }
        ]
      });
    }
    state.terminal["old-error"] = { type: "failed", output: "历史合成输出", error: "历史合成失败" };
    localStorage.setItem("task-notification-ui-fixture:snapshot", JSON.stringify(state.snapshot));
    localStorage.setItem("task-notification-ui-fixture:terminal", JSON.stringify(state.terminal));
  });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__taskNotificationsTest.bound.includes("run-running-unread"));
  await unread("old-error", false);
  await unread("running-unread", true);
  try {
    await row("running-unread").locator(".thread-state-indicator.running").waitFor();
  } catch (error) {
    console.error("Recovered running task UI:", await row("running-unread").innerHTML());
    console.error("Synthetic recovery state:", await page.evaluate(() => ({
      bound: window.__taskNotificationsTest.bound,
      task: window.__taskNotificationsTest.snapshot.threads.find(thread => thread.id === "task-running-unread"),
      issues: window.__taskNotificationsTest.issues
    })));
    throw error;
  }
  await dock(3);
  assert.equal(await page.evaluate(() => window.__taskNotificationsTest.notifications.length), 6, "An old failed turn without receipt metadata must not become a new notification on reload");

  // The notification subscription was registered before this ordinary document
  // link opened. A pending read from the old task must be invalidated even when
  // the click callback still holds the subscription-time navigation closure.
  await select("visible");
  await page.getByRole("link", { name: "打开合成旧文档", exact: true }).click();
  await page.waitForFunction(() => window.__taskNotificationsTest.markdownReads?.length === 1);
  await page.locator(".markdown-panel-shell").waitFor();
  await page.evaluate(() => window.__taskNotificationsTest.click({
    threadId: "task-other", notificationId: "task-document-switch-regression"
  }));
  await page.waitForFunction(() => document.querySelector(".thread-item.active strong")?.textContent === "通知测试 other");
  await page.evaluate(async () => {
    window.__taskNotificationsTest.releaseMarkdown({ ok: true, document: {
      path: "/synthetic/notification-old-task.md", name: "notification-old-task.md",
      content: "旧任务的合成文档，不能显示在通知打开的另一任务里。", size: 96, mtimeMs: 1
    } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.locator(".markdown-title-button").filter({ hasText: "notification-old-task.md" }).count(), 0, "A delayed ordinary Markdown read from the previous task must not appear after notification navigation");
  assert.equal(await page.locator(".markdown-panel-shell").count(), 0, "The previous task's pending document panel must close when a notification opens another task");

  await select("visible");
  await page.getByRole("link", { name: "打开合成旧 PDF", exact: true }).click();
  await page.waitForFunction(() => window.__taskNotificationsTest.pdfReads?.length === 1);
  await page.locator(".pdf-panel-shell").waitFor();
  await page.evaluate(() => window.__taskNotificationsTest.click({
    threadId: "task-other", notificationId: "task-pdf-switch-regression"
  }));
  await page.waitForFunction(() => document.querySelector(".thread-item.active strong")?.textContent === "通知测试 other");
  await page.evaluate(async () => {
    window.__taskNotificationsTest.releasePdf({ ok: true, document: {
      path: "/synthetic/notification-old-task.pdf", name: "notification-old-task.pdf",
      previewUrl: "about:blank", size: 96, mtimeMs: 1
    } });
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  assert.equal(await page.locator(".pdf-panel-shell").count(), 0, "A delayed ordinary PDF read from the previous task must not appear after notification navigation");

  await select("visible");
  await page.getByRole("link", { name: "打开合成旧文档", exact: true }).click();
  await page.waitForFunction(() => window.__taskNotificationsTest.markdownReads?.length === 2);
  await page.evaluate(() => {
    window.__taskNotificationsTest.markdownSaveConflict = true;
    window.__taskNotificationsTest.releaseMarkdown({ ok: true, document: {
      path: "/synthetic/notification-old-task.md", name: "notification-old-task.md",
      content: "需要保留的合成草稿。", size: 30, mtimeMs: 1
    } });
  });
  const editor = page.locator(".rich-markdown-content[contenteditable=true]");
  await editor.waitFor();
  await editor.fill("需要保留的合成草稿。新编辑内容必须保留。");
  await page.locator(".markdown-save-state.dirty").waitFor();
  const blockedTarget = { threadId: "task-waiting", notificationId: "task-dirty-document-switch-regression" };
  await page.evaluate(target => window.__taskNotificationsTest.click(target), blockedTarget);
  await page.locator(".markdown-error-banner").filter({ hasText: "合成保存冲突" }).waitFor();
  assert.equal(await row("visible").getAttribute("class"), "thread-item active", "A notification must not navigate away when the current document cannot save");
  assert.ok((await editor.innerText()).includes("新编辑内容必须保留"), "A blocked notification navigation must preserve the document draft");
  await unread("waiting", true);
  await page.evaluate(() => { window.__taskNotificationsTest.markdownSaveConflict = false; });
  await page.evaluate(target => window.__taskNotificationsTest.click(target), blockedTarget);
  await page.waitForFunction(() => document.querySelector(".thread-item.active strong")?.textContent === "通知测试 waiting");
  await unread("waiting", false);
  assert.equal(await page.locator(".markdown-panel-shell").count(), 0, "Retrying the same notification after saving must finish navigation and close the old document");
  assert.deepEqual(errors, [], "The real App must not throw during notification interactions");
  console.log("Task notification UI passed: foreground suppression; other-task and background alerts; unread/Dock clear; failure vs stop and waiting; denied notification; duplicate terminal; reload persistence; live and startup click routing; delayed/failed finalization; legacy failure recovery; concurrent running/unread indicators; delayed Markdown/PDF isolation; unsaved draft protection and notification retry.");
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
