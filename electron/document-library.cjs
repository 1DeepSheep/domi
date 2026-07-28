const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DOMI_WORKSPACE_DIRECTORY = "domi工作区";
const LOCAL_TODO_DOCUMENT_NAME = "0.待办事项.md";
const LOCAL_TODO_DOCUMENT_CONTENT = `# 待办事项

> 本文档用于 domi 本地待办事项维护。初始化和升级不会覆盖已有内容。

## 关键节点

## 新入库约见

## 人脉跟进

## 项目跟踪

<pre lang="json" caption="domi-task-board-v1"><code>{
  "schemaVersion": 1,
  "updatedAt": "1970-01-01T00:00:00.000Z",
  "tasks": []
}</code></pre>
`;
const DOCUMENT_LIBRARY_DIRECTORIES = Object.freeze([
  "1.行业研究",
  "2.行业动态",
  "3.项目库",
  "4.人脉库"
]);
const DOCUMENT_EXTENSIONS = new Map([
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".pdf", "pdf"]
]);

function expandHomePath(value) {
  const input = String(value || "").trim();
  return input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
}

function domiWorkspaceRoot(selectedDirectory) {
  const input = String(selectedDirectory || "").trim();
  if (!input) return "";
  const normalized = path.normalize(input);
  return path.basename(normalized) === DOMI_WORKSPACE_DIRECTORY
    ? normalized
    : path.join(normalized, DOMI_WORKSPACE_DIRECTORY);
}

function documentLibraryLocation(settings = {}) {
  const repositoryRoot = expandHomePath(settings.localRepositoryDir);
  const materialsRoot = expandHomePath(settings.localLibraryDir);
  const legacyLibraryRoot = materialsRoot && path.basename(path.resolve(materialsRoot)) === "3.项目库"
    ? path.dirname(path.resolve(materialsRoot))
    : materialsRoot;
  const configuredRoot = repositoryRoot || legacyLibraryRoot;
  if (!configuredRoot || !path.isAbsolute(configuredRoot)) {
    throw new Error("尚未配置本地文档库目录，请先在“资料连接”中选择目录。");
  }
  return {
    rootPath: path.resolve(configuredRoot),
    initializeStructure: Boolean(repositoryRoot)
  };
}

function isInsideRoot(rootPath, candidatePath, allowRoot = true) {
  const relative = path.relative(rootPath, candidatePath);
  if (!relative) return allowRoot;
  return relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative);
}

function assertInsideRoot(rootPath, candidatePath, allowRoot = true) {
  const resolved = path.resolve(candidatePath);
  if (!isInsideRoot(rootPath, resolved, allowRoot)) {
    throw new Error("文档操作只能在当前本地文档库内进行。");
  }
  return resolved;
}

function ensureLocalTodoDocument(rootPath) {
  const todoDocumentPath = path.join(rootPath, LOCAL_TODO_DOCUMENT_NAME);
  try {
    fs.writeFileSync(todoDocumentPath, LOCAL_TODO_DOCUMENT_CONTENT, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600
    });
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    const stat = fs.lstatSync(todoDocumentPath);
    if (!stat.isFile()) {
      throw new Error(`${LOCAL_TODO_DOCUMENT_NAME} 已存在，但不是普通文件。`);
    }
  }
  return todoDocumentPath;
}

function ensureDocumentLibraryStructure(rootPath) {
  fs.mkdirSync(rootPath, { recursive: true });
  ensureLocalTodoDocument(rootPath);
  for (const directory of DOCUMENT_LIBRARY_DIRECTORIES) {
    fs.mkdirSync(path.join(rootPath, directory), { recursive: true });
  }
}

function documentNode(rootPath, filePath, name, stat, kind, children) {
  return {
    kind,
    name,
    path: filePath,
    relativePath: path.relative(rootPath, filePath),
    size: kind === "folder" ? 0 : Number(stat.size) || 0,
    mtimeMs: Number(stat.mtimeMs) || 0,
    ...(children ? { children } : {})
  };
}

function compareNodes(left, right) {
  if (left.kind === "folder" && right.kind !== "folder") return -1;
  if (right.kind === "folder" && left.kind !== "folder") return 1;
  return left.name.localeCompare(right.name, "zh-CN", {
    numeric: true,
    sensitivity: "base"
  });
}

function listDocumentLibrary(rootPath, options = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const maximumDepth = Math.min(Math.max(Number(options.maximumDepth) || 24, 1), 24);
  const maximumNodes = Math.min(Math.max(Number(options.maximumNodes) || 20_000, 100), 50_000);
  let nodeCount = 0;
  let documentCount = 0;
  let folderCount = 0;
  let truncated = false;

  function scan(directoryPath, depth) {
    if (depth > maximumDepth || nodeCount >= maximumNodes) {
      truncated = true;
      return [];
    }
    const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
    const nodes = [];
    for (const entry of entries) {
      if (nodeCount >= maximumNodes) {
        truncated = true;
        break;
      }
      if (!entry.name || entry.name.startsWith(".")) continue;
      const entryPath = assertInsideRoot(resolvedRoot, path.join(directoryPath, entry.name), false);
      let stat;
      try {
        stat = fs.lstatSync(entryPath);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        nodeCount += 1;
        folderCount += 1;
        nodes.push(documentNode(
          resolvedRoot,
          entryPath,
          entry.name,
          stat,
          "folder",
          scan(entryPath, depth + 1)
        ));
        continue;
      }
      if (!stat.isFile()) continue;
      const kind = DOCUMENT_EXTENSIONS.get(path.extname(entry.name).toLowerCase());
      if (!kind) continue;
      nodeCount += 1;
      documentCount += 1;
      nodes.push(documentNode(resolvedRoot, entryPath, entry.name, stat, kind));
    }
    return nodes.sort(compareNodes);
  }

  const stat = fs.statSync(resolvedRoot);
  if (!stat.isDirectory()) {
    throw new Error("配置的本地文档库路径不是文件夹。");
  }
  const nodes = scan(resolvedRoot, 1);
  return {
    ok: true,
    rootPath: resolvedRoot,
    rootName: path.basename(resolvedRoot) || resolvedRoot,
    nodes,
    documentCount,
    folderCount,
    truncated,
    scannedAt: Date.now()
  };
}

function normalizeEntryName(value, kind) {
  let name = String(value || "").trim();
  if (!name) throw new Error(kind === "folder" ? "文件夹名称不能为空。" : "文档名称不能为空。");
  if (name === "." || name === ".." || /[\/\\:\0]/.test(name)) {
    throw new Error("名称不能包含路径分隔符、冒号或空字符。");
  }
  if (name.startsWith(".")) {
    throw new Error("名称不能以“.”开头。");
  }
  if (kind === "markdown" && !/\.(?:md|markdown)$/i.test(name)) {
    name = `${name}.md`;
  }
  if (kind === "markdown" && !/\.(?:md|markdown)$/i.test(name)) {
    throw new Error("新建文档必须使用 .md 或 .markdown 扩展名。");
  }
  return name;
}

function createDocumentLibraryEntry(rootPath, request = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const kind = request.kind === "folder" ? "folder" : "markdown";
  const parentPath = assertInsideRoot(
    resolvedRoot,
    request.parentPath ? request.parentPath : resolvedRoot
  );
  const parentStat = fs.statSync(parentPath);
  if (!parentStat.isDirectory()) {
    throw new Error("请选择一个文件夹作为新内容的位置。");
  }
  const name = normalizeEntryName(request.name, kind);
  const targetPath = assertInsideRoot(resolvedRoot, path.join(parentPath, name), false);
  if (fs.existsSync(targetPath)) {
    throw new Error(`“${name}”已经存在。`);
  }
  if (kind === "folder") {
    fs.mkdirSync(targetPath);
  } else {
    const title = name.replace(/\.(?:md|markdown)$/i, "");
    fs.writeFileSync(targetPath, `# ${title}\n`, { encoding: "utf8", flag: "wx" });
  }
  return {
    ok: true,
    kind,
    path: targetPath,
    name
  };
}

module.exports = {
  DOMI_WORKSPACE_DIRECTORY,
  DOCUMENT_LIBRARY_DIRECTORIES,
  LOCAL_TODO_DOCUMENT_CONTENT,
  LOCAL_TODO_DOCUMENT_NAME,
  assertInsideRoot,
  createDocumentLibraryEntry,
  documentLibraryLocation,
  domiWorkspaceRoot,
  ensureDocumentLibraryStructure,
  ensureLocalTodoDocument,
  isInsideRoot,
  listDocumentLibrary,
  normalizeEntryName
};
