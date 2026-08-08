const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("workbench", {
  checkCodex: () => ipcRenderer.invoke("codex:check"),
  loadSettings: () => ipcRenderer.invoke("settings:load"),
  saveSettings: (request) => ipcRenderer.invoke("settings:save", request),
  selectDirectory: (currentPath) => ipcRenderer.invoke("settings:select-directory", currentPath),
  installCodex: () => ipcRenderer.invoke("settings:install-codex"),
  getCodexRuntimeStatus: () => ipcRenderer.invoke("settings:codex-runtime-status"),
  updateCodexRuntime: () => ipcRenderer.invoke("settings:update-codex-runtime"),
  rollbackCodexRuntime: () => ipcRenderer.invoke("settings:rollback-codex-runtime"),
  configureCodexRelay: (request) => ipcRenderer.invoke("settings:configure-relay", request),
  testCodexConnection: () => ipcRenderer.invoke("settings:test-codex"),
  startChatGPTLogin: () => ipcRenderer.invoke("settings:chatgpt-login"),
  runDiagnostics: () => ipcRenderer.invoke("settings:diagnose"),
  exportDiagnostics: (report) => ipcRenderer.invoke("settings:export-diagnostics", report),
  reportRendererIssue: (report) => ipcRenderer.send("app:renderer-report", report),
  getUpdateStatus: () => ipcRenderer.invoke("update:status"),
  checkForUpdates: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  runCodex: (payload) => ipcRenderer.invoke("codex:run", payload),
  stopCodex: (runId) => ipcRenderer.invoke("codex:stop", runId),
  recoverCodexThread: (threadId) => ipcRenderer.invoke("codex:recover-thread", threadId),
  bindCodexRun: (runId) => ipcRenderer.invoke("codex:bind-run", runId),
  answerCodexUserInput: (request) => ipcRenderer.invoke("codex:answer-user-input", request),
  selectFiles: (workspacePath, entityRequest) => ipcRenderer.invoke("files:select", workspacePath, entityRequest),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  importFiles: (sourcePaths, workspacePath, entityRequest) => ipcRenderer.invoke("files:import", sourcePaths, workspacePath, entityRequest),
  importFileData: (files, workspacePath, entityRequest) => ipcRenderer.invoke("files:import-data", files, workspacePath, entityRequest),
  discardStagedAttachment: (filePath) => ipcRenderer.invoke("files:discard-staged", filePath),
  openResource: (resource) => ipcRenderer.invoke("resource:open", resource),
  openMarkdownExternal: (resource) => ipcRenderer.invoke("markdown:open-external", resource),
  showNotification: (request) => ipcRenderer.invoke("app:notify", request),
  onPrepareClose: (callback) => {
    const handler = async (_event, request) => {
      let result;
      try {
        result = await callback(request);
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
      ipcRenderer.send("app:prepare-close-result", {
        requestId: request?.requestId,
        ...result
      });
    };
    ipcRenderer.on("app:prepare-close", handler);
    return () => ipcRenderer.removeListener("app:prepare-close", handler);
  },
  listDocumentLibrary: (request) => ipcRenderer.invoke("document-library:list", request),
  createDocumentLibraryEntry: (request) => ipcRenderer.invoke("document-library:create", request),
  readMarkdown: (request) => ipcRenderer.invoke("markdown:read", request),
  saveMarkdown: (request) => ipcRenderer.invoke("markdown:save", request),
  renameMarkdown: (request) => ipcRenderer.invoke("markdown:rename", request),
  resolveMarkdownImage: (request) => ipcRenderer.invoke("markdown:image-preview", request),
  saveMarkdownImage: (request) => ipcRenderer.invoke("markdown:image-save", request),
  copyMarkdown: (request) => ipcRenderer.invoke("markdown:copy", request),
  readPdf: (request) => ipcRenderer.invoke("pdf:read", request),
  loadState: (defaultState) => ipcRenderer.invoke("storage:load", defaultState),
  saveState: (state) => ipcRenderer.invoke("storage:save", state),
  saveStatePatch: (patch) => ipcRenderer.invoke("storage:save-patch", patch),
  createProjectWorkspace: (request) => ipcRenderer.invoke("workspace:create", request),
  openWorkspace: (workspacePath) => ipcRenderer.invoke("workspace:open", workspacePath),
  loadDomiCache: () => ipcRenderer.invoke("domi:cache"),
  checkDomi: () => ipcRenderer.invoke("domi:status"),
  getFeishuSetupStatus: (request) => ipcRenderer.invoke("domi:feishu-setup-status", request),
  startFeishuSetupAuth: () => ipcRenderer.invoke("domi:feishu-setup-start-auth"),
  completeFeishuSetupAuth: (request) => ipcRenderer.invoke("domi:feishu-setup-complete-auth", request),
  provisionFeishuSetup: () => ipcRenderer.invoke("domi:feishu-setup-provision"),
  syncDomi: () => ipcRenderer.invoke("domi:sync"),
  listDomiDatabase: () => ipcRenderer.invoke("domi:database-list"),
  updateDomiDatabaseRecord: (request) => ipcRenderer.invoke("domi:database-update", request),
  updateDomiDatabaseRecordPatch: (request) => ipcRenderer.invoke("domi:database-update-patch", request),
  previewDomiDatabaseRecord: (request) => ipcRenderer.invoke("domi:database-preview", request),
  deleteDomiDatabaseRecord: (request) => ipcRenderer.invoke("domi:database-delete", request),
  classifyDomiDatabaseProject: (request) => ipcRenderer.invoke("domi:database-classify", request),
  previewStorageMigration: () => ipcRenderer.invoke("domi:migration-preview"),
  listWeeklyNews: (request) => ipcRenderer.invoke("domi:weekly-news", request),
  saveWeeklyNewsCheckpoint: (request) => ipcRenderer.invoke("domi:weekly-news-checkpoint", request),
  listRadarSources: () => ipcRenderer.invoke("domi:radar-source-list"),
  saveRadarSource: (request) => ipcRenderer.invoke("domi:radar-source-save", request),
  deleteRadarSource: (request) => ipcRenderer.invoke("domi:radar-source-delete", request),
  syncRadarSources: (request) => ipcRenderer.invoke("domi:radar-source-sync", request),
  processPodcastEpisode: (request) => ipcRenderer.invoke("domi:podcast-process", request),
  listDomiTasks: (request) => ipcRenderer.invoke("domi:task-list", request),
  updateDomiTask: (request) => ipcRenderer.invoke("domi:task-update", request),
  loginPlaud: (request) => ipcRenderer.invoke("domi:plaud-login", request),
  checkPlaudConnection: (request) => ipcRenderer.invoke("domi:plaud-connection", request),
  disconnectPlaud: (request) => ipcRenderer.invoke("domi:plaud-disconnect", request),
  listPlaud: (request) => ipcRenderer.invoke("domi:plaud-list", request),
  syncPlaud: (request) => ipcRenderer.invoke("domi:plaud-sync", request),
  renamePlaud: (request) => ipcRenderer.invoke("domi:plaud-rename", request),
  deletePlaud: (request) => ipcRenderer.invoke("domi:plaud-delete", request),
  loadDomiEntityWorkspace: (request) => ipcRenderer.invoke("domi:entity-workspace", request),
  loadDomiEntityMaterials: (request) => ipcRenderer.invoke("domi:entity-materials", request),
  onCodexEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("codex:event", handler);
    return () => ipcRenderer.removeListener("codex:event", handler);
  },
  onUpdateStatus: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  }
});
