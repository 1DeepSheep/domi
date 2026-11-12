import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Exercise real App cancellation and subsequent submission with synthetic data.
// No production state, native filesystem, external request or model is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-stop-app-cache-"));
const fixture = "/__domi_stop_app_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const source = `
import React from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
const fallback = (await import("/src/bridge?stop-fixture")).workbench;
const state = window.__stopTest = { runs: [], issues: [], listener: null, finish: null, stopMode: "normal" };
const settings = { ...(await fallback.loadSettings()).settings, onboardingComplete: true,
 codexPath: "/synthetic/codex", plaudConnectionMode: "disabled", localRepositoryDir: "/synthetic/library", radarFollowedDomains: [] };
const ready = { ...(await fallback.checkCodex()), ok: true, connectionOk: true,
 path: "/synthetic/codex", workspacePath: "/synthetic/thread", transport: "app-server",
 account: {type:"chatgpt", email:"fixture@example.com"}, pluginSetup:{ok:true,status:"ready",version:"7.0.21"}, error:"" };
localStorage.clear();
window.workbench = { ...fallback,
 loadSettings: async () => ({ok:true, settings}),
 loadState: async defaults => ({ok:true,isNew:false,state:{...defaults, activeThreadId:"cancel-fixture",threads:[{
 ...defaults.threads[0], id:"cancel-fixture", title:"停止测试", workspacePath:"/synthetic/thread", codexThreadId:undefined,
 messages:[{id:"initial",role:"assistant",status:"done",content:"测试准备就绪。"}]
 }]}}),
 checkCodex: async () => ready,
 onCodexEvent: listener => {state.listener=listener;return ()=>{};},
 runCodex: request => {state.runs.push(request);return new Promise(resolve=>{state.finish=()=>resolve({ok:true,stopped:true,runId:request.runId,output:""});});},
 stopCodex: async () => {
 if (state.stopMode === "inactive") return {ok:true,inactive:true};
 if (state.stopMode === "completed") return {ok:true,inactive:true,terminalEvent:{type:"completed",runId:state.runs.at(-1).runId,output:"合成任务已完成。"}};
 state.finish();return {ok:true};
},
 listWeeklyNews: async () => ({ok:true,items:[],total:0,radarCheckedThrough:Date.now()}),
 listDomiTasks: async () => ({ok:true,configured:true,tasks:[],syncedAt:Date.now()}),
 reportRendererIssue: issue => state.issues.push(issue)
};
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
    plugins: [{ name: "stop-app-fixture",
      resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`);
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle" });
  const composer = page.getByRole("textbox", { name: "输入投资任务", exact: true });
  await composer.waitFor();
  const stop = page.getByRole("button", {name:"停止当前 Codex 运行",exact:true});
  for (const mode of ["normal", "eventFirst", "inactive", "completed"]) {
    await page.evaluate(mode => {window.__stopTest.stopMode=mode;}, mode);
    await composer.fill("执行合成测试任务");
    await page.getByRole("button", {name:"发送给 Codex",exact:true}).click();
    await page.waitForFunction(() => !!window.__stopTest.finish);
    await stop.waitFor();
    if (mode === "eventFirst") {
      await page.evaluate(() => {
        const s=window.__stopTest;
        s.listener({type:"stopped",runId:s.runs.at(-1).runId,output:""});
        s.finish();
      });
    } else {
      await stop.click();
    }
    await stop.waitFor({state:"detached"});
    await page.waitForFunction(() => document.querySelectorAll(".message.assistant.running").length === 0);
    if (mode === "completed") assert.match(await page.locator(".message.assistant.done").last().innerText(), /合成任务已完成/);
    else if (mode !== "inactive") assert.match(await page.locator(".message.assistant.done").last().innerText(), /任务已停止/);
    await page.evaluate(() => {window.__stopTest.finish=null;});
  }
  assert.equal(await page.evaluate(() => window.__stopTest.runs.length), 4, "Stopping releases the run lock for the next explicit submission");
  assert.deepEqual(await page.evaluate(() => window.__stopTest.issues), []);
  assert.deepEqual(errors, []);
  console.log("Stop cancellation UI passed: preparation result without event, event/result deduplication, released run lock, no stuck spinner.");

} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
