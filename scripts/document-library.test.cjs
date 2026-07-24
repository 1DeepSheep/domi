const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DOCUMENT_LIBRARY_DIRECTORIES,
  createDocumentLibraryEntry,
  documentLibraryLocation,
  ensureDocumentLibraryStructure,
  listDocumentLibrary
} = require("../electron/document-library.cjs");

test("document library reflects the canonical local repository structure", () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "domi-document-library-"));
  try {
    ensureDocumentLibraryStructure(rootPath);
    const projectDirectory = path.join(rootPath, "3.项目库", "AI", "Agent", "示例项目");
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(path.join(projectDirectory, "项目主页.md"), "# 示例项目\n");
    fs.writeFileSync(path.join(projectDirectory, "融资材料.pdf"), "%PDF-1.4\n");
    fs.writeFileSync(path.join(projectDirectory, "内部数据.txt"), "hidden");

    const snapshot = listDocumentLibrary(rootPath);
    assert.equal(snapshot.ok, true);
    assert.equal(snapshot.documentCount, 2);
    assert.deepEqual(
      snapshot.nodes.slice(0, 4).map((node) => node.name),
      DOCUMENT_LIBRARY_DIRECTORIES
    );
    const projectRoot = snapshot.nodes.find((node) => node.name === "3.项目库");
    const project = projectRoot.children[0].children[0].children[0];
    assert.deepEqual(project.children.map((node) => node.kind).sort(), ["markdown", "pdf"]);
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("document library creates Markdown files and folders without escaping its root", () => {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "domi-document-create-"));
  try {
    ensureDocumentLibraryStructure(rootPath);
    const parentPath = path.join(rootPath, "1.行业研究");
    const folder = createDocumentLibraryEntry(rootPath, {
      parentPath,
      kind: "folder",
      name: "AI行业"
    });
    const document = createDocumentLibraryEntry(rootPath, {
      parentPath: folder.path,
      kind: "markdown",
      name: "行业概览"
    });

    assert.equal(document.name, "行业概览.md");
    assert.equal(fs.readFileSync(document.path, "utf8"), "# 行业概览\n");
    assert.throws(
      () => createDocumentLibraryEntry(rootPath, {
        parentPath: path.dirname(rootPath),
        kind: "markdown",
        name: "越界"
      }),
      /只能在当前本地文档库内/
    );
  } finally {
    fs.rmSync(rootPath, { recursive: true, force: true });
  }
});

test("document library prefers the configured repository root", () => {
  assert.deepEqual(
    documentLibraryLocation({
      localRepositoryDir: "/tmp/domi-repository",
      localLibraryDir: "/tmp/materials"
    }),
    {
      rootPath: "/tmp/domi-repository",
      initializeStructure: true
    }
  );
});

test("legacy project-material folder opens from its containing library root", () => {
  assert.deepEqual(
    documentLibraryLocation({
      localLibraryDir: "/tmp/1.Investment/3.项目库"
    }),
    {
      rootPath: "/tmp/1.Investment",
      initializeStructure: false
    }
  );
});
