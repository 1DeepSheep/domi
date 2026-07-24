const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");
const {
  LocalToFeishuMigration,
  parseWikiFolderMap,
  prepareMarkdownDocument,
  projectDocuments
} = require("../electron/local-to-feishu-migration.cjs");

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
  assert.match(prepared.content, /Domi迁移图片1/);
  assert.equal(prepared.assets[0].path, imagePath);
  assert.equal(prepared.sourceSha256.length, 64);
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

test("local project documents migrate into the matching Wiki folder before Base is updated", async (t) => {
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
  database.close();

  let record = null;
  let createCount = 0;
  let mediaCount = 0;
  const createParents = [];
  const runLark = async (args) => {
    const command = `${args[0]} ${args[1]}`;
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
      return { data: { document: { document_id: args[args.indexOf("--doc") + 1], content: "# ok" } } };
    }
    if (command === "docs +media-insert") {
      mediaCount += 1;
      return { data: { document_id: "docx_1" } };
    }
    if (command === "api POST") {
      return { data: { items: record ? [record] : [] } };
    }
    if (command === "base +record-upsert") {
      const fields = JSON.parse(args[args.indexOf("--json") + 1]);
      record = {
        record_id: "rec_demo",
        fields: {
          "公司名称": fields["公司名称"],
          "链接": fields["链接"]
        }
      };
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
  const result = await migration.run({
    projectBaseToken: "placeholder",
    projectTableId: "placeholder",
    wikiSpaceId: "placeholder"
  });

  assert.equal(result.ok, true);
  assert.equal(result.migratedProjectCount, 1);
  assert.equal(result.documentCount, 2);
  assert.equal(result.assetCount, 1);
  assert.deepEqual(createParents, ["n2", "n3"]);
  assert.equal(mediaCount, 1);
  assert.equal(record.fields["链接"], "https://docs.example.com/wiki/n3");

  const retry = new LocalToFeishuMigration({
    repository,
    runLark,
    pluginRoot,
    libraryRoot: libraryDir,
    now: () => now + 1
  });
  const retryResult = await retry.run({
    projectBaseToken: "placeholder",
    projectTableId: "placeholder",
    wikiSpaceId: "placeholder"
  });
  assert.equal(retryResult.ok, true);
  assert.equal(createCount, 2);

  repository.close();
});
