const fs = require("node:fs");
const path = require("node:path");

const SETTINGS_KEY = "runtime";
const defaultSettings = Object.freeze({
  version: 5,
  onboardingComplete: false,
  authMode: "chatgpt",
  apiBaseUrl: "",
  apiModel: "",
  relayCredentialConfigured: false,
  codexPath: "",
  plaudConnectionMode: "unconfigured",
  storageBackend: "feishu",
  projectBaseToken: "",
  projectTableId: "",
  peopleBaseToken: "",
  peopleTableId: "",
  radarBaseToken: "",
  radarTableId: "",
  wikiSpaceId: "",
  localLibraryDir: "",
  localRepositoryDir: "",
  localDatabasePath: "",
  externalAccessMode: "always",
  updateChannel: "stable"
});

const domiConfigKeys = Object.freeze([
  "plaudConnectionMode",
  "storageBackend",
  "projectBaseToken",
  "projectTableId",
  "peopleBaseToken",
  "peopleTableId",
  "radarBaseToken",
  "radarTableId",
  "wikiSpaceId",
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
  if (codexPath && !path.isAbsolute(codexPath)) {
    throw new Error("Codex 路径必须是绝对路径。");
  }
  if (localDatabasePath && !path.isAbsolute(localDatabasePath)) {
    throw new Error("本地资料库数据库路径必须是绝对路径。");
  }
  const plaudConnectionMode = ["enabled", "disabled"].includes(value.plaudConnectionMode)
    ? value.plaudConnectionMode
    : value.onboardingComplete
      ? "enabled"
      : "unconfigured";
  const authMode = version >= 5 && value.authMode === "relay" ? "relay" : "chatgpt";
  return {
    version: 5,
    onboardingComplete: Boolean(value.onboardingComplete),
    authMode,
    apiBaseUrl: authMode === "relay" ? String(value.apiBaseUrl || "").trim() : "",
    apiModel: authMode === "relay" ? String(value.apiModel || "").trim() : "",
    relayCredentialConfigured: authMode === "relay" && Boolean(value.relayCredentialConfigured),
    codexPath,
    plaudConnectionMode,
    storageBackend: value.storageBackend === "local" ? "local" : "feishu",
    projectBaseToken: String(value.projectBaseToken || "").trim(),
    projectTableId: String(value.projectTableId || "").trim(),
    peopleBaseToken: String(value.peopleBaseToken || "").trim(),
    peopleTableId: String(value.peopleTableId || "").trim(),
    radarBaseToken: String(value.radarBaseToken || "").trim(),
    radarTableId: String(value.radarTableId || "").trim(),
    wikiSpaceId: String(value.wikiSpaceId || "").trim(),
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
    : [
        "projectBaseToken",
        "projectTableId",
        "peopleBaseToken",
        "peopleTableId",
        "radarBaseToken",
        "radarTableId",
        "wikiSpaceId",
        "localLibraryDir"
      ];
  const missing = requiredKeys.filter((key) => !settings[key]);
  if (missing.length) {
    throw new Error(`请补充 Domi 资料连接：${missing.map((key) => labels[key]).join("、")}。`);
  }
  if (settings.storageBackend === "feishu") {
    for (const key of ["projectBaseToken", "projectTableId", "peopleBaseToken", "peopleTableId", "radarBaseToken", "radarTableId"]) {
      if (!/^[A-Za-z0-9_-]{6,}$/.test(settings[key])) {
        throw new Error(`${labels[key]} 格式不正确。`);
      }
    }
    if (!/^[A-Za-z0-9_-]{6,}$/.test(settings.wikiSpaceId)) {
      throw new Error("Wiki Space ID 格式不正确。");
    }
  }
  const activeLocalDirectory = settings.storageBackend === "local"
    ? settings.localRepositoryDir
    : settings.localLibraryDir;
  if (!(path.isAbsolute(activeLocalDirectory) || activeLocalDirectory.startsWith("~/"))) {
    throw new Error("本地资料库目录必须是绝对路径或以 ~/ 开头。");
  }
  if (!path.isAbsolute(settings.localDatabasePath)) {
    throw new Error("本地资料库数据库路径必须是绝对路径。");
  }
}

class AppSettingsService {
  constructor({ stateStore, safeStorage, domiConfigPath }) {
    this.stateStore = stateStore;
    this.safeStorage = safeStorage;
    this.domiConfigPath = domiConfigPath;
    this.localDatabasePath = domiConfigPath
      ? path.join(path.dirname(domiConfigPath), "domi-repository.sqlite3")
      : "";
  }

  writeDomiConfig(settings) {
    if (!this.domiConfigPath) return;
    const config = { version: 4 };
    for (const key of domiConfigKeys) config[key] = settings[key];
    // Older Domi plugin builds read this key. Keep the alias until every
    // supported plugin version understands localLibraryDir.
    config.oneDriveProjectDir = settings.localLibraryDir;
    const directory = path.dirname(this.domiConfigPath);
    const temporaryPath = `${this.domiConfigPath}.tmp`;
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporaryPath, this.domiConfigPath);
    fs.chmodSync(this.domiConfigPath, 0o600);
  }

  readDomiConfig() {
    if (!this.domiConfigPath || !fs.existsSync(this.domiConfigPath)) return {};
    try {
      const parsed = JSON.parse(fs.readFileSync(this.domiConfigPath, "utf8"));
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

  load() {
    const stored = this.stateStore.loadAppSettings(SETTINGS_KEY, defaultSettings);
    const localDomiConfig = this.readDomiConfig();
    let settings;
    try {
      const storedSettings = { ...defaultSettings, ...stored.value };
      for (const key of domiConfigKeys) {
        if (!storedSettings[key] && localDomiConfig[key]) storedSettings[key] = localDomiConfig[key];
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
    const settings = normalizeSettings({ ...current.settings, ...request });
    const updatesDomiConfig = domiConfigKeys.some((key) =>
      Object.prototype.hasOwnProperty.call(request, key)
    ) || Object.prototype.hasOwnProperty.call(request, "oneDriveProjectDir");
    if ((!current.settings.onboardingComplete && settings.onboardingComplete)
      || (settings.onboardingComplete && updatesDomiConfig)) {
      validateDomiConfig(settings);
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
  normalizeSettings,
  validateDomiConfig
};
