const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");
const {
  LocalToFeishuMigration,
  importanceLevel,
  normalizeEvidenceStatus,
  normalizeSuggestedAction,
  parseWikiFolderMap,
  prepareMarkdownDocument,
  projectDocuments
} = require("../electron/local-to-feishu-migration.cjs");
const {
  markdownFeatureCounts,
  prepareMarkdownForFeishu,
  verifyFeishuMarkdownImport
} = require("../electron/markdown-feishu-fidelity.cjs");

const PROJECT_BASE = "projects";
const PEOPLE_BASE = "people";
const NEWS_BASE = "news";
const PROJECT_TABLE = "project-table-placeholder";
const PEOPLE_TABLE = "people-table-placeholder";
const NEWS_TABLE = "news-table-placeholder";
const WIKI_SPACE = "wiki-space-placeholder";

function migrationTarget() {
  return {
    ["projectBase" + "Token"]: PROJECT_BASE,
    ["projectTable" + "Id"]: PROJECT_TABLE,
    ["peopleBase" + "Token"]: PEOPLE_BASE,
    ["peopleTable" + "Id"]: PEOPLE_TABLE,
    ["radarBase" + "Token"]: NEWS_BASE,
    ["radarTable" + "Id"]: NEWS_TABLE,
    ["wikiSpace" + "Id"]: WIKI_SPACE
  };
}

test("folder map keeps canonical subdomains attached to Wiki folder titles", () => {
  const parsed = parseWikiFolderMap(`
## AI 行业

| Wiki 文件夹名 | 子领域 |
|---|---|
| Agent行业 | Agent |
| AI应用项目集 | *(null)* |
`);
  assert.deepEqual(parsed.get("Agent"), [{
    folderTitle: "Agent行业",
    domainHeading: "AI 行业"
  }]);
  assert.equal(parsed.has("*(null)"), false);
});

test("Markdown preparation removes internal frontmatter and collects local images", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-migration-markdown-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const imagePath = path.join(root, "diagram.png");
  const documentPath = path.join(root, "项目主页.md");
  fs.writeFileSync(imagePath, Buffer.from("not-a-real-image"));
  fs.writeFileSync(documentPath, `---
project_id: prj_demo
---

# 示例项目

![架构图](diagram.png)
`);
  const prepared = prepareMarkdownDocument({
    path: documentPath,
    relativePath: "项目主页.md",
    title: "示例项目"
  }, root);
  assert.doesNotMatch(prepared.content, /project_id/);
  assert.match(prepared.content, /domi飞书图片1/);
  assert.equal(prepared.assets[0].path, fs.realpathSync.native(imagePath));
  assert.equal(prepared.sourceSha256.length, 64);
  assert.equal(prepared.fidelity.status, "ready");
  assert.equal(prepared.fidelity.degradations[0].code, "frontmatter-not-rendered");
});

test("Markdown to Feishu preparation preserves core formatting and uploads every local image form", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-fidelity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const assetsDir = path.join(root, "assets");
  fs.mkdirSync(assetsDir, { recursive: true });
  for (const name of ["inline.png", "reference.jpg", "html.webp"]) {
    fs.writeFileSync(path.join(assetsDir, name), Buffer.from(name));
  }
  const sourcePath = path.join(root, "report.md");
  const markdown = `# 一级标题

普通段落包含 **粗体**、*斜体*、~~删除线~~、[外部链接](https://example.com) 和 \`行内代码\`。

- 无序列表
1. 有序列表
- [x] 已完成 **核验**
- [ ] 待处理 [来源](https://example.com/source)

> 引用内容

\`\`\`js
console.log("code");
\`\`\`

| 公司 | 评级 |
|---|---|
| 示例 | A |

---

![行内图](assets/inline.png)
![引用图][architecture]
<img src="assets/html.webp" alt="HTML 图">

[architecture]: assets/reference.jpg
`;
  fs.writeFileSync(sourcePath, markdown);
  const prepared = prepareMarkdownForFeishu({
    markdown,
    sourcePath,
    libraryRoot: root,
    title: "格式核验"
  });
  assert.equal(prepared.fidelity.status, "ready");
  assert.equal(prepared.assets.length, 3);
  assert.match(prepared.content, /<checkbox done="true">已完成 <b>核验<\/b><\/checkbox>/);
  assert.match(prepared.content, /<checkbox done="false">待处理 <a href="https:\/\/example\.com\/source">来源<\/a><\/checkbox>/);
  assert.match(prepared.content, /\| 公司 \| 评级 \|/);
  assert.match(prepared.content, /```js/);
  assert.match(prepared.content, /~~删除线~~/);
  assert.deepEqual(markdownFeatureCounts(markdown), prepared.fidelity.featureCounts);
  assert.deepEqual(
    prepared.assets.map((asset) => path.basename(asset.path)).sort(),
    ["html.webp", "inline.png", "reference.jpg"]
  );
  let importedContent = prepared.content;
  for (const asset of prepared.assets) {
    importedContent = importedContent.replace(
      new RegExp(`${asset.marker} · [^\\n]+`),
      `![${asset.caption}](https://example.com/${path.basename(asset.path)})`
    );
  }
  const verified = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: importedContent });
  assert.equal(verified.status, "passed");
  assert.equal(verified.textCoverage, 1);
});

test("unsupported Markdown is explicitly degraded and missing local images block a lossy import", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-degrade-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "unsupported.md");
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "vector.svg"), "<svg></svg>");
  const markdown = `# 报告

  - [ ] 嵌套任务

\`\`\`mermaid
flowchart LR
A --> B
\`\`\`

<details><summary>更多</summary>正文</details>

![缺失图](assets/missing.png)

![矢量图](assets/vector.svg)

[本地纪要](notes/meeting.md)

脚注[^1]

[^1]: 脚注正文
`;
  const prepared = prepareMarkdownForFeishu({ markdown, sourcePath, libraryRoot: root, title: "报告" });
  assert.equal(prepared.fidelity.status, "blocked");
  assert.match(prepared.content, /图片未导入：缺失图/);
  assert.match(prepared.content, /\\<details>/);
  const codes = new Set(prepared.fidelity.degradations.map((item) => item.code));
  assert.ok(codes.has("nested-task-list-visual-fallback"));
  assert.match(prepared.content, /^  - ☐ 嵌套任务$/m);
  assert.ok(codes.has("mermaid-kept-as-code"));
  assert.ok(codes.has("unsupported-html-visible-text"));
  assert.ok(codes.has("local-image-unavailable"));
  assert.ok(codes.has("local-image-format-unsupported"));
  assert.ok(codes.has("relative-links-require-target-map"));
  assert.ok(codes.has("footnotes-kept-as-text"));
});

test("post-import verification detects reordered content, link target changes, and task state loss", () => {
  const sourcePath = path.join(os.tmpdir(), "domi-verification-example.md");
  const prepared = prepareMarkdownForFeishu({
    markdown: `# 核验

第一段关键结论。

- [x] 已完成
- [ ] 待处理

[原始来源](https://example.com/original)

第二段最终判断。
`,
    sourcePath,
    libraryRoot: os.tmpdir(),
    title: "核验"
  });
  const changed = `# 核验

第二段最终判断。

<checkbox done="false">已完成</checkbox>
<checkbox done="false">待处理</checkbox>

[原始来源](https://example.com/changed)

第一段关键结论。
`;
  const verified = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: changed });
  assert.equal(verified.status, "failed");
  assert.ok(verified.tokenOrderCoverage < 0.98);
  assert.equal(verified.missingFeatureCounts.checkedTasks, 1);
  assert.equal(verified.missingLinkSignatures.length, 1);
});

test("post-import verification refuses silent text loss", () => {
  const prepared = {
    content: "# 标题\n\n这是必须完整保留的正文和关键数字 12345。\n",
    fidelity: { featureCounts: { headings: 1, paragraphs: 1 } }
  };
  const verified = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: "# 标题\n\n这是正文。\n" });
  assert.equal(verified.status, "failed");
  assert.ok(verified.textCoverage < 0.9);
  assert.ok(verified.missingTextSamples.length > 0);
});

test("migration scanning never escapes the configured local library", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-migration-boundary-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libraryDir = path.join(root, "资料库");
  const outsideDocument = path.join(root, "outside.md");
  fs.mkdirSync(libraryDir, { recursive: true });
  fs.writeFileSync(outsideDocument, "# 不应扫描\n");
  assert.deepEqual(projectDocuments({
    documentPath: outsideDocument,
    documents: []
  }, libraryDir), []);
});

test("legacy local news values normalize to the current radar contract", () => {
  assert.equal(importanceLevel(9), "P0-立即关注");
  assert.equal(importanceLevel(8), "P1-重点关注");
  assert.equal(importanceLevel(6), "P2-日常跟踪");
  assert.equal(importanceLevel(3), "P3-仅归档");
  assert.equal(normalizeEvidenceStatus("官方确认"), "公司／机构口径");
  assert.equal(normalizeSuggestedAction("", true), "继续跟踪");
  assert.equal(normalizeSuggestedAction("", false), "仅归档");
});

test("local projects, people and news migrate to their Feishu destinations with idempotent retries", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-to-feishu-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const libraryDir = path.join(root, "资料库");
  const databasePath = path.join(root, "domi.sqlite3");
  const pluginRoot = path.join(root, "plugin");
  const referenceDir = path.join(pluginRoot, "skills", "investment-mgmt", "references");
  fs.mkdirSync(referenceDir, { recursive: true });
  fs.writeFileSync(path.join(referenceDir, "folder_map.md"), `
## AI 行业

| Wiki 文件夹名 | 子领域 |
|---|---|
| Agent行业 | Agent |
`);

  const projectDir = path.join(libraryDir, "3.项目库", "AI", "Agent", "示例科技");
  const notesDir = path.join(projectDir, "纪要");
  fs.mkdirSync(notesDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "chart.png"), Buffer.from("image"));
  fs.writeFileSync(path.join(projectDir, "项目主页.md"), `---
project_id: prj_demo
---
# 示例科技

![产品图](chart.png)
`);
  fs.writeFileSync(path.join(notesDir, "首次交流.md"), "# 首次交流\n\n核心结论。\n");

  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  const database = new DatabaseSync(databasePath);
  const now = Date.now();
  database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_demo",
    "示例科技",
    "示例科技",
    "AI",
    '["Agent"]',
    "深度跟踪",
    "A",
    "项目摘要",
    '["上海"]',
    '["示例资本"]',
    now,
    path.join(projectDir, "项目主页.md"),
    now,
    now
  );
  database.prepare(`
    INSERT INTO documents (id, owner_type, owner_id, kind, title, path, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "doc_notes",
    "project",
    "prj_demo",
    "纪要",
    "首次交流",
    path.join(notesDir, "首次交流.md"),
    now,
    now
  );
  database.prepare(`
    INSERT INTO people (
      id, name, normalized_name, types_json, organization, status, rating,
      last_contact_at, cities_json, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "person_demo",
    "张三",
    "张三",
    '["创业者","大厂"]',
    "示例科技 · 创始人",
    "保持联系",
    "A",
    now,
    '["上海"]',
    "",
    now,
    now
  );
  database.prepare(`
    INSERT INTO news_events (
      event_id, title, domains_json, subdomains_json, types_json, published_at,
      summary, investment_meaning, url, source, companies, institutions,
      importance, confidence, evidence_status, action, worth_following,
      document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "evt_v1_demo",
    "示例科技发布 Agent 新产品",
    '["AI"]',
    '["Agent"]',
    '["产品／技术"]',
    now,
    "示例科技发布面向企业的 Agent 产品。",
    "验证了企业 Agent 的商业化需求。",
    "https://example.com/news",
    "示例科技官网",
    "示例科技",
    "",
    8,
    9,
    "官方确认",
    "",
    1,
    "",
    now,
    now
  );
  database.close();

  let createCount = 0;
  let mediaCount = 0;
  const createParents = [];
  const createdDocumentContent = new Map();
  const markerByBlock = new Map();
  const imageByBlock = new Map();
  const movedImageByAnchor = new Map();
  let nextBlockId = 1;
  const fieldNamesByBase = {
    projects: [
      "公司名称", "领域", "子领域", "进展状态", "链接", "Notes", "项目评级", "城市", "投资机构"
    ],
    people: ["人名", "类型", "所属组织&身份", "进展状态", "评级", "最后联系日期", "城市"],
    news: [
      "新闻标题", "领域", "子领域", "信息类型", "信息发布时间", "新闻核心内容", "投资含义",
      "原文链接", "来源名称", "涉及公司", "涉及机构", "重要性评分", "重要性等级", "可信度",
      "证据状态", "是否值得关注", "建议动作", "事件ID", "扫描批次"
    ]
  };
  const recordsByBase = {
    projects: [],
    people: [],
    news: []
  };
  const createdRecordsByBase = {
    projects: 0,
    people: 0,
    news: 0
  };
  const runLark = async (args, options = {}) => {
    const command = `${args[0]} ${args[1]}`;
    const baseIndex = args.indexOf("--base-token");
    const targetBase = baseIndex >= 0 ? args[baseIndex + 1] : "";
    if (command === "base +field-list") {
      return {
        data: {
          items: fieldNamesByBase[targetBase].map((field_name) => ({ field_name }))
        }
      };
    }
    if (command === "base +record-list") {
      const filter = JSON.parse(args[args.indexOf("--filter-json") + 1]);
      const [field, , expected] = filter.conditions[0];
      return {
        data: {
          items: recordsByBase[targetBase].filter((item) => item.fields[field] === expected)
        }
      };
    }
    if (command === "wiki +node-list") {
      const parentIndex = args.indexOf("--parent-node-token");
      const parent = parentIndex >= 0 ? args[parentIndex + 1] : "";
      if (!parent) {
        return { data: { items: [{
          node_token: "n1",
          title: "AI行业",
          has_child: true
        }] } };
      }
      if (parent === "n1") {
        return { data: { items: [{
          node_token: "n2",
          parent_node_token: "n1",
          title: "Agent行业",
          has_child: false
        }] } };
      }
      return { data: { items: [] } };
    }
    if (command === "docs +create") {
      createCount += 1;
      const parentIndex = args.indexOf("--parent-token");
      createParents.push(args[parentIndex + 1]);
      const documentId = `docx_${createCount}`;
      const nodeToken = createCount === 1 ? "n3" : "n4";
      const contentArgument = args[args.indexOf("--content") + 1];
      if (String(contentArgument).startsWith("@")) {
        createdDocumentContent.set(
          documentId,
          fs.readFileSync(path.join(options.cwd, String(contentArgument).slice(1)), "utf8")
        );
      }
      return {
        data: {
          document: {
            document_id: documentId,
            node_token: nodeToken,
            url: `https://docs.example.com/wiki/${nodeToken}`
          }
        }
      };
    }
    if (command === "docs +fetch") {
      const documentId = args[args.indexOf("--doc") + 1];
      if (args.includes("--scope")) {
        const marker = args[args.indexOf("--keyword") + 1];
        const blockId = `marker-block-${nextBlockId++}`;
        markerByBlock.set(blockId, { documentId, marker });
        return { data: { document: { document_id: documentId, content: `<fragment><p id="${blockId}">${marker} · 图</p></fragment>` } } };
      }
      return { data: { document: { document_id: documentId, content: createdDocumentContent.get(documentId) } } };
    }
    if (command === "docs +media-insert") {
      mediaCount += 1;
      const caption = args[args.indexOf("--caption") + 1];
      const blockId = `image-block-${nextBlockId++}`;
      imageByBlock.set(blockId, { caption, url: `https://docs.example.com/media/${mediaCount}.png` });
      return { data: { block_id: blockId } };
    }
    if (command === "docs +update") {
      const updateCommand = args[args.indexOf("--command") + 1];
      if (updateCommand === "block_move_after") {
        movedImageByAnchor.set(
          args[args.indexOf("--block-id") + 1],
          args[args.indexOf("--src-block-ids") + 1]
        );
        return { data: {} };
      }
      if (updateCommand === "block_delete") {
        const anchor = args[args.indexOf("--block-id") + 1];
        const marker = markerByBlock.get(anchor);
        const image = imageByBlock.get(movedImageByAnchor.get(anchor));
        createdDocumentContent.set(
          marker.documentId,
          String(createdDocumentContent.get(marker.documentId) || "").replace(
            new RegExp(`${marker.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · [^\\n]+`),
            `![${image.caption}](${image.url})`
          )
        );
        return { data: {} };
      }
    }
    if (command === "base +record-upsert") {
      const fields = JSON.parse(args[args.indexOf("--json") + 1]);
      const recordIndex = args.indexOf("--record-id");
      const recordId = recordIndex >= 0
        ? args[recordIndex + 1]
        : `record_${targetBase}_${recordsByBase[targetBase].length + 1}`;
      let record = recordsByBase[targetBase].find((item) => item.record_id === recordId);
      if (!record) {
        record = { record_id: recordId, fields: {} };
        recordsByBase[targetBase].push(record);
        createdRecordsByBase[targetBase] += 1;
      }
      record.fields = { ...record.fields, ...fields };
      return { data: { record } };
    }
    throw new Error(`Unexpected lark command: ${command}`);
  };

  const migration = new LocalToFeishuMigration({
    repository,
    runLark,
    pluginRoot,
    libraryRoot: libraryDir,
    now: () => now
  });
  const result = await migration.run(migrationTarget());

  assert.equal(result.ok, true);
  assert.equal(result.migratedProjectCount, 1);
  assert.equal(result.migratedPeopleCount, 1);
  assert.equal(result.migratedNewsCount, 1);
  assert.equal(result.documentCount, 2);
  assert.equal(result.assetCount, 1);
  assert.equal(result.fidelityReport.documentCount, 2);
  assert.equal(result.fidelityReport.verifiedCount, 2);
  assert.equal(result.fidelityReport.documents[0].verification.status, "passed");
  assert.deepEqual(createParents, ["n2", "n3"]);
  assert.equal(mediaCount, 1);
  assert.equal(recordsByBase.projects[0].fields["链接"], "https://docs.example.com/wiki/n3");
  assert.deepEqual(recordsByBase.people[0].fields["类型"], ["创业者"]);
  assert.equal(recordsByBase.news[0].fields["重要性等级"], "P1-重点关注");
  assert.equal(recordsByBase.news[0].fields["证据状态"], "公司／机构口径");
  assert.equal(recordsByBase.news[0].fields["建议动作"], "继续跟踪");
  assert.equal(recordsByBase.news[0].fields["扫描批次"], "本地资料库迁移");

  const retry = new LocalToFeishuMigration({
    repository,
    runLark,
    pluginRoot,
    libraryRoot: libraryDir,
    now: () => now + 1
  });
  const retryResult = await retry.run(migrationTarget());
  assert.equal(retryResult.ok, true);
  assert.equal(createCount, 2);
  assert.deepEqual(createdRecordsByBase, {
    projects: 1,
    people: 1,
    news: 1
  });

  repository.close();
});

test("duplicate Feishu business keys stop the switch instead of creating another record", async () => {
  const news = {
    eventId: "evt_v1_duplicate",
    title: "重复事件",
    domains: ["AI"],
    subdomains: ["Agent"],
    types: ["公司动态"],
    publishedAt: Date.now(),
    summary: "同一事件已经存在重复记录。",
    investmentMeaning: "需要先清理重复项。",
    url: "https://example.com/duplicate",
    source: "示例来源",
    companies: "",
    institutions: "",
    importance: 8,
    confidence: 8,
    evidenceStatus: "二手报道",
    action: "继续跟踪",
    worthFollowing: true
  };
  const repository = {
    listMigrationProjects: () => [],
    listMigrationPeople: () => [],
    listMigrationNews: () => [news]
  };
  const projectFields = ["公司名称", "领域", "子领域", "进展状态", "链接"];
  const peopleFields = ["人名"];
  const newsFields = [
    "新闻标题", "领域", "子领域", "信息类型", "信息发布时间", "新闻核心内容", "投资含义",
    "原文链接", "来源名称", "重要性评分", "重要性等级", "可信度", "证据状态",
    "是否值得关注", "建议动作", "事件ID", "扫描批次"
  ];
  let upsertCount = 0;
  const runLark = async (args) => {
    const command = `${args[0]} ${args[1]}`;
    const targetBase = args[args.indexOf("--base-token") + 1];
    if (command === "base +field-list") {
      const fields = targetBase === "projects"
        ? projectFields
        : targetBase === "people"
          ? peopleFields
          : newsFields;
      return { data: { items: fields.map((field_name) => ({ field_name })) } };
    }
    if (command === "base +record-list") {
      return {
        data: {
          items: [
            { record_id: "rec_1", fields: { "事件ID": news.eventId } },
            { record_id: "rec_2", fields: { "事件ID": news.eventId } }
          ]
        }
      };
    }
    if (command === "base +record-upsert") {
      upsertCount += 1;
      return { data: {} };
    }
    throw new Error(`Unexpected lark command: ${command}`);
  };
  const migration = new LocalToFeishuMigration({
    repository,
    runLark,
    pluginRoot: os.tmpdir(),
    libraryRoot: os.tmpdir()
  });
  const result = await migration.run(migrationTarget());
  assert.equal(result.ok, false);
  assert.equal(result.failed[0].kind, "news");
  assert.match(result.failed[0].error, /存在 2 条事件ID/);
  assert.equal(upsertCount, 0);
});
