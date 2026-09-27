const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { stableDescendantRealPath } = require("../electron/workspace-boundary.cjs");
const { writeNamedAttachment, removeEmptyAttachmentImportDirectory } = require("../electron/attachment-storage.cjs");

// Exercise the actual IPC handlers' implementation, without starting Electron
// or touching a user's files, settings, clipboard, database or model session.
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "domi-attachment-storage-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staging = path.join(root, "runtime");
  const entity = path.join(root, "library", "fictional-project");
  const downloads = path.join(root, "Downloads");
  for (const directory of [staging, entity, downloads]) fs.mkdirSync(directory, { recursive: true });
  const source = fs.readFileSync(path.join(__dirname, "../electron/main.cjs"), "utf8");
  const context = vm.createContext({
    fs, path, Buffer, ArrayBuffer, setTimeout, stableDescendantRealPath,
    writeNamedAttachment, removeEmptyAttachmentImportDirectory,
    demoWorkspace: staging, projectsDir: path.join(staging, "projects"),
    ensureDemoWorkspace() {}, appendRuntimeLog() {},
    getAppSettings: () => ({ load: () => ({ settings: { storageBackend: "local" } }) }),
    validCodexWorkspace: value => [staging, entity].includes(value) ? value : "",
    isEntityWorkspace: value => value === entity,
    getDomiIntegration: () => ({ entityWorkspace: () => entity })
  });
  vm.runInContext(source.slice(source.indexOf("function secureWorkspaceSubdirectory("), source.indexOf("async function selectLocalFiles(")), context);
  return { root, staging, entity, downloads, api: context, entityRequest: { entityType: "project", recordId: "fictional-project" } };
}

test("picker and clipboard imports preserve the physical filename in separate staging directories", async t => {
  const f = fixture(t);
  const name = "【BP】Example Lab.pdf";
  const source = path.join(f.downloads, name);
  fs.writeFileSync(source, "picker-original");
  const picked = await f.api.importLocalFiles(f.staging, [source]);
  const pasted = await f.api.importLocalFileData(f.staging, [{ name, data: Buffer.from("clipboard-original") }]);
  for (const result of [picked, pasted]) {
    assert.equal(result.ok, true);
    assert.equal(result.files[0].name, name);
    assert.equal(path.basename(result.files[0].path), name);
    assert.match(path.basename(path.dirname(result.files[0].path)), /^import-[A-Za-z0-9]{6}$/);
  }
  assert.notEqual(picked.files[0].path, pasted.files[0].path);
  assert.equal(fs.readFileSync(picked.files[0].path, "utf8"), "picker-original");
  assert.equal(fs.readFileSync(pasted.files[0].path, "utf8"), "clipboard-original");
  assert.equal(fs.readFileSync(source, "utf8"), "picker-original");
});

test("commit writes the original name into the entity folder and cleans only its staging copy", async t => {
  const f = fixture(t);
  const name = "【BP】Example Lab.pdf";
  const imported = await f.api.importLocalFileData(f.staging, [{ name, data: Buffer.from("archive-body") }]);
  const staged = imported.files[0];
  const result = await f.api.importLocalFiles(f.entity, [staged.path], f.entityRequest, [staged]);
  assert.equal(result.ok, true);
  assert.equal(result.files[0].path, path.join(f.entity, "原始材料", name));
  assert.equal(fs.readFileSync(result.files[0].path, "utf8"), "archive-body");
  assert.equal(fs.existsSync(staged.path), false);
  assert.equal(fs.existsSync(path.dirname(staged.path)), false);
});

test("legacy staging uses exact original metadata while genuine numeric names survive", async t => {
  const f = fixture(t);
  const directory = path.join(f.staging, "attachments");
  fs.mkdirSync(directory);
  for (const [stored, original] of [
    ["1770000000000-0-BP.pdf", "BP.pdf"],
    ["1770000000000-1-1770000000001-0-customer.pdf", "1770000000001-0-customer.pdf"],
    ["1770000000000-2-20260922-Example Lab-文字稿.md", "20260922-Example Lab-文字稿.md"]
  ]) {
    const source = path.join(directory, stored);
    fs.writeFileSync(source, stored);
    const result = await f.api.importLocalFiles(f.entity, [source], f.entityRequest, [{ path: source, name: original }]);
    assert.equal(result.ok, true);
    assert.equal(path.basename(result.files[0].path), original);
  }
});

test("unknown numeric filenames are not guessed from path shape or unrelated metadata", async t => {
  const f = fixture(t);
  const name = "1770000000000-0-customer-version.pdf";
  for (const parent of [f.downloads, path.join(f.staging, "attachments")]) {
    fs.mkdirSync(parent, { recursive: true });
    const source = path.join(parent, name);
    fs.writeFileSync(source, name);
    assert.equal(f.api.logicalStagingAttachmentName(source, [{ path: `${source}.other`, name: "wrong.pdf" }]), name);
    if (parent === f.downloads) assert.equal(f.api.logicalStagingAttachmentName(source, [{ path: source, name: "wrong.pdf" }]), name);
    assert.equal(f.api.logicalStagingAttachmentName(source), name);
  }
});

test("simultaneous same-name entity imports preserve every body with readable collision names", async t => {
  const f = fixture(t);
  const results = await Promise.all(["first", "second", "third"].map(body =>
    f.api.importLocalFileData(f.entity, [{ name: "BP.pdf", data: Buffer.from(body) }], f.entityRequest)
  ));
  assert.equal(results.every(result => result.ok), true);
  const actualPaths = results.map(result => result.files[0].path);
  assert.deepEqual(actualPaths.map(value => path.basename(value)).sort(), ["BP (2).pdf", "BP (3).pdf", "BP.pdf"]);
  assert.deepEqual(actualPaths.map(value => fs.readFileSync(value, "utf8")).sort(), ["first", "second", "third"]);
});

test("same-name symlink is never followed or overwritten", async t => {
  const f = fixture(t);
  const original = path.join(f.downloads, "important.pdf");
  fs.writeFileSync(original, "preserve");
  fs.mkdirSync(path.join(f.entity, "原始材料"));
  fs.symlinkSync(original, path.join(f.entity, "原始材料", "BP.pdf"));
  const result = await f.api.importLocalFileData(f.entity, [{ name: "BP.pdf", data: Buffer.from("new") }], f.entityRequest);
  assert.equal(result.ok, true);
  assert.equal(path.basename(result.files[0].path), "BP (2).pdf");
  assert.equal(fs.readFileSync(original, "utf8"), "preserve");
});

test("a failed batch removes all new files and staging directories, preserving existing materials", async t => {
  const f = fixture(t);
  for (const [workspace, entityRequest] of [[f.staging, undefined], [f.entity, f.entityRequest]]) {
    const before = await f.api.importLocalFileData(workspace, [{ name: "BP.pdf", data: Buffer.from("preserve") }], entityRequest);
    const result = await f.api.importLocalFileData(workspace, [
      { name: "BP.pdf", data: Buffer.from("rollback") }, { name: "empty.pdf", data: Buffer.alloc(0) }
    ], entityRequest);
    assert.equal(result.ok, false);
    assert.equal(fs.readFileSync(before.files[0].path, "utf8"), "preserve");
    const directory = path.join(workspace, entityRequest ? "原始材料" : "attachments");
    assert.equal(fs.readdirSync(directory).length, 1);
  }
});

test("staging discard recognizes new directories and rejects directories redirected outside the workspace", async t => {
  const f = fixture(t);
  const imported = await f.api.importLocalFileData(f.staging, [{ name: "BP.pdf", data: Buffer.from("remove") }]);
  const staged = imported.files[0];
  assert.equal((await f.api.discardManagedStagingAttachment(staged.path)).removed, true);
  assert.equal(fs.existsSync(path.dirname(staged.path)), false);
  const outside = path.join(f.downloads, "attachments");
  fs.mkdirSync(outside);
  const important = path.join(outside, "BP.pdf");
  fs.writeFileSync(important, "preserve");
  const alias = path.join(f.staging, "projects", "alias");
  fs.mkdirSync(path.dirname(alias), { recursive: true });
  fs.symlinkSync(f.downloads, alias, "dir");
  assert.equal((await f.api.discardManagedStagingAttachment(path.join(alias, "attachments", "BP.pdf"))).ok, false);
  assert.equal(fs.readFileSync(important, "utf8"), "preserve");
});

test("attachment names reject traversal metadata and keep numeric clipboard names intact", async t => {
  const f = fixture(t);
  const name = "1770000000000-0-original.pdf";
  const result = await f.api.importLocalFileData(f.staging, [{ name, data: Buffer.from("original") }]);
  assert.equal(path.basename(result.files[0].path), name);
  assert.equal(f.api.logicalStagingAttachmentName(result.files[0].path, [{ path: result.files[0].path, name: "../escape.pdf" }]), name);
});

test("partial write failures leave no file or temporary directory and preserve existing collisions", async t => {
  const f = fixture(t);
  for (const staging of [false, true]) {
    const directory = path.join(f.root, staging ? "attachments" : "原始材料");
    fs.mkdirSync(directory);
    const existing = path.join(directory, "BP.pdf");
    fs.writeFileSync(existing, "existing-complete-material");
    for (const code of ["ENOSPC", "EIO"]) {
      await assert.rejects(writeNamedAttachment({
        directory, name: "BP.pdf", staging,
        write: async temporaryPath => {
          await fs.promises.writeFile(temporaryPath, "partial-bytes", { flag: "wx" });
          throw Object.assign(new Error("simulated write failure"), { code });
        }
      }), error => error.code === code);
      assert.deepEqual(fs.readdirSync(directory), ["BP.pdf"]);
      assert.equal(fs.readFileSync(existing, "utf8"), "existing-complete-material");
    }
  }
});

test("a file remains unpublished while writing and concurrent publication cannot be overwritten", async t => {
  const f = fixture(t);
  const directory = path.join(f.entity, "原始材料");
  fs.mkdirSync(directory);
  let resumeWrite;
  let announceWrite;
  const held = new Promise(resolve => { resumeWrite = resolve; });
  const started = new Promise(resolve => { announceWrite = resolve; });
  const delayed = writeNamedAttachment({
    directory, name: "BP.pdf",
    write: async temporaryPath => {
      await fs.promises.writeFile(temporaryPath, "partial-", { flag: "wx" });
      announceWrite();
      await held;
      await fs.promises.appendFile(temporaryPath, "complete");
    }
  });
  await started;
  assert.equal(fs.existsSync(path.join(directory, "BP.pdf")), false);
  assert.deepEqual(fs.readdirSync(directory).filter(name => !name.startsWith(".")), []);
  const concurrent = await writeNamedAttachment({
    directory, name: "BP.pdf", write: temporaryPath => fs.promises.writeFile(temporaryPath, "concurrent", { flag: "wx" })
  });
  resumeWrite();
  const later = await delayed;
  assert.equal(path.basename(concurrent), "BP.pdf");
  assert.equal(path.basename(later), "BP (2).pdf");
  assert.equal(fs.readFileSync(concurrent, "utf8"), "concurrent");
  assert.equal(fs.readFileSync(later, "utf8"), "partial-complete");
  assert.deepEqual(fs.readdirSync(directory).sort(), ["BP (2).pdf", "BP.pdf"]);
});
