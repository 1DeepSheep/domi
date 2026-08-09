const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  classifyFeishuDocumentIntent,
  classifyFeishuDocumentIntentFromRun,
  classifyFeishuWriteIntentFromRun,
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

test("Feishu references and local writes never become remote document writes", () => {
  const readOnlyOrLocalWrites = [
    "请检索飞书文档库有没有相关信息，作为参考，并更新本地纪要",
    "生成纪要，搜索飞书文档作为参考",
    "读取飞书文档，补充本地 Markdown",
    "在本地创建纪要，参考飞书文档",
    "复制本地纪要，搜索飞书文档作为参考",
    "读取并补充飞书文档中的信息到本地纪要",
    "补充飞书文档里的信息到本地 Markdown",
    "更新飞书文档检索结果到本地纪要",
    "生成飞书文档内容摘要",
    "创建飞书文档的本地 Markdown 副本",
    "新建飞书文档索引到本地",
    "目标：生成完整结构化纪要；继续完成投资快评、飞书 Wiki 文档、本地资料库归档和 Watching List 新增或更新。"
  ];
  for (const request of readOnlyOrLocalWrites) {
    assert.equal(classifyFeishuDocumentIntent(request), null, request);
  }
});

test("Feishu channel and resource writes require a direct same-clause destination", () => {
  const explicitWrites = [
    ["推送到我的飞书私聊", "external-write"],
    ["发给张三的飞书私聊", "external-write"],
    ["在飞书 Base 更新这条记录", "external-write"],
    ["在飞书 Wiki 中更新页面", "edit-existing"],
    ["把附件上传到飞书云盘", "external-write"]
  ];
  for (const [userInstructionText, expectedAction] of explicitWrites) {
    assert.equal(classifyFeishuWriteIntentFromRun({
      requestOrigin: "user",
      userInstructionText
    }).action, expectedAction, userInstructionText);
  }

  const localOnly = [
    "发送邮件给我，飞书只作参考",
    "推送本地提醒；飞书文档只读",
    "发送到邮箱，参考飞书文档",
    "飞书消息只读；发送邮件给我",
    "飞书私聊作为参考，发送摘要到邮箱",
    "飞书群聊不操作。推送本地通知",
    "整理飞书 Wiki 检索结果到本地",
    "更新飞书 Base 信息到本地资料库",
    "补充飞书知识库中的信息到本地纪要",
    "根据飞书 Base 更新本地记录"
  ];
  for (const userInstructionText of localOnly) {
    assert.equal(classifyFeishuWriteIntentFromRun({
      requestOrigin: "user",
      userInstructionText
    }), null, userInstructionText);
  }
});

test("only original user instructions can authorize a Feishu document write", () => {
  const explicitWrite = "把当前 Markdown 搬到飞书文档";
  assert.equal(classifyFeishuDocumentIntentFromRun({
    requestOrigin: "user",
    userInstructionText: explicitWrite,
    requestText: explicitWrite
  }).action, "publish-copy");
  assert.equal(classifyFeishuDocumentIntentFromRun({
    requestOrigin: "programmatic",
    userInstructionText: explicitWrite,
    requestText: explicitWrite
  }), null);
  assert.equal(classifyFeishuDocumentIntentFromRun({
    requestOrigin: "user",
    userInstructionText: "搜索飞书文档作为参考",
    requestText: "把当前 Markdown 搬到飞书文档"
  }), null);
  assert.equal(classifyFeishuDocumentIntentFromRun({
    requestText: explicitWrite
  }), null);
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
