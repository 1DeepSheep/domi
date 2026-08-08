const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { placeFeishuAssetAtMarker } = require("./feishu-markdown-assets.cjs");
const {
  markdownFeatureCounts,
  prepareMarkdownForFeishu,
  verifyFeishuMarkdownImport
} = require("./markdown-feishu-fidelity.cjs");

const MANIFEST_VERSION = 1;
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;

function responseData(response) {
  const first = response?.data ?? response ?? {};
  return first?.data ?? first;
}

function responseDocument(response) {
  const data = responseData(response);
  return data.document || data.doc || data;
}

function documentIdentity(response) {
  const data = responseData(response);
  const document = responseDocument(response);
  return {
    documentId: String(document.document_id || document.documentId || document.obj_token || ""),
    url: String(
      document.url
      || document.document_url
      || document.documentUrl
      || data.url
      || data.document_url
      || data.documentUrl
      || ""
    )
  };
}

function isPathInside(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertNoSymlinkTraversal(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  if (!isPathInside(root, candidate)) throw new Error("文件路径越过了当前 domi 本地资料库边界。");
  const parts = path.relative(root, candidate).split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new Error("资料库路径包含符号链接，已阻止可能越界的飞书发布。");
      }
    } catch (error) {
      if (error?.code === "ENOENT") break;
      throw error;
    }
  }
}

function secureDirectory(rootPath, directoryPath) {
  assertNoSymlinkTraversal(rootPath, directoryPath);
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  assertNoSymlinkTraversal(rootPath, directoryPath);
  fs.chmodSync(directoryPath, 0o700);
}

function preparePrivateStateRoot(stateRoot, libraryRoot) {
  const requested = String(stateRoot || "").trim();
  if (!requested || !path.isAbsolute(requested)) {
    throw new Error("飞书发布清单缺少 Application Support 私有目录。");
  }
  const requestedRoot = path.resolve(requested);
  if (libraryRoot && isPathInside(path.resolve(libraryRoot), requestedRoot)) {
    throw new Error("飞书发布清单不能保存在本地资料库或同步盘中。");
  }
  const requestedParent = path.dirname(requestedRoot);
  let realParent;
  try {
    realParent = fs.realpathSync.native(requestedParent);
  } catch {
    throw new Error("飞书发布清单的 Application Support 父目录不存在。");
  }
  const privateRoot = path.join(realParent, path.basename(requestedRoot));
  try {
    const stat = fs.lstatSync(privateRoot);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      throw new Error("飞书发布清单目录不是受信任的普通目录。");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    fs.mkdirSync(privateRoot, { mode: 0o700 });
  }
  const realPrivateRoot = fs.realpathSync.native(privateRoot);
  if (path.dirname(realPrivateRoot) !== realParent) {
    throw new Error("飞书发布清单目录包含符号链接，已阻止写入。");
  }
  if (libraryRoot && isPathInside(path.resolve(libraryRoot), realPrivateRoot)) {
    throw new Error("飞书发布清单不能保存在本地资料库或同步盘中。");
  }
  fs.chmodSync(realPrivateRoot, 0o700);
  return realPrivateRoot;
}

function safeJsonRead(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function atomicJsonWrite(rootPath, filePath, value) {
  secureDirectory(rootPath, path.dirname(filePath));
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  assertNoSymlinkTraversal(rootPath, temporaryPath);
  const descriptor = fs.openSync(
    temporaryPath,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
    0o600
  );
  try {
    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  } finally {
    fs.closeSync(descriptor);
  }
  try {
    assertNoSymlinkTraversal(rootPath, filePath);
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } catch (error) {
    fs.rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function manifestPathFor(stateRoot, libraryRoot, sourcePath) {
  const relativePath = path.relative(path.resolve(libraryRoot), path.resolve(sourcePath));
  const key = crypto.createHash("sha256")
    .update(path.resolve(libraryRoot))
    .update("\0")
    .update(relativePath)
    .digest("hex")
    .slice(0, 32);
  return path.join(path.resolve(stateRoot), `${key}.json`);
}

class FeishuMarkdownPublisher {
  constructor({ runLark, now = () => Date.now() }) {
    if (typeof runLark !== "function") throw new Error("FeishuMarkdownPublisher requires runLark(args, options).");
    this.runLark = runLark;
    this.now = now;
  }

  async fetchMarkdown(documentId) {
    if (!documentId) return { exists: false, content: undefined };
    try {
      const fetched = await this.runLark([
        "docs", "+fetch",
        "--doc", documentId,
        "--doc-format", "markdown",
        "--format", "json"
      ], { timeout: 120000 });
      const document = responseDocument(fetched);
      return {
        exists: Boolean(document.document_id || document.documentId || document.content !== undefined),
        content: typeof document.content === "string" ? document.content : undefined
      };
    } catch {
      return { exists: false, content: undefined };
    }
  }

  async writeMarkdown({ documentId, title, parentToken, content }) {
    const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-feishu-publish-"));
    try {
      fs.writeFileSync(path.join(temporaryDirectory, "content.md"), content, "utf8");
      if (documentId) {
        await this.runLark([
          "docs", "+update",
          "--doc", documentId,
          "--command", "overwrite",
          "--doc-format", "markdown",
          "--content", "@content.md",
          "--format", "json"
        ], { cwd: temporaryDirectory, timeout: 180000 });
        return { documentId, url: "", created: false };
      }
      const args = [
        "docs", "+create",
        "--doc-format", "markdown",
        "--title", title,
        "--content", "@content.md"
      ];
      if (parentToken) args.push("--parent-token", parentToken);
      else args.push("--parent-position", "my_library");
      args.push("--format", "json");
      const created = documentIdentity(await this.runLark(args, {
        cwd: temporaryDirectory,
        timeout: 180000
      }));
      if (!created.documentId) throw new Error(`飞书创建《${title}》后没有返回文档 ID。`);
      return { ...created, created: true };
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async insertAssets(documentId, assets) {
    for (const asset of assets) {
      await placeFeishuAssetAtMarker({ runLark: this.runLark, documentId, asset });
    }
  }

  async rollbackMarkdown(documentId, content) {
    if (!documentId || typeof content !== "string") return { ok: false, verification: null };
    try {
      await this.writeMarkdown({ documentId, title: "", parentToken: "", content });
      const fetched = await this.fetchMarkdown(documentId);
      const verification = verifyFeishuMarkdownImport({
        prepared: { content, fidelity: { featureCounts: markdownFeatureCounts(content) } },
        fetchedMarkdown: fetched.content
      });
      return { ok: verification.status === "passed", verification };
    } catch {
      return { ok: false, verification: null };
    }
  }

  async cleanupCreatedDocument(documentId) {
    if (!documentId) return { ok: false };
    try {
      await this.runLark([
        "docs", "+delete",
        "--doc", documentId,
        "--format", "json"
      ], { timeout: 120000 });
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  async publish({
    sourcePath,
    libraryRoot,
    title,
    parentToken = "",
    documentId = "",
    documentUrl = "",
    stateRoot = ""
  }) {
    const configuredRoot = path.resolve(String(libraryRoot || ""));
    const requestedSource = path.resolve(String(sourcePath || ""));
    let root;
    let source;
    try {
      root = fs.realpathSync.native(configuredRoot);
      source = fs.realpathSync.native(requestedSource);
    } catch {
      throw new Error("本地资料库或 Markdown 源文件不存在。");
    }
    if (!libraryRoot || !sourcePath || !isPathInside(root, source)) {
      throw new Error("只能发布当前 domi 本地资料库中的 Markdown 文档。");
    }
    if (isPathInside(configuredRoot, requestedSource)) {
      assertNoSymlinkTraversal(configuredRoot, requestedSource);
    }
    assertNoSymlinkTraversal(root, source);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink() || ![".md", ".markdown"].includes(path.extname(source).toLowerCase())) {
      throw new Error("发布源必须是资料库内的普通 Markdown 文件。");
    }
    if (stat.size > MAX_MARKDOWN_BYTES) throw new Error("Markdown 超过 8 MB，无法安全发布到飞书。");
    const original = fs.readFileSync(source, "utf8");
    const documentTitle = String(title || path.basename(source, path.extname(source))).trim() || "文档";
    const prepared = prepareMarkdownForFeishu({
      markdown: original,
      sourcePath: source,
      libraryRoot: root,
      title: documentTitle
    });
    const privateStateRoot = preparePrivateStateRoot(stateRoot, root);
    const resolvedManifestPath = manifestPathFor(privateStateRoot, root, source);
    assertNoSymlinkTraversal(privateStateRoot, resolvedManifestPath);
    const priorManifest = safeJsonRead(resolvedManifestPath);
    const targetDocumentId = String(documentId || priorManifest?.target?.documentId || "");
    const targetDocumentUrl = String(documentUrl || priorManifest?.target?.url || "");
    const manifestId = path.basename(resolvedManifestPath, ".json");
    if (prepared.fidelity.status === "blocked") {
      const blockedManifest = {
        version: MANIFEST_VERSION,
        status: "blocked",
        source: {
          relativePath: path.relative(root, source),
          sha256: prepared.sourceSha256
        },
        target: {
          documentId: targetDocumentId,
          url: targetDocumentUrl,
          parentToken
        },
        preparation: prepared.fidelity,
        remoteWrite: false,
        updatedAt: this.now()
      };
      atomicJsonWrite(privateStateRoot, resolvedManifestPath, blockedManifest);
      return {
        ok: false,
        stage: "preflight",
        remoteWrite: false,
        manifestId,
        manifestStored: true,
        preparation: prepared.fidelity,
        error: "本地 Markdown 存在无法无损导入的资源；飞书端未执行任何写入。"
      };
    }
    if (
      priorManifest?.status === "complete"
      && priorManifest.source?.sha256 === prepared.sourceSha256
      && targetDocumentId
    ) {
      const current = await this.fetchMarkdown(targetDocumentId);
      if (current.exists) {
        const verification = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: current.content });
        if (verification.status === "passed") {
          return {
            ok: true,
            skipped: true,
            remoteWrite: false,
            manifestId,
            manifestStored: true,
            target: { documentId: targetDocumentId, url: targetDocumentUrl },
            preparation: prepared.fidelity,
            verification
          };
        }
      }
    }
    const priorRemote = targetDocumentId
      ? await this.fetchMarkdown(targetDocumentId)
      : { exists: false, content: undefined };
    if (targetDocumentId && (!priorRemote.exists || typeof priorRemote.content !== "string")) {
      return {
        ok: false,
        stage: "snapshot",
        remoteWrite: false,
        manifestId,
        manifestStored: true,
        target: { documentId: targetDocumentId, url: targetDocumentUrl },
        preparation: prepared.fidelity,
        error: "编辑飞书文档前无法取得可回读的远端 Markdown 快照；为避免不可逆覆盖，本次未写入。"
      };
    }
    let target = null;
    let editWriteAttempted = false;
    try {
      editWriteAttempted = Boolean(targetDocumentId);
      target = await this.writeMarkdown({
        documentId: targetDocumentId,
        title: documentTitle,
        parentToken,
        content: prepared.content
      });
      await this.insertAssets(target.documentId, prepared.assets);
      const fetched = await this.fetchMarkdown(target.documentId);
      const verification = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: fetched.content });
      if (verification.status !== "passed") {
        const rollback = !target.created && priorRemote.exists
          ? await this.rollbackMarkdown(target.documentId, priorRemote.content)
          : { ok: false, verification: null };
        const cleanup = target.created
          ? await this.cleanupCreatedDocument(target.documentId)
          : { ok: false };
        const failedManifest = {
          version: MANIFEST_VERSION,
          status: "verification-failed",
          source: {
            relativePath: path.relative(root, source),
            sha256: prepared.sourceSha256
          },
          target: {
            documentId: target.documentId,
            url: target.url || targetDocumentUrl,
            parentToken
          },
          preparation: prepared.fidelity,
          verification,
          remoteRolledBack: rollback.ok,
          cleanupAttempted: Boolean(target.created),
          remoteCleaned: cleanup.ok,
          rollbackVerification: rollback.verification,
          updatedAt: this.now()
        };
        atomicJsonWrite(privateStateRoot, resolvedManifestPath, failedManifest);
        return {
          ok: false,
          stage: "verification",
          remoteWrite: true,
          remoteRolledBack: rollback.ok,
          cleanupAttempted: Boolean(target.created),
          remoteCleaned: cleanup.ok,
          manifestId,
          manifestStored: true,
          target: failedManifest.target,
          preparation: prepared.fidelity,
          verification,
          error: verification.message
        };
      }
      const manifest = {
        version: MANIFEST_VERSION,
        status: "complete",
        source: {
          relativePath: path.relative(root, source),
          sha256: prepared.sourceSha256
        },
        target: {
          documentId: target.documentId,
          url: target.url || targetDocumentUrl,
          parentToken
        },
        preparation: prepared.fidelity,
        verification,
        updatedAt: this.now()
      };
      atomicJsonWrite(privateStateRoot, resolvedManifestPath, manifest);
      return {
        ok: true,
        skipped: false,
        remoteWrite: true,
        manifestId,
        manifestStored: true,
        target: manifest.target,
        preparation: prepared.fidelity,
        verification
      };
    } catch (error) {
      const rollback = editWriteAttempted && targetDocumentId && priorRemote.exists
        ? await this.rollbackMarkdown(targetDocumentId, priorRemote.content)
        : { ok: false, verification: null };
      const cleanup = target?.created
        ? await this.cleanupCreatedDocument(target.documentId)
        : { ok: false };
      return {
        ok: false,
        stage: "write",
        remoteWrite: Boolean(target) || editWriteAttempted,
        remoteRolledBack: rollback.ok,
        cleanupAttempted: Boolean(target?.created),
        remoteCleaned: cleanup.ok,
        rollbackVerification: rollback.verification,
        manifestId,
        manifestStored: fs.existsSync(resolvedManifestPath),
        preparation: prepared.fidelity,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }
}

module.exports = {
  FeishuMarkdownPublisher,
  manifestPathFor
};
