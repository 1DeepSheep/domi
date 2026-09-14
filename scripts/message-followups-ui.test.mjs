import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// The production MessageContent and Markdown pipeline run against a synthetic
// bridge. No real document, account, filesystem attachment or model is used.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = await fs.mkdtemp(path.join(os.tmpdir(), "domi-followup-ui-cache-"));
const screenshotDir = process.env.DOMI_FOLLOWUP_UI_SCREENSHOTS_DIR
  || await fs.mkdtemp(path.join(os.tmpdir(), "domi-followup-ui-screenshots-"));
await fs.mkdir(screenshotDir, { recursive: true });
const fixture = "/__domi_followup_fixture__.tsx";
const resolvedFixture = path.join(root, fixture.slice(1));
const prompt = '为示例项目准备访谈提纲；保留 context_pending 与 notes_project 字面量。比较 "原计划"，读取 C:\\资料\\研究。\n重点核验产品与付费；<img src=x onerror="alert(1)">。';
const markers = [
  `:codex-followup[准备创始人访谈]{prompt=${JSON.stringify(prompt)}}`,
  '::codex-followup[进入技术尽调]{prompt="制定技术尽调清单与验收标准。"}',
  ':codex-followup[搭建回报情景]{prompt="建立回报与稀释情景模型。"}'
];
const content = [
  "研究材料已整理。",
  "[普通链接](https://example.com/research)",
  "[纪要](/synthetic/交流纪要.md)",
  ...markers.map(marker => `- ${marker}`)
].join("\n\n");
const source = `
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "/src/styles.css";
import "/src/appearance/index.css";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/standard.css";
const test = window.__followupTest = { callbacks: [], opens: [], documents: [], sends: 0, modelRuns: 0, ready: false };
window.workbench = {
  openResource: async target => { test.opens.push(target); return { ok: true }; },
  runCodex: async () => { test.modelRuns++; throw new Error("No model run is allowed"); }
};
const { default: MessageContent } = await import("/src/MessageContent.tsx");
function Harness() {
  const [view, setView] = useState({ content: ${JSON.stringify(content)}, role: "assistant", enabled: true, disabled: false, revision: 0 });
  const [draft, setDraft] = useState("");
  const message = useMemo(() => ({ role: view.role, content: view.content }), [view.role, view.content]);
  const select = useCallback(prompt => { test.callbacks.push(prompt); setDraft(prompt); }, []);
  const openDocument = useCallback(resource => { test.documents.push(resource); }, []);
  useEffect(() => {
    test.render = patch => setView(previous => ({ ...previous, ...patch, revision: previous.revision + 1 }));
    test.ready = true;
  }, []);
  return <main data-revision={view.revision} style={{ maxWidth: 920, padding: 28 }}>
    <form onSubmit={event => { event.preventDefault(); test.sends++; }}>
      <div className={"message " + view.role}><div className="message-body">
        <MessageContent message={message} onOpenDocument={openDocument}
          onSelectFollowup={view.enabled ? select : undefined} followupsDisabled={view.disabled} />
      </div></div>
      <label>草稿<textarea aria-label="草稿" value={draft} onChange={event => setDraft(event.target.value)} /></label>
      <button type="submit">发送草稿</button>
    </form>
  </main>;
}
createRoot(document.getElementById("root")).render(<Harness />);
`;

let server;
let browser;
try {
  server = await createServer({
    configFile: false, root, cacheDir: cache, logLevel: "error", appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: { include: ["react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime", "react-markdown", "remark-gfm", "lucide-react"] },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [{ name: "message-followup-fixture",
      resolveId(id) { if (id === fixture) return resolvedFixture; },
      load(id) { if (id === resolvedFixture) return source; },
      configureServer(vite) { vite.middlewares.use((request, response, next) => {
        if (request.url !== "/") return next();
        response.setHeader("Content-Type", "text/html; charset=utf-8");
        response.end(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="${fixture}"></script></body></html>`);
      }); }
    }]
  });
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {}) });
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  page.setDefaultTimeout(12_000);
  const errors = [];
  const dialogs = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", dialog => { dialogs.push(dialog.message()); void dialog.dismiss(); });
  await page.goto(origin, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__followupTest.ready);
  const message = page.locator(".message-markdown");
  const actions = message.locator("button.message-followup");
  assert.equal(await actions.count(), 3);
  assert.doesNotMatch(await message.innerText(), /codex-followup|prompt=|context_pending/);
  assert.equal(await message.locator("img, script, [onclick], [data-domi-followup-id]").count(), 0,
    "Prompts and synthetic action IDs must not become DOM attributes or elements");
  await actions.nth(0).click();
  assert.equal(await page.getByRole("textbox", { name: "草稿" }).inputValue(), prompt,
    "Quoted text, backslashes, newlines and literal workflow states round-trip unchanged");
  await actions.nth(1).focus();
  await page.keyboard.press("Enter");
  assert.equal(await page.getByRole("textbox", { name: "草稿" }).inputValue(), "制定技术尽调清单与验收标准。");
  assert.deepEqual(await page.evaluate(() => ({ sends: window.__followupTest.sends, modelRuns: window.__followupTest.modelRuns })), { sends: 0, modelRuns: 0 });
  await message.getByRole("link", { name: "普通链接", exact: true }).click();
  await message.getByRole("link", { name: "纪要", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.__followupTest.opens), ["https://example.com/research"]);
  assert.deepEqual(await page.evaluate(() => window.__followupTest.documents), [encodeURI("/synthetic/交流纪要.md")]);

  const copied = await message.evaluate(element => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    const data = new DataTransfer();
    const event = new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    selection.removeAllRanges();
    return { plain: data.getData("text/plain"), html: data.getData("text/html"), handled: event.defaultPrevented };
  });
  assert.equal(copied.handled, true);
  for (const value of [copied.plain, copied.html]) {
    assert.match(value, /准备创始人访谈/);
    assert.doesNotMatch(value, /codex-followup|prompt=|context_pending|data-domi-followup|<button/i);
  }
  await page.screenshot({ path: path.join(screenshotDir, "message-followup-actions.png"), fullPage: true, animations: "disabled" });

  async function render(patch) {
    const revision = Number(await page.locator("main").getAttribute("data-revision"));
    await page.evaluate(patch => window.__followupTest.render(patch), patch);
    await page.waitForFunction(revision => Number(document.querySelector("main").dataset.revision) > revision, revision);
  }
  await render({ disabled: true });
  assert.equal(await actions.nth(0).isDisabled(), true, "Memoized messages update when followupsDisabled changes");
  await actions.nth(0).evaluate(button => button.click());
  assert.equal(await page.evaluate(() => window.__followupTest.callbacks.length), 2);
  await render({ enabled: false, disabled: false });
  assert.equal(await actions.count(), 0);
  assert.equal(await message.locator(".message-followup-label").count(), 3);
  assert.doesNotMatch(await message.innerText(), /codex-followup|prompt=/);
  await render({ enabled: true });
  assert.equal(await actions.count(), 3, "Changing the optional callback updates an otherwise unchanged message");
  await render({ role: "user" });
  assert.equal(await page.locator(".message button").count(), 0);
  assert.match(await page.locator(".message-text").innerText(), /codex-followup/);

  const marker = markers[0];
  for (const sample of [
    `\`${marker}\``, `\`\`\`text\n${marker}\n\`\`\``, `> ${marker}`, `> - ${marker}`,
    `示例：${marker}`, `“${marker}”`, `<div>\n${marker}\n</div>`, `\\${marker}`,
    marker.slice(0, -1), marker.slice(0, -2), marker.slice(0, 24)
  ]) {
    await render({ role: "assistant", content: sample });
    assert.equal(await actions.count(), 0, `Literal examples and incomplete chunks stay non-interactive: ${sample.slice(0, 48)}`);
  }
  await render({ content: marker });
  assert.equal(await actions.count(), 1, "The completed independent marker becomes a suggestion");
  await actions.click();
  assert.equal(await page.getByRole("textbox", { name: "草稿" }).inputValue(), prompt);
  assert.deepEqual(dialogs, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(await page.evaluate(() => ({ sends: window.__followupTest.sends, modelRuns: window.__followupTest.modelRuns })), { sends: 0, modelRuns: 0 });
  console.log("Message followup UI checks passed: historical markers, exact drafts, keyboard/disabled behavior, safe clipboard, ordinary links, literals and incomplete chunks.");
  console.log(`Screenshots: ${screenshotDir}`);
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cache, { recursive: true, force: true });
}
