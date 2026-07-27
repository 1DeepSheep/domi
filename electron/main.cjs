const { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, net, Notification, protocol, safeStorage, shell } = require("electron");
const { execFile } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath, pathToFileURL } = require("node:url");
const { promisify } = require("node:util");
const {
  CodexAppServer,
  codexEnvironment,
  resolveCodexBinary
} = require("./codex-app-server.cjs");
const {
  CodexBootstrapService,
  createElectronNetFetcher,
  fetchOfficialInstaller
} = require("./codex-bootstrap.cjs");
const { WorkbenchStateStore } = require("./state-store.cjs");
const { DomiIntegration } = require("./domi-integration.cjs");
const { DomiPluginManager } = require("./domi-plugin-manager.cjs");
const {
  AppSettingsService,
  normalizeSettings,
  validateDomiConfig
} = require("./app-settings.cjs");
const { UpdateService } = require("./update-service.cjs");
const { ServiceCoordinator } = require("./service-coordinator.cjs");
const { classifyCodexTurnStatus } = require("./codex-turn-status.cjs");
const { isSelectedCodexConnectionReady } = require("./codex-protocol.cjs");
const {
  codexRunExecutionMode,
  partitionCodexRuns,
  requestCodexTurn,
  threadPersistenceOptions
} = require("./codex-run-context.cjs");
const {
  buildMarkdownClipboardPayload,
  detectImageMime,
  resolveMarkdownImagePath,
  savePastedMarkdownImage
} = require("./markdown-assets.cjs");
const {
  createDocumentLibraryEntry,
  documentLibraryLocation,
  ensureDocumentLibraryStructure,
  listDocumentLibrary
} = require("./document-library.cjs");
const { normalizeWebResource } = require("./resource-target.cjs");
const { prepareApplicationBrandPaths } = require("./brand-migration.cjs");

const brandPaths = prepareApplicationBrandPaths(app);
const execFileAsync = promisify(execFile);
const pdfProtocol = "domi-pdf";
const markdownAssetProtocol = "domi-asset";

protocol.registerSchemesAsPrivileged([
  {
    scheme: pdfProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  },
  {
    scheme: markdownAssetProtocol,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);
const activeRuns = new Map();
const allowedMarkdownAssetPaths = new Set();
const CODEX_RUN_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const externalDomiWorkflows = new Map([
  ["domi-analyst", "使用 domi-AI分析师，并可能读取当前 domi 资料库"],
  ["domi-router", "访问 PLAUD、domi 恢复队列和当前资料库，并可能按工作流更新记录"],
  ["meeting-prep", "读取当前项目、人脉、文档和材料及公开信息，生成只读会前简报"],
  ["people-intake", "使用 domi 人物研究入库工作流检索公开信息、查重并更新当前人脉库"],
  ["project-research", "使用 domi Router 读取内部项目材料、当前文档库与公开信息源，完成项目只读研究"],
  ["project-intake", "使用 domi Router 完成项目研究、投资快评，并更新当前项目库"],
  ["quick-discussion", "使用 domi Router 调用本机麦克风、PLAUD 与本地文件，生成讨论纪要和跟进事项"],
  ["investment-radar", "联网检索和核验最新行业新闻，并更新当前行业事件库"],
  ["desk-research", "访问当前项目库、文档、材料和联网数据源，并可能按要求回填研究成果"],
  ["sourcing", "访问当前人脉库和公开信息源，并可能按要求更新人脉记录"],
  ["investment-mgmt", "访问并可能更新当前项目库、文档与本地材料"]
]);
const larkRequestPattern = /(?:飞书|lark|wiki|watching\s*list|项目库|人脉库|people|onedrive|项目文档|交流文档|线上文档)/i;
const explicitFeishuRequestPattern = /(?:飞书|lark|wiki|watching\s*list|线上文档)/i;

const appName = brandPaths.appName;
const rootDir = path.resolve(__dirname, "..");
const runtimeLogPath = path.join(brandPaths.userDataPath, "logs", "runtime.jsonl");
const runtimeLogArchivePath = `${runtimeLogPath}.1`;
const RUNTIME_LOG_MAX_BYTES = 2 * 1024 * 1024;
const legacyDevelopmentWorkspace = path.join(rootDir, "demo-workspace");
const demoWorkspace = brandPaths.workspacePath;
const outputDir = path.join(demoWorkspace, "outputs");
const projectsDir = path.join(demoWorkspace, "projects");
const appIconPath = path.join(rootDir, "public", "domi-dock-icon.png");

let codexClient = null;
let stateStore = null;
let domiIntegration = null;
let domiPluginManager = null;
let appSettings = null;
let codexBootstrap = null;
let updateService = null;
const serviceCoordinator = new ServiceCoordinator();

function boundedRuntimeText(value, limit = 8_000) {
  if (value === undefined || value === null) return "";
  return String(value).slice(0, limit);
}

function appendRuntimeLog(event, details = {}) {
  try {
    fs.mkdirSync(path.dirname(runtimeLogPath), { recursive: true });
    if (fs.existsSync(runtimeLogPath) && fs.statSync(runtimeLogPath).size >= RUNTIME_LOG_MAX_BYTES) {
      fs.rmSync(runtimeLogArchivePath, { force: true });
      fs.renameSync(runtimeLogPath, runtimeLogArchivePath);
    }
    fs.appendFileSync(runtimeLogPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      event: boundedRuntimeText(event, 120),
      ...details
    })}\n`, "utf8");
  } catch (error) {
    console.error("[runtime-log] 无法写入诊断日志", error);
  }
}

function migrateLegacyDevelopmentWorkspace() {
  if (app.isPackaged || !fs.existsSync(legacyDevelopmentWorkspace)) return;
  const markerDir = path.join(app.getPath("userData"), "migrations");
  const markerPath = path.join(markerDir, "development-workspace-v1.json");
  if (fs.existsSync(markerPath)) return;

  fs.mkdirSync(path.dirname(demoWorkspace), { recursive: true });
  fs.cpSync(legacyDevelopmentWorkspace, demoWorkspace, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
  fs.mkdirSync(markerDir, { recursive: true });
  fs.writeFileSync(markerPath, JSON.stringify({
    migratedAt: new Date().toISOString(),
    source: legacyDevelopmentWorkspace,
    destination: demoWorkspace
  }, null, 2));
}

function ensureDemoWorkspace() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(projectsDir, { recursive: true });
}

function getStateStore() {
  if (!stateStore) {
    stateStore = new WorkbenchStateStore({
      databasePath: path.join(app.getPath("userData"), "domi.sqlite3"),
      projectsDir
    });
  }
  return stateStore;
}

function getDomiIntegration() {
  if (!domiIntegration) {
    domiIntegration = new DomiIntegration({
      stateStore: getStateStore(),
      configProvider: () => getAppSettings().load().settings,
      plaudOutputDir: path.join(demoWorkspace, "work", "domi", "plaud")
    });
  }
  return domiIntegration;
}

function getDomiPluginManager() {
  if (!domiPluginManager) {
    const bundledRoot = app.isPackaged
      ? path.join(process.resourcesPath, "domi-plugin")
      : path.join(rootDir, "build", "domi-plugin");
    const bundledLockPath = app.isPackaged
      ? path.join(process.resourcesPath, "domi-plugin-lock.json")
      : path.join(rootDir, "build", "domi-plugin-lock.json");
    domiPluginManager = new DomiPluginManager({
      userDataPath: app.getPath("userData"),
      bundledPluginRoot: bundledRoot,
      bundledLockPath,
      clientVersion: app.getVersion(),
      remoteUpdateEnabled: process.env.DOMI_PLUGIN_AUTO_UPDATE !== "0"
    });
  }
  return domiPluginManager;
}

function getAppSettings() {
  if (!appSettings) {
    appSettings = new AppSettingsService({
      stateStore: getStateStore(),
      safeStorage,
      domiConfigPath: path.join(app.getPath("userData"), "domi-plugin-config.json")
    });
  }
  return appSettings;
}

function getCodexBootstrap() {
  if (!codexBootstrap) {
    const electronFetcher = createElectronNetFetcher(net);
    codexBootstrap = new CodexBootstrapService({
      fetchInstaller: () => fetchOfficialInstaller(electronFetcher)
    });
  }
  return codexBootstrap;
}

function getUpdateService() {
  if (!updateService) {
    updateService = new UpdateService({
      app,
      channelProvider: () => getAppSettings().load().settings.updateChannel
    });
  }
  return updateService;
}

function validProjectWorkspace(candidate) {
  if (!candidate) {
    return null;
  }
  const resolved = path.resolve(candidate);
  return resolved.startsWith(`${path.resolve(projectsDir)}${path.sep}`) ? resolved : null;
}

async function importLocalFiles(requestedWorkspacePath, requestedPaths) {
  ensureDemoWorkspace();
  const workspacePath = validProjectWorkspace(requestedWorkspacePath) || demoWorkspace;
  const attachmentsDir = path.join(workspacePath, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const sourcePaths = Array.isArray(requestedPaths)
    ? [...new Set(requestedPaths.filter((value) => typeof value === "string" && value.trim()))]
    : [];
  if (sourcePaths.length === 0) {
    return { ok: false, canceled: false, files: [], error: "没有读取到可导入的本地文件。" };
  }

  try {
    const stamp = Date.now();
    const files = await Promise.all(
      sourcePaths.map(async (sourcePath, index) => {
        const resolvedSourcePath = path.resolve(sourcePath);
        const sourceStat = await fs.promises.stat(resolvedSourcePath);
        if (!sourceStat.isFile()) {
          throw new Error(`${path.basename(resolvedSourcePath)} 不是可导入的文件。`);
        }
        const name = path.basename(resolvedSourcePath);
        const targetPath = path.join(attachmentsDir, `${stamp}-${index}-${name}`);
        await fs.promises.copyFile(resolvedSourcePath, targetPath);
        const stat = await fs.promises.stat(targetPath);
        return { name, path: targetPath, size: stat.size };
      })
    );
    return { ok: true, canceled: false, files };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      files: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function sanitizedAttachmentName(candidate, index) {
  const fallback = `clipboard-file-${index + 1}`;
  const baseName = path.basename(typeof candidate === "string" ? candidate.trim() : "") || fallback;
  const sanitized = baseName
    .replace(/[\u0000-\u001f<>:"/\\|?*]/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 180);
  return sanitized || fallback;
}

async function importLocalFileData(requestedWorkspacePath, requestedFiles) {
  ensureDemoWorkspace();
  const workspacePath = validProjectWorkspace(requestedWorkspacePath) || demoWorkspace;
  const attachmentsDir = path.join(workspacePath, "attachments");
  fs.mkdirSync(attachmentsDir, { recursive: true });

  const sourceFiles = Array.isArray(requestedFiles) ? requestedFiles : [];
  if (sourceFiles.length === 0) {
    return { ok: false, canceled: false, files: [], error: "剪贴板中没有可导入的文件。" };
  }

  try {
    const stamp = Date.now();
    const files = await Promise.all(
      sourceFiles.map(async (sourceFile, index) => {
        const data = sourceFile?.data;
        const bytes = data instanceof ArrayBuffer
          ? Buffer.from(data)
          : ArrayBuffer.isView(data)
            ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : null;
        if (!bytes || bytes.length === 0) {
          throw new Error(`${sanitizedAttachmentName(sourceFile?.name, index)} 没有可读取的文件内容。`);
        }
        const name = sanitizedAttachmentName(sourceFile?.name, index);
        const targetPath = path.join(attachmentsDir, `${stamp}-${index}-${name}`);
        await fs.promises.writeFile(targetPath, bytes, { flag: "wx" });
        const stat = await fs.promises.stat(targetPath);
        return { name, path: targetPath, size: stat.size };
      })
    );
    return { ok: true, canceled: false, files };
  } catch (error) {
    return {
      ok: false,
      canceled: false,
      files: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function selectLocalFiles(sender, requestedWorkspacePath) {
  const owner = BrowserWindow.fromWebContents(sender);
  const result = await dialog.showOpenDialog(owner, {
    title: "选择投资材料",
    buttonLabel: "添加材料",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "常用材料",
        extensions: [
          "pdf", "doc", "docx", "xls", "xlsx", "csv", "ppt", "pptx",
          "md", "txt", "json", "png", "jpg", "jpeg", "webp", "heic",
          "mp3", "m4a", "wav", "mp4", "mov"
        ]
      },
      { name: "所有文件", extensions: ["*"] }
    ]
  });

  if (result.canceled) {
    return { ok: true, canceled: true, files: [] };
  }
  return importLocalFiles(requestedWorkspacePath, result.filePaths);
}

function expandHomeDirectory(input) {
  const candidate = String(input || "").trim();
  return candidate.startsWith("~/")
    ? path.join(os.homedir(), candidate.slice(2))
    : candidate;
}

async function selectLocalDirectory(sender, requestedPath) {
  const owner = BrowserWindow.fromWebContents(sender);
  const expandedPath = expandHomeDirectory(requestedPath);
  const defaultPath = expandedPath && fs.existsSync(expandedPath)
    ? expandedPath
    : app.getPath("documents");
  const result = await dialog.showOpenDialog(owner, {
    title: "选择本地资料库目录",
    buttonLabel: "选择目录",
    defaultPath,
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) {
    return { ok: true, canceled: true, path: "" };
  }
  return { ok: true, canceled: false, path: result.filePaths[0] };
}

function currentDocumentLibraryLocation() {
  const settings = getAppSettings().load().settings;
  const location = documentLibraryLocation(settings);
  if (location.initializeStructure) {
    ensureDocumentLibraryStructure(location.rootPath);
  } else if (!fs.existsSync(location.rootPath)) {
    fs.mkdirSync(location.rootPath, { recursive: true });
  }
  return location;
}

function readDocumentLibrary() {
  try {
    const location = currentDocumentLibraryLocation();
    return {
      ...listDocumentLibrary(location.rootPath),
      structured: location.initializeStructure
    };
  } catch (error) {
    return {
      ok: false,
      rootPath: "",
      rootName: "本地文档库",
      nodes: [],
      documentCount: 0,
      folderCount: 0,
      truncated: false,
      scannedAt: Date.now(),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function createDocumentLibraryItem(request) {
  try {
    const location = currentDocumentLibraryLocation();
    const created = createDocumentLibraryEntry(location.rootPath, request);
    return {
      ...created,
      snapshot: {
        ...listDocumentLibrary(location.rootPath),
        structured: location.initializeStructure
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function openResource(resource) {
  const webResource = normalizeWebResource(resource);
  if (webResource) {
    await shell.openExternal(webResource);
    return { ok: true, target: webResource };
  }

  if (typeof resource !== "string" || !resource.trim()) {
    return { ok: false, error: "资源地址为空。" };
  }

  const target = resource.trim();
  let localPath = target;
  if (/^file:\/\//i.test(target)) {
    try {
      localPath = fileURLToPath(target);
    } catch {
      return { ok: false, error: "本地文件地址无效。" };
    }
  }

  try {
    localPath = decodeURIComponent(localPath);
  } catch {
    // Keep the original path when it contains a literal percent sign.
  }

  if (!path.isAbsolute(localPath)) {
    return { ok: false, error: "仅支持网页链接或绝对本地路径。" };
  }

  const resolved = path.normalize(localPath);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: "本地文件不存在。", target: resolved };
  }

  const error = await shell.openPath(resolved);
  return { ok: !error, error: error || undefined, target: resolved };
}

function resolveMarkdownPath(resource, basePath) {
  if (typeof resource !== "string" || !resource.trim()) {
    throw new Error("Markdown 文件地址为空。");
  }

  let localPath = resource.trim();
  if (/^file:\/\//i.test(localPath)) {
    localPath = fileURLToPath(localPath);
  }
  try {
    localPath = decodeURIComponent(localPath);
  } catch {
    // Keep literal percent signs in local paths.
  }

  if (!path.isAbsolute(localPath)) {
    if (typeof basePath !== "string" || !path.isAbsolute(basePath)) {
      throw new Error("Markdown 文件必须使用绝对路径。");
    }
    localPath = path.resolve(path.dirname(basePath), localPath);
  }

  const resolved = path.normalize(localPath);
  if (!/\.(?:md|markdown)$/i.test(resolved)) {
    throw new Error("右侧文档面板仅支持 Markdown 文件。");
  }
  return resolved;
}

function resolvePdfPath(resource, basePath) {
  if (typeof resource !== "string" || !resource.trim()) {
    throw new Error("PDF 文件地址为空。");
  }

  let localPath = resource.trim();
  if (/^file:\/\//i.test(localPath)) {
    localPath = fileURLToPath(localPath);
  }
  try {
    localPath = decodeURIComponent(localPath);
  } catch {
    // Keep literal percent signs in local paths.
  }

  if (!path.isAbsolute(localPath)) {
    if (typeof basePath !== "string" || !path.isAbsolute(basePath)) {
      throw new Error("PDF 文件必须使用绝对路径。");
    }
    localPath = path.resolve(path.dirname(basePath), localPath);
  }

  const resolved = path.normalize(localPath);
  if (!/\.pdf$/i.test(resolved)) {
    throw new Error("右侧 PDF 面板仅支持 PDF 文件。");
  }
  return resolved;
}

function pdfPreviewUrl(filePath) {
  const token = Buffer.from(filePath, "utf8").toString("base64url");
  return `${pdfProtocol}://local/${token}`;
}

function markdownAssetPreviewUrl(filePath) {
  const token = Buffer.from(filePath, "utf8").toString("base64url");
  return `${markdownAssetProtocol}://local/${token}`;
}

async function readPdfDocument(request) {
  try {
    const resolved = resolvePdfPath(request?.resource, request?.basePath);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return { ok: false, error: "所选路径不是文件。" };
    }

    const file = await fs.promises.open(resolved, "r");
    const signature = Buffer.alloc(5);
    try {
      await file.read(signature, 0, signature.length, 0);
    } finally {
      await file.close();
    }
    if (signature.toString("ascii") !== "%PDF-") {
      return { ok: false, error: "文件扩展名为 PDF，但内容不是有效的 PDF 文件。" };
    }

    return {
      ok: true,
      document: {
        path: resolved,
        name: path.basename(resolved),
        previewUrl: pdfPreviewUrl(resolved),
        size: stat.size,
        mtimeMs: stat.mtimeMs
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function installPdfProtocol() {
  protocol.handle(pdfProtocol, (request) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== "local") {
        return new Response("Not found", { status: 404 });
      }
      const token = requestUrl.pathname.replace(/^\//, "");
      const resolved = resolvePdfPath(Buffer.from(token, "base64url").toString("utf8"));
      return net.fetch(pathToFileURL(resolved).href);
    } catch {
      return new Response("Invalid PDF resource", { status: 400 });
    }
  });
}

function installMarkdownAssetProtocol() {
  protocol.handle(markdownAssetProtocol, async (request) => {
    try {
      const requestUrl = new URL(request.url);
      if (requestUrl.hostname !== "local") {
        return new Response("Not found", { status: 404 });
      }
      const token = requestUrl.pathname.replace(/^\//, "");
      const resolved = fs.realpathSync(Buffer.from(token, "base64url").toString("utf8"));
      if (!allowedMarkdownAssetPaths.has(resolved)) {
        return new Response("Not allowed", { status: 403 });
      }
      const file = await fs.promises.open(resolved, "r");
      const signature = Buffer.alloc(16);
      let bytesRead = 0;
      try {
        ({ bytesRead } = await file.read(signature, 0, signature.length, 0));
      } finally {
        await file.close();
      }
      if (!detectImageMime(signature.subarray(0, bytesRead))) {
        return new Response("Unsupported image", { status: 415 });
      }
      return net.fetch(pathToFileURL(resolved).href);
    } catch {
      return new Response("Invalid image resource", { status: 400 });
    }
  });
}

async function readMarkdownDocument(request) {
  try {
    const resolved = resolveMarkdownPath(request?.resource, request?.basePath);
    const stat = await fs.promises.stat(resolved);
    if (!stat.isFile()) {
      return { ok: false, error: "所选路径不是文件。" };
    }
    if (stat.size > 8 * 1024 * 1024) {
      return { ok: false, error: "Markdown 文件超过 8 MB，暂不在 domi 中打开。" };
    }
    const content = await fs.promises.readFile(resolved, "utf8");
    return {
      ok: true,
      document: {
        path: resolved,
        name: path.basename(resolved),
        content,
        size: stat.size,
        mtimeMs: stat.mtimeMs
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function saveMarkdownDocument(request) {
  try {
    const resolved = resolveMarkdownPath(request?.path);
    if (typeof request?.content !== "string") {
      return { ok: false, error: "Markdown 内容无效。" };
    }
    if (Buffer.byteLength(request.content, "utf8") > 8 * 1024 * 1024) {
      return { ok: false, error: "Markdown 内容超过 8 MB，无法保存。" };
    }

    const currentStat = await fs.promises.stat(resolved);
    const expectedMtimeMs = Number(request.expectedMtimeMs || 0);
    if (expectedMtimeMs && Math.abs(currentStat.mtimeMs - expectedMtimeMs) > 1) {
      return {
        ok: false,
        conflict: true,
        error: "文件已被 OneDrive 或其他应用修改，请重新载入后再编辑。"
      };
    }

    await fs.promises.writeFile(resolved, request.content, "utf8");
    const nextStat = await fs.promises.stat(resolved);
    return {
      ok: true,
      document: {
        path: resolved,
        name: path.basename(resolved),
        content: request.content,
        size: nextStat.size,
        mtimeMs: nextStat.mtimeMs
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function resolveMarkdownImagePreview(request) {
  try {
    const resolved = resolveMarkdownImagePath(request?.documentPath, request?.source);
    if (allowedMarkdownAssetPaths.size >= 2_000) allowedMarkdownAssetPaths.clear();
    allowedMarkdownAssetPaths.add(resolved);
    return {
      ok: true,
      previewUrl: markdownAssetPreviewUrl(resolved)
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function saveMarkdownImage(request) {
  try {
    const asset = await savePastedMarkdownImage(request);
    const resolved = fs.realpathSync(asset.path);
    if (allowedMarkdownAssetPaths.size >= 2_000) allowedMarkdownAssetPaths.clear();
    allowedMarkdownAssetPaths.add(resolved);
    return {
      ok: true,
      asset: {
        ...asset,
        previewUrl: markdownAssetPreviewUrl(resolved)
      }
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function copyMarkdownDocument(request) {
  try {
    const payload = buildMarkdownClipboardPayload({
      documentPath: request?.documentPath,
      markdown: request?.markdown
    });
    clipboard.write({
      text: payload.text,
      html: payload.html
    });
    return {
      ok: true,
      imageCount: payload.imageCount,
      missingImageCount: payload.missingImageCount
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeMarkdownFileName(value, currentPath) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("文件名不能为空。");
  }

  let fileName = value.trim();
  if (fileName === "." || fileName === ".." || /[\/\\\0]/.test(fileName)) {
    throw new Error("文件名不能包含路径或非法字符。");
  }
  if (Buffer.byteLength(fileName, "utf8") > 240) {
    throw new Error("文件名过长，请缩短后再试。");
  }

  let extension = path.extname(fileName);
  if (!extension) {
    extension = path.extname(currentPath) || ".md";
    fileName += extension;
  }
  if (!/^\.(?:md|markdown)$/i.test(extension)) {
    throw new Error("文件名必须以 .md 或 .markdown 结尾。");
  }
  if (!fileName.slice(0, -extension.length).trim()) {
    throw new Error("文件名不能只包含扩展名。");
  }
  return fileName;
}

async function renameMarkdownDocument(request) {
  try {
    const sourcePath = resolveMarkdownPath(request?.path);
    const sourceStat = await fs.promises.stat(sourcePath);
    if (!sourceStat.isFile()) {
      return { ok: false, error: "所选路径不是文件。" };
    }

    const expectedMtimeMs = Number(request?.expectedMtimeMs || 0);
    if (expectedMtimeMs && Math.abs(sourceStat.mtimeMs - expectedMtimeMs) > 1) {
      return {
        ok: false,
        conflict: true,
        error: "文件已被 OneDrive 或其他应用修改，请重新打开后再重命名。"
      };
    }

    const fileName = normalizeMarkdownFileName(request?.name, sourcePath);
    const targetPath = path.join(path.dirname(sourcePath), fileName);
    if (targetPath === sourcePath) {
      return readMarkdownDocument({ resource: sourcePath });
    }

    const caseOnlyRename = sourcePath.toLocaleLowerCase() === targetPath.toLocaleLowerCase();
    if (!caseOnlyRename && fs.existsSync(targetPath)) {
      return { ok: false, error: "当前文件夹中已存在同名文件。" };
    }

    if (caseOnlyRename) {
      const temporaryPath = path.join(
        path.dirname(sourcePath),
        `.${path.basename(sourcePath)}.domi-rename-${process.pid}-${Date.now().toString(36)}`
      );
      await fs.promises.rename(sourcePath, temporaryPath);
      try {
        await fs.promises.rename(temporaryPath, targetPath);
      } catch (error) {
        await fs.promises.rename(temporaryPath, sourcePath).catch(() => undefined);
        throw error;
      }
    } else {
      await fs.promises.rename(sourcePath, targetPath);
    }

    return readMarkdownDocument({ resource: targetPath });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function createWindow() {
  const appIcon = nativeImage.createFromPath(appIconPath);
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 760,
    title: appName,
    icon: appIcon,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#f6f3ee",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    const allowed = app.isPackaged
      ? url.startsWith("file:")
      : url.startsWith("http://127.0.0.1:5173");
    if (!allowed) event.preventDefault();
  });

  let rendererRecoveryAttempts = 0;
  let rendererStableTimer = null;
  const scheduleRendererRecovery = (trigger, baseDelayMs) => {
    rendererRecoveryAttempts += 1;
    const attempt = rendererRecoveryAttempts;
    if (attempt > 2) {
      appendRuntimeLog("renderer-reload-suppressed", { trigger, attempt });
      return;
    }
    const delayMs = baseDelayMs * attempt;
    appendRuntimeLog("renderer-reload-scheduled", { trigger, attempt, delayMs });
    setTimeout(() => {
      if (win.isDestroyed()) return;
      appendRuntimeLog("renderer-reload-started", { trigger, attempt });
      win.webContents.reload();
    }, delayMs).unref();
  };

  win.webContents.on("did-finish-load", () => {
    if (rendererStableTimer) clearTimeout(rendererStableTimer);
    appendRuntimeLog("renderer-loaded", { recoveryAttempts: rendererRecoveryAttempts });
    rendererStableTimer = setTimeout(() => {
      rendererRecoveryAttempts = 0;
      rendererStableTimer = null;
      appendRuntimeLog("renderer-stable");
    }, 60_000);
    rendererStableTimer.unref();
  });
  win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame || errorCode === -3 || win.isDestroyed()) return;
    console.error(`[renderer] 页面加载失败：${errorCode} ${errorDescription}`);
    appendRuntimeLog("renderer-load-failed", {
      errorCode,
      errorDescription: boundedRuntimeText(errorDescription, 1_000),
      url: boundedRuntimeText(_url, 1_000)
    });
    scheduleRendererRecovery("did-fail-load", 800);
  });
  win.webContents.on("render-process-gone", (_event, details) => {
    console.error(`[renderer] 渲染进程退出：${details.reason} (${details.exitCode})`);
    appendRuntimeLog("renderer-process-gone", {
      reason: boundedRuntimeText(details.reason, 120),
      exitCode: Number(details.exitCode || 0)
    });
    if (win.isDestroyed() || details.reason === "clean-exit") return;
    scheduleRendererRecovery("render-process-gone", 1_000);
  });
  win.webContents.on("preload-error", (_event, preloadPath, error) => {
    appendRuntimeLog("renderer-preload-error", {
      preloadPath: boundedRuntimeText(preloadPath, 1_000),
      message: boundedRuntimeText(error?.message || error, 4_000),
      stack: boundedRuntimeText(error?.stack, 8_000)
    });
  });
  win.on("unresponsive", () => {
    if (win.isDestroyed()) return;
    appendRuntimeLog("renderer-unresponsive");
    void dialog.showMessageBox(win, {
      type: "warning",
      title: "domi 暂时无响应",
      message: "界面暂时无响应，后台任务仍会继续运行。",
      detail: "可以等待界面恢复，或重新载入界面并自动恢复正在执行的 Codex 对话。",
      buttons: ["继续等待", "重新载入界面"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    }).then((result) => {
      if (result.response === 1 && !win.isDestroyed()) {
        appendRuntimeLog("renderer-manual-reload", { trigger: "unresponsive-dialog" });
        win.webContents.reload();
      }
    });
  });
  win.on("responsive", () => appendRuntimeLog("renderer-responsive"));
  win.on("closed", () => {
    if (rendererStableTimer) clearTimeout(rendererStableTimer);
  });

  if (app.isPackaged || process.env.NODE_ENV === "production") {
    win.loadFile(path.join(rootDir, "dist", "index.html"));
  } else {
    win.loadURL("http://127.0.0.1:5173");
  }
}

function publishCodexEvent(sender, runId, payload) {
  if (!sender.isDestroyed()) {
    sender.send("codex:event", { runId, ...payload });
  }
}

function findActiveRun(params) {
  for (const run of activeRuns.values()) {
    if (params.turnId && run.turnId === params.turnId) {
      return run;
    }
    if (params.threadId && run.threadId === params.threadId) {
      return run;
    }
  }
  return null;
}

function textFromReasoning(item) {
  const parts = [...(item.summary || []), ...(item.content || [])];
  return parts
    .map((part) => (typeof part === "string" ? part : part?.text || ""))
    .filter(Boolean)
    .join("\n");
}

function describeItem(item) {
  if (!item || typeof item !== "object") {
    return null;
  }

  switch (item.type) {
    case "agentMessage":
      return { kind: "assistant", text: item.text || "" };
    case "reasoning":
      return { kind: "reasoning", text: textFromReasoning(item) || "已完成推理" };
    case "plan":
      return { kind: "todo", text: item.text || "已更新执行计划" };
    case "commandExecution":
      return {
        kind: "command",
        text: item.command || "command",
        detail: item.aggregatedOutput || "",
        status: item.status,
        exitCode: item.exitCode
      };
    case "fileChange":
      return {
        kind: "file",
        text: (item.changes || [])
          .map((change) => `${typeof change.kind === "string" ? change.kind : "更新"} ${change.path}`)
          .join("\n"),
        status: item.status
      };
    case "mcpToolCall":
      return {
        kind: "tool",
        text: `${item.server || "mcp"}:${item.tool || "tool"}`,
        detail: item.error?.message || "",
        status: item.status
      };
    case "dynamicToolCall":
      return {
        kind: "tool",
        text: [item.namespace, item.tool].filter(Boolean).join(":") || "tool",
        status: item.status
      };
    case "collabAgentToolCall":
      return {
        kind: "tool",
        text: `子任务：${item.tool || "agent"}`,
        detail: item.prompt || "",
        status: item.status
      };
    case "webSearch":
      return { kind: "search", text: item.query || "网页搜索" };
    case "imageView":
      return { kind: "file", text: `查看图片 ${item.path || ""}`.trim() };
    case "imageGeneration":
      return { kind: "file", text: item.savedPath || "已生成图片", status: item.status };
    default:
      return null;
  }
}

function usageFromNotification(params) {
  const usage = params.tokenUsage?.last;
  if (!usage) {
    return null;
  }
  return {
    input_tokens: usage.inputTokens || 0,
    cached_input_tokens: usage.cachedInputTokens || 0,
    output_tokens: usage.outputTokens || 0,
    reasoning_output_tokens: usage.reasoningOutputTokens || 0
  };
}

function armRunIdleTimeout(run) {
  clearTimeout(run.idleTimer);
  run.idleTimer = setTimeout(() => {
    if (run.finished || activeRuns.get(run.runId) !== run) return;
    const error = "Codex 任务长时间没有返回事件，已停止等待。可以在当前对话中继续执行。";
    const interrupt = run.turnId
      ? getCodexClient().request("turn/interrupt", {
          threadId: run.threadId,
          turnId: run.turnId
        }).catch(() => null)
      : Promise.resolve();
    void interrupt.finally(() => finishRun(run, "failed", { error }));
  }, CODEX_RUN_IDLE_TIMEOUT_MS);
  run.idleTimer.unref();
}

function finishRun(run, type, details = {}) {
  if (run.finished) {
    return;
  }
  run.finished = true;
  clearTimeout(run.idleTimer);
  activeRuns.delete(run.runId);

  const stopped = type === "stopped";
  const ok = type === "completed" || stopped;
  let outputPath = "";
  if (type === "completed" && run.output.trim()) {
    const archiveDir = path.join(run.workspacePath || demoWorkspace, "outputs");
    fs.mkdirSync(archiveDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outputPath = path.join(archiveDir, `${stamp}-${run.runId}.md`);
    fs.writeFileSync(outputPath, run.output, "utf8");
  }
  const result = {
    ok,
    stopped,
    runId: run.runId,
    threadId: run.threadId,
    turnId: run.turnId,
    output: run.output,
    error: ok ? "" : details.error || "Codex 执行失败。",
    workspacePath: run.workspacePath || demoWorkspace,
    outputPath,
    eventCount: run.eventCount
  };

  publishCodexEvent(run.sender, run.runId, {
    type,
    threadId: run.threadId,
    turnId: run.turnId,
    output: run.output,
    error: result.error,
    outputPath,
    eventCount: run.eventCount
  });
  run.resolve(result);
}

function prepareCodexConnectionMaintenance(blockedError) {
  const { background, foreground } = partitionCodexRuns(activeRuns.values());
  if (foreground.length > 0) {
    return {
      ok: false,
      error: blockedError
    };
  }
  for (const run of background) {
    finishRun(run, "stopped");
  }
  return {
    ok: true,
    pausedBackgroundRuns: background.length
  };
}

function handleCodexNotification(method, params) {
  const run = findActiveRun(params);
  if (!run) {
    return;
  }

  run.eventCount += 1;
  armRunIdleTimeout(run);

  if (method === "turn/started") {
    run.turnId = params.turn?.id || run.turnId;
    publishCodexEvent(run.sender, run.runId, {
      type: "started",
      threadId: run.threadId,
      turnId: run.turnId,
      summary: "Codex 已开始执行"
    });
    return;
  }

  if (method === "item/agentMessage/delta") {
    run.output += params.delta || "";
    publishCodexEvent(run.sender, run.runId, {
      type: "assistant-delta",
      threadId: run.threadId,
      turnId: run.turnId,
      text: params.delta || ""
    });
    return;
  }

  if (method === "thread/tokenUsage/updated") {
    const usage = usageFromNotification(params);
    if (usage) {
      publishCodexEvent(run.sender, run.runId, {
        type: "usage",
        threadId: run.threadId,
        turnId: run.turnId,
        usage
      });
    }
    return;
  }

  if (method === "item/started" || method === "item/completed") {
    const item = describeItem(params.item);
    if (method === "item/completed" && params.item?.type === "agentMessage") {
      run.output = params.item.text || run.output;
    }
    if (item) {
      publishCodexEvent(run.sender, run.runId, {
        type: "json",
        threadId: run.threadId,
        turnId: run.turnId,
        event: {
          type: method,
          item: params.item
        },
        item
      });
    }
    return;
  }

  if (method === "error") {
    const message = params.error?.message || params.message || "Codex 执行出错。";
    publishCodexEvent(run.sender, run.runId, {
      type: "json",
      threadId: run.threadId,
      turnId: run.turnId,
      event: {
        type: "turn.failed",
        error: { message }
      }
    });
    return;
  }

  if (method === "turn/completed") {
    run.turnId = params.turn?.id || run.turnId;
    const status = classifyCodexTurnStatus(params.turn?.status);
    if (status === "completed") {
      finishRun(run, "completed");
    } else if (status === "stopped") {
      finishRun(run, "stopped");
    } else {
      finishRun(run, "failed", {
        error: params.turn?.error?.message || "Codex turn 执行失败。"
      });
    }
  }
}

function failAllRuns(error) {
  for (const run of [...activeRuns.values()]) {
    finishRun(run, "failed", { error: error.message });
  }
}

function getCodexClient() {
  if (!codexClient) {
    codexClient = new CodexAppServer({
      cwd: demoWorkspace,
      version: app.getVersion(),
      runtimeProvider: () => getAppSettings().runtime(),
      onNotification: handleCodexNotification,
      onLog: (text) => {
        if (process.env.NODE_ENV !== "production") {
          process.stderr.write(`[codex app-server] ${text}`);
        }
      },
      onExit: ({ error, intentional }) => {
        if (!intentional) {
          failAllRuns(error);
        }
      }
    });
  }
  return codexClient;
}

function resetCodexClient() {
  codexClient?.close();
  codexClient = null;
}

async function runCodexCheck() {
  ensureDemoWorkspace();
  const loaded = getAppSettings().load();
  let detectedPath = "";
  let detectedVersion = "";
  let runtime = {
    authMode: "chatgpt",
    providerLabel: "个人 ChatGPT",
    apiBaseUrl: "",
    hasApiKey: false,
    codexPath: loaded.settings.codexPath,
    env: {}
  };
  try {
    runtime = getAppSettings().runtime();
    const binary = resolveCodexBinary(runtime.codexPath);
    detectedPath = binary;
    const versionResult = await execFileAsync(binary, ["--version"], {
      env: codexEnvironment(runtime.env)
    });
    detectedVersion = String(versionResult.stdout || "").trim();
    let pluginSetup = null;
    try {
      pluginSetup = await getDomiPluginManager().ensure({
        binary,
        env: codexEnvironment(runtime.env),
        enabled: app.isPackaged || process.env.DOMI_INSTALL_BUNDLED_PLUGIN === "1"
      });
      if (pluginSetup.updated) resetCodexClient();
    } catch (error) {
      pluginSetup = {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
    const client = getCodexClient();
    const [accountResult, modelResult, configResult] = await Promise.all([
      runtime.authMode === "chatgpt"
        ? client.request("account/read", { refreshToken: false })
        : Promise.resolve({ account: null, requiresOpenaiAuth: false }),
      client.request("model/list", {
        cursor: null,
        limit: 50,
        includeHidden: false
      }),
      client.request("config/read", { includeLayers: false })
    ]);
    const account = accountResult?.account || null;
    const config = configResult?.config || {};
    const requiresOpenaiAuth = runtime.authMode === "chatgpt"
      && Boolean(accountResult?.requiresOpenaiAuth);
    const authenticated = isSelectedCodexConnectionReady({
      authMode: runtime.authMode,
      requiresOpenaiAuth,
      account,
      relayCredentialStored: runtime.hasApiKey
    });

    return {
      ok: authenticated,
      path: binary,
      version: detectedVersion,
      transport: "app-server",
      workspacePath: demoWorkspace,
      account,
      authMode: runtime.authMode,
      providerLabel: runtime.providerLabel,
      apiBaseUrl: runtime.apiBaseUrl,
      credentialStored: Boolean(account || runtime.hasApiKey),
      requiresOpenaiAuth,
      configuredModel: config.model || "",
      configuredReasoningEffort: config.model_reasoning_effort || "medium",
      configuredServiceTier: config.service_tier || "standard",
      pluginSetup,
      models: (modelResult?.data || []).map((item) => ({
        id: item.id || item.model,
        name: item.displayName || item.model || item.id,
        description: item.description || "",
        isDefault: Boolean(item.isDefault),
        defaultReasoningEffort: item.defaultReasoningEffort || "medium",
        supportedReasoningEfforts: (item.supportedReasoningEfforts || []).map((option) => ({
          id: option.reasoningEffort,
          description: option.description || ""
        })),
        serviceTiers: (item.serviceTiers || []).map((tier) => ({
          id: tier.id,
          name: tier.name,
          description: tier.description || ""
        }))
      })),
      error: authenticated
        ? ""
        : runtime.authMode === "relay"
          ? "中转站凭据未就绪，请重新保存配置并测试；无需登录 ChatGPT。"
          : "请先登录 ChatGPT Codex。"
    };
  } catch (error) {
    return {
      ok: false,
      path: detectedPath,
      version: detectedVersion,
      transport: "app-server",
      workspacePath: demoWorkspace,
      account: null,
      authMode: runtime.authMode,
      providerLabel: runtime.providerLabel,
      apiBaseUrl: runtime.apiBaseUrl,
      credentialStored: false,
      requiresOpenaiAuth: true,
      configuredModel: "",
      configuredReasoningEffort: "medium",
      configuredServiceTier: "standard",
      pluginSetup: null,
      models: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function resolveThread(client, payload, workspacePath, sandbox) {
  const model = payload.model && payload.model !== "default" ? payload.model : undefined;
  const effort = payload.reasoningEffort && payload.reasoningEffort !== "default"
    ? payload.reasoningEffort
    : undefined;
  const serviceTier = payload.serviceTier === "standard"
    ? null
    : payload.serviceTier && payload.serviceTier !== "default"
      ? payload.serviceTier
      : undefined;
  if (payload.threadId && payload.ephemeral !== true) {
    try {
      const resumed = await client.request("thread/resume", {
        threadId: payload.threadId,
        model,
        serviceTier,
        config: effort ? { model_reasoning_effort: effort } : undefined,
        cwd: workspacePath,
        approvalPolicy: "never",
        sandbox
      });
      return resumed.thread.id;
    } catch {
      // Switching identity/provider can make an old Codex thread unavailable.
    }
  }

  const started = await client.request("thread/start", {
    model,
    serviceTier,
    cwd: workspacePath,
    approvalPolicy: "never",
    sandbox,
    serviceName: "domi",
    ...threadPersistenceOptions(payload),
    config: {
      web_search: "live",
      ...(effort ? { model_reasoning_effort: effort } : {})
    }
  });
  return started.thread.id;
}

async function saveRuntimeSettings(request) {
  const current = getAppSettings().load().settings;
  const {
    storageMigration = "none",
    ...settingsRequest
  } = request || {};
  const connectionChanged = [
    "codexPath",
    "authMode",
    "apiBaseUrl",
    "apiModel",
    "relayCredentialConfigured",
    "externalAccessMode",
    "storageBackend",
    "projectBaseToken",
    "projectTableId",
    "peopleBaseToken",
    "peopleTableId",
    "radarBaseToken",
    "radarTableId",
    "wikiSpaceId",
    "localLibraryDir",
    "localRepositoryDir"
  ].some((key) => Object.prototype.hasOwnProperty.call(settingsRequest, key)
    && settingsRequest[key] !== current[key]);
  if (connectionChanged) {
    const maintenance = prepareCodexConnectionMaintenance(
      "请先停止正在执行的用户任务，再修改 Codex 或资料库连接。"
    );
    if (!maintenance.ok) return maintenance;
  }
  try {
    let migration;
    if (settingsRequest.authMode === "chatgpt" && current.authMode === "relay") {
      const restored = getCodexBootstrap().restoreChatGPTConfig();
      if (!restored.ok) {
        return { ok: false, error: restored.error || "无法恢复 ChatGPT Codex 配置。" };
      }
    }
    const migratesLocalToFeishu = current.storageBackend === "local"
      && settingsRequest.storageBackend === "feishu"
      && storageMigration === "local-to-feishu";
    if (migratesLocalToFeishu) {
      const targetSettings = normalizeSettings({ ...current, ...settingsRequest });
      validateDomiConfig(targetSettings);
      migration = await getDomiIntegration().migrateLocalToFeishu({
        sourceSettings: current,
        targetSettings
      });
      if (!migration.ok) {
        return {
          ok: false,
          settings: current,
          migration,
          error: migration.error || "本地文档迁移到飞书失败，资料库仍保持本地模式。"
        };
      }
    }
    const result = getAppSettings().save(settingsRequest);
    getUpdateService().configureChannel(result.settings.updateChannel);
    if (!connectionChanged) return { ok: true, ...result, migration };
    resetCodexClient();
    const codex = await runCodexCheck();
    return { ok: true, ...result, codex, migration };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function installCodexCli() {
  const maintenance = prepareCodexConnectionMaintenance(
    "请先停止正在执行的用户任务，再安装 Codex CLI。"
  );
  if (!maintenance.ok) return maintenance;
  const result = await getCodexBootstrap().install();
  if (!result.ok) return result;
  getAppSettings().save({ codexPath: result.path });
  resetCodexClient();
  return { ...result, pausedBackgroundRuns: maintenance.pausedBackgroundRuns };
}

async function configureCodexRelay(request = {}) {
  const maintenance = prepareCodexConnectionMaintenance(
    "请先停止正在执行的用户任务，再修改 Codex 中转站。"
  );
  if (!maintenance.ok) return maintenance;
  const result = await getCodexBootstrap().configureRelay(request);
  if (!result.ok) return result;
  getAppSettings().save({
    authMode: "relay",
    apiBaseUrl: result.baseUrl,
    apiModel: result.model,
    relayCredentialConfigured: true,
    codexPath: result.codexPath
  });
  resetCodexClient();
  const codex = await runCodexCheck();
  if (!codex.ok) {
    return {
      ok: false,
      configured: true,
      codex,
      error: codex.error || "中转站已配置，但 Codex App Server 尚未就绪。"
    };
  }
  const verification = await getCodexBootstrap().testConnection(result.codexPath);
  return {
    ok: verification.ok,
    configured: true,
    codex,
    verification,
    pausedBackgroundRuns: maintenance.pausedBackgroundRuns,
    error: verification.ok ? "" : verification.error || "中转站测试失败。"
  };
}

async function testCodexConnection() {
  const maintenance = prepareCodexConnectionMaintenance(
    "请先停止正在执行的用户任务，再运行 Codex 连接测试。"
  );
  if (!maintenance.ok) return maintenance;
  resetCodexClient();
  const codex = await runCodexCheck();
  if (!codex.ok) return { ok: false, codex, error: codex.error || "Codex App Server 不可用。" };
  const verification = await getCodexBootstrap().testConnection(codex.path);
  return {
    ok: verification.ok,
    codex,
    verification,
    pausedBackgroundRuns: maintenance.pausedBackgroundRuns,
    error: verification.ok ? "" : verification.error || "Codex 连接测试失败。"
  };
}

async function startChatGptLogin() {
  try {
    const restored = getCodexBootstrap().restoreChatGPTConfig();
    if (!restored.ok) {
      return { ok: false, error: restored.error || "无法恢复 ChatGPT Codex 配置。" };
    }
    getAppSettings().save({
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      relayCredentialConfigured: false
    });
    if (restored.changed) resetCodexClient();
    const response = await getCodexClient().request("account/login/start", {
      type: "chatgpt",
      appBrand: "codex",
      codexStreamlinedLogin: true,
      useHostedLoginSuccessPage: true
    });
    if (!response?.authUrl) {
      return { ok: false, error: "Codex 没有返回登录地址。" };
    }
    await shell.openExternal(response.authUrl);
    return { ok: true, loginId: response.loginId, authUrlOpened: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runSystemDiagnostics() {
  const checks = [];
  const startedAt = Date.now();
  const push = (id, label, ok, detail) => checks.push({ id, label, ok, detail });

  const settings = getAppSettings().load();
  push(
    "secure-storage",
    "macOS Keychain",
    settings.secureStorageAvailable,
    settings.secureStorageAvailable ? "加密存储可用" : "系统加密存储不可用"
  );

  try {
    ensureDemoWorkspace();
    await fs.promises.access(demoWorkspace, fs.constants.R_OK | fs.constants.W_OK);
    push("workspace", "本地工作区", true, demoWorkspace);
  } catch (error) {
    push("workspace", "本地工作区", false, error instanceof Error ? error.message : String(error));
  }

  try {
    getStateStore().loadAppSettings("runtime", {});
    push("database", "本地数据库", true, "SQLite 读写层正常");
  } catch (error) {
    push("database", "本地数据库", false, error instanceof Error ? error.message : String(error));
  }

  const codex = await runCodexCheck();
  push(
    "codex",
    "Codex App Server",
    codex.ok,
    codex.ok
      ? `${codex.version} · ${codex.providerLabel}`
      : codex.error || "Codex 不可用"
  );
  push(
    "domi-plugin-package",
    "内置 domi 插件",
    Boolean(codex.pluginSetup?.ok),
    codex.pluginSetup?.ok
      ? `v${codex.pluginSetup.version || codex.pluginSetup.bundledVersion || "未知"}${codex.pluginSetup.gitCommit ? ` · ${codex.pluginSetup.gitCommit.slice(0, 8)}` : ""}`
      : codex.pluginSetup?.error || "尚未完成内置插件安装"
  );

  try {
    const health = await getDomiIntegration().status();
    const pluginOk = Boolean(health.plugin?.ok);
    push(
      "domi",
      "domi 插件",
      pluginOk,
      pluginOk ? `v${health.plugin.version}` : health.plugin?.error || "未检测到插件"
    );
    push(
      "plaud",
      "PLAUD 录音转写",
      Boolean(health.plaud?.ok || health.plaud?.disabled),
      health.plaud?.disabled
        ? "未启用（已跳过连接检测）"
        : health.plaud?.ok
          ? `已连接 · ${health.plaud.queueCount || 0} 条本机队列记录`
          : health.plaud?.error || "未检测到 Tabbit 中的 PLAUD 登录"
    );
  } catch (error) {
    push("domi", "domi 插件", false, error instanceof Error ? error.message : String(error));
    push("plaud", "PLAUD 录音转写", false, "domi 插件未就绪，暂时无法检测 PLAUD");
  }

  return {
    ok: checks.every((check) => check.ok),
    generatedAt: Date.now(),
    durationMs: Date.now() - startedAt,
    app: { name: appName, version: app.getVersion(), packaged: app.isPackaged },
    system: { platform: process.platform, arch: process.arch, release: os.release() },
    connection: {
      authMode: settings.settings.authMode,
      providerLabel: codex.providerLabel,
      apiBaseUrl: codex.apiBaseUrl || "",
      credentialStored: codex.credentialStored
    },
    checks
  };
}

async function exportSystemDiagnostics(sender, report) {
  try {
    const owner = BrowserWindow.fromWebContents(sender);
    const result = await dialog.showSaveDialog(owner, {
      title: "导出 domi 诊断报告",
      defaultPath: `domi-诊断-${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return { ok: true, canceled: true };
    const safeReport = report?.checks ? report : await runSystemDiagnostics();
    await fs.promises.writeFile(result.filePath, JSON.stringify(safeReport, null, 2), "utf8");
    return { ok: true, canceled: false, path: result.filePath };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function needsLarkAccess(payload) {
  const requestText = String(payload?.requestText || "");
  const backend = getAppSettings().load().settings.storageBackend;
  if (backend === "local") return false;
  if (explicitFeishuRequestPattern.test(requestText)) return true;
  if (payload?.workflowId === "domi-analyst") {
    return larkRequestPattern.test(requestText);
  }
  return externalDomiWorkflows.has(payload?.workflowId)
    || larkRequestPattern.test(requestText);
}

function repositoryRuntimeContext(payload) {
  if (!externalDomiWorkflows.has(payload?.workflowId)
    && !larkRequestPattern.test(String(payload?.requestText || ""))) {
    return "";
  }
  const settings = getAppSettings().load().settings;
  if (settings.storageBackend === "local") {
    return [
      "domi 本轮资料库事实：",
      "- 后端：local。",
      `- SQLite：${settings.localDatabasePath}`,
      `- Markdown 与资料目录：${settings.localRepositoryDir}。`,
      "- 使用 domi:investment-mgmt 本地后端；本轮不调用飞书 Wiki/Base。"
    ].join("\n");
  }
  return [
    "domi 本轮资料库事实：",
    "- 后端：feishu。",
    "- 使用当前配置的 Base、Wiki 与本地材料目录；错误时不要静默切换后端。"
  ].join("\n");
}

async function larkRuntimeContext(required) {
  if (!required) return "";
  const status = await getDomiIntegration().larkStatus();
  const identity = status.userName ? `，当前用户：${status.userName}` : "";
  if (status.ok) {
    return [
      "domi 本轮飞书连接事实：",
      `- lark-cli 已验证可用${identity}；路径：${status.cliPath}。`,
      "- 飞书任务应实际调用 lark-cli；失败时报告真实错误，不推测授权状态。"
    ].join("\n");
  }
  return [
    "domi 本轮飞书连接事实：",
    `- lark-cli 预检失败；路径：${status.cliPath}。`,
    `- 实际错误：${status.error || "未返回错误详情"}。`,
    "- 请基于该错误处理，不推测其他授权原因。"
  ].join("\n");
}

async function confirmExternalDomiRun(sender, payload) {
  const accessMode = getAppSettings().load().settings.externalAccessMode;
  if (accessMode === "always") {
    return { allowed: true, sandbox: "danger-full-access" };
  }
  const workflowDetail = externalDomiWorkflows.get(payload?.workflowId);
  const larkLookup = larkRequestPattern.test(String(payload?.requestText || ""));
  const detail = workflowDetail || (larkLookup
    ? "读取飞书 Wiki、Watching List、People 人脉库或本地资料库材料"
    : "");
  if (!detail) return { allowed: true, sandbox: "workspace-write" };
  const owner = BrowserWindow.fromWebContents(sender);
  const options = {
    type: "warning",
    title: "允许 domi 本次访问外部数据？",
    message: "本次任务需要临时扩展 Codex 权限",
    detail: `${detail}。\n\n权限只应用于本次任务；其他普通对话仍在项目工作区沙箱中运行。`,
    buttons: ["取消", "允许本次运行"],
    defaultId: 1,
    cancelId: 0,
    noLink: true
  };
  const result = owner
    ? await dialog.showMessageBox(owner, options)
    : await dialog.showMessageBox(options);
  return {
    allowed: result.response === 1,
    sandbox: result.response === 1 ? "danger-full-access" : "workspace-write"
  };
}

async function runCodex(sender, payload) {
  ensureDemoWorkspace();
  const workspacePath = validProjectWorkspace(payload?.workspacePath) || demoWorkspace;

  const runId = payload?.runId || `run-${Date.now()}`;
  const prompt = String(payload?.prompt || "").trim();
  if (!prompt) {
    return {
      ok: false,
      runId,
      output: "",
      error: "任务内容不能为空。",
      workspacePath
    };
  }

  if (activeRuns.has(runId)) {
    return {
      ok: false,
      runId,
      output: "",
      error: "该任务已经在执行。",
      workspacePath
    };
  }

  try {
    const larkRequired = needsLarkAccess(payload);
    const execution = await confirmExternalDomiRun(sender, payload);
    if (!execution.allowed) {
      return {
        ok: false,
        runId,
        output: "",
        error: "已取消 domi 外部数据访问，本次工作流未运行。",
        workspacePath
      };
    }
    const client = getCodexClient();
    await client.start();
    const threadId = await resolveThread(client, payload, workspacePath, execution.sandbox);
    const runtimeContext = [
      repositoryRuntimeContext(payload),
      await larkRuntimeContext(larkRequired)
    ].filter(Boolean).join("\n\n");

    const completion = new Promise((resolve) => {
      const run = {
        runId,
        sender,
        threadId,
        turnId: null,
        executionMode: codexRunExecutionMode(payload),
        output: "",
        eventCount: 0,
        workspacePath,
        finished: false,
        resolve
      };
      activeRuns.set(runId, run);
      armRunIdleTimeout(run);
    });

    publishCodexEvent(sender, runId, {
      type: "thread",
      threadId,
      summary: payload.threadId ? "已恢复 Codex 对话" : "已创建 Codex 对话"
    });

    const model = payload.model && payload.model !== "default" ? payload.model : undefined;
    const effort = payload.reasoningEffort && payload.reasoningEffort !== "default"
      ? payload.reasoningEffort
      : undefined;
    const serviceTier = payload.serviceTier === "standard"
      ? null
      : payload.serviceTier && payload.serviceTier !== "default"
        ? payload.serviceTier
        : undefined;
    try {
      const response = await requestCodexTurn(client, {
        threadId,
        model,
        effort,
        serviceTier,
        cwd: workspacePath,
        approvalPolicy: "never"
      }, prompt, runtimeContext, {
        onCompatibility: ({ message, error }) => {
          if (process.env.NODE_ENV !== "production" && error) {
            process.stderr.write(
              `[codex compatibility] ${error instanceof Error ? error.message : String(error)}\n`
            );
          }
          publishCodexEvent(sender, runId, {
            type: "compatibility",
            threadId,
            summary: message
          });
        }
      });
      const run = activeRuns.get(runId);
      if (run) {
        run.turnId = response.turn.id;
      }
    } catch (error) {
      const run = activeRuns.get(runId);
      if (run) {
        finishRun(run, "failed", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    return completion;
  } catch (error) {
    return {
      ok: false,
      runId,
      output: "",
      error: error instanceof Error ? error.message : String(error),
      workspacePath
    };
  }
}

async function stopCodex(runId) {
  const run = activeRuns.get(runId);
  if (!run) {
    return { ok: false, error: "没有找到正在执行的任务。" };
  }
  if (!run.turnId) {
    return { ok: false, error: "Codex 正在启动，请稍后再停止。" };
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await getCodexClient().request("turn/interrupt", {
        threadId: run.threadId,
        turnId: run.turnId
      });
      return { ok: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("no active turn") || attempt === 4) {
        return { ok: false, error: message };
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return { ok: false, error: "无法停止当前任务。" };
}

async function recoverCodexThread(threadId) {
  const normalizedThreadId = String(threadId || "").trim();
  if (!normalizedThreadId) {
    return { ok: false, threadId: "", status: "unknown", error: "Codex 对话 ID 不能为空。" };
  }

  try {
    const activeRun = [...activeRuns.values()].find((run) => run.threadId === normalizedThreadId);
    const response = await getCodexClient().request("thread/read", {
      threadId: normalizedThreadId,
      includeTurns: true
    });
    const turns = Array.isArray(response?.thread?.turns) ? response.thread.turns : [];
    const lastTurn = turns.at(-1);
    const items = Array.isArray(lastTurn?.items) ? lastTurn.items : [];
    const finalMessage = [...items]
      .reverse()
      .find((item) => item?.type === "agentMessage" && item?.phase === "final_answer");
    const latestMessage = finalMessage || [...items]
      .reverse()
      .find((item) => item?.type === "agentMessage");
    const turnStatus = String(lastTurn?.status || "");
    const status = classifyCodexTurnStatus(turnStatus, Boolean(activeRun));

    return {
      ok: true,
      runId: activeRun?.runId || "",
      threadId: normalizedThreadId,
      turnId: lastTurn?.id || activeRun?.turnId || "",
      status,
      output: latestMessage?.text || activeRun?.output || "",
      error: status === "failed"
        ? lastTurn?.error?.message || `Codex turn 状态：${turnStatus || "unknown"}`
        : ""
    };
  } catch (error) {
    return {
      ok: false,
      threadId: normalizedThreadId,
      status: "unknown",
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

app.whenReady().then(() => {
  appendRuntimeLog("app-ready", {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    brandUserDataMigrated: brandPaths.userDataMigration.migrated,
    brandWorkspaceMigrated: brandPaths.workspaceMigration.migrated
  });
  migrateLegacyDevelopmentWorkspace();
  ensureDemoWorkspace();
  installPdfProtocol();
  installMarkdownAssetProtocol();
  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(appIconPath));
  }
  createWindow();
  getUpdateService().start();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("before-quit", () => {
  appendRuntimeLog("app-before-quit");
  updateService?.stop();
  codexClient?.close();
  stateStore?.close();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

ipcMain.on("app:renderer-report", (_event, payload) => {
  const kind = [
    "error",
    "unhandled-rejection",
    "react-boundary",
    "section-boundary",
    "document-operation",
    "markdown-editor-boundary",
    "markdown-editor-operation"
  ].includes(payload?.kind)
    ? payload.kind
    : "error";
  appendRuntimeLog("renderer-report", {
    kind,
    message: boundedRuntimeText(payload?.message, 4_000),
    stack: boundedRuntimeText(payload?.stack, 12_000),
    source: boundedRuntimeText(payload?.source, 1_000),
    line: Number.isFinite(payload?.line) ? payload.line : undefined,
    column: Number.isFinite(payload?.column) ? payload.column : undefined
  });
});

ipcMain.handle("app:notify", (_event, request = {}) => {
  if (!Notification.isSupported()) {
    return { ok: false, error: "当前系统不支持桌面通知。" };
  }
  const title = boundedRuntimeText(request.title || "domi 行业动态", 120);
  const body = boundedRuntimeText(request.body || "发现新的重要行业动态", 500);
  const notification = new Notification({
    title,
    body,
    silent: Boolean(request.silent),
    icon: nativeImage.createFromPath(appIconPath)
  });
  notification.on("click", () => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
  return { ok: true };
});

ipcMain.handle("codex:check", runCodexCheck);
ipcMain.handle("codex:run", (event, payload) => runCodex(event.sender, payload));
ipcMain.handle("codex:stop", (_event, runId) => stopCodex(runId));
ipcMain.handle("codex:recover-thread", (_event, threadId) => recoverCodexThread(threadId));
ipcMain.handle("settings:load", () => ({ ok: true, ...getAppSettings().load() }));
ipcMain.handle("settings:save", (_event, request) => saveRuntimeSettings(request));
ipcMain.handle("settings:select-directory", (event, currentPath) =>
  selectLocalDirectory(event.sender, currentPath)
);
ipcMain.handle("settings:install-codex", () => installCodexCli());
ipcMain.handle("settings:configure-relay", (_event, request) => configureCodexRelay(request));
ipcMain.handle("settings:test-codex", () => testCodexConnection());
ipcMain.handle("settings:chatgpt-login", () => startChatGptLogin());
ipcMain.handle("settings:diagnose", () => runSystemDiagnostics());
ipcMain.handle("settings:export-diagnostics", (event, report) =>
  exportSystemDiagnostics(event.sender, report)
);
ipcMain.handle("update:status", () => getUpdateService().snapshot());
ipcMain.handle("update:check", () => getUpdateService().check());
ipcMain.handle("update:download", () => getUpdateService().download());
ipcMain.handle("update:install", () => getUpdateService().install());
ipcMain.handle("files:select", (event, workspacePath) =>
  selectLocalFiles(event.sender, workspacePath)
);
ipcMain.handle("files:import", (_event, sourcePaths, workspacePath) =>
  importLocalFiles(workspacePath, sourcePaths)
);
ipcMain.handle("files:import-data", (_event, files, workspacePath) =>
  importLocalFileData(workspacePath, files)
);
ipcMain.handle("resource:open", (_event, resource) => openResource(resource));
ipcMain.handle("document-library:list", () => readDocumentLibrary());
ipcMain.handle("document-library:create", (_event, request) =>
  createDocumentLibraryItem(request)
);
ipcMain.handle("markdown:read", (_event, request) => readMarkdownDocument(request));
ipcMain.handle("markdown:save", (_event, request) => saveMarkdownDocument(request));
ipcMain.handle("markdown:rename", (_event, request) => renameMarkdownDocument(request));
ipcMain.handle("markdown:image-preview", (_event, request) => resolveMarkdownImagePreview(request));
ipcMain.handle("markdown:image-save", (_event, request) => saveMarkdownImage(request));
ipcMain.handle("markdown:copy", (_event, request) => copyMarkdownDocument(request));
ipcMain.handle("pdf:read", (_event, request) => readPdfDocument(request));
ipcMain.handle("domi:entity-materials", async (_event, request) => {
  try {
    const cacheKey = `domi:entity-materials:${JSON.stringify(request || {})}`;
    const materials = await serviceCoordinator.run(
      cacheKey,
      () => getDomiIntegration().entityMaterials(request),
      { ttlMs: 30_000, retries: 1 }
    );
    return { ok: true, materials };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle("storage:load", (_event, defaultState) => {
  const result = getStateStore().load(defaultState);
  return { ok: true, ...result };
});

ipcMain.handle("storage:save", (_event, state) => {
  const result = getStateStore().save(state);
  return { ok: true, ...result };
});

ipcMain.handle("storage:save-patch", (_event, patch) => {
  const result = getStateStore().savePatch(patch);
  return { ok: true, ...result };
});

ipcMain.handle("workspace:create", (_event, { projectId, projectName }) => {
  const workspacePath = getStateStore().ensureProjectWorkspace(projectId, projectName);
  return { ok: true, workspacePath };
});

ipcMain.handle("workspace:open", async (_event, requestedWorkspacePath) => {
  ensureDemoWorkspace();
  const workspacePath = validProjectWorkspace(requestedWorkspacePath) || demoWorkspace;
  const error = await shell.openPath(workspacePath);
  return { ok: !error, error, workspacePath };
});

ipcMain.handle("domi:cache", () => getDomiIntegration().loadCache());
ipcMain.handle("domi:status", async () => {
  try {
    const health = await serviceCoordinator.run(
      "domi:status",
      () => getDomiIntegration().status(),
      { ttlMs: 30_000, retries: 1 }
    );
    return { ok: true, health };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:weekly-news", async (_event, request) => {
  try {
    const normalizedRequest = {
      days: Number(request?.days) || 7,
      limit: Number(request?.limit) || 100,
      page: Number(request?.page) || 0,
      cacheOnly: Boolean(request?.cacheOnly)
    };
    return await serviceCoordinator.run(
      `domi:weekly-news:${JSON.stringify(normalizedRequest)}`,
      () => getDomiIntegration().weeklyNews(normalizedRequest),
      {
        ttlMs: normalizedRequest.cacheOnly ? 2_000 : 10_000,
        retries: normalizedRequest.cacheOnly ? 0 : 1,
        isSuccess: (value) => value?.ok !== false || value?.fromCache
      }
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:weekly-news-checkpoint", (_event, request) => {
  const result = getDomiIntegration().recordWeeklyNewsRadarCheckpoint(request);
  if (result.ok) serviceCoordinator.invalidate("domi:weekly-news:");
  return result;
});
ipcMain.handle("domi:plaud-list", async (_event, request) => {
  try {
    const fresh = request?.fresh === true;
    return await serviceCoordinator.run(
      "domi:plaud-list",
      () => getDomiIntegration().plaudQueue(),
      {
        ttlMs: 15_000,
        retries: 1,
        force: fresh,
        allowStale: !fresh,
        isSuccess: (value) => value?.ok !== false
      }
    );
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:plaud-sync", async (_event, request) => {
  try {
    const result = await serviceCoordinator.run(
      "domi:plaud-sync",
      () => getDomiIntegration().syncPlaud(request),
      { force: true, allowStale: false, isSuccess: (value) => value?.ok !== false }
    );
    serviceCoordinator.invalidate("domi:plaud-list");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:plaud-rename", async (_event, request) => {
  try {
    const result = await getDomiIntegration().renamePlaud(request);
    serviceCoordinator.invalidate("domi:plaud-list");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:plaud-delete", async (_event, request) => {
  try {
    const result = await getDomiIntegration().deletePlaud(request);
    serviceCoordinator.invalidate("domi:plaud-list");
    return result;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
ipcMain.handle("domi:sync", async () => {
  try {
    const result = await serviceCoordinator.run(
      "domi:sync",
      () => getDomiIntegration().sync(),
      { force: true, allowStale: false }
    );
    serviceCoordinator.invalidate("domi:status");
    serviceCoordinator.invalidate("domi:entity-materials:");
    return result;
  } catch (error) {
    const cached = getDomiIntegration().loadCache();
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      snapshot: cached.snapshot,
      updatedAt: cached.updatedAt
    };
  }
});
ipcMain.handle("domi:migration-preview", async () => {
  try {
    return getDomiIntegration().previewLocalToFeishu();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
});
