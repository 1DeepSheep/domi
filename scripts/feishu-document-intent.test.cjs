const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  classifyFeishuDocumentIntent,
  feishuMarkdownSourceCandidates,
  safeFeishuExportContext
} = require("../electron/feishu-document-intent.cjs");

test("only explicit Feishu document writes produce an intent", () => {
  assert.equal(classifyFeishuDocumentIntent("搜索飞书知识库里的芯片材料"), null);
  assert.equal(classifyFeishuDocumentIntent("不要把这份文档上传到飞书"), null);
  assert.equal(classifyFeishuDocumentIntent("把飞书文档同步到本地工作区"), null);
  assert.equal(classifyFeishuDocumentIntent("同步飞书文档"), null);
  assert.equal(classifyFeishuDocumentIntent("把当前 Markdown 搬到飞书文档").action, "publish-copy");
  assert.equal(classifyFeishuDocumentIntent("在飞书创建一个新文档").action, "publish-copy");
  assert.equal(classifyFeishuDocumentIntent("修改这篇飞书文档").action, "edit-existing");
});

test("source candidates only use host-provided Markdown paths", () => {
  assert.deepEqual(feishuMarkdownSourceCandidates({
    activeDocumentPath: "/tmp/current.md",
    attachmentPaths: ["/tmp/current.md", "/tmp/other.markdown", "/tmp/image.png"]
  }), ["/tmp/current.md", "/tmp/other.markdown"]);
});

test("ambiguous export context never claims a remote write", () => {
  const context = safeFeishuExportContext({
    intent: { action: "publish-copy" },
    candidates: ["/tmp/a.md", "/tmp/b.md"]
  });
  assert.match(context, /存在多个本地 Markdown 候选/);
  assert.match(context, /不要声称已创建飞书副本/);
});

test("export context does not expose local paths or raw provider errors", () => {
  const context = safeFeishuExportContext({
    intent: { action: "publish-copy" },
    candidates: ["/private/example.md"],
    result: {
      ok: false,
      remoteWrite: false,
      stage: "preflight",
      error: "failed /Volumes/private/example.md with bascn_secret"
    }
  });
  assert.doesNotMatch(context, /\/Volumes\/private|bascn_secret/);
  assert.match(context, /未通过无损发布预检/);
});

test("export context distinguishes cleaned and orphaned failed creates", () => {
  const cleaned = safeFeishuExportContext({
    intent: { action: "publish-copy" },
    candidates: ["/private/report.md"],
    result: {
      ok: false,
      remoteWrite: true,
      stage: "verification",
      cleanupAttempted: true,
      remoteCleaned: true
    }
  });
  assert.match(cleaned, /已由主进程清理/);
  const orphaned = safeFeishuExportContext({
    intent: { action: "publish-copy" },
    candidates: ["/private/report.md"],
    result: {
      ok: false,
      remoteWrite: true,
      stage: "verification",
      cleanupAttempted: true,
      remoteCleaned: false
    }
  });
  assert.match(orphaned, /未能自动清理/);
  assert.match(orphaned, /不得声称已回滚或已成功/);
});

test("the host fixes publisher state under Application Support and ignores renderer manifest paths", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "domi-integration.cjs"), "utf8");
  const start = source.indexOf("async publishLocalMarkdownToFeishu");
  const end = source.indexOf("\n  databaseSnapshot()", start);
  const method = source.slice(start, end);
  assert.match(method, /path\.dirname\(path\.resolve\(this\.domiConfigPath\)\)/);
  assert.match(method, /feishu-markdown-manifests/);
  assert.doesNotMatch(method, /request\.manifestPath/);
});
