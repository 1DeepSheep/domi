const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { pathToFileURL } = require("node:url");
const {
  normalizeLocalDocumentResource,
  unwrapDocumentDestination
} = require("../electron/document-resource.cjs");

test("local Markdown resources remove Codex line and column suffixes", () => {
  assert.deepEqual(
    normalizeLocalDocumentResource("/tmp/完整结构化纪要.md:1"),
    { path: "/tmp/完整结构化纪要.md", extension: ".md", line: 1, column: 0 }
  );
  assert.deepEqual(
    normalizeLocalDocumentResource("/tmp/report.markdown:27:4"),
    { path: "/tmp/report.markdown", extension: ".markdown", line: 27, column: 4 }
  );
});

test("local document resources accept encoded paths, file URLs, anchors and queries", () => {
  assert.deepEqual(
    normalizeLocalDocumentResource("/tmp/%E7%BA%AA%E8%A6%81%20%E7%BB%93%E6%9E%9C.md#L12C3"),
    { path: "/tmp/纪要 结果.md", extension: ".md", line: 12, column: 3 }
  );
  const fileUrl = `${pathToFileURL("/tmp/report.pdf").href}?line=8&column=2`;
  assert.deepEqual(
    normalizeLocalDocumentResource(fileUrl),
    { path: "/tmp/report.pdf", extension: ".pdf", line: 8, column: 2 }
  );
});

test("local document resources unwrap Markdown and angle-bracket destinations", () => {
  assert.equal(
    unwrapDocumentDestination("[完整纪要](/tmp/full-notes.md:3)"),
    "/tmp/full-notes.md:3"
  );
  assert.equal(
    normalizeLocalDocumentResource("</tmp/full-notes.md:3>").path,
    path.normalize("/tmp/full-notes.md")
  );
});

test("web, unsupported and malformed resources are rejected", () => {
  assert.equal(normalizeLocalDocumentResource("https://example.com/report.md"), null);
  assert.equal(normalizeLocalDocumentResource("/tmp/report.txt:1"), null);
  assert.equal(normalizeLocalDocumentResource("file://%not-a-url"), null);
});
