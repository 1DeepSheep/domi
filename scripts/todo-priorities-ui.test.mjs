import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-todo-ui-"));
const fixture = "/__domi_todo_priorities_fixture__.tsx";
const fixturePath = path.join(root, fixture.slice(1));
const source = `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import TodoPriorities from "/src/components/TodoPriorities";
import "/src/styles.css";
const task = (id, extra = {}) => ({ id, title: "确认合成项目 " + id + " 的试点反馈", summary: "试点反馈已归档",
  reason: "客户完成试用，需要明确是否进入下一阶段验证", priority: "P2", category: "project-follow-up", status: "open", signalKey: id,
  source: { kind: "project", recordId: "synthetic-" + id, displayName: "合成项目 " + id }, dueAt: null,
  suggestedAction: { kind: "review", label: "读取试点反馈并列出待确认的问题", prompt: "读取已归档资料" },
  createdAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-25T00:00:00Z", ...extra });
const initial = [task("B"), task("A", { dueAt: "2026-10-26" }), task("C"), task("D"), task("done", { status: "done" })];
window.__todoTest = { executed: [] };
function Harness() {
  const [tasks, setTasks] = useState(initial);
  const [busy, setBusy] = useState(false);
  window.__todoTest.setTasks = setTasks;
  window.__todoTest.setBusy = setBusy;
  return <main style={{ padding: 16, minWidth: 0, width: "100%", boxSizing: "border-box" }}><TodoPriorities tasks={tasks}
    now={new Date(2026, 9, 26, 10).getTime()} busy={busy}
    subtitle="每天上午 9 点更新；未打开时，下次打开自动补上"
    onExecute={task => window.__todoTest.executed.push(task.id)} /></main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
`;

let server;
let browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false, fs: { allow: [root, await fs.realpath(path.join(root, "node_modules"))] } },
    plugins: [{ name: "todo-priorities-fixture",
      resolveId(id) { if (id === fixture) return fixturePath; },
      load(id) { if (id === fixturePath) return source; },
      configureServer(vite) {
        vite.middlewares.use((request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#root{width:100%;min-width:0;margin:0;overflow:auto}</style></head><body><div id="root"></div><script type="module" src="' + fixture + '"></script></body></html>');
        });
      }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true,
    ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const page = await browser.newPage({ viewport: { width: 1080, height: 900 } });
  const errors = [];
  const external = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "今天先做这几件事" }).waitFor();
  assert.equal(await page.locator(".todo-priority").count(), 3);
  assert.equal(await page.locator(".todo-priority h3").first().textContent(), "确认合成项目 A 的试点反馈");
  assert.match(await page.locator(".todo-priority-reason").first().textContent(), /今天到期.*客户完成试用/);
  assert.deepEqual(await page.evaluate(() => window.__todoTest.executed), [], "Rendering recommendations must never execute work");
  await page.getByRole("button", { name: "开始处理：确认合成项目 A 的试点反馈" }).click();
  assert.deepEqual(await page.evaluate(() => window.__todoTest.executed), ["A"]);
  await page.evaluate(() => window.__todoTest.setBusy(true));
  await page.waitForFunction(() => [...document.querySelectorAll(".todo-priority-start")].every(button => button.disabled));
  await page.setViewportSize({ width: 390, height: 900 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "Narrow viewport must not crop actions or content horizontally");
  for (const button of await page.locator(".todo-priority-start").all()) {
    const box = await button.boundingBox();
    assert.ok(box && box.x >= 0 && box.x + box.width <= 390);
  }
  await page.evaluate(() => window.__todoTest.setTasks([]));
  await page.getByText("当前没有未完成的待办。", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button").count(), 0);
  assert.equal(await page.locator(".todo-priority").count(), 0);
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("Todo priorities UI passed: order/evidence, explicit action, busy, 390px layout, empty state, no external requests.");
} finally {
  if (browser) await browser.close();
  if (server) await server.close();
  await fs.rm(cache, { recursive: true, force: true });
}
