import { CodexRunRequest } from "./env";

const nativeWorkbench = (window as unknown as { workbench?: Window["workbench"] }).workbench;

const browserFallback: Window["workbench"] = {
  loadSettings: async () => ({
    ok: true,
    settings: {
      version: 4,
      onboardingComplete: true,
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      codexPath: "",
      plaudConnectionMode: "disabled",
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
    },
    hasApiKey: false,
    secureStorageAvailable: false,
    updatedAt: Date.now()
  }),
  saveSettings: async (request) => ({
    ok: true,
    settings: {
      version: 4,
      onboardingComplete: Boolean(request.onboardingComplete),
      authMode: "chatgpt",
      apiBaseUrl: "",
      apiModel: "",
      codexPath: request.codexPath || "",
      plaudConnectionMode: request.plaudConnectionMode === "enabled" ? "enabled" : "disabled",
      storageBackend: request.storageBackend === "local" ? "local" : "feishu",
      projectBaseToken: request.projectBaseToken || "",
      projectTableId: request.projectTableId || "",
      peopleBaseToken: request.peopleBaseToken || "",
      peopleTableId: request.peopleTableId || "",
      radarBaseToken: request.radarBaseToken || "",
      radarTableId: request.radarTableId || "",
      wikiSpaceId: request.wikiSpaceId || "",
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
  startChatGPTLogin: async () => ({ ok: false, error: "请在 Electron 窗口中登录。" }),
  runDiagnostics: async () => ({
    ok: false,
    generatedAt: Date.now(),
    durationMs: 0,
    app: { name: "豆米", version: "browser", packaged: false },
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
    console.error("豆米渲染异常", report);
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
    if (/^https?:\/\//i.test(resource)) {
      window.open(resource, "_blank", "noopener,noreferrer");
      return { ok: true, target: resource };
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
    error: "浏览器预览模式不能读取 Domi 缓存。"
  }),
  checkDomi: async () => ({
    ok: false,
    error: "浏览器预览模式不能检查本地 Domi 插件。"
  }),
  listWeeklyNews: async () => ({
    ok: false,
    items: [],
    error: "浏览器预览模式不能读取 Domi 行业新闻。"
  }),
  saveWeeklyNewsCheckpoint: async () => ({
    ok: false,
    error: "浏览器预览模式不能保存 Domi 行业雷达水位。"
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
    error: "请在 Electron 窗口中读取 Domi 项目和人脉材料。"
  }),
  syncDomi: async () => ({
    ok: false,
    error: "浏览器预览模式不能同步 Domi 数据。"
  }),
  onCodexEvent: () => () => undefined,
  onUpdateStatus: () => () => undefined
};

export const workbench = nativeWorkbench ?? browserFallback;
export const hasNativeWorkbench = Boolean(nativeWorkbench);
