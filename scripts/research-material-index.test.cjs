const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  PARSER_VERSION, parseMarkdownStructure, prepareMaterialIndex, materialIndexContext,
  markMaterialIndexInjected, readMaterialLines
} = require("../electron/research-material-index.cjs");
const { projectInventory, prepareProjectResearchCache, preparedProjectResearchCacheContext,
  markProjectMaterialIndexInjected } = require("../electron/research-cache.cjs");

function memoryStore() {
  const values = new Map();
  return { values, loadCache: key => values.has(key) ? { value: values.get(key) } : null,
    saveCache: (key, value) => { values.set(key, value); return { value }; }, pruneCache() {} };
}

async function fixture(callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-material-index-"));
  const store = memoryStore();
  const prepare = async (options = {}) => prepareMaterialIndex({ stateStore: store,
    identityKey: "synthetic-project", workspacePath: root, inventory: await projectInventory(root),
    budget: { maxMs: 1_000, ...(options.budget || {}) }, ...options });
  try { await callback({ root, store, prepare }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}

test("Markdown structure retains exact line locators without treating fenced headings as sections", () => {
  const text = "# 项目\n\n完整第一段。\n第二行证据。\n\n## 财务\n\n| 年度 | 收入 |\n| --- | --- |\n| 2025 | 100 |\n\n```md\n# 不是标题\n```\n\n- 完整行动项\n- 第二项";
  const parsed = parseMarkdownStructure(text);
  assert.equal(parsed.parserVersion, PARSER_VERSION);
  assert.equal(parsed.title, "项目");
  assert.equal(parsed.complete, true);
  assert.deepEqual(parsed.blocks.map(({ kind, startLine, endLine }) => [kind, startLine, endLine]), [
    ["heading", 1, 1], ["paragraph", 3, 4], ["heading", 6, 6], ["table", 8, 10], ["code", 12, 14], ["list", 16, 17]
  ]);
});

test("same-size and restored-mtime edits invalidate parsed content and stale line reads", async () => fixture(async ({ root, prepare }) => {
  const file = path.join(root, "研究.md");
  fs.writeFileSync(file, "# Research\n\nOld evidence.\n");
  const before = fs.statSync(file);
  const first = await prepare();
  const unchanged = await prepare();
  assert.equal(unchanged.files[0].reused, true);
  fs.writeFileSync(file, "# Research\n\nNew evidence.\n");
  fs.utimesSync(file, before.atime, before.mtime);
  assert.equal(fs.statSync(file).size, before.size);
  const changed = await prepare();
  assert.notEqual(changed.files[0].sha256, first.files[0].sha256);
  assert.equal(changed.files[0].reused, false);
  assert.equal(changed.files[0].changed, true);
  await assert.rejects(readMaterialLines({ workspacePath: root, relativePath: "研究.md",
    sha256: first.files[0].sha256, startLine: 3, endLine: 3 }), /Material changed/);
  const read = await readMaterialLines({ workspacePath: root, relativePath: "研究.md",
    sha256: changed.files[0].sha256, startLine: 3, endLine: 3 });
  assert.equal(read.text, "New evidence.");
  assert.equal(read.complete, true);
}));

test("parser version changes force rebuilding structure even for identical bytes", async () => fixture(async ({ root, prepare }) => {
  fs.writeFileSync(path.join(root, "研究.md"), "# Research\n\nEvidence");
  const first = await prepare();
  const next = await prepare({ parserVersion: "markdown-lines-v2-test" });
  assert.equal(next.files[0].sha256, first.files[0].sha256);
  assert.equal(next.files[0].reused, false);
  assert.equal(next.files[0].parserVersion, "markdown-lines-v2-test");
  assert.notEqual(next.signature, first.signature);
}));

test("only accepted context is remembered, new threads receive it, and unchanged same-thread context is omitted", async () => fixture(async ({ root, prepare }) => {
  const file = path.join(root, "研究.md");
  fs.writeFileSync(file, "# Research\n\nEvidence");
  const first = await prepare();
  assert.match(materialIndexContext(first, "one"), /sha256/);
  assert.match(materialIndexContext(await prepare(), "one"), /sha256/, "preparing without acceptance must not suppress future context");
  markMaterialIndexInjected(first, "one");
  const same = await prepare();
  assert.equal(materialIndexContext(same, "one"), "");
  assert.match(materialIndexContext(same, "two"), /DOMI_LOCAL_MATERIAL_INDEX/);
  fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
  assert.equal(materialIndexContext(await prepare(), "one"), "", "touching identical content does not reinject its index");
  fs.appendFileSync(file, "\n\nNew evidence");
  assert.match(materialIndexContext(await prepare(), "one"), /changed_or_new/);
}));

test("budget exhaustion, partial structure and unparsed PDF never claim complete evidence", async () => fixture(async ({ root, prepare }) => {
  fs.writeFileSync(path.join(root, "a.md"), "# Research\n\nFirst\n\nSecond");
  fs.writeFileSync(path.join(root, "b.md"), "# More\n\nEvidence");
  fs.writeFileSync(path.join(root, "source.pdf"), "%PDF-synthetic-unparsed");
  const report = await prepare({ budget: { maxFiles: 1, maxBlocks: 1, maxMs: 1_000 } });
  assert.equal(report.complete, false);
  assert.equal(report.files.find(file => file.relativePath === "a.md").status, "partial");
  assert.equal(report.files.find(file => file.relativePath === "b.md").status, "omitted");
  assert.equal(report.files.find(file => file.relativePath === "source.pdf").sha256, undefined);
  assert.ok(report.omitted.some(item => item.reason === "EXTERNAL_PARSER_REQUIRED"));
  assert.ok(report.omitted.some(item => item.reason === "STRUCTURE_BUDGET"));
  assert.match(materialIndexContext(report, "one"), /complete=false/);
  markMaterialIndexInjected(report, "one");
  assert.match(materialIndexContext(await prepare({ budget: { maxFiles: 1, maxBlocks: 1, maxMs: 1_000 } }), "one"), /仍不完整/);
}));

test("byte and time budgets cap reads and report omissions", async () => fixture(async ({ root, prepare }) => {
  fs.writeFileSync(path.join(root, "a.md"), "a".repeat(100));
  fs.writeFileSync(path.join(root, "b.md"), "b".repeat(100));
  const bytes = await prepare({ budget: { maxBytes: 100, maxMs: 1_000 } });
  assert.equal(bytes.complete, false);
  assert.equal(bytes.bytesRead, 100);
  assert.ok(bytes.omitted.some(item => item.reason === "BYTE_BUDGET"));
  const time = await prepare({ budget: { maxMs: 0 } });
  assert.equal(time.complete, false);
  assert.equal(time.files.length, 0);
  assert.ok(time.errors.some(item => item.reason === "TIME_BUDGET"));
  assert.match(materialIndexContext(time, "one"), /complete=false errors=1/);
}));

test("a hanging file open cannot make index preparation exceed its I/O deadline", async () => fixture(async ({ root, prepare }) => {
  fs.writeFileSync(path.join(root, "a.md"), "# Research\n\nEvidence");
  const originalOpen = fs.promises.open;
  try {
    fs.promises.open = async () => new Promise(() => {});
    const started = Date.now();
    const report = await prepare({ budget: { maxMs: 20 } });
    assert.ok(Date.now() - started < 500);
    assert.equal(report.complete, false);
    assert.ok(report.errors.some(error => error.reason === "TIME_BUDGET"));
  } finally { fs.promises.open = originalOpen; }
}));

test("deleted or replaced materials surface errors rather than cached paragraphs", async () => fixture(async ({ root, store }) => {
  const file = path.join(root, "a.md");
  fs.writeFileSync(file, "# Evidence");
  const inventory = await projectInventory(root);
  fs.unlinkSync(file);
  const report = await prepareMaterialIndex({ stateStore: store, identityKey: "synthetic", workspacePath: root, inventory });
  assert.equal(report.complete, false);
  assert.equal(report.files[0].status, "error");
  assert.equal(report.files[0].blocks, undefined);
  assert.ok(report.errors.some(error => error.path === "a.md"));
}));

test("source locators cannot escape the project or silently shorten an out-of-range read", async () => fixture(async ({ root, prepare }) => {
  fs.writeFileSync(path.join(root, "a.md"), "# Research\n\nEvidence");
  const report = await prepare();
  const sha256 = report.files[0].sha256;
  await assert.rejects(readMaterialLines({ workspacePath: root, relativePath: "../outside.md", sha256, startLine: 1, endLine: 1 }), /outside project/);
  await assert.rejects(readMaterialLines({ workspacePath: root, relativePath: "a.md", sha256, startLine: 1, endLine: 5 }), /exceeds/);
}));

test("material context integrates without changing the historical summary cache or source expiry", async () => fixture(async ({ root, store }) => {
  fs.writeFileSync(path.join(root, "a.md"), "# Research\n\nEvidence");
  const payload = { workflowId: "desk-research", externalType: "project", externalRecordId: "synthetic", threadId: "one" };
  const prepared = await prepareProjectResearchCache({ stateStore: store, payload, workspacePath: root, includeMaterialIndex: true });
  assert.equal(prepared.context, "");
  assert.equal(prepared.cacheHit, false);
  assert.match(prepared.materialContext, /startLine/);
  assert.match(prepared.materialContext, /旧研究摘要不能代替证据/);
  markProjectMaterialIndexInjected(prepared, "one");
  const same = await prepareProjectResearchCache({ stateStore: store, payload, workspacePath: root, includeMaterialIndex: true });
  assert.equal(same.materialContext, "");
  assert.match(preparedProjectResearchCacheContext(same, "two").materialContext, /sha256/);
  assert.equal(store.values.has(prepared.identity.key), false, "parsing must not write a research conclusion or refresh external evidence time");
}));
