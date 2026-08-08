const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { FeishuMarkdownPublisher } = require("../electron/feishu-markdown-publisher.cjs");

function makeFixture(t) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-publisher-"));
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  const root = path.join(fixtureRoot, "library");
  const privateParent = path.join(fixtureRoot, "Application Support", "domi");
  const stateRoot = path.join(privateParent, "feishu-markdown-manifests");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(privateParent, { recursive: true });
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "chart.png"), "image-bytes");
  const sourcePath = path.join(root, "report.md");
  const content = `# 项目报告

正文含 **粗体**、*斜体*、~~删除线~~ 和 [来源](https://example.com/source)。

- 普通列表
- [x] 已核验

> 引用内容

| 公司 | 评级 |
|---|---|
| 示例 | A |

\`\`\`js
console.log("ok");
\`\`\`

---

![图表](./assets/chart.png)
`;
  fs.writeFileSync(sourcePath, content);
  return { fixtureRoot, root, sourcePath, content, stateRoot };
}

function mockLark() {
  const documents = new Map();
  const calls = [];
  let nextId = 1;
  let failNextFetch = false;
  let failAfterNextWrite = false;
  let failNextMedia = false;
  let failNextDelete = false;
  let nextBlockId = 1;
  const markerByBlock = new Map();
  const imageByBlock = new Map();
  const movedImageByAnchor = new Map();
  const runLark = async (args, options = {}) => {
    calls.push([...args]);
    const command = `${args[0]} ${args[1]}`;
    const argument = (name) => args[args.indexOf(name) + 1];
    if (command === "docs +create") {
      const id = `doc-${nextId++}`;
      const input = argument("--content").replace(/^@/, "");
      documents.set(id, fs.readFileSync(path.join(options.cwd, input), "utf8"));
      if (failAfterNextWrite) {
        failNextFetch = true;
        failAfterNextWrite = false;
      }
      return { data: { document: { document_id: id, url: `https://docs.invalid/docx/${id}` } } };
    }
    if (command === "docs +delete") {
      if (failNextDelete) {
        failNextDelete = false;
        throw new Error("simulated delete failure");
      }
      documents.delete(argument("--doc"));
      return { data: {} };
    }
    if (command === "docs +update") {
      const updateCommand = argument("--command");
      if (updateCommand === "block_move_after") {
        movedImageByAnchor.set(argument("--block-id"), argument("--src-block-ids"));
        return { data: {} };
      }
      if (updateCommand === "block_delete") {
        const anchor = argument("--block-id");
        const marker = markerByBlock.get(anchor);
        const image = imageByBlock.get(movedImageByAnchor.get(anchor));
        documents.set(marker.documentId, documents.get(marker.documentId).replace(
          new RegExp(`${marker.marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} · [^\\n]+`),
          `![${image.caption}](https://docs.invalid/media/chart.png)`
        ));
        return { data: {} };
      }
      const input = argument("--content").replace(/^@/, "");
      documents.set(argument("--doc"), fs.readFileSync(path.join(options.cwd, input), "utf8"));
      if (failAfterNextWrite) {
        failNextFetch = true;
        failAfterNextWrite = false;
      }
      return { data: {} };
    }
    if (command === "docs +media-insert") {
      if (failNextMedia) {
        failNextMedia = false;
        throw new Error("simulated media upload failure");
      }
      const caption = argument("--caption");
      const blockId = `image-block-${nextBlockId++}`;
      imageByBlock.set(blockId, { caption });
      return { data: { block_id: blockId } };
    }
    if (command === "docs +fetch") {
      const id = argument("--doc");
      if (args.includes("--scope")) {
        const marker = argument("--keyword");
        const blockId = `marker-block-${nextBlockId++}`;
        markerByBlock.set(blockId, { documentId: id, marker });
        return { data: { document: { document_id: id, content: `<fragment><p id="${blockId}">${marker} · 图表</p></fragment>` } } };
      }
      const content = failNextFetch ? "# 回读缺失" : documents.get(id);
      failNextFetch = false;
      return { data: { document: { document_id: id, content } } };
    }
    throw new Error(`Unexpected lark command: ${command}`);
  };
  return {
    calls,
    documents,
    runLark,
    failOneFetchAfterNextWrite: () => { failAfterNextWrite = true; },
    failOneMediaInsert: () => { failNextMedia = true; },
    failOneDelete: () => { failNextDelete = true; }
  };
}

test("single Markdown publishing preserves local assets, writes a manifest, and skips unchanged sources", async (t) => {
  const fixture = makeFixture(t);
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark, now: () => 123 });

  const first = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot,
    manifestPath: path.join(fixture.root, "renderer-chosen-manifest.json"),
    title: "项目报告"
  });
  assert.equal(first.ok, true);
  assert.equal(first.verification.status, "passed");
  assert.equal(first.verification.missingFeatureCounts && Object.keys(first.verification.missingFeatureCounts).length, 0);
  assert.ok(lark.calls.some((args) => args[1] === "+media-insert"));

  const manifestPath = path.join(fixture.stateRoot, `${first.manifestId}.json`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.status, "complete");
  assert.equal(manifest.source.relativePath, "report.md");
  assert.equal(manifest.source.snapshot, undefined);
  assert.equal(fs.existsSync(path.join(fixture.root, ".domi")), false);
  assert.equal(fs.existsSync(path.join(fixture.root, "renderer-chosen-manifest.json")), false);
  assert.equal(fs.statSync(fixture.stateRoot).mode & 0o777, 0o700);
  assert.equal(fs.statSync(manifestPath).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(manifestPath, "utf8").includes(fixture.content), false);

  const writeCount = lark.calls.filter((args) => ["+create", "+update", "+media-insert"].includes(args[1])).length;
  const second = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot
  });
  assert.equal(second.ok, true);
  assert.equal(second.skipped, true);
  assert.equal(lark.calls.filter((args) => ["+create", "+update", "+media-insert"].includes(args[1])).length, writeCount);
});

test("missing local images block before any remote command", async (t) => {
  const fixture = makeFixture(t);
  fs.writeFileSync(fixture.sourcePath, "# 报告\n\n![缺图](./assets/missing.png)\n");
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  const result = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "preflight");
  assert.equal(result.remoteWrite, false);
  assert.equal(lark.calls.length, 0);
  const manifest = JSON.parse(fs.readFileSync(path.join(fixture.stateRoot, `${result.manifestId}.json`), "utf8"));
  assert.equal(manifest.status, "blocked");
  assert.equal(manifest.source.snapshot, undefined);
  assert.equal(fs.existsSync(path.join(fixture.root, ".domi")), false);
});

test("failed semantic readback restores an existing Feishu document and never edits the source", async (t) => {
  const fixture = makeFixture(t);
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  const initial = await publisher.publish({ sourcePath: fixture.sourcePath, libraryRoot: fixture.root, stateRoot: fixture.stateRoot });
  const previousRemote = lark.documents.get(initial.target.documentId);
  const changedSource = `${fixture.content}\n新增的关键结论。\n`;
  fs.writeFileSync(fixture.sourcePath, changedSource);
  lark.failOneFetchAfterNextWrite();

  const failed = await publisher.publish({ sourcePath: fixture.sourcePath, libraryRoot: fixture.root, stateRoot: fixture.stateRoot });
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "verification");
  assert.equal(failed.remoteRolledBack, true);
  assert.equal(lark.documents.get(initial.target.documentId), previousRemote);
  assert.equal(fs.readFileSync(fixture.sourcePath, "utf8"), changedSource);
});

test("an image upload error after edit triggers rollback and verified readback", async (t) => {
  const fixture = makeFixture(t);
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  const initial = await publisher.publish({ sourcePath: fixture.sourcePath, libraryRoot: fixture.root, stateRoot: fixture.stateRoot });
  const previousRemote = lark.documents.get(initial.target.documentId);
  fs.writeFileSync(fixture.sourcePath, `${fixture.content}\n新增进展。\n`);
  lark.failOneMediaInsert();
  const failed = await publisher.publish({ sourcePath: fixture.sourcePath, libraryRoot: fixture.root, stateRoot: fixture.stateRoot });
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "write");
  assert.equal(failed.remoteRolledBack, true);
  assert.equal(failed.rollbackVerification.status, "passed");
  assert.equal(lark.documents.get(initial.target.documentId), previousRemote);
});

test("editing stops before overwrite when a reliable remote snapshot cannot be read", async (t) => {
  const fixture = makeFixture(t);
  const calls = [];
  const publisher = new FeishuMarkdownPublisher({
    runLark: async (args) => {
      calls.push(args);
      if (args[1] === "+fetch") return { data: { document: { document_id: "doc-existing" } } };
      throw new Error("no write expected");
    }
  });
  const result = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot,
    documentId: "doc-existing"
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "snapshot");
  assert.equal(result.remoteWrite, false);
  assert.equal(calls.every((args) => args[1] === "+fetch"), true);
});

test("source and image paths cannot escape the library through intermediate symlinks", async (t) => {
  const fixture = makeFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-external-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  const externalSource = path.join(external, "outside.md");
  fs.writeFileSync(externalSource, "# 外部文档\n");
  fs.symlinkSync(external, path.join(fixture.root, "linked"));
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  await assert.rejects(
    () => publisher.publish({
      sourcePath: path.join(fixture.root, "linked", "outside.md"),
      libraryRoot: fixture.root,
      stateRoot: fixture.stateRoot
    }),
    /只能发布|符号链接/
  );
  assert.equal(lark.calls.length, 0);

  fs.unlinkSync(path.join(fixture.root, "linked"));
  fs.symlinkSync(external, path.join(fixture.root, "assets-linked"));
  fs.writeFileSync(path.join(external, "external.png"), "external-image");
  fs.writeFileSync(fixture.sourcePath, "# 报告\n\n![外部图片](./assets-linked/external.png)\n");
  const blocked = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.stage, "preflight");
  assert.match(blocked.preparation.degradations[0].message, /符号链接/);
  assert.equal(lark.calls.length, 0);
});

test("a symlinked private state root cannot redirect audit files outside Application Support", async (t) => {
  const fixture = makeFixture(t);
  const external = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-manifest-external-"));
  t.after(() => fs.rmSync(external, { recursive: true, force: true }));
  fs.symlinkSync(external, fixture.stateRoot);
  const lark = mockLark();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  await assert.rejects(
    () => publisher.publish({
      sourcePath: fixture.sourcePath,
      libraryRoot: fixture.root,
      stateRoot: fixture.stateRoot
    }),
    /受信任|符号链接/
  );
  assert.equal(lark.calls.length, 0);
  assert.deepEqual(fs.readdirSync(external), []);
});

test("a newly created document is deleted when verification fails", async (t) => {
  const fixture = makeFixture(t);
  const lark = mockLark();
  lark.failOneFetchAfterNextWrite();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  const failed = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.stage, "verification");
  assert.equal(failed.remoteCleaned, true);
  assert.ok(lark.calls.some((args) => args[1] === "+delete"));
  assert.equal(lark.documents.size, 0);
});

test("a failed cleanup is reported as an orphan instead of a rollback success", async (t) => {
  const fixture = makeFixture(t);
  const lark = mockLark();
  lark.failOneFetchAfterNextWrite();
  lark.failOneDelete();
  const publisher = new FeishuMarkdownPublisher({ runLark: lark.runLark });
  const failed = await publisher.publish({
    sourcePath: fixture.sourcePath,
    libraryRoot: fixture.root,
    stateRoot: fixture.stateRoot
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.cleanupAttempted, true);
  assert.equal(failed.remoteCleaned, false);
  assert.equal(failed.remoteRolledBack, false);
  assert.equal(lark.documents.size, 1);
});
