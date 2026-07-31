export {};

declare global {
  interface Window {
    workbench: {
      checkCodex: () => Promise<CodexCheckResult>;
      loadSettings: () => Promise<AppSettingsResult>;
      saveSettings: (request: AppSettingsSaveRequest) => Promise<AppSettingsSaveResult>;
      selectDirectory: (currentPath?: string) => Promise<DirectorySelectionResult>;
      installCodex: () => Promise<CodexInstallResult>;
      getCodexRuntimeStatus: () => Promise<CodexRuntimeStatus>;
      updateCodexRuntime: () => Promise<CodexRuntimeActionResult>;
      rollbackCodexRuntime: () => Promise<CodexRuntimeActionResult>;
      configureCodexRelay: (request: CodexRelayConfigureRequest) => Promise<CodexSetupResult>;
      testCodexConnection: () => Promise<CodexSetupResult>;
      startChatGPTLogin: () => Promise<ChatGPTLoginResult>;
      runDiagnostics: () => Promise<DiagnosticReport>;
      exportDiagnostics: (report: DiagnosticReport) => Promise<DiagnosticExportResult>;
      reportRendererIssue: (report: RendererIssueReport) => void;
      getUpdateStatus: () => Promise<UpdateStatus>;
      checkForUpdates: () => Promise<UpdateStatus>;
      downloadUpdate: () => Promise<UpdateStatus>;
      installUpdate: () => Promise<UpdateInstallResult>;
      runCodex: (payload: CodexRunRequest) => Promise<CodexRunResult>;
      stopCodex: (runId: string) => Promise<{ ok: boolean; error?: string }>;
      recoverCodexThread: (threadId: string) => Promise<CodexThreadRecoveryResult>;
      selectFiles: (workspacePath?: string) => Promise<FileSelectionResult>;
      getPathForFile: (file: File) => string;
      importFiles: (sourcePaths: string[], workspacePath?: string) => Promise<FileSelectionResult>;
      importFileData: (
        files: ClipboardAttachmentPayload[],
        workspacePath?: string
      ) => Promise<FileSelectionResult>;
      openResource: (resource: string) => Promise<{ ok: boolean; error?: string; target?: string }>;
      showNotification: (request: DesktopNotificationRequest) => Promise<DesktopNotificationResult>;
      listDocumentLibrary: (
        request?: DocumentLibraryListRequest
      ) => Promise<DocumentLibrarySnapshot>;
      createDocumentLibraryEntry: (
        request: DocumentLibraryCreateRequest
      ) => Promise<DocumentLibraryCreateResult>;
      readMarkdown: (request: MarkdownReadRequest) => Promise<MarkdownReadResult>;
      saveMarkdown: (request: MarkdownSaveRequest) => Promise<MarkdownSaveResult>;
      renameMarkdown: (request: MarkdownRenameRequest) => Promise<MarkdownRenameResult>;
      resolveMarkdownImage: (
        request: MarkdownImagePreviewRequest
      ) => Promise<MarkdownImagePreviewResult>;
      saveMarkdownImage: (request: MarkdownImageSaveRequest) => Promise<MarkdownImageSaveResult>;
      copyMarkdown: (request: MarkdownCopyRequest) => Promise<MarkdownCopyResult>;
      readPdf: (request: PdfReadRequest) => Promise<PdfReadResult>;
      loadState: (defaultState: unknown) => Promise<StateLoadResult>;
      saveState: (state: unknown) => Promise<StateSaveResult>;
      saveStatePatch: (patch: unknown) => Promise<StateSaveResult>;
      createProjectWorkspace: (request: ProjectWorkspaceRequest) => Promise<ProjectWorkspaceResult>;
      openWorkspace: (workspacePath?: string) => Promise<{ ok: boolean; error?: string; workspacePath: string }>;
      loadDomiCache: () => Promise<DomiSyncResult>;
      checkDomi: () => Promise<DomiStatusResult>;
      syncDomi: () => Promise<DomiSyncResult>;
      listDomiDatabase: () => Promise<DomiDatabaseSnapshot>;
      updateDomiDatabaseRecord: (
        request: DomiDatabaseUpdateRequest
      ) => Promise<DomiDatabaseUpdateResult>;
      previewDomiDatabaseRecord: (
        request: DomiDatabasePreviewRequest
      ) => Promise<DomiDatabasePreviewResult>;
      deleteDomiDatabaseRecord: (
        request: DomiDatabaseDeleteRequest
      ) => Promise<DomiDatabaseDeleteResult>;
      previewStorageMigration: () => Promise<StorageMigrationPreview>;
      listWeeklyNews: (request?: DomiWeeklyNewsRequest) => Promise<DomiWeeklyNewsSnapshot>;
      saveWeeklyNewsCheckpoint: (
        request: DomiWeeklyNewsCheckpointRequest
      ) => Promise<DomiWeeklyNewsCheckpointResult>;
      listDomiTasks: (request?: DomiTaskBoardRequest) => Promise<DomiTaskBoardSnapshot>;
      updateDomiTask: (request: DomiTaskUpdateRequest) => Promise<DomiTaskUpdateResult>;
      loginPlaud: (request: DomiPlaudConnectionRequest) => Promise<DomiPlaudConnectionResult>;
      checkPlaudConnection: (
        request?: DomiPlaudConnectionRequest
      ) => Promise<DomiPlaudConnectionResult>;
      disconnectPlaud: (
        request?: DomiPlaudConnectionRequest
      ) => Promise<DomiPlaudConnectionResult>;
      listPlaud: (request?: DomiPlaudListRequest) => Promise<DomiPlaudSnapshot>;
      syncPlaud: (request?: DomiPlaudSyncRequest) => Promise<DomiPlaudSyncResult>;
      renamePlaud: (request: DomiPlaudRenameRequest) => Promise<DomiPlaudRenameResult>;
      deletePlaud: (request: DomiPlaudDeleteRequest) => Promise<DomiPlaudDeleteResult>;
      loadDomiEntityMaterials: (request: DomiEntityMaterialsRequest) => Promise<DomiEntityMaterialsResult>;
      onCodexEvent: (callback: (payload: CodexEventPayload) => void) => () => void;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}

export type LocalAttachment = {
  name: string;
  path: string;
  size: number;
};

export type DesktopNotificationRequest = {
  title: string;
  body: string;
  silent?: boolean;
};

export type DesktopNotificationResult = {
  ok: boolean;
  error?: string;
};

export type FileSelectionResult = {
  ok: boolean;
  canceled: boolean;
  files: LocalAttachment[];
  error?: string;
};

export type DirectorySelectionResult = {
  ok: boolean;
  canceled: boolean;
  path: string;
  error?: string;
};

export type ClipboardAttachmentPayload = {
  name: string;
  type: string;
  data: ArrayBuffer;
};

export type MarkdownDocument = {
  path: string;
  name: string;
  content: string;
  size: number;
  mtimeMs: number;
};

export type DocumentLibraryNode = {
  kind: "folder" | "markdown" | "pdf";
  name: string;
  path: string;
  relativePath: string;
  size: number;
  mtimeMs: number;
  children?: DocumentLibraryNode[];
};

export type DocumentLibrarySnapshot = {
  ok: boolean;
  rootPath: string;
  rootName: string;
  nodes: DocumentLibraryNode[];
  documentCount: number;
  folderCount: number;
  truncated: boolean;
  structured?: boolean;
  scannedAt: number;
  error?: string;
};

export type DocumentLibraryListRequest = {
  force?: boolean;
};

export type DocumentLibraryCreateRequest = {
  parentPath?: string;
  kind: "folder" | "markdown";
  name: string;
};

export type DocumentLibraryCreateResult = {
  ok: boolean;
  kind?: "folder" | "markdown";
  path?: string;
  name?: string;
  snapshot?: DocumentLibrarySnapshot;
  error?: string;
};

export type MarkdownReadRequest = {
  resource: string;
  basePath?: string;
};

export type MarkdownReadResult = {
  ok: boolean;
  document?: MarkdownDocument;
  error?: string;
};

export type MarkdownSaveRequest = {
  path: string;
  content: string;
  expectedMtimeMs: number;
};

export type MarkdownSaveResult = {
  ok: boolean;
  document?: MarkdownDocument;
  conflict?: boolean;
  error?: string;
};

export type MarkdownRenameRequest = {
  path: string;
  name: string;
  expectedMtimeMs: number;
};

export type MarkdownRenameResult = {
  ok: boolean;
  document?: MarkdownDocument;
  conflict?: boolean;
  error?: string;
};

export type MarkdownImagePreviewRequest = {
  documentPath: string;
  source: string;
};

export type MarkdownImagePreviewResult = {
  ok: boolean;
  previewUrl?: string;
  error?: string;
};

export type MarkdownImageSaveRequest = {
  documentPath: string;
  name: string;
  type: string;
  data: ArrayBuffer;
};

export type MarkdownImageAsset = {
  path: string;
  name: string;
  relativePath: string;
  previewUrl: string;
  mimeType: string;
  size: number;
};

export type MarkdownImageSaveResult = {
  ok: boolean;
  asset?: MarkdownImageAsset;
  error?: string;
};

export type MarkdownCopyRequest = {
  documentPath: string;
  markdown: string;
};

export type MarkdownCopyResult = {
  ok: boolean;
  imageCount?: number;
  missingImageCount?: number;
  error?: string;
};

export type PdfDocument = {
  path: string;
  name: string;
  previewUrl: string;
  size: number;
  mtimeMs: number;
};

export type PdfReadRequest = {
  resource: string;
  basePath?: string;
};

export type PdfReadResult = {
  ok: boolean;
  document?: PdfDocument;
  error?: string;
};

export type StateLoadResult = {
  ok: boolean;
  state?: unknown;
  updatedAt?: number;
  isNew?: boolean;
  error?: string;
};

export type StateSaveResult = {
  ok: boolean;
  state?: unknown;
  updatedAt?: number;
  error?: string;
};

export type ProjectWorkspaceRequest = {
  projectId: string;
  projectName: string;
};

export type ProjectWorkspaceResult = {
  ok: boolean;
  workspacePath: string;
  error?: string;
};

export type DomiHealth = {
  plugin: {
    ok: boolean;
    version: string;
    displayName: string;
    root: string;
  };
  lark: {
    ok: boolean;
    disabled?: boolean;
    userName: string;
    appName: string;
    error?: string;
  };
  plaud: {
    ok: boolean;
    disabled?: boolean;
    queueCount: number;
    queueStages: Record<string, number>;
    error?: string;
  };
};

export type DomiProject = {
  recordId: string;
  name: string;
  domain: string;
  subdomains: string[];
  status: string;
  rating: string;
  notes?: string;
  cities?: string[];
  investors?: string[];
  financingHistory?: string;
  latestValuationUsd100m?: number | null;
  createdAt: number | null;
  lastFollowup: number | null;
  updatedAt?: number;
  link: string;
};

export type DomiPerson = {
  recordId: string;
  name: string;
  types: string[];
  organization: string;
  status: string;
  rating: string;
  createdAt: number | null;
  lastContact: number | null;
  cities: string[];
  updatedAt?: number;
  link: string;
};

export type DomiSnapshot = {
  version: 1;
  backend?: "feishu" | "local";
  syncedAt: number;
  health: DomiHealth;
  sources: {
    projects: {
      name: string;
      total: number;
      localLibraryDir: string;
      localDatabasePath?: string;
    };
    people: {
      name: string;
      total: number;
    };
  };
  projects: DomiProject[];
  people: DomiPerson[];
};

export type DomiSyncResult = {
  ok: boolean;
  snapshot?: DomiSnapshot;
  updatedAt?: number;
  error?: string;
  stale?: boolean;
};

export type StorageMigrationProject = {
  projectId: string;
  name: string;
  domain: string;
  subdomains: string[];
  documentCount: number;
};

export type StorageMigrationPreview = {
  ok: boolean;
  projectCount?: number;
  peopleCount?: number;
  newsCount?: number;
  documentCount?: number;
  projects?: StorageMigrationProject[];
  error?: string;
};

export type StorageMigrationFailure = {
  kind: "project" | "person" | "news";
  id: string;
  name: string;
  error: string;
};

export type StorageMigrationResult = {
  ok: boolean;
  projectCount: number;
  migratedProjectCount: number;
  peopleCount: number;
  migratedPeopleCount: number;
  newsCount: number;
  migratedNewsCount: number;
  documentCount: number;
  assetCount: number;
  failed: StorageMigrationFailure[];
  error?: string;
};

export type DomiStatusResult = {
  ok: boolean;
  health?: DomiHealth;
  error?: string;
};

export type DomiWeeklyNewsRequest = {
  days?: number;
  limit?: number;
  page?: number;
  cacheOnly?: boolean;
};

export type DomiWeeklyNewsCheckpointRequest = {
  checkedThrough: number;
};

export type DomiWeeklyNewsCheckpointResult = {
  ok: boolean;
  radarCheckedThrough?: number;
  error?: string;
};

export type DomiNewsItem = {
  recordId: string;
  title: string;
  domains: string[];
  subdomains: string[];
  types: string[];
  publishedAt: number | null;
  summary: string;
  investmentMeaning: string;
  url: string;
  source: string;
  companies: string;
  institutions: string;
  importance: number;
  confidence: number;
  evidenceStatus: string;
  action: string;
  worthFollowing?: boolean;
  updatedAt?: number;
};

export type DomiDatabaseSnapshot = {
  ok: boolean;
  backend?: "feishu" | "local";
  editable?: boolean;
  loadedAt?: number;
  projects: DomiProject[];
  people: DomiPerson[];
  news: DomiNewsItem[];
  error?: string;
};

export type DomiProjectDatabaseUpdate = {
  recordId: string;
  expectedUpdatedAt: number;
  name: string;
  domain: string;
  subdomains: string[];
  status: string;
  rating: string;
  notes: string;
  cities: string[];
  investors: string[];
  financingHistory: string;
  latestValuationUsd100m: number | null;
};

export type DomiPersonDatabaseUpdate = {
  recordId: string;
  expectedUpdatedAt: number;
  name: string;
  types: string[];
  organization: string;
  status: string;
  rating: string;
  lastContact: number | null;
  cities: string[];
};

export type DomiNewsDatabaseUpdate = {
  recordId: string;
  expectedUpdatedAt: number;
  title: string;
  domains: string[];
  subdomains: string[];
  types: string[];
  publishedAt: number;
  summary: string;
  investmentMeaning: string;
  url: string;
  source: string;
  companies: string;
  institutions: string;
  importance: number;
  confidence: number;
  evidenceStatus: string;
  action: string;
  worthFollowing: boolean;
};

export type DomiDatabaseUpdateRequest =
  | { entityType: "project"; record: DomiProjectDatabaseUpdate }
  | { entityType: "person"; record: DomiPersonDatabaseUpdate }
  | { entityType: "news"; record: DomiNewsDatabaseUpdate };

export type DomiDatabaseUpdateResult = {
  ok: boolean;
  entityType?: "project" | "person" | "news";
  record?: DomiProject | DomiPerson | DomiNewsItem;
  snapshot?: DomiSnapshot;
  updatedAt?: number;
  error?: string;
};

export type DomiDatabasePreviewRequest = {
  entityType: "project" | "person";
  recordId: string;
};

export type DomiDatabasePreviewResult = {
  ok: boolean;
  entityType?: "project" | "person";
  recordId?: string;
  title?: string;
  resource?: string;
  error?: string;
};

export type DomiDatabaseDeleteRequest = {
  entityType: "project" | "person" | "news";
  recordId: string;
  expectedUpdatedAt: number;
};

export type DomiDatabaseDeleteResult = {
  ok: boolean;
  entityType?: "project" | "person" | "news";
  recordId?: string;
  title?: string;
  filesPreserved?: boolean;
  snapshot?: DomiSnapshot;
  updatedAt?: number;
  error?: string;
};

export type DomiWeeklyNewsSnapshot = {
  ok: boolean;
  syncedAt?: number;
  checkedAt?: number;
  contentUpdatedAt?: number;
  radarCheckedThrough?: number;
  contentChanged?: boolean;
  rangeStart?: number;
  rangeEnd?: number;
  page?: number;
  total?: number;
  hasMore?: boolean;
  hasNewer?: boolean;
  hasOlder?: boolean;
  sourceUrl?: string;
  items?: DomiNewsItem[];
  fromCache?: boolean;
  cachedAt?: number;
  cacheMiss?: boolean;
  error?: string;
};

export type DomiTaskStatus = "open" | "in_progress" | "done" | "ignored";
export type DomiTaskPriority = "P1" | "P2" | "P3";
export type DomiTaskCategory =
  | "key-milestone"
  | "new-entry"
  | "relationship-follow-up"
  | "project-follow-up";

export type DomiTask = {
  id: string;
  title: string;
  summary: string;
  reason: string;
  priority: DomiTaskPriority;
  category: DomiTaskCategory;
  status: DomiTaskStatus;
  signalKey: string;
  source: {
    kind: "project" | "person" | "news" | "manual";
    recordId: string;
    displayName: string;
  };
  dueAt: string | null;
  suggestedAction: {
    kind: "schedule" | "research" | "contact" | "review" | "custom";
    label: string;
    prompt: string;
  };
  createdAt: string;
  updatedAt: string;
  ignoredAt?: string | null;
  completedAt?: string | null;
};

export type DomiTaskBoardRequest = {
  cacheOnly?: boolean;
  fresh?: boolean;
};

export type DomiTaskBoardSnapshot = {
  ok: boolean;
  configured: boolean;
  stale: boolean;
  syncedAt: number;
  updatedAt: string | null;
  tasks: DomiTask[];
  error?: string;
};

export type DomiTaskUpdateRequest = {
  taskId: string;
  status: DomiTaskStatus;
};

export type DomiTaskUpdateResult = {
  ok: boolean;
  task?: DomiTask;
  snapshot?: DomiTaskBoardSnapshot;
  error?: string;
};

export type DomiPlaudItem = {
  fileId: string;
  fileName: string;
  duration: number | null;
  createdAt: number | null;
  editedAt: number | null;
  hasTranscript: boolean;
  hasSummary: boolean;
  processing: boolean;
  queueStage: string;
  transcriptPath: string;
  error: string;
};

export type DomiPlaudConnectionRequest = {
  browser?: "chrome" | "tabbit";
};

export type DomiPlaudConnectionResult = {
  ok: boolean;
  connected?: boolean;
  browser?: "chrome" | "tabbit";
  browserLabel?: string;
  accountFingerprint?: string;
  status?:
    | "connected"
    | "auth_required"
    | "profile_locked"
    | "browser_unavailable"
    | "runtime_unavailable"
    | "network_error"
    | "service_changed"
    | "unknown";
  checkedAt?: number;
  error?: string;
};

export type DomiPlaudListRequest = {
  fresh?: boolean;
  offset?: number;
  limit?: number;
};

export type DomiPlaudSnapshot = {
  ok: boolean;
  stale?: boolean;
  syncedAt?: number;
  lastSuccessfulAt?: number;
  pendingCount?: number;
  queueCount?: number;
  pageOffset?: number;
  pageSize?: number;
  hasMore?: boolean;
  nextOffset?: number;
  items?: DomiPlaudItem[];
  warning?: string;
  error?: string;
};

export type DomiPlaudSyncRequest = {
  confirmed?: boolean;
};

export type DomiPlaudSyncResult = {
  ok: boolean;
  requiresConfirmation?: boolean;
  pendingCount?: number;
  generatedCount?: number;
  recoveredCount?: number;
  failedCount?: number;
  manifestPath?: string;
  snapshot?: DomiPlaudSnapshot;
  error?: string;
};

export type DomiPlaudRenameRequest = {
  fileId: string;
  fileName: string;
};

export type DomiPlaudRenameResult = {
  ok: boolean;
  fileId?: string;
  fileName?: string;
  error?: string;
};

export type DomiPlaudDeleteRequest = {
  fileId: string;
};

export type DomiPlaudDeleteResult = {
  ok: boolean;
  fileId?: string;
  trashed?: boolean;
  error?: string;
};

export type DomiEntityMaterial = {
  name: string;
  path: string;
  relativePath: string;
  kind: string;
  size: number;
  mtimeMs: number;
};

export type DomiEntityMaterials = {
  entityType: "project" | "person";
  recordId: string;
  searchRoot: string;
  files: DomiEntityMaterial[];
  generatedAt: number;
};

export type DomiEntityMaterialsRequest = {
  entityType: "project" | "person";
  recordId: string;
};

export type DomiEntityMaterialsResult = {
  ok: boolean;
  materials?: DomiEntityMaterials;
  error?: string;
};

export type CodexCheckResult = {
  ok: boolean;
  path: string;
  version: string;
  transport: "app-server" | "browser";
  workspacePath: string;
  account: CodexAccount | null;
  authMode: "chatgpt" | "relay";
  providerLabel: string;
  apiBaseUrl: string;
  credentialStored: boolean;
  requiresOpenaiAuth: boolean;
  configuredModel: string;
  configuredReasoningEffort: string;
  configuredServiceTier: string;
  pluginSetup?: {
    ok: boolean;
    updated?: boolean;
    skipped?: boolean;
    pluginId?: string;
    version?: string;
    bundledVersion?: string;
    gitCommit?: string;
    error?: string;
  } | null;
  models: CodexModel[];
  error?: string;
};

export type AppSettings = {
  version: 7;
  onboardingComplete: boolean;
  authMode: "chatgpt" | "relay";
  apiBaseUrl: string;
  apiModel: string;
  relayCredentialConfigured: boolean;
  codexPath: string;
  plaudConnectionMode: "unconfigured" | "enabled" | "disabled";
  plaudBrowser: "chrome" | "tabbit";
  storageBackend: "feishu" | "local";
  projectBaseToken: string;
  projectTableId: string;
  peopleBaseToken: string;
  peopleTableId: string;
  radarBaseToken: string;
  radarTableId: string;
  wikiSpaceId: string;
  taskDocumentUrl: string;
  outlookCalendarEmail: string;
  outlookCalendarEmailVerifiedAt: number;
  outlookCalendarRecipients: string;
  outlookCalendarTimezone: string;
  localLibraryDir: string;
  localRepositoryDir: string;
  localDatabasePath: string;
  externalAccessMode: "always" | "ask";
  updateChannel: "stable" | "beta";
};

export type AppSettingsResult = {
  ok: boolean;
  settings?: AppSettings;
  hasApiKey?: boolean;
  secureStorageAvailable?: boolean;
  updatedAt?: number;
  error?: string;
};

export type AppSettingsSaveRequest = Partial<AppSettings> & {
  apiKey?: string;
  clearApiKey?: boolean;
  storageMigration?: "none" | "local-to-feishu";
};

export type AppSettingsSaveResult = AppSettingsResult & {
  codex?: CodexCheckResult;
  migration?: StorageMigrationResult;
};

export type CodexInstallResult = {
  ok: boolean;
  installed: boolean;
  installedNow?: boolean;
  path: string;
  version: string;
  credentialStored: boolean;
  error?: string;
};

export type CodexRuntimeStatus = {
  ok: boolean;
  managed: boolean;
  path: string;
  version: string;
  bundledVersion: string;
  currentTarget?: string;
  rollbackAvailable: boolean;
  rollbackVersion: string;
  error?: string;
};

export type CodexRuntimeActionResult = Partial<CodexInstallResult> & CodexRuntimeStatus & {
  runtime?: CodexRuntimeStatus;
  pausedBackgroundRuns?: number;
};

export type CodexRelayConfigureRequest = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  keepExistingKey?: boolean;
};

export type CodexConnectionVerification = {
  ok: boolean;
  modelOk: boolean;
  toolOk: boolean;
  detail?: string;
  error?: string;
};

export type CodexSetupResult = {
  ok: boolean;
  configured?: boolean;
  codex?: CodexCheckResult;
  verification?: CodexConnectionVerification;
  pausedBackgroundRuns?: number;
  error?: string;
};

export type UpdateState =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "up-to-date"
  | "downloading"
  | "downloaded"
  | "error";

export type UpdateStatus = {
  state: UpdateState;
  supported: boolean;
  currentVersion: string;
  availableVersion: string;
  channel: "stable" | "beta";
  percent: number;
  transferred: number;
  total: number;
  releaseDate: string;
  error: string;
};

export type UpdateInstallResult = {
  ok: boolean;
  status: UpdateStatus;
  error?: string;
};

export type ChatGPTLoginResult = {
  ok: boolean;
  loginId?: string;
  authUrlOpened?: boolean;
  error?: string;
};

export type DiagnosticCheck = {
  id: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type DiagnosticReport = {
  ok: boolean;
  generatedAt: number;
  durationMs: number;
  app: { name: string; version: string; packaged: boolean };
  system: { platform: string; arch: string; release: string };
  connection: {
    authMode: "chatgpt" | "api";
    providerLabel: string;
    apiBaseUrl: string;
    credentialStored: boolean;
  };
  checks: DiagnosticCheck[];
};

export type DiagnosticExportResult = {
  ok: boolean;
  canceled?: boolean;
  path?: string;
  error?: string;
};

export type RendererIssueReport = {
  kind:
    | "error"
    | "unhandled-rejection"
    | "react-boundary"
    | "section-boundary"
    | "document-operation"
    | "markdown-editor-boundary"
    | "markdown-editor-operation"
    | "workflow-metric";
  message: string;
  stack?: string;
  source?: string;
  line?: number;
  column?: number;
};

export type CodexAccount = {
  type: string;
  email?: string;
  planType?: string;
};

export type CodexModel = {
  id: string;
  name: string;
  description: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: Array<{
    id: string;
    description: string;
  }>;
  serviceTiers: Array<{
    id: string;
    name: string;
    description: string;
  }>;
};

export type CodexRunRequest = {
  runId: string;
  prompt: string;
  requestText?: string;
  threadId?: string;
  ephemeral?: boolean;
  background?: boolean;
  workflowId?: string;
  webSearch?: boolean;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  workspacePath?: string;
  privateOutput?: boolean;
};

export type CodexRunResult = {
  ok: boolean;
  runId: string;
  code?: number;
  signal?: string;
  stopped?: boolean;
  threadId?: string;
  turnId?: string;
  output: string;
  outputPath?: string;
  error?: string;
  workspacePath: string;
  eventCount?: number;
};

export type CodexThreadRecoveryResult = {
  ok: boolean;
  runId?: string;
  threadId: string;
  turnId?: string;
  status: "running" | "completed" | "stopped" | "failed" | "unknown";
  output?: string;
  error?: string;
};

export type CodexEventPayload = {
  runId: string;
  type:
    | "thread"
    | "started"
    | "compatibility"
    | "assistant-delta"
    | "usage"
    | "json"
    | "stdout"
    | "stderr"
    | "error"
    | "completed"
    | "stopped"
    | "failed";
  threadId?: string;
  turnId?: string;
  summary?: string;
  text?: string;
  error?: string;
  code?: number;
  signal?: string;
  output?: string;
  outputPath?: string;
  stderr?: string;
  eventCount?: number;
  event?: {
    type: string;
    item?: CodexThreadItem;
    usage?: CodexUsage;
    error?: { message: string };
  };
  item?: CodexEventItem;
  usage?: CodexUsage;
};

export type CodexUsage = {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_output_tokens: number;
};

export type CodexThreadItem = {
  id?: string;
  type: string;
  text?: string;
  command?: string;
  aggregatedOutput?: string;
  aggregated_output?: string;
  status?: string;
  exitCode?: number;
  exit_code?: number;
  message?: string;
  query?: string;
};

export type CodexEventItem = {
  kind: "assistant" | "reasoning" | "command" | "file" | "tool" | "search" | "todo" | "error";
  text: string;
  detail?: string;
  status?: string;
  exitCode?: number;
};
