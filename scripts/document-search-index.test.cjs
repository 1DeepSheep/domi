const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  configureRoot,
  openDocumentSearchIndex,
  removeStaleDocuments,
  searchIndexedDocuments,
  shouldIndexFile,
  upsertIndexedDocument
} = require("../electron/document-search-index.cjs");
const { DocumentSearchService } = require("../electron/document-search-service.cjs");

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-document-search-"));
  const rootPath = path.join(directory, "library");
  fs.mkdirSync(path.join(rootPath, "3.项目库", "AI", "示例项目", "纪要"), { recursive: true });
  fs.mkdirSync(path.join(rootPath, "3.项目库", "AI", "示例项目", "原始材料"), { recursive: true });
  return {
    directory,
    rootPath,
    databasePath: path.join(directory, "search.sqlite3"),
    close() {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  };
}

function indexFiles(database, rootPath, files, generation) {
  configureRoot(database, rootPath);
  for (const filePath of files) {
    upsertIndexedDocument(database, rootPath, filePath, fs.statSync(filePath), generation);
  }
  removeStaleDocuments(database, generation);
}

test("indexes Markdown body mentions and PDF filenames without promoting them to entities", () => {
  const sample = fixture();
  const notePath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "纪要", "行业交流.md");
  const pdfPath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "原始材料", "ExampleCo 产品资料.pdf");
  fs.writeFileSync(notePath, "# 行业交流\n\n会上提到 ExampleCo 正在探索新型模型训练方法。\n");
  fs.writeFileSync(pdfPath, "%PDF-1.4\n");
  const database = openDocumentSearchIndex(sample.databasePath);
  try {
    indexFiles(database, sample.rootPath, [notePath, pdfPath], "one");
    const results = searchIndexedDocuments(database, { query: "ExampleCo", limit: 10 });
    assert.equal(results.length, 2);
    assert.equal(results[0].path, pdfPath);
    assert.ok(results.some((result) => result.path === notePath && result.line === 3));
    assert.ok(results.some((result) => result.snippet.includes("模型训练方法")));
    assert.equal(
      searchIndexedDocuments(database, { query: "模型", limit: 10 }).length,
      0,
      "Two-character searches must stay on names and paths instead of scanning every document body."
    );
  } finally {
    database.close();
    sample.close();
  }
});

test("updates changed files, removes deleted files, and hides raw transcripts by default", () => {
  const sample = fixture();
  const notePath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "纪要", "会议.md");
  const transcriptPath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "原始材料", "ExampleCo-PLAUD文字稿.md");
  fs.writeFileSync(notePath, "最初内容");
  fs.writeFileSync(transcriptPath, "ExampleCo 逐字内容");
  const database = openDocumentSearchIndex(sample.databasePath);
  try {
    indexFiles(database, sample.rootPath, [notePath, transcriptPath], "one");
    assert.equal(searchIndexedDocuments(database, { query: "ExampleCo" }).length, 0);
    assert.equal(searchIndexedDocuments(database, { query: "ExampleCo", includeTranscripts: true }).length, 1);
    assert.equal(searchIndexedDocuments(database, { query: "逐字内容", includeTranscripts: true }).length, 0);
    fs.writeFileSync(notePath, "后来补充了 ExampleCo 的判断");
    const future = new Date(Date.now() + 2_000);
    fs.utimesSync(notePath, future, future);
    indexFiles(database, sample.rootPath, [notePath, transcriptPath], "two");
    assert.equal(searchIndexedDocuments(database, { query: "ExampleCo" }).length, 1);
    fs.unlinkSync(notePath);
    indexFiles(database, sample.rootPath, [transcriptPath], "three");
    assert.equal(searchIndexedDocuments(database, { query: "ExampleCo" }).length, 0);
  } finally {
    database.close();
    sample.close();
  }
});

test("ignores unsupported files and never indexes paths outside the trusted root", () => {
  const sample = fixture();
  const outsidePath = path.join(sample.directory, "outside.md");
  fs.writeFileSync(outsidePath, "ExampleCo secret");
  const database = openDocumentSearchIndex(sample.databasePath);
  try {
    configureRoot(database, sample.rootPath);
    assert.equal(shouldIndexFile("note.md"), true);
    assert.equal(shouldIndexFile("sheet.xlsx"), false);
    assert.equal(
      upsertIndexedDocument(database, sample.rootPath, outsidePath, fs.statSync(outsidePath), "one"),
      false
    );
    assert.equal(searchIndexedDocuments(database, { query: "ExampleCo" }).length, 0);
  } finally {
    database.close();
    sample.close();
  }
});

test("rebuilds a corrupt search cache without touching source documents", () => {
  const sample = fixture();
  const notePath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "纪要", "保留原文.md");
  fs.writeFileSync(notePath, "原始资料不会随索引缓存重建而改变");
  const original = fs.readFileSync(notePath, "utf8");
  fs.writeFileSync(sample.databasePath, "not a sqlite database");
  const database = openDocumentSearchIndex(sample.databasePath);
  try {
    configureRoot(database, sample.rootPath);
    assert.equal(fs.readFileSync(notePath, "utf8"), original);
    assert.equal(searchIndexedDocuments(database, { query: "原始资料" }).length, 0);
  } finally {
    database.close();
    sample.close();
  }
});

test("worker service returns immediately with partial results and finishes indexing in background", async () => {
  const sample = fixture();
  const notePath = path.join(sample.rootPath, "3.项目库", "AI", "示例项目", "纪要", "行业交流.md");
  fs.writeFileSync(notePath, "ExampleCo 出现在一份普通纪要中。\n");
  const service = new DocumentSearchService({ databasePath: sample.databasePath });
  try {
    let result = await service.search(sample.rootPath, { query: "ExampleCo" });
    assert.equal(result.ok, true);
    const deadline = Date.now() + 5_000;
    while (!result.results.length && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      result = await service.search(sample.rootPath, { query: "ExampleCo" });
    }
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0].path, notePath);
  } finally {
    await service.close();
    sample.close();
  }
});
