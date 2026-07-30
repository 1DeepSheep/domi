const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { AppSettingsService } = require("../electron/app-settings.cjs");
const {
  normalizeCalendarRecipients,
  parseCalendarRecipients
} = require("../electron/app-settings.cjs");

function createStateStore(initialSettings = {}, initialUpdatedAt = null) {
  let settings = { ...initialSettings };
  let updatedAt = initialUpdatedAt ?? (Object.keys(initialSettings).length > 0 ? 1 : 0);
  const secrets = new Map();
  return {
    loadAppSettings: (_key, fallback) => updatedAt
      ? { value: { ...settings }, updatedAt }
      : { value: fallback, updatedAt: 0 },
    saveAppSettings: (_key, value) => {
      settings = structuredClone(value);
      updatedAt = Date.now();
      return { updatedAt };
    },
    loadSecret: (key) => secrets.has(key) ? { value: secrets.get(key) } : null,
    saveSecret: (key, value) => secrets.set(key, value),
    deleteSecret: (key) => secrets.delete(key)
  };
}

function createService(
  root,
  initialSettings = {},
  initialUpdatedAt = null,
  options = {}
) {
  return new AppSettingsService({
    stateStore: createStateStore(initialSettings, initialUpdatedAt),
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString("utf8")
    },
    domiConfigPath: path.join(root, "domi-plugin-config.json"),
    developmentFallbackConfigPath: options.developmentFallbackConfigPath || ""
  });
}

const completeDomiConfig = {
  plaudConnectionMode: "disabled",
  storageBackend: "feishu",
  projectBaseToken: "placeholder",
  projectTableId: "placeholder",
  peopleBaseToken: "placeholder",
  peopleTableId: "placeholder",
  radarBaseToken: "placeholder",
  radarTableId: "placeholder",
  wikiSpaceId: "placeholder",
  localLibraryDir: "/tmp/domi-investment-library"
};

test("new users default to the local repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    const loaded = service.load();
    assert.equal(loaded.settings.onboardingComplete, false);
    assert.equal(loaded.settings.storageBackend, "local");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("development reuses the existing production workspace without copying private configuration", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-dev-"));
  try {
    const productionRoot = path.join(root, "production");
    const developmentRoot = path.join(root, "development");
    const workspaceRoot = path.join(root, "existing-domi-workspace");
    fs.mkdirSync(productionRoot, { recursive: true });
    fs.mkdirSync(developmentRoot, { recursive: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    const productionConfigPath = path.join(productionRoot, "domi-plugin-config.json");
    fs.writeFileSync(productionConfigPath, JSON.stringify({
      storageBackend: "local",
      localRepositoryDir: workspaceRoot,
      localDatabasePath: path.join(productionRoot, "production-repository.sqlite3"),
      plaudConnectionMode: "enabled",
      projectBaseToken: "placeholder",
      outlookCalendarEmail: "example@example.com"
    }));

    const service = createService(developmentRoot, {}, null, {
      developmentFallbackConfigPath: productionConfigPath
    });
    const inherited = service.bootstrapDevelopmentLocalRepository();
    const loaded = service.load().settings;
    const developmentConfig = JSON.parse(fs.readFileSync(
      path.join(developmentRoot, "domi-plugin-config.json"),
      "utf8"
    ));

    assert.equal(inherited.applied, true);
    assert.equal(loaded.onboardingComplete, true);
    assert.equal(loaded.storageBackend, "local");
    assert.equal(loaded.localRepositoryDir, workspaceRoot);
    assert.equal(
      loaded.localDatabasePath,
      path.join(developmentRoot, "domi-repository.sqlite3")
    );
    assert.equal(loaded.plaudConnectionMode, "disabled");
    assert.equal(developmentConfig.projectBaseToken, "");
    assert.equal(developmentConfig.outlookCalendarEmail, "");
    assert.equal(fs.readdirSync(root).includes("domi开发工作区"), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("development never inherits a production Feishu repository", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-dev-feishu-"));
  try {
    const productionConfigPath = path.join(root, "production-config.json");
    fs.writeFileSync(productionConfigPath, JSON.stringify({
      storageBackend: "feishu",
      projectBaseToken: "placeholder",
      wikiSpaceId: "placeholder"
    }));
    const service = createService(path.join(root, "development"), {}, null, {
      developmentFallbackConfigPath: productionConfigPath
    });

    const inherited = service.bootstrapDevelopmentLocalRepository();
    assert.equal(inherited.applied, false);
    assert.equal(inherited.reason, "no-local-production-repository");
    assert.equal(service.load().settings.onboardingComplete, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("existing users without an explicit backend keep the historical Feishu default", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const legacySettings = {
      version: 6,
      onboardingComplete: true,
      ...completeDomiConfig
    };
    delete legacySettings.storageBackend;
    const service = createService(root, legacySettings, Date.now());
    assert.equal(service.load().settings.storageBackend, "feishu");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("domi connection settings persist outside the app bundle and survive app updates", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    service.save({ ...completeDomiConfig, plaudBrowser: "tabbit" });

    const configPath = path.join(root, "domi-plugin-config.json");
    const diskConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(diskConfig.projectBaseToken, completeDomiConfig.projectBaseToken);
    assert.equal(diskConfig.storageBackend, "feishu");
    assert.equal(diskConfig.localLibraryDir, completeDomiConfig.localLibraryDir);
    assert.equal(diskConfig.oneDriveProjectDir, completeDomiConfig.localLibraryDir);
    assert.equal(diskConfig.plaudBrowser, "tabbit");
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);

    const migrated = createService(root).load();
    assert.equal(migrated.settings.peopleTableId, completeDomiConfig.peopleTableId);
    assert.equal(migrated.settings.localLibraryDir, completeDomiConfig.localLibraryDir);
    assert.equal(migrated.settings.plaudBrowser, "tabbit");
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
    assert.equal(migrated.settings.version, 7);
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
    assert.equal(migrated.settings.version, 7);
    assert.equal(migrated.settings.plaudConnectionMode, "enabled");
    assert.equal(migrated.settings.plaudBrowser, "chrome");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("task document and Outlook account hints stay in the private local config", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const service = createService(root);
    const saved = service.save({
      ...completeDomiConfig,
      taskDocumentUrl: "document_token",
      outlookCalendarEmail: "calendar@example.com",
      outlookCalendarEmailVerifiedAt: 1785246000000,
      outlookCalendarRecipients: "张三 <zhangsan@example.com>; lisi@example.com",
      outlookCalendarTimezone: "Asia/Shanghai"
    });
    assert.equal(saved.settings.taskDocumentUrl, "document_token");
    assert.equal(saved.settings.outlookCalendarEmail, "calendar@example.com");
    assert.equal(saved.settings.outlookCalendarEmailVerifiedAt, 1785246000000);
    assert.equal(
      saved.settings.outlookCalendarRecipients,
      "张三 <zhangsan@example.com>, lisi@example.com"
    );

    const configPath = path.join(root, "domi-plugin-config.json");
    const diskConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    assert.equal(diskConfig.version, 6);
    assert.equal(diskConfig.taskDocumentUrl, "document_token");
    assert.equal(diskConfig.outlookCalendarEmail, "calendar@example.com");
    assert.equal(diskConfig.outlookCalendarEmailVerifiedAt, 1785246000000);
    assert.equal(
      diskConfig.outlookCalendarRecipients,
      "张三 <zhangsan@example.com>, lisi@example.com"
    );
    assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);

    assert.throws(
      () => service.save({ outlookCalendarEmail: "not-an-email" }),
      /邮箱格式不正确/
    );
    assert.throws(
      () => service.save({ outlookCalendarTimezone: "Invalid/Timezone" }),
      /时区格式不正确/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("calendar recipient lists accept labels, deduplicate emails, and reject invalid entries", () => {
  assert.deepEqual(
    parseCalendarRecipients(
      "张三 <ZhangSan@example.com>; lisi@example.com\n张三重复 <zhangsan@example.com>"
    ),
    [
      {
        name: "张三",
        email: "ZhangSan@example.com",
        label: "张三 <ZhangSan@example.com>"
      },
      {
        name: "",
        email: "lisi@example.com",
        label: "lisi@example.com"
      }
    ]
  );
  assert.equal(
    normalizeCalendarRecipients("张三 <zhangsan@example.com>\nlisi@example.com"),
    "张三 <zhangsan@example.com>, lisi@example.com"
  );
  assert.throws(
    () => normalizeCalendarRecipients("张三 <not-an-email>"),
    /常用参会人邮箱格式不正确/
  );
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
    const workspaceRoot = path.join(root, "资料库", "domi工作区");
    assert.equal(saved.settings.onboardingComplete, true);
    assert.equal(saved.settings.storageBackend, "local");
    assert.equal(saved.settings.projectBaseToken, "");
    assert.equal(saved.settings.localRepositoryDir, workspaceRoot);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "0.待办事项.md")), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "1.行业研究")), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "2.行业动态")), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "3.项目库")), true);
    assert.equal(fs.existsSync(path.join(workspaceRoot, "4.人脉库")), true);
    assert.equal(
      saved.settings.localDatabasePath,
      path.join(root, "domi-repository.sqlite3")
    );

    const diskConfig = JSON.parse(fs.readFileSync(path.join(root, "domi-plugin-config.json"), "utf8"));
    assert.equal(diskConfig.storageBackend, "local");
    assert.equal(diskConfig.localRepositoryDir, workspaceRoot);
    assert.equal(diskConfig.localDatabasePath, path.join(root, "domi-repository.sqlite3"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("existing local repositories keep their current root without forced nesting", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-settings-"));
  try {
    const existingRoot = path.join(root, "旧资料库");
    const service = createService(root, {
      version: 6,
      onboardingComplete: true,
      storageBackend: "local",
      plaudConnectionMode: "disabled",
      localRepositoryDir: existingRoot,
      localDatabasePath: path.join(root, "domi-repository.sqlite3")
    });
    const saved = service.save({
      storageBackend: "local",
      localRepositoryDir: existingRoot
    });
    assert.equal(saved.settings.localRepositoryDir, existingRoot);
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
