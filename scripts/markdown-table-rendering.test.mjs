import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";

// Render the actual application components, not a hand-written approximation of
// their HTML. All inputs and bridge responses are synthetic; no app or user data
// is read, and browser requests are restricted to the temporary local server.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "domi-table-test-"));
const artifactDirectory = process.env.DOMI_TABLE_TEST_ARTIFACTS
  ? path.resolve(process.env.DOMI_TABLE_TEST_ARTIFACTS)
  : null;
const fixtureId = "/__domi_markdown_table_fixture__.tsx";
const resolvedFixtureId = path.join(root, fixtureId.slice(1));
const conclusion = "表格后的结论：保留完整信息，窄窗口仅在表格内部左右滚动。";
const longCode = `synthetic_${"readable_token_".repeat(14)}`;
const longUrl = `https://example.invalid/${"synthetic-evidence/".repeat(13)}source`;
const fixtures = [
  {
    id: "two-columns", columns: 2, rows: 3,
    markdown: "| 项目字段 | 当前信息 |\n| --- | --- |\n| 研究方向 | 智能语音与人机交互 |\n| 当前状态 | 待验证；需要补充产品的独立测试结果 |\n| 资料来源 | 公开技术说明与合成测试材料 |"
  },
  {
    id: "peer-comparison", columns: 3, rows: 3, equalPeers: true,
    markdown: "| 维度 | 方案甲 | 方案乙 |\n| --- | --- | --- |\n| 主要能力 | 语音转文字、标点和基础编辑，支持连续表达 | 语音转文字、标点和基础编辑，支持连续表达 |\n| 最有价值场景 | 办公室输入、走动输入、长段表达与跨应用操作 | 办公室输入、走动输入、长段表达与跨应用操作 |\n| 隐私与成熟度 | 明确按键才录音，处理范围需在独立测试中核验 | 明确按键才录音，处理范围需在独立测试中核验 |"
  },
  {
    id: "long-analysis", columns: 3, rows: 3,
    markdown: "| 层级 | 主要方案 | 研究判断 |\n| --- | --- | --- |\n| 智能音频平台 | 方案甲、方案乙、方案丙 | 已有语音、连接和开发工具链。研究需要区分公开产品介绍与真实运行证据；不能因为单次演示成功，就推断持续准确率、实际成本和长期稳定性。 |\n| 高出货量主控 | 方案丁、方案戊 | 成本、渠道和量产生态具有优势，仍需核实实际使用场景与连续转写的表现。 |\n| 专用低功耗语音 | 方案己、方案庚 | 功能接近目标，但模型容量、唤醒模式和端侧处理边界仍有差异，应使用相同测试材料进行比较。 |"
  },
  {
    id: "six-columns", columns: 6, rows: 3, numericColumns: [1, 2, 3, 4],
    markdown: "| 测试方案 | 样本数 | 准确率 | 延迟毫秒 | 月成本 | 备注 |\n| --- | ---: | ---: | ---: | ---: | --- |\n| 合成方案甲 | 1,200 | 98.5% | 120 | 15.00 | 同口径测试，不代表真实产品结论 |\n| 合成方案乙 | 850 | 97.2% | 145 | 12.50 | 包含长中文与中英混合输入 |\n| 合成方案丙 | 2,050 | 99.1% | 110 | 18.00 | 数据完全为回归测试而虚构 |"
  },
  {
    id: "long-tokens", columns: 3, rows: 2,
    markdown: `| 类型 | 内容 | 说明 |\n| --- | --- | --- |\n| 长代码 | \`${longCode}\` | 中英混排与 inline code 不应撑破页面。 |\n| 长链接 | [${longUrl}](${longUrl}) | 保留完整 URL 与可点击链接，允许在单元格内断行。 |`
  }
].map((fixture) => ({ ...fixture, markdown: `${fixture.markdown}\n\n${conclusion}` }));

const fixtureSource = `
import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import MessageContent from "/src/MessageContent.tsx";
import RichMarkdownEditor from "/src/RichMarkdownEditor.tsx";
import "/src/styles.css";
const fixtures = ${JSON.stringify(fixtures)};
function Harness() {
  const [state, setState] = useState({ surface: "chat", id: fixtures[0].id, markdown: fixtures[0].markdown });
  useEffect(() => {
    window.__domiTableTest.render = (surface, id, markdown) => {
      const fixture = fixtures.find((item) => item.id === id);
      setState({ surface, id, markdown: markdown ?? fixture.markdown });
    };
    window.__domiTableTest.ready = true;
  }, []);
  return <main className="table-test-frame" data-surface={state.surface} data-case={state.id}>
    {state.surface === "chat"
      ? <div className="message assistant"><div className="message-body"><MessageContent message={{ role: "assistant", content: state.markdown }} onOpenDocument={() => {}} /></div></div>
      : <div className="table-test-editor"><RichMarkdownEditor key={state.id} documentPath="/synthetic/table-regression.md" markdown={state.markdown} onChange={(value) => { window.__domiTableTest.lastMarkdown = value; }} /></div>}
  </main>;
}
window.__domiTableTest = { ready: false, lastMarkdown: null };
createRoot(document.getElementById("root")).render(<Harness />);
`;
const fixtureHtml = `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="${fixtureId}"></script><style>
/* The fixture exposes overflow instead of hiding it like the application shell.
 * Only the unrelated editing toolbar is hidden; document/table CSS is unaltered. */
html, body, #root { width: 100%; height: auto; min-height: 100%; overflow: visible; }
.table-test-frame { width: 100%; min-width: 0; padding: 16px; }
.table-test-editor { width: 100%; height: 960px; min-width: 0; }
.table-test-editor .rich-markdown-formatbar { display: none; }
.table-test-editor .rich-markdown-editor { grid-template-rows: minmax(0, 1fr); }
</style></body></html>`;

let server;
let browser;
const failures = [];
let tested = 0;
try {
  if (artifactDirectory) await fs.mkdir(artifactDirectory, { recursive: true });
  server = await createServer({
    configFile: false,
    root,
    cacheDir: cacheDirectory,
    logLevel: "error",
    appType: "custom",
    esbuild: { jsx: "automatic", jsxImportSource: "react" },
    optimizeDeps: {
      noDiscovery: true,
      include: [
        "react", "react-dom/client", "react/jsx-runtime", "react/jsx-dev-runtime",
        "react-markdown", "remark-gfm", "lucide-react", "@tiptap/core", "@tiptap/react",
        "@tiptap/starter-kit", "@tiptap/markdown", "@tiptap/extension-table", "@tiptap/pm/model", "@tiptap/pm/state",
        "@tiptap/extension-image", "@tiptap/extension-task-item", "@tiptap/extension-task-list"
      ]
    },
    server: { host: "127.0.0.1", port: 0, hmr: false },
    plugins: [{
      name: "domi-table-regression-fixture",
      resolveId(id) { if (id === fixtureId) return resolvedFixtureId; },
      load(id) { if (id === resolvedFixtureId) return fixtureSource; },
      configureServer(viteServer) {
        viteServer.middlewares.use((request, response, next) => {
          if (request.url !== "/") return next();
          response.setHeader("Content-Type", "text/html; charset=utf-8");
          response.end(fixtureHtml);
        });
      }
    }]
  });
  await server.listen();
  const address = server.httpServer.address();
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.DOMI_TABLE_TEST_BROWSER ? { executablePath: process.env.DOMI_TABLE_TEST_BROWSER } : {})
  });
  const context = await browser.newContext({ viewport: { width: 980, height: 1100 }, deviceScaleFactor: 1 });
  await context.route("**/*", (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const page = await context.newPage();
  const browserErrors = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto(origin, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForFunction(() => window.__domiTableTest?.ready, undefined, { timeout: 30000 }).catch((error) => {
    throw new Error(`${error.message}\nBrowser errors: ${browserErrors.join("\n")}`, { cause: error });
  });

  async function render(surface, fixture, markdown = undefined) {
    await page.evaluate(({ surface, id, markdown }) => window.__domiTableTest.render(surface, id, markdown), { surface, id: fixture.id, markdown });
    await page.waitForFunction(({ surface, id }) => {
      const frame = document.querySelector(".table-test-frame");
      return frame?.getAttribute("data-surface") === surface && frame?.getAttribute("data-case") === id;
    }, { surface, id: fixture.id });
    await page.locator(surface === "chat" ? ".message-markdown" : ".rich-markdown-content").waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  for (const width of [980, 620, 360]) {
    await page.setViewportSize({ width, height: 1100 });
    for (const surface of ["chat", "editor"]) {
      for (const fixture of fixtures) {
        const label = `${surface}/${fixture.id}/${width}px`;
        const wrapperSelector = surface === "chat" ? ".markdown-table-scroll" : ".tableWrapper";
        try {
          await render(surface, fixture);
          const wrapper = page.locator(wrapperSelector);
          await wrapper.waitFor();
          const metrics = await wrapper.evaluate((element) => {
            const table = element.querySelector("table");
            const rows = [...table.rows];
            const cells = rows.map((row) => [...row.cells].map((cell) => {
              const style = getComputedStyle(cell);
              const rect = cell.getBoundingClientRect();
              return {
                text: cell.textContent, width: rect.width, minWidth: parseFloat(style.minWidth),
                paddingLeft: parseFloat(style.paddingLeft), paddingTop: parseFloat(style.paddingTop),
                rightBorder: parseFloat(style.borderRightWidth), bottomBorder: parseFloat(style.borderBottomWidth),
                align: style.textAlign, verticalAlign: style.verticalAlign, background: style.backgroundColor
              };
            }));
            const wrapperStyle = getComputedStyle(element);
            return {
              cells, layout: getComputedStyle(table).tableLayout,
              width: element.clientWidth, scrollWidth: element.scrollWidth,
              parentWidth: element.parentElement.clientWidth,
              overflowX: wrapperStyle.overflowX,
              outerBorder: parseFloat(wrapperStyle.borderLeftWidth),
              bodyWidth: document.body.scrollWidth, viewportWidth: document.documentElement.clientWidth,
              content: element.closest(".message-markdown, .rich-markdown-content").textContent
            };
          });
          assert.equal(metrics.cells.length, fixture.rows + 1, `${label}: all rows must survive rendering`);
          assert.ok(metrics.cells.every((row) => row.length === fixture.columns), `${label}: all columns must survive rendering`);
          assert.equal(metrics.layout, "auto", `${label}: columns must not use fixed equal widths`);
          assert.equal(metrics.overflowX, "auto", `${label}: tables need their own horizontal scroll container`);
          assert.ok(metrics.outerBorder >= 1, `${label}: table needs a visible outer boundary`);
          assert.ok(metrics.bodyWidth <= metrics.viewportWidth + 1, `${label}: table must not overflow the page (${metrics.bodyWidth} > ${metrics.viewportWidth})`);
          assert.ok(metrics.width <= metrics.parentWidth + 1, `${label}: wrapper must stay within its parent`);
          assert.ok(metrics.content.includes(conclusion), `${label}: content after the table must remain intact`);
          for (const [rowIndex, row] of metrics.cells.entries()) {
            for (const [columnIndex, cell] of row.entries()) {
              const cellLabel = `${label}, cell ${rowIndex}/${columnIndex}`;
              assert.ok(cell.width >= cell.minWidth - 1, `${cellLabel}: minimum readable cell width must apply`);
              assert.ok(cell.paddingLeft >= 10 && cell.paddingTop >= 7, `${cellLabel}: text needs readable spacing`);
              assert.equal(cell.verticalAlign, "top", `${cellLabel}: multi-line comparisons must top-align`);
              if (columnIndex < fixture.columns - 1) assert.ok(cell.rightBorder >= 1, `${cellLabel}: adjacent columns need a separator`);
              if (rowIndex < fixture.rows) assert.ok(cell.bottomBorder >= 1, `${cellLabel}: adjacent rows need a separator`);
              if (rowIndex === 0) assert.ok(!["transparent", "rgba(0, 0, 0, 0)", "rgb(255, 255, 255)"].includes(cell.background), `${cellLabel}: headers need a distinct background`);
              if (fixture.numericColumns?.includes(columnIndex)) assert.equal(cell.align, "right", `${cellLabel}: GFM numeric alignment must survive`);
            }
          }
          if (fixture.equalPeers) {
            const [left, right] = metrics.cells[0].slice(1).map((cell) => cell.width);
            assert.ok(Math.max(left, right) / Math.min(left, right) < 1.2, `${label}: equivalent peers must not receive an arbitrary 27/58 split`);
          }
          if (fixture.id === "long-tokens") {
            assert.ok(metrics.content.includes(longCode) && metrics.content.includes(longUrl), `${label}: long tokens must not be truncated`);
            assert.equal(await wrapper.locator("a").first().getAttribute("href"), longUrl, `${label}: link target must be preserved`);
            assert.ok(metrics.scrollWidth <= Math.max(metrics.width, 900), `${label}: long tokens must wrap instead of creating a huge canvas`);
          }
          if (surface === "chat") {
            assert.equal(await wrapper.getAttribute("role"), "region", `${label}: scroll region needs accessible semantics`);
            assert.equal(await wrapper.getAttribute("tabindex"), "0", `${label}: keyboard users must be able to focus the table`);
          }
          if (fixture.columns === 6 && width <= 620) {
            assert.ok(metrics.scrollWidth > metrics.width + 20, `${label}: wide tables must scroll instead of crushing columns`);
            await wrapper.scrollIntoViewIfNeeded();
            await wrapper.hover();
            await page.mouse.wheel(160, 0);
            await page.waitForFunction((selector) => document.querySelector(selector).scrollLeft > 0, wrapperSelector, { timeout: 3000 });
            await wrapper.evaluate((element) => { element.scrollLeft = 0; });
          }
          if (artifactDirectory && ["peer-comparison", "long-analysis", "six-columns", "long-tokens"].includes(fixture.id)) {
            await wrapper.screenshot({ path: path.join(artifactDirectory, `${surface}-${fixture.id}-${width}.png`) });
          }
          tested += 1;
        } catch (error) {
          failures.push(`${label}: ${error.message}`);
          if (artifactDirectory) await page.screenshot({ path: path.join(artifactDirectory, `FAILED-${surface}-${fixture.id}-${width}.png`), fullPage: true }).catch(() => {});
        }
      }
    }
  }

  // A streaming reply initially has only a header. Do not require body rows for
  // table styles, and do not leave an orphan wrapper when it is not yet a table.
  const streamingFixture = fixtures[1];
  const header = "| 维度 | 方案甲 | 方案乙 |";
  await render("chat", streamingFixture, header);
  await page.waitForFunction(() => document.querySelectorAll(".message-markdown table").length === 0);
  assert.equal(await page.locator(".markdown-table-scroll").count(), 0, "Incomplete streamed tables must remain ordinary text");
  await render("chat", streamingFixture, `${header}\n| --- | --- | --- |`);
  await page.locator(".markdown-table-scroll table").waitFor();
  assert.equal(await page.locator(".markdown-table-scroll th").count(), 3, "Header-only streamed tables must render with all headers");
  assert.equal(await page.locator(".markdown-table-scroll td").count(), 0, "Streaming must not invent table body content");
  await render("chat", streamingFixture);
  assert.equal(await page.locator(".markdown-table-scroll td").count(), 9, "Completing a streamed table must preserve all rows");

  // Enabling the editor's wrapper must not leak HTML into saved Markdown or
  // lose table cells when the user edits the surrounding document.
  await render("editor", streamingFixture);
  const expectedCellTexts = await page.locator(".tableWrapper :is(th, td)").allTextContents();
  await page.locator(".rich-markdown-content > p").last().click();
  await page.keyboard.insertText(" table-edit-check");
  await page.waitForFunction(() => window.__domiTableTest.lastMarkdown?.includes("table-edit-check"));
  const savedMarkdown = await page.evaluate(() => window.__domiTableTest.lastMarkdown);
  assert.doesNotMatch(savedMarkdown, /<div\b|tableWrapper|markdown-table-scroll/, "Table display wrappers must not leak into saved Markdown");
  for (const text of expectedCellTexts) {
    assert.ok(savedMarkdown.includes(text), "Editing the document must preserve every table cell");
  }
  assert.equal(savedMarkdown.split("\n").filter((line) => line.trim().startsWith("|")).length, streamingFixture.rows + 2, "Saving must preserve the Markdown table structure");

  // Exercise the real editor's ordinary selection-copy path, not just the
  // separate full-document export button. Legacy emphasized headings must not
  // become online-document headings when the user copies a selected passage.
  for (const markdown of [
    "## ++团队的核心组合不是单一 EDA 工具团队++\n\n## 产品与技术\n\n正文内容。",
    "## <u>编辑器保存出的重点判断</u>\n\n## 产品与技术\n\n正文内容。"
  ]) {
    await render("chat", streamingFixture);
    await render("editor", streamingFixture, markdown);
    const copied = await page.locator(".rich-markdown-content").evaluate((element) => {
      const editor = element.editor;
      const before = JSON.stringify(editor.getJSON());
      editor.commands.selectAll();
      const all = editor.view.serializeForClipboard(editor.state.selection.content());
      const end = editor.state.doc.firstChild.nodeSize - 1;
      editor.commands.setTextSelection({ from: 2, to: end - 1 });
      const partial = editor.view.serializeForClipboard(editor.state.selection.content());
      return { all: all.dom.innerHTML, partial: partial.dom.innerHTML, before, after: JSON.stringify(editor.getJSON()) };
    });
    assert.match(copied.all, /<p[^>]*><strong><u[^>]*>/, "Ordinary selection copy must export underlined emphasis as bold body text");
    assert.match(copied.all, /<h2>产品与技术<\/h2>/, "Real section headings must survive ordinary selection copy");
    assert.doesNotMatch(copied.partial, /<h[1-6]\b/, "Partial selection of legacy emphasis must not regain a heading wrapper");
    assert.match(copied.partial, /<strong><u[^>]*>/, "Partial selection must keep bold and underline formatting");
    assert.equal(copied.before, copied.after, "Clipboard normalization must never rewrite the source document");
  }

  await render("chat", streamingFixture);
  await render("editor", streamingFixture, "## 正常标题与<u>部分下划线</u>\n\n| 工作经历 |\n| --- |\n| IBM<br />Dell EMC<br>趋动科技 |\n\n`<u>代码示例</u><br>`");
  const portableCopy = await page.locator(".rich-markdown-content").evaluate((element) => {
    const editor = element.editor;
    const before = JSON.stringify(editor.getJSON());
    editor.commands.selectAll();
    const copied = editor.view.serializeForClipboard(editor.state.selection.content());
    const table = copied.dom.querySelector("table");
    const heading = editor.state.doc.firstChild;
    const underlined = heading.lastChild;
    const headingEnd = heading.nodeSize - 1;
    editor.commands.setTextSelection({ from: headingEnd - underlined.nodeSize, to: headingEnd });
    const partialHeading = editor.view.serializeForClipboard(editor.state.selection.content());
    return {
      html: copied.dom.innerHTML, text: copied.text,
      partialHeading: partialHeading.dom.innerHTML,
      tableBorder: table?.style.borderCollapse,
      cellBorder: table?.querySelector("td")?.style.borderWidth,
      breakCount: table?.querySelectorAll("br").length,
      before, after: JSON.stringify(editor.getJSON())
    };
  });
  assert.match(portableCopy.html, /<h2[^>]*>正常标题与<u[^>]*>部分下划线<\/u><\/h2>/, "Partially underlined real headings must not be demoted");
  assert.match(portableCopy.partialHeading, /<h2[^>]*><u[^>]*>部分下划线<\/u><\/h2>/, "Copying only an underlined fragment of a real heading must retain its source semantics");
  assert.doesNotMatch(portableCopy.html, /tableWrapper/, "Application-only table wrappers must not enter the clipboard");
  assert.equal(portableCopy.tableBorder, "collapse", "Copied tables need portable inline table styling");
  assert.equal(portableCopy.cellBorder, "1px", "Copied table cells need portable borders");
  assert.equal(portableCopy.breakCount, 2, "Copied table br markup must remain real line breaks");
  assert.match(portableCopy.html, /<code>&lt;u&gt;代码示例&lt;\/u&gt;&lt;br&gt;<\/code>/, "Code examples must remain literal instead of becoming formatting");
  assert.equal(portableCopy.before, portableCopy.after, "Copying table and heading selections must leave source content unchanged");
  assert.deepEqual(browserErrors, [], "Table rendering must not produce browser runtime errors");
  assert.deepEqual(failures, [], `Rendered table regressions:\n${failures.join("\n")}`);
  console.log(`Markdown table DOM regression passed: ${tested} real component/viewport fixtures, streamed header transitions, editor Markdown round-trip and ordinary selection clipboard fidelity.`);
  if (artifactDirectory) console.log(`Synthetic visual QA screenshots: ${artifactDirectory}`);
} finally {
  await browser?.close();
  await server?.close();
  await fs.rm(cacheDirectory, { recursive: true, force: true });
}
