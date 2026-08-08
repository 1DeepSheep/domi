const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  documentLibraryLocation,
  domiWorkspaceRoot,
  ensureDocumentLibraryStructure
} = require("./document-library.cjs");

const SETTINGS_KEY = "runtime";
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const MAX_CALENDAR_RECIPIENTS = 50;

function parseCalendarRecipients(value = "") {
  const entries = String(value || "")
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (entries.length > MAX_CALENDAR_RECIPIENTS) {
    throw new Error(`常用参会人最多保存 ${MAX_CALENDAR_RECIPIENTS} 个。`);
  }
  const seen = new Set();
  const recipients = [];
  for (const entry of entries) {
    const labeled = entry.match(/^(.*?)\s*<([^<>]+)>$/);
    const name = labeled ? labeled[1].trim() : "";
    const email = (labeled ? labeled[2] : entry).trim();
    if (!EMAIL_PATTERN.test(email)) {
      throw new Error("常用参会人邮箱格式不正确，请使用“姓名 <邮箱>”并以逗号、分号或换行分隔。");
    }
    const key = email.toLocaleLowerCase("en-US");
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({
      name,
      email,
      label: name ? `${name} <${email}>` : email
    });
  }
  return recipients;
}

function normalizeCalendarRecipients(value = "") {
  return parseCalendarRecipients(value).map((recipient) => recipient.label).join(", ");
}

const defaultSettings = Object.freeze({
  version: 8,
  onboardingComplete: false,
  authMode: "chatgpt",
  apiBaseUrl: "",
  apiModel: "",
  relayCredentialConfigured: false,
  codexPath: "",
  plaudConnectionMode: "unconfigured",
  plaudBrowser: "chrome",
  storageBackend: "local",
  projectBaseToken: "",
  projectTableId: "",
  peopleBaseToken: "",
  peopleTableId: "",
  radarBaseToken: "",
  radarTableId: "",
  wikiSpaceId: "",
  taskDocumentUrl: "",
  outlookCalendarEmail: "",
  outlookCalendarEmailVerifiedAt: 0,
  outlookCalendarRecipients: "",
  outlookCalendarTimezone: "Asia/Shanghai",
  localLibraryDir: "",
  localRepositoryDir: "",
  localDatabasePath: "",
  externalAccessMode: "always",
  updateChannel: "stable"
});

const domiConfigKeys = Object.freeze([
  "plaudConnectionMode",
  "plaudBrowser",
  "storageBackend",
  "projectBaseToken",
  "projectTableId",
  "peopleBaseToken",
  "peopleTableId",
  "radarBaseToken",
  "radarTableId",
  "wikiSpaceId",
  "taskDocumentUrl",
  "outlookCalendarEmail",
  "outlookCalendarEmailVerifiedAt",
  "outlookCalendarRecipients",
  "outlookCalendarTimezone",
  "localLibraryDir",
  "localRepositoryDir",
  "localDatabasePath"
]);

function normalizeSettings(value = {}) {
  const version = Number(value.version) || 0;
  const codexPath = String(value.codexPath || "").trim();
  const localLibraryDir = String(value.localLibraryDir || value.oneDriveProjectDir || "").trim();
  const localRepositoryDir = String(value.localRepositoryDir || "").trim();
  const localDatabasePath = String(value.localDatabasePath || "").trim();
  const taskDocumentUrl = String(value.taskDocumentUrl || "").trim();
  const outlookCalendarEmail = String(value.outlookCalendarEmail || "").trim();
  const outlookCalendarEmailVerifiedAt = outlookCalendarEmail
    ? Math.max(0, Number(value.outlookCalendarEmailVerifiedAt) || 0)
    : 0;
  const outlookCalendarRecipients = normalizeCalendarRecipients(
    value.outlookCalendarRecipients || ""
  );
  const outlookCalendarTimezone = String(value.outlookCalendarTimezone || "Asia/Shanghai").trim();
  if (codexPath && !path.isAbsolute(codexPath)) {
    throw new Error("Codex 路径必须是绝对路径。");
  }
  if (localDatabasePath && !path.isAbsolute(localDatabasePath)) {
    throw new Error("本地资料库数据库路径必须是绝对路径。");
  }
  if (
    taskDocumentUrl
    && !(/^https:\/\/\S+$/i.test(taskDocumentUrl)
      || /^[A-Za-z0-9_-]{6,}$/.test(taskDocumentUrl))
  ) {
    throw new Error("1.待办事项文档链接或 token 格式不正确。");
  }
  if (
    outlookCalendarEmail
    && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(outlookCalendarEmail)
  ) {
    throw new Error("Outlook 日历邮箱格式不正确。");
  }
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: outlookCalendarTimezone }).format();
  } catch {
    throw new Error("Outlook 日历时区格式不正确，请使用 IANA 时区名称。");
  }
  const plaudConnectionMode = ["enabled", "disabled"].includes(value.plaudConnectionMode)
    ? value.plaudConnectionMode
    : value.onboardingComplete
      ? "enabled"
      : "unconfigured";
  const authMode = version >= 5 && value.authMode === "relay" ? "relay" : "chatgpt";
  return {
    version: 8,
    onboardingComplete: Boolean(value.onboardingComplete),
    authMode,
    apiBaseUrl: authMode === "relay" ? String(value.apiBaseUrl || "").trim() : "",
    apiModel: authMode === "relay" ? String(value.apiModel || "").trim() : "",
    relayCredentialConfigured: authMode === "relay" && Boolean(value.relayCredentialConfigured),
    codexPath,
    plaudConnectionMode,
    plaudBrowser: value.plaudBrowser === "tabbit" ? "tabbit" : "chrome",
    // Feishu is retained as a legacy primary state for existing users until
    // their explicit local import has been fully verified. New settings can
    // no longer opt into it (see save()).
    storageBackend: value.storageBackend === "feishu" ? "feishu" : "local",
    projectBaseToken: String(value.projectBaseToken || "").trim(),
    projectTableId: String(value.projectTableId || "").trim(),
    peopleBaseToken: String(value.peopleBaseToken || "").trim(),
    peopleTableId: String(value.peopleTableId || "").trim(),
    radarBaseToken: String(value.radarBaseToken || "").trim(),
    radarTableId: String(value.radarTableId || "").trim(),
    wikiSpaceId: String(value.wikiSpaceId || "").trim(),
    taskDocumentUrl,
    outlookCalendarEmail,
    outlookCalendarEmailVerifiedAt,
    outlookCalendarRecipients,
    outlookCalendarTimezone,
    localLibraryDir,
    localRepositoryDir,
    localDatabasePath,
    externalAccessMode: value.externalAccessMode === "ask" ? "ask" : "always",
    updateChannel: value.updateChannel === "beta" ? "beta" : "stable"
  };
}

function validateDomiConfig(settings) {
  if (!["enabled", "disabled"].includes(settings.plaudConnectionMode)) {
    throw new Error("请选择连接 PLAUD，或选择暂时不用。");
  }
  const labels = {
    projectBaseToken: "项目库 Base Token",
    projectTableId: "项目库 Table ID",
    peopleBaseToken: "人脉库 Base Token",
    peopleTableId: "人脉库 Table ID",
    radarBaseToken: "行业动态 Base Token",
    radarTableId: "行业动态 Table ID",
    wikiSpaceId: "Wiki Space ID",
    localLibraryDir: "本地资料库目录",
    localRepositoryDir: "本地资料库根目录",
    localDatabasePath: "本地资料库数据库"
  };
  const requiredKeys = settings.storageBackend === "local"
    ? ["localRepositoryDir", "localDatabasePath"]
    : [];
  const missing = requiredKeys.filter((key) => !settings[key]);
  if (missing.length) {
    throw new Error(`请补充 domi 资料连接：${missing.map((key) => labels[key]).join("、")}。`);
  }
  if (
    settings.storageBackend === "local"
    && !(path.isAbsolute(settings.localRepositoryDir) || settings.localRepositoryDir.startsWith("~/"))
  ) {
    throw new Error("本地资料库目录必须是绝对路径或以 ~/ 开头。");
  }
  if (!path.isAbsolute(settings.localDatabasePath)) {
    throw new Error("本地资料库数据库路径必须是绝对路径。");
  }
}

class AppSettingsService {
  constructor({
    stateStore,
    safeStorage,
    domiConfigPath,
    developmentFallbackConfigPath = ""
  }) {
    this.stateStore = stateStore;
    this.safeStorage = safeStorage;
    this.domiConfigPath = domiConfigPath;
    this.developmentFallbackConfigPath = developmentFallbackConfigPath;
    this.localDatabasePath = domiConfigPath
      ? path.join(path.dirname(domiConfigPath), "domi-repository.sqlite3")
      : "";
  }

  writeDomiConfig(settings) {
    if (!this.domiConfigPath) return;
    const config = { version: 7 };
    for (const key of domiConfigKeys) config[key] = settings[key];
    // Older domi plugin builds read this key. Keep the alias until every
    // supported plugin version understands localLibraryDir.
    config.oneDriveProjectDir = settings.localLibraryDir;
    const directory = path.dirname(this.domiConfigPath);
    const temporaryPath = `${this.domiConfigPath}.tmp`;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.domiConfigPath);
    fs.chmodSync(this.domiConfigPath, 0o600);
  }

  readDomiConfigFile(configPath) {
    if (!configPath || !fs.existsSync(configPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
      const config = {};
      for (const key of domiConfigKeys) {
        if (typeof parsed[key] === "string") config[key] = parsed[key].trim();
      }
      if (!config.localLibraryDir && typeof parsed.oneDriveProjectDir === "string") {
        config.localLibraryDir = parsed.oneDriveProjectDir.trim();
      }
      return config;
    } catch {
      return {};
    }
  }

  readDomiConfig() {
    return this.readDomiConfigFile(this.domiConfigPath);
  }

  bootstrapDevelopmentLocalRepository() {
    if (!this.developmentFallbackConfigPath) {
      return { applied: false, reason: "disabled" };
    }
    const stored = this.stateStore.loadAppSettings(SETTINGS_KEY, defaultSettings);
    const localConfig = this.readDomiConfig();
    const currentRepository = String(
      stored.value?.localRepositoryDir || localConfig.localRepositoryDir || ""
    ).trim();
    if (stored.value?.onboardingComplete || currentRepository) {
      return { applied: false, reason: "already-configured" };
    }

    const productionConfig = this.readDomiConfigFile(
      this.developmentFallbackConfigPath
    );
    const repositoryDir = String(productionConfig.localRepositoryDir || "").trim();
    const resolvedRepositoryDir = repositoryDir.startsWith("~/")
      ? path.join(os.homedir(), repositoryDir.slice(2))
      : repositoryDir;
    if (
      productionConfig.storageBackend !== "local"
      || !repositoryDir
      || !path.isAbsolute(resolvedRepositoryDir)
      || !fs.existsSync(resolvedRepositoryDir)
    ) {
      return { applied: false, reason: "no-local-production-repository" };
    }

    const settings = normalizeSettings({
      ...defaultSettings,
      ...(stored.updatedAt ? stored.value : {}),
      onboardingComplete: true,
      storageBackend: "local",
      localRepositoryDir: repositoryDir,
      // Development keeps its own SQLite index. Only Markdown and material
      // directories are shared, so production and development never contend
      // over the same database file.
      localDatabasePath: this.localDatabasePath,
      plaudConnectionMode: "disabled",
      projectBaseToken: "",
      projectTableId: "",
      peopleBaseToken: "",
      peopleTableId: "",
      radarBaseToken: "",
      radarTableId: "",
      wikiSpaceId: "",
      taskDocumentUrl: "",
      outlookCalendarEmail: "",
      outlookCalendarEmailVerifiedAt: 0,
      outlookCalendarRecipients: ""
    });
    validateDomiConfig(settings);
    const saved = this.stateStore.saveAppSettings(SETTINGS_KEY, settings);
    this.writeDomiConfig(settings);
    return {
      applied: true,
      settings,
      updatedAt: saved.updatedAt
    };
  }

  load() {
    const stored = this.stateStore.loadAppSettings(SETTINGS_KEY, defaultSettings);
    const localDomiConfig = this.readDomiConfig();
    let settings;
    try {
      const storedSettings = { ...defaultSettings, ...stored.value };
      const hasStoredBackend = Object.prototype.hasOwnProperty.call(
        stored.value || {},
        "storageBackend"
      );
      const hasLocalConfigBackend = Object.prototype.hasOwnProperty.call(
        localDomiConfig,
        "storageBackend"
      );
      for (const key of domiConfigKeys) {
        const hasStoredValue = Object.prototype.hasOwnProperty.call(stored.value || {}, key);
        if ((!stored.updatedAt || !hasStoredValue || !storedSettings[key]) && localDomiConfig[key]) {
          storedSettings[key] = localDomiConfig[key];
        }
      }
      const hasLegacyFeishuMapping = [
        "projectBaseToken",
        "projectTableId",
        "peopleBaseToken",
        "peopleTableId",
        "radarBaseToken",
        "radarTableId",
        "wikiSpaceId"
      ].every((key) => Boolean(String(storedSettings[key] || "").trim()));
      if (
        stored.updatedAt
        && !hasStoredBackend
        && !hasLocalConfigBackend
        && hasLegacyFeishuMapping
        && !String(storedSettings.localRepositoryDir || "").trim()
      ) {
        // Very old builds predate storageBackend. A complete Base/Wiki mapping
        // is strong evidence that Feishu held the user's real records. Keep
        // the original primary mode instead of making those records appear missing.
        storedSettings.storageBackend = "feishu";
      }
      if (!storedSettings.localDatabasePath) storedSettings.localDatabasePath = this.localDatabasePath;
      settings = normalizeSettings(storedSettings);
    } catch {
      settings = normalizeSettings({
        ...defaultSettings,
        ...localDomiConfig,
        localDatabasePath: localDomiConfig.localDatabasePath || this.localDatabasePath
      });
    }
    return {
      settings,
      hasApiKey: settings.relayCredentialConfigured,
      secureStorageAvailable: this.safeStorage.isEncryptionAvailable(),
      updatedAt: stored.updatedAt
    };
  }

  save(request = {}) {
    const current = this.load();
    const settingsRequest = { ...request };
    const legacyFeishuCompatibility = current.settings.storageBackend === "feishu";
    // New users and all normal settings writes are local-only. Existing
    // Feishu-primary users stay in their current mode until an explicit,
    // verified import has completed; silently switching them to an empty
    // local database would make their existing records appear to disappear.
    settingsRequest.storageBackend = legacyFeishuCompatibility ? "feishu" : "local";
    const requestedStorageBackend = settingsRequest.storageBackend;
    const requestedLocalRepositoryDir = String(settingsRequest.localRepositoryDir || "").trim();
    const initializesLocalWorkspace = requestedStorageBackend === "local"
      && requestedLocalRepositoryDir
      && (
        !current.settings.localRepositoryDir
        || (
          !current.settings.onboardingComplete
          && requestedLocalRepositoryDir !== current.settings.localRepositoryDir
        )
      );
    if (initializesLocalWorkspace) {
      settingsRequest.localRepositoryDir = domiWorkspaceRoot(requestedLocalRepositoryDir);
    }
    const requestedPlaudMode = Object.prototype.hasOwnProperty.call(request, "plaudConnectionMode")
      ? request.plaudConnectionMode
      : current.settings.plaudConnectionMode;
    if (
      !current.settings.onboardingComplete
      && request.onboardingComplete
      && !["enabled", "disabled"].includes(requestedPlaudMode)
    ) {
      throw new Error("请选择连接 PLAUD，或选择暂时不用。");
    }
    const settings = normalizeSettings({ ...current.settings, ...settingsRequest });
    const updatesDomiConfig = domiConfigKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(settingsRequest, key)
    ) || Object.prototype.hasOwnProperty.call(settingsRequest, "oneDriveProjectDir");
    if ((!current.settings.onboardingComplete && settings.onboardingComplete)
      || (settings.onboardingComplete && updatesDomiConfig)) {
      validateDomiConfig(settings);
    }
    if (initializesLocalWorkspace) {
      const location = documentLibraryLocation(settings);
      ensureDocumentLibraryStructure(location.rootPath);
    }

    const saved = this.stateStore.saveAppSettings(SETTINGS_KEY, settings);
    this.writeDomiConfig(settings);
    return {
      settings,
      hasApiKey: settings.relayCredentialConfigured,
      secureStorageAvailable: this.safeStorage.isEncryptionAvailable(),
      updatedAt: saved.updatedAt
    };
  }

  runtime() {
    const { settings } = this.load();
    const runtime = {
      authMode: settings.authMode,
      codexPath: settings.codexPath,
      args: [],
      env: {},
      defaultModel: settings.authMode === "relay" ? settings.apiModel : "",
      providerLabel: settings.authMode === "relay" ? "Responses 中转站" : "个人 ChatGPT",
      apiBaseUrl: settings.authMode === "relay" ? settings.apiBaseUrl : "",
      hasApiKey: settings.authMode === "relay" && settings.relayCredentialConfigured
    };
    if (this.domiConfigPath) runtime.env.DOMI_CONFIG_PATH = this.domiConfigPath;
    return runtime;
  }
}

module.exports = {
  AppSettingsService,
  defaultSettings,
  domiConfigKeys,
  normalizeCalendarRecipients,
  normalizeSettings,
  parseCalendarRecipients,
  validateDomiConfig
};
