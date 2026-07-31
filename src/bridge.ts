import { CodexRunRequest } from "./env";

const nativeWorkbench = (window as unknown as { workbench?: Window["workbench"] }).workbench;

function browserWebResource(resource: string) {
  let candidate = String(resource || "").trim().replace(/\u200b/g, "");
  const markdown = candidate.match(/^\[[^\]]*]\(\s*(.+)\s*\)$/s);
  if (markdown) candidate = markdown[1].trim();
  if (candidate.startsWith("<") && candidate.endsWith(">")) candidate = candidate.slice(1, -1).trim();
  const titled = candidate.match(/^(https?:\/\/\S+?)(?:\s+["'][^"']*["'])?$/i);
  if (titled) candidate = titled[1];
  try {
    const parsed = new URL(candidate);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

const browserFallback: Window["workbench"] = {
  loadSettings: async () => ({
    ok: true,
    settings: {
      version: 7,
      onboardingComplete: true,
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      relayCredentialConfigured: false,
      codexPath: "",
      plaudConnectionMode: "disabled",
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
    },
    hasApiKey: false,
    secureStorageAvailable: false,
    updatedAt: Date.now()
  }),
  saveSettings: async (request) => ({
    ok: true,
    settings: {
      version: 7,
      onboardingComplete: Boolean(request.onboardingComplete),
      authMode: request.authMode === "relay" ? "relay" : "chatgpt",
      apiBaseUrl: request.authMode === "relay" ? request.apiBaseUrl || "" : "",
      apiModel: request.authMode === "relay" ? request.apiModel || "" : "",
      relayCredentialConfigured: request.authMode === "relay" && Boolean(request.relayCredentialConfigured),
      codexPath: request.codexPath || "",
      plaudConnectionMode: request.plaudConnectionMode === "enabled" ? "enabled" : "disabled",
      plaudBrowser: request.plaudBrowser === "tabbit" ? "tabbit" : "chrome",
      storageBackend: request.storageBackend === "feishu" ? "feishu" : "local",
      projectBaseToken: request.projectBaseToken || "",
      projectTableId: request.projectTableId || "",
      peopleBaseToken: request.peopleBaseToken || "",
      peopleTableId: request.peopleTableId || "",
      radarBaseToken: request.radarBaseToken || "",
      radarTableId: request.radarTableId || "",
      wikiSpaceId: request.wikiSpaceId || "",
      taskDocumentUrl: request.taskDocumentUrl || "",
      outlookCalendarEmail: request.outlookCalendarEmail || "",
      outlookCalendarEmailVerifiedAt: request.outlookCalendarEmail
        ? Number(request.outlookCalendarEmailVerifiedAt) || 0
        : 0,
      outlookCalendarRecipients: request.outlookCalendarRecipients || "",
      outlookCalendarTimezone: request.outlookCalendarTimezone || "Asia/Shanghai",
      localLibraryDir: request.localLibraryDir || "",
      localRepositoryDir: request.localRepositoryDir || "",
      localDatabasePath: request.localDatabasePath || "",
      externalAccessMode: request.externalAccessMode === "ask" ? "ask" : "always",
      updateChannel: request.updateChannel === "beta" ? "beta" : "stable"
    },
    hasApiKey: false,
    secureStorageAvailable: false,
    updatedAt: Date.now()
  }),
  selectDirectory: async () => ({
    ok: false,
    canceled: false,
    path: "",
    error: "请在 Electron 窗口中选择本地资料库目录。"
  }),
  installCodex: async () => ({
    ok: false,
    installed: false,
    path: "",
    version: "",
    credentialStored: false,
    error: "请在 Electron 窗口中安装 Codex CLI。"
  }),
  getCodexRuntimeStatus: async () => ({
    ok: false,
    managed: false,
    path: "",
    version: "",
    bundledVersion: "",
    rollbackAvailable: false,
    rollbackVersion: "",
    error: "浏览器预览模式不管理 Codex Runtime。"
  }),
  updateCodexRuntime: async () => ({
    ok: false,
    managed: false,
    path: "",
    version: "",
    bundledVersion: "",
    rollbackAvailable: false,
    rollbackVersion: "",
    error: "浏览器预览模式不能更新 Codex Runtime。"
  }),
  rollbackCodexRuntime: async () => ({
    ok: false,
    managed: false,
    path: "",
    version: "",
    bundledVersion: "",
    rollbackAvailable: false,
    rollbackVersion: "",
    error: "浏览器预览模式不能恢复 Codex Runtime。"
  }),
  configureCodexRelay: async () => ({
    ok: false,
    error: "请在 Electron 窗口中配置 Codex 中转站。"
  }),
  testCodexConnection: async () => ({
    ok: false,
    error: "请在 Electron 窗口中测试 Codex 连接。"
  }),
  startChatGPTLogin: async () => ({ ok: false, error: "请在 Electron 窗口中登录。" }),
  runDiagnostics: async () => ({
    ok: false,
    generatedAt: Date.now(),
    durationMs: 0,
    app: { name: "domi", version: "browser", packaged: false },
    system: { platform: "browser", arch: "unknown", release: "" },
    connection: {
      authMode: "chatgpt",
      providerLabel: "浏览器预览",
      apiBaseUrl: "",
      credentialStored: false
    },
    checks: [{ id: "electron", label: "Electron", ok: false, detail: "浏览器预览模式" }]
  }),
  exportDiagnostics: async () => ({
    ok: false,
    error: "浏览器预览模式不能导出诊断报告。"
  }),
  reportRendererIssue: (report) => {
    console.error("domi 渲染异常", report);
  },
  getUpdateStatus: async () => ({
    state: "disabled",
    supported: false,
    currentVersion: "browser",
    availableVersion: "",
    channel: "stable",
    percent: 0,
    transferred: 0,
    total: 0,
    releaseDate: "",
    error: "浏览器预览模式不执行更新。"
  }),
  checkForUpdates: async () => browserFallback.getUpdateStatus(),
  downloadUpdate: async () => browserFallback.getUpdateStatus(),
  installUpdate: async () => ({
    ok: false,
    status: await browserFallback.getUpdateStatus(),
    error: "浏览器预览模式不能安装更新。"
  }),
  checkCodex: async () => ({
    ok: false,
    path: "",
    version: "Browser preview mode",
    transport: "browser",
    workspacePath: "demo-workspace",
    account: null,
    authMode: "chatgpt",
    providerLabel: "浏览器预览",
    apiBaseUrl: "",
    credentialStored: false,
    requiresOpenaiAuth: true,
    configuredModel: "",
    configuredReasoningEffort: "medium",
    configuredServiceTier: "standard",
    models: [],
    error: "请使用 Electron 窗口运行本地 Codex。"
  }),
  runCodex: async (payload: CodexRunRequest) => ({
    ok: true,
    runId: payload.runId,
    output:
      "当前是浏览器预览模式，界面已正常渲染，但不能直接调用本地 Codex。\n\n请使用 `npm run dev` 自动打开的 Electron 窗口，或运行 `npm run preview`，即可通过 Electron 主进程连接 `codex app-server`。",
    workspacePath: "demo-workspace",
    eventCount: 0
  }),
  stopCodex: async () => ({ ok: true }),
  recoverCodexThread: async (threadId) => ({
    ok: false,
    threadId,
    status: "unknown",
    error: "浏览器预览模式不能恢复本地 Codex 对话。"
  }),
  selectFiles: async () => ({
    ok: false,
    canceled: false,
    files: [],
    error: "请使用 Electron 窗口选择本地文件。"
  }),
  getPathForFile: () => "",
  importFiles: async () => ({
    ok: false,
    canceled: false,
    files: [],
    error: "请使用 Electron 窗口粘贴或拖入本地文件。"
  }),
  importFileData: async () => ({
    ok: false,
    canceled: false,
    files: [],
    error: "请使用 Electron 窗口粘贴图片或录音文件。"
  }),
  openResource: async (resource) => {
    const target = browserWebResource(resource);
    if (target) {
      window.open(target, "_blank", "noopener,noreferrer");
      return { ok: true, target };
    }
    return { ok: false, error: "请在 Electron 窗口中打开本地文件。", target: resource };
  },
  showNotification: async ({ title, body, silent }) => {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") {
      return { ok: false, error: "当前浏览器未授权桌面通知。" };
    }
    new Notification(title, { body, silent });
    return { ok: true };
  },
  listDocumentLibrary: async (_request) => ({
    ok: false,
    rootPath: "",
    rootName: "本地文档库",
    nodes: [],
    documentCount: 0,
    folderCount: 0,
    truncated: false,
    scannedAt: Date.now(),
    error: "请在 Electron 窗口中读取本地文档库。"
  }),
  createDocumentLibraryEntry: async () => ({
    ok: false,
    error: "请在 Electron 窗口中新建本地文档。"
  }),
  readMarkdown: async () => ({
    ok: false,
    error: "请在 Electron 窗口中预览本地 Markdown 文件。"
  }),
  saveMarkdown: async () => ({
    ok: false,
    error: "请在 Electron 窗口中保存本地 Markdown 文件。"
  }),
  renameMarkdown: async () => ({
    ok: false,
    error: "请在 Electron 窗口中重命名本地 Markdown 文件。"
  }),
  resolveMarkdownImage: async () => ({
    ok: false,
    error: "请在 Electron 窗口中预览本地 Markdown 图片。"
  }),
  saveMarkdownImage: async () => ({
    ok: false,
    error: "请在 Electron 窗口中粘贴 Markdown 图片。"
  }),
  copyMarkdown: async ({ markdown }) => {
    try {
      await navigator.clipboard.writeText(markdown);
      return { ok: true, imageCount: 0, missingImageCount: 0 };
    } catch {
      return { ok: false, error: "浏览器预览模式无法访问系统剪贴板。" };
    }
  },
  readPdf: async () => ({
    ok: false,
    error: "请在 Electron 窗口中预览本地 PDF 文件。"
  }),
  loadState: async (defaultState) => ({
    ok: true,
    state: defaultState,
    updatedAt: Date.now(),
    isNew: true
  }),
  saveState: async (state) => ({ ok: true, state, updatedAt: Date.now() }),
  saveStatePatch: async () => ({ ok: true, updatedAt: Date.now() }),
  createProjectWorkspace: async ({ projectId }) => ({
    ok: true,
    workspacePath: `demo-workspace/projects/${projectId}`
  }),
  openWorkspace: async (workspacePath) => ({
    ok: false,
    workspacePath: workspacePath || "demo-workspace",
    error: "浏览器预览模式不能打开本地目录。"
  }),
  loadDomiCache: async () => ({
    ok: false,
    error: "浏览器预览模式不能读取 domi 缓存。"
  }),
  checkDomi: async () => ({
    ok: false,
    error: "浏览器预览模式不能检查本地 domi 插件。"
  }),
  listWeeklyNews: async () => ({
    ok: false,
    items: [],
    error: "浏览器预览模式不能读取 domi 行业新闻。"
  }),
  saveWeeklyNewsCheckpoint: async () => ({
    ok: false,
    error: "浏览器预览模式不能保存 domi 行业雷达水位。"
  }),
  listDomiTasks: async () => ({
    ok: false,
    configured: false,
    stale: false,
    syncedAt: 0,
    updatedAt: null,
    tasks: [],
    error: "浏览器预览模式不能读取 1.待办事项。"
  }),
  updateDomiTask: async () => ({
    ok: false,
    error: "浏览器预览模式不能更新 1.待办事项。"
  }),
  loginPlaud: async ({ browser }) => ({
    ok: false,
    connected: false,
    browser: browser === "tabbit" ? "tabbit" : "chrome",
    error: "请在 Electron 窗口中登录 PLAUD。"
  }),
  checkPlaudConnection: async ({ browser } = {}) => ({
    ok: false,
    connected: false,
    browser: browser === "tabbit" ? "tabbit" : "chrome",
    error: "请在 Electron 窗口中检测 PLAUD。"
  }),
  disconnectPlaud: async ({ browser } = {}) => ({
    ok: false,
    connected: false,
    browser: browser === "tabbit" ? "tabbit" : "chrome",
    error: "请在 Electron 窗口中断开 PLAUD。"
  }),
  listPlaud: async () => ({
    ok: false,
    items: [],
    pendingCount: 0,
    queueCount: 0,
    error: "浏览器预览模式不能读取 PLAUD 队列。"
  }),
  syncPlaud: async () => ({
    ok: false,
    error: "浏览器预览模式不能同步 PLAUD 队列。"
  }),
  renamePlaud: async () => ({
    ok: false,
    error: "浏览器预览模式不能修改 PLAUD 录音标题。"
  }),
  deletePlaud: async () => ({
    ok: false,
    error: "浏览器预览模式不能删除 PLAUD 录音。"
  }),
  loadDomiEntityMaterials: async () => ({
    ok: false,
    error: "请在 Electron 窗口中读取 domi 项目和人脉材料。"
  }),
  syncDomi: async () => ({
    ok: false,
    error: "浏览器预览模式不能同步 domi 数据。"
  }),
  listDomiDatabase: async () => ({
    ok: true,
    backend: "local",
    editable: true,
    loadedAt: Date.now(),
    projects: [{
      recordId: "preview_project",
      name: "示例项目",
      domain: "AI",
      subdomains: ["Agent"],
      status: "深度跟踪",
      rating: "A",
      notes: "浏览器预览使用的非真实示例记录。",
      cities: ["上海"],
      investors: ["IDG"],
      financingHistory: "",
      latestValuationUsd100m: 1.2,
      createdAt: Date.now(),
      lastFollowup: Date.now(),
      updatedAt: 1,
      link: ""
    }],
    people: [{
      recordId: "preview_person",
      name: "示例人物",
      types: ["创业者"],
      organization: "示例公司 · CEO",
      status: "已联系",
      rating: "A",
      createdAt: Date.now(),
      lastContact: Date.now(),
      cities: ["北京"],
      updatedAt: 1,
      link: ""
    }],
    news: [{
      recordId: "preview_news",
      title: "示例行业信息",
      domains: ["AI"],
      subdomains: ["Agent"],
      types: ["公司动态"],
      publishedAt: Date.now(),
      summary: "浏览器预览使用的示例行业信息。",
      investmentMeaning: "用于验证资料库编辑界面的布局。",
      url: "https://example.com",
      source: "示例来源",
      companies: "示例项目",
      institutions: "",
      importance: 8,
      confidence: 9,
      evidenceStatus: "官方确认",
      action: "继续跟踪",
      worthFollowing: true,
      updatedAt: 1
    }]
  }),
  updateDomiDatabaseRecord: async (request) => {
    const updatedAt = Date.now();
    if (request.entityType === "project") {
      return {
        ok: true,
        entityType: "project",
        updatedAt,
        record: {
          ...request.record,
          createdAt: updatedAt,
          lastFollowup: updatedAt,
          updatedAt,
          link: ""
        }
      };
    }
    if (request.entityType === "person") {
      return {
        ok: true,
        entityType: "person",
        updatedAt,
        record: {
          ...request.record,
          createdAt: updatedAt,
          updatedAt,
          link: ""
        }
      };
    }
    return {
      ok: true,
      entityType: "news",
      updatedAt,
      record: {
        ...request.record,
        updatedAt
      }
    };
  },
  previewDomiDatabaseRecord: async (request) => ({
    ok: false,
    entityType: request.entityType,
    recordId: request.recordId,
    error: "浏览器预览没有关联本地项目文档。"
  }),
  deleteDomiDatabaseRecord: async (request) => ({
    ok: true,
    entityType: request.entityType,
    recordId: request.recordId,
    filesPreserved: true,
    updatedAt: Date.now()
  }),
  previewStorageMigration: async () => ({
    ok: true,
    projectCount: 0,
    documentCount: 0,
    projects: []
  }),
  onCodexEvent: () => () => undefined,
  onUpdateStatus: () => () => undefined
};

export const workbench = nativeWorkbench ?? browserFallback;
export const hasNativeWorkbench = Boolean(nativeWorkbench);
