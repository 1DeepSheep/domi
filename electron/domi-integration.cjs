const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { LocalDomiRepository, resolveHomePath } = require("./local-domi-repository.cjs");
const { LocalToFeishuMigration } = require("./local-to-feishu-migration.cjs");
const { TaskQueue } = require("./service-coordinator.cjs");

const execFileAsync = promisify(execFile);
const CACHE_KEY = "snapshot-v1";
const WEEKLY_NEWS_CACHE_KEY = "weekly-news-v1";
const WEEKLY_NEWS_RADAR_CHECKPOINT_KEY = "weekly-news-radar-checkpoint-v1";
const WEEKLY_NEWS_FIELDS = [
  "新闻标题",
  "领域",
  "子领域",
  "信息类型",
  "信息发布时间",
  "新闻核心内容",
  "投资含义",
  "原文链接",
  "来源名称",
  "涉及公司",
  "涉及机构",
  "重要性评分",
  "可信度",
  "证据状态",
  "是否值得关注",
  "建议动作"
];
const SKIPPED_MATERIAL_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  "$RECYCLE.BIN"
]);

function normalizedMaterialText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function entitySearchKeys(name) {
  const raw = String(name || "").trim();
  const base = raw.split(/[（(\/，,&]/)[0].trim();
  const stripped = base.replace(/(?:科技|技术)?(?:股份)?(?:有限(?:责任)?)?公司$|集团$/g, "");
  return [...new Set([raw, base, stripped].map(normalizedMaterialText))]
    .filter((item) => item.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function materialKind(filePath) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  if (extension === ".pdf") return "PDF";
  if ([".md", ".markdown"].includes(extension)) return "Markdown";
  if ([".xlsx", ".xls", ".csv"].includes(extension)) return "表格";
  if ([".docx", ".doc", ".rtf"].includes(extension)) return "文档";
  if ([".pptx", ".ppt", ".key"].includes(extension)) return "演示文稿";
  if ([".m4a", ".mp3", ".wav", ".aac"].includes(extension)) return "录音";
  if ([".png", ".jpg", ".jpeg", ".webp", ".heic"].includes(extension)) return "图片";
  return extension ? extension.slice(1).toUpperCase() : "文件";
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item);
        return item?.text || item?.name || "";
      })
      .filter(Boolean)
      .join("");
  }
  return value.text || value.name || "";
}

function stringList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(textValue).filter(Boolean);
}

function weeklyNewsContentSignature(items = []) {
  return [...items]
    .sort((left, right) => String(left.recordId || "").localeCompare(String(right.recordId || "")))
    .map((item) => [
      item.recordId,
      item.title,
      item.publishedAt,
      item.summary,
      item.investmentMeaning,
      item.url,
      item.source,
      item.companies,
      item.institutions,
      item.importance,
      item.confidence,
      item.evidenceStatus,
      item.action,
      ...(item.domains || []),
      ...(item.subdomains || []),
      ...(item.types || [])
    ].map((value) => String(value ?? "")).join("\u001f"))
    .join("\u001e");
}

function weeklyNewsHasSubstantiveChange(previousItems = [], items = []) {
  const previousSignatures = new Map(
    previousItems.map((item) => [String(item.recordId || ""), weeklyNewsContentSignature([item])])
  );
  return items.some((item) => {
    const recordId = String(item.recordId || "");
    return !previousSignatures.has(recordId)
      || previousSignatures.get(recordId) !== weeklyNewsContentSignature([item]);
  });
}

function resolveWeeklyNewsTimestamps(cachedPage, items, checkedAt = Date.now()) {
  const previousItems = cachedPage?.items || [];
  const changed = weeklyNewsHasSubstantiveChange(previousItems, items);
  const legacyContentTime = previousItems.reduce(
    (latest, item) => Math.max(latest, Number(item.publishedAt) || 0),
    0
  );
  const previousContentUpdatedAt = Number(
    cachedPage?.contentUpdatedAt
      || (cachedPage?.checkedAt ? cachedPage?.syncedAt : legacyContentTime)
      || cachedPage?.syncedAt
      || cachedPage?.cachedAt
      || 0
  );
  const contentUpdatedAt = !cachedPage || changed
    ? checkedAt
    : previousContentUpdatedAt || checkedAt;
  return { checkedAt, contentUpdatedAt, changed };
}

function timestampValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedEpochMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function comparePlaudItems(left, right) {
  const leftTime = normalizedEpochMs(left?.createdAt) || normalizedEpochMs(left?.editedAt);
  const rightTime = normalizedEpochMs(right?.createdAt) || normalizedEpochMs(right?.editedAt);
  return rightTime - leftTime
    || String(left?.fileName || "").localeCompare(String(right?.fileName || ""), "zh-CN");
}

function versionParts(version) {
  return String(version || "0").match(/\d+/g)?.map(Number) || [0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function commandErrorMessage(error, binary, options = {}) {
  const label = options.label || path.basename(binary) || "Domi 命令";
  if (error?.killed || error?.code === "ETIMEDOUT") {
    return `${label}执行超时（${Math.round((options.timeout || 60000) / 1000)} 秒）。`;
  }

  const clean = (value) => String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .trim();
  const rawDetail = clean(error?.stderr) || clean(error?.stdout);
  if (/Cannot find module ['"]playwright['"]/i.test(rawDetail)) {
    return `${label}缺少浏览器运行组件。请重启豆米；如果仍然失败，请重新安装最新版豆米。`;
  }
  let detail = rawDetail;
  if (rawDetail) {
    try {
      const parsed = JSON.parse(rawDetail);
      detail = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.msg || rawDetail;
    } catch {
      // Keep the original stderr when the command does not return JSON.
    }
  }
  const code = error?.code && error.code !== 1 ? `（${error.code}）` : "";
  return `${label}执行失败${code}：${String(detail || "未返回错误详情").slice(0, 800)}`;
}

function resolvePlaywrightNodeModules() {
  try {
    return path.dirname(path.dirname(require.resolve("playwright/package.json")));
  } catch {
    const codexRuntime = path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules"
    );
    return fs.existsSync(path.join(codexRuntime, "playwright")) ? codexRuntime : "";
  }
}

class DomiIntegration {
  constructor({ stateStore, plaudOutputDir, plaudStateDir, configProvider, playwrightNodeModules }) {
    this.stateStore = stateStore;
    this.configProvider = configProvider || (() => ({}));
    this.larkCli = this.resolveLarkCli();
    this.materialIndexCache = new Map();
    this.larkCommandQueue = new TaskQueue(2);
    this.plaudCommandQueue = new TaskQueue(1);
    this.plaudOutputDir = path.resolve(plaudOutputDir || path.join(os.homedir(), "Documents", "豆米", "work", "domi", "plaud"));
    this.plaudStateFile = path.join(
      path.resolve(plaudStateDir || process.env.DOMI_PLAUD_STATE_DIR || path.join(os.homedir(), ".domi")),
      "plaud-workflow.json"
    );
    this.plaudWorker = path.join(__dirname, "plaud-worker.cjs");
    this.playwrightNodeModules = playwrightNodeModules || resolvePlaywrightNodeModules();
  }

  async buildMaterialIndex(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    if (this.materialIndexCache.has(resolvedRoot)) {
      return this.materialIndexCache.get(resolvedRoot);
    }

    const pending = (async () => {
      const entries = [];
      const directories = [resolvedRoot];
      while (directories.length && entries.length < 60000) {
        const current = directories.pop();
        let children;
        try {
          children = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of children) {
          if (child.name.startsWith(".") || SKIPPED_MATERIAL_DIRECTORIES.has(child.name)) continue;
          const fullPath = path.join(current, child.name);
          const relativePath = path.relative(resolvedRoot, fullPath);
          if (child.isDirectory()) {
            entries.push({ path: fullPath, relativePath, name: child.name, isDirectory: true });
            directories.push(fullPath);
          } else if (child.isFile()) {
            entries.push({ path: fullPath, relativePath, name: child.name, isDirectory: false });
          }
          if (entries.length >= 60000) break;
        }
      }
      return entries;
    })();

    this.materialIndexCache.set(resolvedRoot, pending);
    try {
      return await pending;
    } catch (error) {
      this.materialIndexCache.delete(resolvedRoot);
      throw error;
    }
  }

  async findEntityFiles(rootPath, entityName) {
    if (!rootPath || !fs.existsSync(rootPath)) return [];
    const keys = entitySearchKeys(entityName);
    if (!keys.length) return [];
    const entries = await this.buildMaterialIndex(rootPath);
    const matchingDirectories = entries
      .filter((entry) => entry.isDirectory)
      .filter((entry) => keys.some((key) => normalizedMaterialText(entry.name).includes(key)))
      .map((entry) => `${entry.path}${path.sep}`);

    const scored = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => {
        const normalizedName = normalizedMaterialText(entry.name);
        const normalizedRelative = normalizedMaterialText(entry.relativePath);
        const directKey = keys.find((key) => normalizedName.includes(key));
        const pathKey = keys.find((key) => normalizedRelative.includes(key));
        const inMatchingDirectory = matchingDirectories.some((directory) => entry.path.startsWith(directory));
        const score = (directKey ? 120 + directKey.length : 0)
          + (pathKey ? 55 + pathKey.length : 0)
          + (inMatchingDirectory ? 90 : 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.relativePath.localeCompare(right.entry.relativePath, "zh-CN"))
      .slice(0, 24);

    return Promise.all(scored.map(async ({ entry }) => {
      let size = 0;
      let mtimeMs = 0;
      try {
        const stat = await fs.promises.stat(entry.path);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        // Cloud placeholders can still be opened even when metadata is temporarily unavailable.
      }
      return {
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath,
        kind: materialKind(entry.path),
        size,
        mtimeMs
      };
    }));
  }

  async entityMaterials(request) {
    const entityType = request?.entityType === "person" ? "person" : "project";
    const recordId = String(request?.recordId || "");
    const cached = this.stateStore.loadCache(CACHE_KEY)?.value;
    if (!cached) throw new Error("Domi 项目与人脉缓存尚未同步。");
    const collection = entityType === "project" ? cached.projects : cached.people;
    const entity = collection?.find((item) => item.recordId === recordId);
    if (!entity) throw new Error("没有在 Domi 缓存中找到该项目或人脉。");

    const projectConfig = this.readProjectConfig();
    const searchRoot = entityType === "project"
      ? projectConfig.localLibraryDir
      : path.dirname(projectConfig.localLibraryDir);
    const files = await this.findEntityFiles(searchRoot, entity.name);
    return {
      entityType,
      recordId,
      searchRoot,
      files,
      generatedAt: Date.now()
    };
  }

  resolveLarkCli() {
    const candidates = [
      process.env.LARK_CLI_PATH,
      path.join(os.homedir(), ".npm-global", "bin", "lark-cli")
    ].filter(Boolean);
    return candidates.find((candidate) => fs.existsSync(candidate)) || "lark-cli";
  }

  findPlugin() {
    const cacheRoot = path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "plugins",
      "cache"
    );
    if (!fs.existsSync(cacheRoot)) {
      throw new Error("未找到已安装的 Domi 插件。请先在 Codex 中安装 Domi。 ");
    }
    const candidates = fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((marketplace) => marketplace.isDirectory())
      .flatMap((marketplace) => {
        const baseDir = path.join(cacheRoot, marketplace.name, "domi");
        if (!fs.existsSync(baseDir)) return [];
        return fs.readdirSync(baseDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            const root = path.join(baseDir, entry.name);
            const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
            if (!fs.existsSync(manifestPath)) return null;
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
              return {
                root,
                manifest,
                marketplace: marketplace.name,
                version: manifest.version || entry.name
              };
            } catch {
              return null;
            }
          });
      })
      .filter(Boolean)
      .sort((left, right) => compareVersions(right.version, left.version)
        || Number(right.marketplace === "domi-managed") - Number(left.marketplace === "domi-managed"));
    if (!candidates.length) {
      throw new Error("Domi 插件目录存在，但没有可读取的 plugin.json。 ");
    }
    return candidates[0];
  }

  readProjectConfig() {
    const settings = this.configProvider();
    const backend = settings.storageBackend === "local" ? "local" : "feishu";
    const appToken = String(settings.projectBaseToken || "").trim();
    const tableId = String(settings.projectTableId || "").trim();
    const wikiSpaceId = String(settings.wikiSpaceId || "").trim();
    const localLibraryRaw = String(settings.localLibraryDir || settings.oneDriveProjectDir || "").trim();
    const localRepositoryRaw = String(settings.localRepositoryDir || "").trim();
    const localDatabaseRaw = String(settings.localDatabasePath || "").trim();
    if (backend === "local") {
      if (!localRepositoryRaw || !localDatabaseRaw) {
        throw new Error("Domi 本地资料库尚未配置。请在豆米设置的“资料连接”中选择本地资料库目录。 ");
      }
      return {
        backend,
        appToken: "",
        tableId: "",
        wikiSpaceId: "",
        localLibraryDir: resolveHomePath(localRepositoryRaw),
        localDatabasePath: resolveHomePath(localDatabaseRaw)
      };
    }
    if (!appToken || !tableId || !wikiSpaceId || !localLibraryRaw) {
      throw new Error("Domi 项目库连接尚未配置。请在豆米设置的“资料连接”中填写项目 Base、Wiki 和本地资料库目录。 ");
    }
    return {
      backend,
      appToken,
      tableId,
      wikiSpaceId,
      localLibraryDir: resolveHomePath(localLibraryRaw),
      localDatabasePath: localDatabaseRaw ? resolveHomePath(localDatabaseRaw) : ""
    };
  }

  readRadarConfig() {
    const settings = this.configProvider();
    if (settings.storageBackend === "local") {
      const localLibraryDir = resolveHomePath(settings.localRepositoryDir);
      const localDatabasePath = resolveHomePath(settings.localDatabasePath);
      if (!localLibraryDir || !localDatabasePath) {
        throw new Error("Domi 本地行业动态库尚未配置。请在豆米设置的“资料连接”中选择本地资料库目录。 ");
      }
      return {
        backend: "local",
        appToken: "",
        tableId: "",
        baseUrl: "",
        localLibraryDir,
        localDatabasePath
      };
    }
    const appToken = String(settings.radarBaseToken || "").trim();
    const tableId = String(settings.radarTableId || "").trim();
    if (!appToken || !tableId) {
      throw new Error("Domi 行业动态连接尚未配置。请在豆米设置的“资料连接”中填写行业动态 Base。 ");
    }
    return { backend: "feishu", appToken, tableId, baseUrl: "" };
  }

  withLocalRepository(source, callback) {
    const repository = new LocalDomiRepository({
      databasePath: source.localDatabasePath,
      libraryDir: source.localLibraryDir
    });
    try {
      const result = callback(repository);
      if (result && typeof result.then === "function") {
        return result.finally(() => repository.close());
      }
      repository.close();
      return result;
    } catch (error) {
      repository.close();
      throw error;
    }
  }

  async runJson(binary, args, options = {}) {
    const execute = async () => {
      let stdout;
      try {
        ({ stdout } = await execFileAsync(binary, args, {
        cwd: options.cwd || os.homedir(),
        timeout: options.timeout || 60000,
        maxBuffer: 24 * 1024 * 1024,
        env: {
          ...process.env,
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          ...(options.env || {})
        }
        }));
      } catch (error) {
        throw new Error(commandErrorMessage(error, binary, options));
      }
      const value = JSON.parse(stdout.trim());
      if (value?.ok === false) {
        const message = typeof value.error === "string" ? value.error : value.error?.message;
        throw new Error(message || "Domi 命令执行失败。 ");
      }
      return value;
    };
    if (options.queue === "lark") return this.larkCommandQueue.run(execute);
    if (options.queue === "plaud") return this.plaudCommandQueue.run(execute);
    return execute();
  }

  plaudPaths(pluginInput) {
    const plugin = pluginInput || this.findPlugin();
    return {
      plugin,
      script: path.join(plugin.root, "skills", "plaud", "scripts", "plaud.js")
    };
  }

  plaudRuntimeEnv() {
    const nodePaths = [
      this.playwrightNodeModules,
      ...String(process.env.NODE_PATH || "").split(path.delimiter)
    ].filter(Boolean);
    return {
      ELECTRON_RUN_AS_NODE: "1",
      ...(nodePaths.length ? { NODE_PATH: [...new Set(nodePaths)].join(path.delimiter) } : {})
    };
  }

  plaudEnabled() {
    return this.configProvider().plaudConnectionMode !== "disabled";
  }

  async runPlaudWorker(command, args = [], pluginInput) {
    if (!this.plaudEnabled()) {
      throw new Error("PLAUD 未启用。请先在豆米设置的“录音转写”中开启。");
    }
    const { plugin } = this.plaudPaths(pluginInput);
    return this.runJson(process.execPath, [this.plaudWorker, command, plugin.root, ...args], {
      timeout: command === "list" ? 180000 : 120000,
      label: command === "list" ? "PLAUD 最近录音读取" : "PLAUD 操作",
      queue: "plaud",
      env: this.plaudRuntimeEnv()
    });
  }

  normalizePlaudQueueItem(item) {
    return {
      fileId: String(item?.fileId || ""),
      fileName: String(item?.fileName || "未命名录音"),
      duration: Number(item?.duration) || null,
      createdAt: Number(item?.createdAt) || null,
      editedAt: Number(item?.editedAt) || null,
      hasTranscript: Boolean(item?.transcriptPath),
      hasSummary: false,
      processing: ["generation_submitting", "generating"].includes(item?.stage),
      queueStage: String(item?.stage || ""),
      transcriptPath: String(item?.transcriptPath || ""),
      error: String(item?.error || "")
    };
  }

  loadPlaudWorkflowRecords() {
    try {
      const state = JSON.parse(fs.readFileSync(this.plaudStateFile, "utf8"));
      if (!state?.records || typeof state.records !== "object") return [];
      return Object.values(state.records).filter((item) => item && String(item.fileId || ""));
    } catch {
      return [];
    }
  }

  async plaudQueue(limit = 50) {
    if (!this.plaudEnabled()) {
      return {
        ok: false,
        disabled: true,
        syncedAt: Date.now(),
        pendingCount: 0,
        queueCount: 0,
        items: [],
        error: ""
      };
    }
    const { plugin, script } = this.plaudPaths();
    const [remoteResult, queueResult] = await Promise.allSettled([
      this.runPlaudWorker("list", [String(limit)], plugin),
      this.runJson(process.execPath, [script, "queue"], {
        queue: "plaud",
        env: this.plaudRuntimeEnv()
      })
    ]);
    const queueItems = queueResult.status === "fulfilled" ? queueResult.value.items || [] : [];
    const workflowById = new Map(
      this.loadPlaudWorkflowRecords().map((item) => [String(item.fileId), item])
    );
    for (const item of queueItems) workflowById.set(String(item.fileId), item);
    const activeQueueById = new Map(queueItems.map((item) => [String(item.fileId), item]));
    const remoteItems = remoteResult.status === "fulfilled" ? remoteResult.value.items || [] : [];
    const items = remoteItems.map((item) => {
      const fileId = String(item.fileId);
      const queued = workflowById.get(fileId);
      activeQueueById.delete(fileId);
      return {
        ...item,
        queueStage: String(queued?.stage || ""),
        transcriptPath: String(queued?.transcriptPath || ""),
        error: String(queued?.error || "")
      };
    });
    for (const queued of activeQueueById.values()) {
      items.push(this.normalizePlaudQueueItem(queued));
    }
    items.sort(comparePlaudItems);
    const errors = [
      remoteResult.status === "rejected" ? remoteResult.reason.message : "",
      queueResult.status === "rejected" ? queueResult.reason.message : ""
    ].filter(Boolean);
    return {
      ok: remoteResult.status === "fulfilled",
      syncedAt: Date.now(),
      pendingCount: remoteResult.status === "fulfilled" ? remoteResult.value.pendingCount || 0 : 0,
      queueCount: queueItems.length,
      items,
      error: errors.join("；")
    };
  }

  async syncPlaud(request = {}) {
    const current = await this.plaudQueue();
    if (!current.ok) return current;
    if (current.pendingCount > 10 && !request.confirmed) {
      return { ok: false, requiresConfirmation: true, pendingCount: current.pendingCount, snapshot: current };
    }

    const { script } = this.plaudPaths();
    const runName = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.join(this.plaudOutputDir, runName);
    const recoverableItems = (current.items || []).filter((item) =>
      item.hasTranscript
      && item.queueStage
      && !item.transcriptPath
    );
    const recoveryResults = [];
    for (const item of recoverableItems) {
      try {
        await this.runJson(process.execPath, [script, "download", item.fileId, outputDir], {
          timeout: 180000,
          queue: "plaud",
          env: this.plaudRuntimeEnv()
        });
        recoveryResults.push({ ok: true, fileId: item.fileId });
      } catch (error) {
        recoveryResults.push({
          ok: false,
          fileId: item.fileId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let generationResult = { results: [], manifestPath: "" };
    if (current.pendingCount > 0) {
      generationResult = await this.runJson(process.execPath, [
        script,
        "sync-pending",
        String(current.pendingCount),
        outputDir,
        "900",
        "8"
      ], {
        timeout: 930000,
        queue: "plaud",
        env: this.plaudRuntimeEnv()
      });
    }
    const snapshot = await this.plaudQueue();
    const generationResults = generationResult.results || [];
    return {
      ok: snapshot.ok,
      recoveredCount: recoveryResults.filter((item) => item.ok).length,
      generatedCount: generationResults.filter((item) => item.ok).length,
      failedCount:
        recoveryResults.filter((item) => !item.ok).length
        + generationResults.filter((item) => !item.ok).length,
      manifestPath: generationResult.manifestPath || "",
      snapshot,
      error: snapshot.error || ""
    };
  }

  async mutatePlaudQueue(mutator) {
    const stateDir = path.join(os.homedir(), ".domi");
    const statePath = path.join(stateDir, "plaud-workflow.json");
    const lockPath = path.join(stateDir, "plaud-workflow.lock");
    if (!fs.existsSync(statePath)) return false;
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    let lockHandle;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        lockHandle = fs.openSync(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 120000) fs.rmSync(lockPath, { force: true });
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (lockHandle === undefined) throw new Error("等待 PLAUD 队列写入锁超时。 ");
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (!mutator(state)) return false;
      const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, statePath);
      return true;
    } finally {
      try { fs.closeSync(lockHandle); } catch {}
      fs.rmSync(lockPath, { force: true });
    }
  }

  async updatePlaudQueueTitle(fileId, fileName) {
    return this.mutatePlaudQueue((state) => {
      if (!state.records?.[fileId]) return false;
      state.records[fileId] = {
        ...state.records[fileId],
        fileName,
        updatedAt: new Date().toISOString()
      };
      return true;
    });
  }

  async removePlaudQueueItem(fileId) {
    return this.mutatePlaudQueue((state) => {
      if (!state.records?.[fileId]) return false;
      delete state.records[fileId];
      return true;
    });
  }

  async renamePlaud(request = {}) {
    if (!this.plaudEnabled()) {
      return { ok: false, error: "PLAUD 未启用。请先在豆米设置的“录音转写”中开启。" };
    }
    const fileId = String(request.fileId || "").trim();
    const fileName = String(request.fileName || "").trim();
    const result = await this.runPlaudWorker("rename", [fileId, fileName]);
    await this.updatePlaudQueueTitle(fileId, result.fileName);
    return { ok: true, fileId, fileName: result.fileName };
  }

  async deletePlaud(request = {}) {
    if (!this.plaudEnabled()) {
      return { ok: false, error: "PLAUD 未启用。请先在豆米设置的“录音转写”中开启。" };
    }
    const fileId = String(request.fileId || "").trim();
    const result = await this.runPlaudWorker("trash", [fileId]);
    await this.removePlaudQueueItem(fileId);
    return { ok: true, fileId: result.fileId || fileId, trashed: true };
  }

  async lark(args, options = {}) {
    return this.runJson(this.larkCli, [...args, "--as", "user"], {
      label: options.label || "飞书数据读取",
      queue: "lark",
      ...options
    });
  }

  async larkStatus() {
    try {
      const auth = await this.runJson(
        this.larkCli,
        ["auth", "status", "--json", "--verify"],
        { label: "飞书登录检查", queue: "lark" }
      );
      return {
        ok: Boolean(auth?.verified),
        cliPath: this.larkCli,
        userName: auth?.identities?.user?.userName || "",
        appName: auth?.identities?.bot?.appName || "",
        tokenStatus: auth?.identities?.user?.tokenStatus || "",
        error: ""
      };
    } catch (error) {
      return {
        ok: false,
        cliPath: this.larkCli,
        userName: "",
        appName: "",
        tokenStatus: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  resolvePeopleBase() {
    const settings = this.configProvider();
    const appToken = String(settings.peopleBaseToken || "").trim();
    const tableId = String(settings.peopleTableId || "").trim();
    if (!appToken || !tableId) {
      throw new Error("Domi 人脉库连接尚未配置。请在豆米设置的“资料连接”中填写人脉 Base。 ");
    }
    return { appToken, tableId };
  }

  async fetchRecords({ appToken, tableId, fieldNames }) {
    const items = [];
    let pageToken = "";
    for (let page = 0; page < 10; page += 1) {
      const params = { page_size: 500 };
      if (pageToken) params.page_token = pageToken;
      const response = await this.lark([
        "api",
        "POST",
        `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
        "--params",
        JSON.stringify(params),
        "--data",
        JSON.stringify({ field_names: fieldNames })
      ]);
      const data = response.data || {};
      items.push(...(data.items || []));
      if (!data.has_more) return { items, total: data.total ?? items.length };
      pageToken = data.page_token || "";
      if (!pageToken) break;
    }
    throw new Error("Domi Base 记录超过同步上限或分页信息缺失。 ");
  }

  weeklyNewsCacheKey(days, page) {
    return `${WEEKLY_NEWS_CACHE_KEY}:${days}:${page}`;
  }

  loadWeeklyNewsCache(days, page) {
    const cached = this.stateStore.loadCache(this.weeklyNewsCacheKey(days, page));
    if (!cached?.value?.items) return null;
    this.stateStore.upsertNews(cached.value.items);
    return {
      ...cached.value,
      radarCheckedThrough: this.loadWeeklyNewsRadarCheckpoint(),
      ok: true,
      fromCache: true,
      cachedAt: cached.updatedAt
    };
  }

  loadWeeklyNewsRadarCheckpoint() {
    const cached = this.stateStore.loadCache(WEEKLY_NEWS_RADAR_CHECKPOINT_KEY);
    return normalizedEpochMs(cached?.value?.checkedThrough);
  }

  recordWeeklyNewsRadarCheckpoint(request = {}) {
    const checkedThrough = normalizedEpochMs(request.checkedThrough);
    if (!checkedThrough) {
      return { ok: false, error: "行业雷达没有返回有效的检查水位。" };
    }
    if (checkedThrough > Date.now() + 5 * 60 * 1000) {
      return { ok: false, error: "行业雷达返回的检查水位晚于当前时间。" };
    }
    const previous = this.loadWeeklyNewsRadarCheckpoint();
    const radarCheckedThrough = Math.max(previous, checkedThrough);
    this.stateStore.saveCache(WEEKLY_NEWS_RADAR_CHECKPOINT_KEY, {
      checkedThrough: radarCheckedThrough
    });
    return { ok: true, radarCheckedThrough };
  }

  async weeklyNews(request = {}) {
    const days = Math.min(Math.max(Number(request.days) || 7, 1), 30);
    const limit = Math.min(Math.max(Number(request.limit) || 100, 1), 100);
    const page = Math.min(Math.max(Math.floor(Number(request.page) || 0), 0), 51);
    const now = new Date();
    const rangeEnd = new Date(now.getTime() - page * days * 24 * 60 * 60 * 1000);
    const rangeStart = new Date(rangeEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const cachedPage = this.loadWeeklyNewsCache(days, page);
    const radarCheckedThrough = this.loadWeeklyNewsRadarCheckpoint();
    const localSnapshot = (error = "") => {
      const items = this.stateStore.listNews({
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        limit: 500
      });
      const olderItems = this.stateStore.listNews({
        rangeStart: 0,
        rangeEnd: rangeStart.getTime(),
        limit: 1
      });
      return {
        ok: items.length > 0,
        fromCache: true,
        stale: Boolean(error),
        error,
        checkedAt: cachedPage?.checkedAt || 0,
        contentUpdatedAt: cachedPage?.contentUpdatedAt || cachedPage?.syncedAt || cachedPage?.cachedAt || 0,
        radarCheckedThrough,
        syncedAt: cachedPage?.contentUpdatedAt || cachedPage?.syncedAt || cachedPage?.cachedAt || 0,
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        page,
        total: items.length,
        hasMore: false,
        hasNewer: page > 0,
        hasOlder: olderItems.length > 0,
        sourceUrl: cachedPage?.sourceUrl || "",
        items
      };
    };
    if (request.cacheOnly) {
      if (cachedPage) return cachedPage;
      const local = localSnapshot();
      return local.items.length > 0 ? local : { ...local, ok: false, cacheMiss: true };
    }
    let source;
    try {
      source = this.readRadarConfig();
      if (source.backend === "local") {
        const items = this.withLocalRepository(source, (repository) => repository.listNews({
          rangeStart: rangeStart.getTime(),
          rangeEnd: rangeEnd.getTime(),
          limit: 500
        }));
        this.stateStore.upsertNews(items);
        const olderItems = this.withLocalRepository(source, (repository) => repository.listNews({
          rangeStart: 0,
          rangeEnd: rangeStart.getTime(),
          limit: 1
        }));
        const timestamps = resolveWeeklyNewsTimestamps(cachedPage, items);
        const snapshot = {
          ok: true,
          backend: "local",
          checkedAt: timestamps.checkedAt,
          contentUpdatedAt: timestamps.contentUpdatedAt,
          radarCheckedThrough,
          syncedAt: timestamps.contentUpdatedAt,
          contentChanged: timestamps.changed,
          rangeStart: rangeStart.getTime(),
          rangeEnd: rangeEnd.getTime(),
          page,
          total: items.length,
          hasMore: false,
          hasNewer: page > 0,
          hasOlder: page < 51 && olderItems.length > 0,
          sourceUrl: "",
          items
        };
        this.stateStore.saveCache(this.weeklyNewsCacheKey(days, page), snapshot);
        return snapshot;
      }
    } catch (error) {
      const fallback = localSnapshot(error instanceof Error ? error.message : String(error));
      if (fallback.items.length > 0) return fallback;
      throw error;
    }
    const exactDate = (date) => {
      const datePart = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
      const timePart = [
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0")
      ].join(":");
      return `ExactDate(${datePart} ${timePart})`;
    };
    try {
      const conditions = [
        ["信息发布时间", ">", exactDate(rangeStart)],
        ["是否值得关注", "==", true]
      ];
      if (page > 0) conditions.splice(1, 0, ["信息发布时间", "<", exactDate(rangeEnd)]);
      const filter = { logic: "and", conditions };
      const sort = [
        { field: "信息发布时间", desc: true },
        { field: "重要性评分", desc: true }
      ];
      const args = [
        "base",
        "+record-list",
        "--base-token",
        source.appToken,
        "--table-id",
        source.tableId,
        "--filter-json",
        JSON.stringify(filter),
        "--sort-json",
        JSON.stringify(sort),
        "--limit",
        String(limit),
        "--format",
        "json"
      ];
      for (const fieldName of WEEKLY_NEWS_FIELDS) args.push("--field-id", fieldName);
      const result = await this.lark(args);
      const data = result.data || {};
      const fields = data.fields || [];
      const rows = data.data || [];
      const recordIds = data.record_id_list || [];
      const items = rows.map((row, index) => {
        const values = Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
        return {
          recordId: String(recordIds[index] || ""),
          title: textValue(values["新闻标题"]).trim(),
          domains: stringList(values["领域"]),
          subdomains: stringList(values["子领域"]),
          types: stringList(values["信息类型"]),
          publishedAt: timestampValue(values["信息发布时间"]),
          summary: textValue(values["新闻核心内容"]).trim(),
          investmentMeaning: textValue(values["投资含义"]).trim(),
          url: textValue(values["原文链接"]).trim(),
          source: textValue(values["来源名称"]).trim(),
          companies: textValue(values["涉及公司"]).trim(),
          institutions: textValue(values["涉及机构"]).trim(),
          importance: Number(values["重要性评分"]) || 0,
          confidence: Number(values["可信度"]) || 0,
          evidenceStatus: textValue(values["证据状态"]).trim(),
          action: textValue(values["建议动作"]).trim()
        };
      }).filter((item) => item.recordId && item.title && item.publishedAt);

      this.stateStore.upsertNews(items);
      const preservedItems = this.stateStore.listNews({
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        limit: 500
      });
      const olderItems = this.stateStore.listNews({
        rangeStart: 0,
        rangeEnd: rangeStart.getTime(),
        limit: 1
      });
      const timestamps = resolveWeeklyNewsTimestamps(cachedPage, preservedItems);
      const snapshot = {
        ok: true,
        checkedAt: timestamps.checkedAt,
        contentUpdatedAt: timestamps.contentUpdatedAt,
        radarCheckedThrough,
        syncedAt: timestamps.contentUpdatedAt,
        contentChanged: timestamps.changed,
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        page,
        total: preservedItems.length,
        hasMore: Boolean(data.has_more),
        hasNewer: page > 0,
        hasOlder: page < 51 && (Boolean(data.has_more) || items.length >= limit || olderItems.length > 0),
        sourceUrl: source.baseUrl,
        items: preservedItems
      };
      this.stateStore.saveCache(this.weeklyNewsCacheKey(days, page), snapshot);
      return snapshot;
    } catch (error) {
      const fallback = localSnapshot(error instanceof Error ? error.message : String(error));
      if (fallback.items.length > 0) return fallback;
      throw error;
    }
  }

  normalizeProjects(records) {
    return records.items
      .map((record) => {
        const fields = record.fields || {};
        return {
          recordId: record.record_id,
          name: textValue(fields["公司名称"]).trim(),
          domain: textValue(fields["领域"]),
          subdomains: stringList(fields["子领域"]),
          status: textValue(fields["进展状态"]),
          rating: textValue(fields["项目评级"]),
          notes: textValue(fields["Notes"]),
          cities: stringList(fields["城市"]),
          investors: stringList(fields["投资机构"]),
          lastFollowup: timestampValue(fields["最后更新时间"] ?? fields["最近跟进时间"]),
          link: textValue(fields["链接"])
        };
      })
      .filter((item) => item.recordId && item.name);
  }

  normalizePeople(records) {
    return records.items
      .map((record) => {
        const fields = record.fields || {};
        return {
          recordId: record.record_id,
          name: textValue(fields["人名"]).trim(),
          types: stringList(fields["类型"]),
          organization: textValue(fields["所属组织&身份"]),
          status: textValue(fields["进展状态"]),
          rating: textValue(fields["评级"]),
          lastContact: timestampValue(fields["最后联系日期"]),
          cities: stringList(fields["城市"]),
          link: textValue(fields["链接"])
        };
      })
      .filter((item) => item.recordId && item.name);
  }

  async status(pluginInput) {
    const plugin = pluginInput || this.findPlugin();
    const settings = this.configProvider();
    const localMode = settings.storageBackend === "local";
    const plaudDisabled = settings.plaudConnectionMode === "disabled";
    const plaudScript = path.join(plugin.root, "skills", "plaud", "scripts", "plaud.js");
    const [larkResult, doctorResult, queueResult] = await Promise.allSettled([
      localMode
        ? Promise.resolve({
            ok: true,
            disabled: true,
            cliPath: "",
            userName: "",
            appName: "本地资料库",
            tokenStatus: "",
            error: ""
          })
        : this.larkStatus(),
      plaudDisabled
        ? Promise.resolve({ ok: false, disabled: true })
        : this.runJson(process.execPath, [plaudScript, "doctor"], {
            queue: "plaud",
            env: this.plaudRuntimeEnv()
          }),
      plaudDisabled
        ? Promise.resolve({ count: 0, items: [], disabled: true })
        : this.runJson(process.execPath, [plaudScript, "queue"], {
            queue: "plaud",
            env: this.plaudRuntimeEnv()
          })
    ]);
    const lark = larkResult.status === "fulfilled" ? larkResult.value : null;
    const doctor = doctorResult.status === "fulfilled" ? doctorResult.value : null;
    const queue = queueResult.status === "fulfilled" ? queueResult.value : null;
    const queueStages = {};
    for (const item of queue?.items || []) {
      queueStages[item.stage || "unknown"] = (queueStages[item.stage || "unknown"] || 0) + 1;
    }
    return {
      plugin: {
        ok: true,
        version: plugin.version,
        displayName: plugin.manifest?.interface?.displayName || "Domi",
        root: plugin.root
      },
      lark: {
        ok: larkResult.status === "fulfilled" && Boolean(lark?.ok),
        disabled: Boolean(lark?.disabled),
        userName: lark?.userName || "",
        appName: lark?.appName || "",
        error: larkResult.status === "rejected" ? larkResult.reason.message : lark?.error || ""
      },
      plaud: {
        ok: !plaudDisabled && doctorResult.status === "fulfilled" && Boolean(doctor?.ok),
        disabled: plaudDisabled,
        queueCount: queue?.count || 0,
        queueStages,
        error: plaudDisabled
          ? ""
          :
          doctorResult.status === "rejected"
            ? doctorResult.reason.message
            : queueResult.status === "rejected"
              ? queueResult.reason.message
              : ""
      }
    };
  }

  loadCache() {
    const cached = this.stateStore.loadCache(CACHE_KEY);
    return cached ? { ok: true, snapshot: cached.value, updatedAt: cached.updatedAt } : { ok: true };
  }

  localMigrationSource(settingsInput) {
    const settings = settingsInput || this.configProvider();
    const localLibraryDir = resolveHomePath(settings.localRepositoryDir);
    const localDatabasePath = resolveHomePath(settings.localDatabasePath);
    if (!localLibraryDir || !localDatabasePath) {
      throw new Error("本地资料库尚未配置，无法生成迁移计划。");
    }
    return {
      backend: "local",
      localLibraryDir,
      localDatabasePath
    };
  }

  previewLocalToFeishu(settingsInput) {
    const source = this.localMigrationSource(settingsInput);
    const plugin = this.findPlugin();
    return this.withLocalRepository(source, (repository) => {
      const migration = new LocalToFeishuMigration({
        repository,
        pluginRoot: plugin.root,
        libraryRoot: source.localLibraryDir,
        runLark: (args, options) => this.lark(args, options)
      });
      return migration.preview();
    });
  }

  async migrateLocalToFeishu({ sourceSettings, targetSettings }) {
    const source = this.localMigrationSource(sourceSettings);
    const plugin = this.findPlugin();
    const health = await this.larkStatus();
    if (!health.ok) {
      return {
        ok: false,
        projectCount: 0,
        migratedProjectCount: 0,
        documentCount: 0,
        assetCount: 0,
        migrated: [],
        failed: [],
        error: health.error || "飞书用户身份未就绪，请先重新授权。"
      };
    }
    return this.withLocalRepository(source, (repository) => {
      const migration = new LocalToFeishuMigration({
        repository,
        pluginRoot: plugin.root,
        libraryRoot: source.localLibraryDir,
        runLark: (args, options) => this.lark(args, {
          label: "本地资料迁移到飞书",
          ...options
        })
      });
      return migration.run(targetSettings);
    });
  }

  async sync() {
    const plugin = this.findPlugin();
    const projectSource = this.readProjectConfig();
    const health = await this.status(plugin);
    if (projectSource.backend === "local") {
      const local = this.withLocalRepository(projectSource, (repository) => ({
        repositoryHealth: repository.health(),
        projects: repository.listProjects(),
        people: repository.listPeople()
      }));
      const snapshot = {
        version: 1,
        backend: "local",
        syncedAt: Date.now(),
        health,
        sources: {
          projects: {
            name: "本地项目库",
            total: local.projects.length,
            localLibraryDir: projectSource.localLibraryDir,
            localDatabasePath: projectSource.localDatabasePath
          },
          people: {
            name: "本地人脉库",
            total: local.people.length
          }
        },
        projects: local.projects,
        people: local.people
      };
      this.stateStore.saveCache(CACHE_KEY, snapshot);
      return { ok: true, snapshot, updatedAt: snapshot.syncedAt };
    }
    if (!health.lark.ok) {
      throw new Error(health.lark.error || "飞书用户身份未就绪。 ");
    }
    const peopleSource = this.resolvePeopleBase();
    const projectRecords = await this.fetchRecords({
      ...projectSource,
      fieldNames: ["公司名称", "Notes", "领域", "子领域", "进展状态", "项目评级", "城市", "投资机构", "最后更新时间", "链接"]
    });
    const peopleRecords = await this.fetchRecords({
      ...peopleSource,
      fieldNames: ["人名", "类型", "所属组织&身份", "进展状态", "评级", "最后联系日期", "城市", "链接"]
    });
    const snapshot = {
      version: 1,
      backend: "feishu",
      syncedAt: Date.now(),
      health,
      sources: {
        projects: {
          name: "1.0 项目Watching List",
          total: projectRecords.total,
          localLibraryDir: projectSource.localLibraryDir
        },
        people: {
          name: "1.1 People人际关系管理",
          total: peopleRecords.total
        }
      },
      projects: this.normalizeProjects(projectRecords),
      people: this.normalizePeople(peopleRecords)
    };
    this.stateStore.saveCache(CACHE_KEY, snapshot);
    return { ok: true, snapshot, updatedAt: snapshot.syncedAt };
  }
}

module.exports = {
  DomiIntegration,
  resolveWeeklyNewsTimestamps,
  weeklyNewsContentSignature,
  weeklyNewsHasSubstantiveChange
};
