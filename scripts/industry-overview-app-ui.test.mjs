import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Verify the production App navigation, rather than just the reader component.
// All native operations use isolated synthetic data; no user library/model runs.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-industry-app-"));
const fixture = "/__industry_app_fixture__.tsx";
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
const fallback = (await import("/src/bridge?industry-app-fallback")).workbench;
const state = window.__industryAppTest = { requests: [], databaseReads: 0, modelRuns: 0, issues: [], hold: false, pending: [], revision: 1 };
const settings = { ...(await fallback.loadSettings()).settings, onboardingComplete: true, storageBackend: "local",
  localRepositoryDir: "/synthetic/library", localDatabasePath: "/synthetic/db", plaudConnectionMode: "disabled", radarFollowedDomains: [] };
const entry = { domain: "合成行业", subdomain: "", title: "合成行业速览", path: "/synthetic/library/行业速览.md", projectCount: 4 };
window.workbench = { ...fallback,
  loadSettings: async () => ({ ok: true, settings }),
  loadState: async defaults => ({ ok: true, isNew: false, state: defaults }),
  checkCodex: async () => ({ ...(await fallback.checkCodex()), ok: true, connectionOk: true, pluginSetup: { ok: true, status: "ready", version: "7.0.14" } }),
  syncDomi: async () => ({ ok: true }),
  listDomiTasks: async () => ({ ok: true, configured: true, tasks: [], syncedAt: Date.now() }),
  listWeeklyNews: async () => ({ ok: true, items: [], total: 0, radarCheckedThrough: Date.now() }),
  listDomiDatabase: async () => { state.databaseReads++; throw new Error("Opening an industry board must not load the editable database"); },
  refreshIndustryOverviews: async request => {
    state.requests.push(request || {});
    if (state.hold) await new Promise(resolve => state.pending.push(resolve));
    return { ok: true, entries: [entry], projectCount: 4, news: [{ recordId: "synthetic-news", title: "合成行业新进展 " + state.revision,
      domains: [entry.domain], subdomains: [], publishedAt: Date.now(), worthFollowing: true, source: "合成信源", url: "https://example.test/item" }] };
  },
  readMarkdown: async ({ resource }) => ({ ok: true, document: { path: resource, name: "行业速览.md", content: "## 研究正文\\n\\n合成研究内容完整保留。", mtimeMs: 1 } }),
  runCodex: async () => { state.modelRuns++; throw new Error("Board browsing must not use a model"); },
  testCodexConnection: async () => { throw new Error("No model probe allowed"); },
  reportRendererIssue: issue => state.issues.push(issue)
};
const { default: App } = await import("/src/App");
createRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);
`;
let server, browser;
try {
  server = await createServer({ configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "@tiptap/pm/model", "@tiptap/pm/state"] },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [{ name: "industry-app-test", resolveId(id) { if (id === fixture) return path.join(root, fixture); },
      load(id) { if (id === path.join(root, fixture)) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end('<html><body><div id="root"></div><script type="module" src="'+fixture+'"></script></body></html>');
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  const board = page.getByRole("button", { name: "行业看板", exact: true });
  const card = page.getByRole("button", { name: "查看合成行业行业", exact: true });
  await board.click(); await card.waitFor();
  await page.getByText("合成行业新进展 1", { exact: true }).first().waitFor();
  assert.ok((await page.evaluate(() => window.__industryAppTest.requests)).every(request => request.force !== true), "Opening must use normal reads");
  await page.getByRole("button", { name: /^待办事项/ }).click();
  await page.evaluate(() => { window.__industryAppTest.hold = true; });
  const started = performance.now();
  await board.click(); await card.waitFor();
  const returnMs = Math.round(performance.now() - started);
  assert.ok(returnMs < 1000, `Cached board returns before held IPC, observed ${returnMs} ms`);
  await page.waitForFunction(() => window.__industryAppTest.pending.length > 0);
  assert.equal(await page.locator(".industry-overview-reader").getAttribute("aria-busy"), "false");
  await card.click();
  await page.getByText("合成研究内容完整保留。", { exact: true }).waitFor();
  await page.evaluate(() => { const s = window.__industryAppTest; s.hold = false; s.pending.splice(0).forEach(resolve => resolve()); });
  await page.getByText("合成研究内容完整保留。", { exact: true }).waitFor();
  await page.getByRole("button", { name: "全行业总览", exact: true }).click();
  await page.evaluate(() => { window.__industryAppTest.revision = 2; });
  await page.getByRole("button", { name: "刷新行业看板", exact: true }).click();
  await page.getByText("合成行业新进展 2", { exact: true }).first().waitFor();
  const state = await page.evaluate(() => window.__industryAppTest);
  assert.equal(state.requests.at(-1).force, true, "Toolbar refresh really forces a source refresh");
  assert.equal(state.databaseReads, 0, "Industry navigation avoids duplicate whole-database loads");
  assert.equal(state.modelRuns, 0, "Navigation and refreshing cost no model tokens");
  assert.deepEqual(state.issues, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, returnWhileIpcHeldMs: returnMs, databaseReads: state.databaseReads, modelRuns: state.modelRuns }));
} finally {
  await browser?.close(); await server?.close(); await fs.rm(cache, { recursive: true, force: true });
}
