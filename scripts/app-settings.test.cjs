const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppSettingsService } = require("../electron/app-settings.cjs");

function createStateStore(initialSettings = {}) {
  let settings = { ...initialSettings };
  const secrets = new Map();
  return {
    loadAppSettings: (_key, fallback) => ({ value: { ...fallback, ...settings }, updatedAt: null }),
    saveAppSettings: (_key, value) => {
      settings = structuredClone(value);
      return { updatedAt: Date.now() };
    },
    loadSecret: (key) => secrets.has(key) ? { value: secrets.get(key) } : null,
    saveSecret: (key, value) => secrets.set(key, value),
    deleteSecret: (key) => secrets.delete(key)
  };
}

function createService(root, initialSettings = {}) {
  return new AppSettingsService({
    stateStore: createStateStore(initialSettings),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString("utf8")
    },
    domiConfigPath: path.join(root, "domi-plugin-config.json")
  });
}

const completeDomiConfig = {
  plaudConnectionMode: "disabled",
  projectBaseToken: "placeholder",
  projectTableId: "placeholder",
  peopleBaseToken: "placeholder",
  peopleTableId: "placeholder",
  radarBaseToken: "placeholder",
  radarTableId: "placeholder",
  wikiSpaceId: "placeholder",
  localLibraryDir: "/tmp/domi-investment-library"
};

test("domi connection settings persist outside the app bundle and survive app updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    service.save(completeDomiConfig);

    const configPath = path.join(root, "domi-plugin-config.json");
    const diskConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(diskConfig.projectBaseToken, completeDomiConfig.projectBaseToken);
    assert.equal(diskConfig.storageBackend, "feishu");
    assert.equal(diskConfig.localLibraryDir, completeDomiConfig.localLibraryDir);
    assert.equal(diskConfig.oneDriveProjectDir, completeDomiConfig.localLibraryDir);
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);

    const migrated = createService(root).load();
    assert.equal(migrated.settings.peopleTableId, completeDomiConfig.peopleTableId);
    assert.equal(migrated.settings.localLibraryDir, completeDomiConfig.localLibraryDir);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy OneDrive settings migrate to the generic local library directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const configPath = path.join(root, "domi-plugin-config.json");
    fs.writeFileSync(configPath, JSON.stringify({
      version: 1,
      ...completeDomiConfig,
      localLibraryDir: undefined,
      oneDriveProjectDir: "~/Library/CloudStorage/Legacy/Projects"
    }));
    const migrated = createService(root, {
      version: 1,
      oneDriveProjectDir: "~/Library/CloudStorage/Legacy/Projects"
    }).load();
    assert.equal(migrated.settings.version, 5);
    assert.equal(migrated.settings.localLibraryDir, "~/Library/CloudStorage/Legacy/Projects");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("legacy API provider settings migrate to ChatGPT and never affect the Codex runtime", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root, {
      authMode: "api",
      apiBaseUrl: "https://proxy.example.com/v1",
      apiModel: "proxy-model"
    });
    const migrated = service.load();
    assert.equal(migrated.settings.authMode, "chatgpt");
    assert.equal(migrated.settings.apiBaseUrl, "");
    assert.equal(migrated.settings.apiModel, "");
    assert.equal(migrated.hasApiKey, false);

    const runtime = service.runtime();
    assert.equal(runtime.authMode, "chatgpt");
    assert.equal(runtime.providerLabel, "个人 ChatGPT");
    assert.deepEqual(runtime.args, []);
    assert.equal(runtime.env.DOMI_PROVIDER_API_KEY, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Responses relay settings persist without placing a credential in app settings", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    const saved = service.save({
      authMode: "relay",
      apiBaseUrl: "https://relay.example.com/v1",
      apiModel: "relay-model",
      relayCredentialConfigured: true
    });
    assert.equal(saved.settings.authMode, "relay");
    assert.equal(saved.settings.apiBaseUrl, "https://relay.example.com/v1");
    assert.equal(saved.settings.apiModel, "relay-model");
    assert.equal(saved.settings.relayCredentialConfigured, true);
    assert.equal(saved.hasApiKey, true);

    const runtime = service.runtime();
    assert.equal(runtime.authMode, "relay");
    assert.equal(runtime.defaultModel, "relay-model");
    assert.equal(runtime.providerLabel, "Responses 中转站");
    assert.equal(runtime.hasApiKey, true);
    assert.deepEqual(runtime.env.DOMI_PROVIDER_API_KEY, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("onboarding cannot complete before employee data connections are configured", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    assert.throws(
      () => service.save({ onboardingComplete: true, plaudConnectionMode: "disabled" }),
      /请补充 domi 资料连接/
    );
    const saved = service.save({ ...completeDomiConfig, onboardingComplete: true });
    assert.equal(saved.settings.onboardingComplete, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("new users must explicitly connect PLAUD or choose to skip it", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    assert.equal(service.load().settings.plaudConnectionMode, "unconfigured");
    assert.throws(
      () => service.save({
        ...completeDomiConfig,
        plaudConnectionMode: "unconfigured",
        onboardingComplete: true
      }),
      /请选择连接 PLAUD/
    );
    const saved = service.save({
      ...completeDomiConfig,
      plaudConnectionMode: "disabled",
      onboardingComplete: true
    });
    assert.equal(saved.settings.plaudConnectionMode, "disabled");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("existing onboarded users keep PLAUD enabled after settings migration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const migrated = createService(root, {
      version: 3,
      onboardingComplete: true,
      ...completeDomiConfig,
      plaudConnectionMode: undefined
    }).load();
    assert.equal(migrated.settings.version, 5);
    assert.equal(migrated.settings.plaudConnectionMode, "enabled");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local repository mode completes onboarding without any Feishu identifiers", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    const saved = service.save({
      storageBackend: "local",
      plaudConnectionMode: "disabled",
      localRepositoryDir: path.join(root, "资料库"),
      onboardingComplete: true
    });
    assert.equal(saved.settings.onboardingComplete, true);
    assert.equal(saved.settings.storageBackend, "local");
    assert.equal(saved.settings.projectBaseToken, "");
    assert.equal(saved.settings.localRepositoryDir, path.join(root, "资料库"));
    assert.equal(
      saved.settings.localDatabasePath,
      path.join(root, "domi-repository.sqlite3")
    );

    const diskConfig = JSON.parse(fs.readFileSync(path.join(root, "domi-plugin-config.json"), "utf8"));
    assert.equal(diskConfig.storageBackend, "local");
    assert.equal(diskConfig.localRepositoryDir, path.join(root, "资料库"));
    assert.equal(diskConfig.localDatabasePath, path.join(root, "domi-repository.sqlite3"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Feishu authorization failure never silently changes the selected backend", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    const saved = service.save({
      ...completeDomiConfig,
      storageBackend: "feishu",
      onboardingComplete: true
    });
    assert.equal(saved.settings.storageBackend, "feishu");
    assert.equal(createService(root).load().settings.storageBackend, "feishu");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
