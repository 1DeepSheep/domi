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
      testCodexConnection: (request?: CodexConnectionTestRequest) => Promise<CodexSetupResult>;
      cancelCodexConnectionTest: (
        request: CodexConnectionTestRequest
      ) => Promise<CodexConnectionTestCancelResult>;
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
      recoverCodexThread: (
        threadId: string,
        request?: CodexThreadRecoveryRequest
      ) => Promise<CodexThreadRecoveryResult>;
      bindCodexRun: (runId: string) => Promise<{ ok: boolean; error?: string }>;
      answerCodexUserInput: (
        request: CodexUserInputAnswerRequest
      ) => Promise<CodexUserInputAnswerResult>;
      listSkillHub: () => Promise<SkillHubListResult>;
      scanSkillHub: () => Promise<SkillHubScanResult>;
      importSkillHub: (request: SkillHubImportRequest) => Promise<SkillHubImportResult>;
      manageSkillHub: (request: { id: string; action: "fork" | "enable" | "details"; enabled?: boolean }) => Promise<{
        ok: boolean; error?: string; skills?: SkillHubUserSkill[]; imported?: SkillHubUserSkill[];
        skill?: SkillHubUserSkill; changes?: string[]; baselineAvailable?: boolean; upstreamVersion?: string;
        failures?: SkillHubImportFailure[]; activation?: string;
      }>;
      selectFiles: (
        workspacePath?: string,
        entityRequest?: DomiEntityMaterialsRequest
      ) => Promise<FileSelectionResult>;
      getPathForFile: (file: File) => string;
      importFiles: (
        sourcePaths: string[],
        workspacePath?: string,
        entityRequest?: DomiEntityMaterialsRequest
      ) => Promise<FileSelectionResult>;
      importFileData: (
        files: ClipboardAttachmentPayload[],
        workspacePath?: string,
        entityRequest?: DomiEntityMaterialsRequest
      ) => Promise<FileSelectionResult>;
      discardStagedAttachment: (filePath: string) => Promise<{
        ok: boolean;
        removed: boolean;
        error?: string;
      }>;
      openResource: (resource: string) => Promise<{ ok: boolean; error?: string; target?: string }>;
      openMarkdownExternal: (resource: string) => Promise<{
        ok: boolean;
        error?: string;
        target?: string;
        application?: string;
      }>;
      showNotification: (request: DesktopNotificationRequest) => Promise<DesktopNotificationResult>;
      onNotificationClicked: (callback: (target: DesktopNotificationTarget) => void) => () => void;
      consumePendingNotification: () => Promise<DesktopNotificationTarget | null>;
      setUnreadTaskCount: (count: number) => Promise<{ ok: boolean; error?: string }>;
      onPrepareClose?: (
        callback: (request: AppPrepareCloseRequest) => Promise<AppPrepareCloseResult>
      ) => () => void;
      listDocumentLibrary: (
        request?: DocumentLibraryListRequest
      ) => Promise<DocumentLibrarySnapshot>;
      searchDocumentLibrary: (
        request: DocumentLibrarySearchRequest
      ) => Promise<DocumentLibrarySearchResult>;
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
      getFeishuSetupStatus: (request?: { force?: boolean }) => Promise<FeishuSetupStatus>;
      startFeishuSetupAuth: () => Promise<FeishuSetupAuthStartResult>;
      completeFeishuSetupAuth: (
        request: FeishuSetupAuthCompleteRequest
      ) => Promise<FeishuSetupStatus>;
      provisionFeishuSetup: () => Promise<FeishuSetupProvisionResult>;
      syncDomi: () => Promise<DomiSyncResult>;
      listDomiDatabase: (request?: { fresh?: boolean }) => Promise<DomiDatabaseSnapshot>;
      updateDomiDatabaseRecord: (
        request: DomiDatabaseUpdateRequest
      ) => Promise<DomiDatabaseUpdateResult>;
      updateDomiDatabaseRecordPatch: (
        request: DomiDatabasePatchRequest
      ) => Promise<DomiDatabaseUpdateResult>;
      previewDomiDatabaseRecord: (
        request: DomiDatabasePreviewRequest
      ) => Promise<DomiDatabasePreviewResult>;
      deleteDomiDatabaseRecord: (
        request: DomiDatabaseDeleteRequest
      ) => Promise<DomiDatabaseDeleteResult>;
      classifyDomiDatabaseProject: (
        request: DomiClassificationActionRequest
      ) => Promise<DomiClassificationActionResult>;
      previewStorageMigration: () => Promise<StorageMigrationPreview>;
      listWeeklyNews: (request?: DomiWeeklyNewsRequest) => Promise<DomiWeeklyNewsSnapshot>;
      saveWeeklyNewsCheckpoint: (
        request: DomiWeeklyNewsCheckpointRequest
      ) => Promise<DomiWeeklyNewsCheckpointResult>;
      listRadarSources: () => Promise<RadarSourceSnapshot>;
      saveRadarSource: (request: RadarSourceSaveRequest) => Promise<RadarSourceMutationResult>;
      bulkImportRadarSources: (
        request: RadarSourceBulkImportRequest
      ) => Promise<RadarSourceBulkImportResult>;
      deleteRadarSource: (request: { sourceId: string }) => Promise<RadarSourceMutationResult>;
      syncRadarSources: (request?: RadarSourceSyncRequest) => Promise<RadarSourceSyncResult>;
      processPodcastEpisode: (request: PodcastProcessRequest) => Promise<PodcastProcessResult>;
      updatePodcastProgress: (request: PodcastProgressRequest) => Promise<PodcastProgressResult>;
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
      syncPlaud: () => Promise<DomiPlaudSyncResult>;
      resumePlaudTranscripts: () => Promise<DomiPlaudSyncResult>;
      renamePlaud: (request: DomiPlaudRenameRequest) => Promise<DomiPlaudRenameResult>;
      deletePlaud: (request: DomiPlaudDeleteRequest) => Promise<DomiPlaudDeleteResult>;
      loadDomiEntityWorkspace: (
        request: DomiEntityMaterialsRequest
      ) => Promise<DomiEntityWorkspaceResult>;
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

export type SkillHubUserSkill = {
  producesSlides?: boolean;
  id: string;
  name: string;
  title: string;
  description: string;
  path: string;
  sourcePath: string;
  fingerprint: string;
  metadataFingerprint?: string;
  available?: boolean;
  error?: string;
  importedAt: number;
  enabled?: boolean;
  independentCopy?: boolean;
  sourceName?: string;
  sourceVersion?: string;
};

export type SkillHubOfficialSkill = {
  id: string; name: string; title: string; description: string; path: string; version: string;
  integrity?: "matches-bundled" | "modified" | "unverified";
  error?: string;
};

export type SkillHubCandidate = {
  id: string;
  name: string;
  title: string;
  description: string;
  sourcePath: string;
  sourceLabel: string;
  status: "available" | "imported" | "unavailable";
  error?: string;
  suggestedName: string;
  officialNameConflict: boolean;
  nameCollision: boolean;
  sourceIsDestination: boolean;
};

export type SkillHubListResult = {
  ok: boolean;
  skills: SkillHubUserSkill[];
  changed?: boolean;
  activation?: "next-task" | "after-current-tasks" | "unchanged";
  updatedAt: number;
  error?: string;
};

export type SkillHubScanResult = {
  official?: SkillHubOfficialSkill[];
  ok: boolean;
  changed?: boolean;
  activation?: "next-task" | "after-current-tasks" | "unchanged";
  candidates: SkillHubCandidate[];
  imported: SkillHubUserSkill[];
  scannedAt: number;
  error?: string;
};

export type SkillHubImportRequest = {
  candidateIds: string[];
};

export type SkillHubImportFailure = {
  id: string;
  title: string;
  error: string;
};

export type SkillHubImportResult = {
  ok: boolean;
  changed?: boolean;
  imported: SkillHubUserSkill[];
  skills?: SkillHubUserSkill[];
  failures?: SkillHubImportFailure[];
  activation?: "next-task" | "after-current-tasks" | "unchanged";
  error?: string;
};

export type DesktopNotificationRequest = {
  title: string;
  body: string;
  silent?: boolean;
  threadId?: string;
  notificationId?: string;
};

export type DesktopNotificationTarget = {
  threadId: string;
  notificationId?: string;
};

export type DesktopNotificationResult = {
  ok: boolean;
  error?: string;
  deduplicated?: boolean;
};

export type AppPrepareCloseRequest = {
  requestId: string;
  reason: "window-close" | "app-quit";
  runningTaskCount: number;
};

export type AppPrepareCloseResult = {
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

export type DocumentLibrarySearchRequest = {
  query: string;
  limit?: number;
  includeTranscripts?: boolean;
};

export type DocumentLibrarySearchMatch = {
  path: string;
  name: string;
  relativePath: string;
  kind: "markdown" | "pdf";
  size: number;
  mtimeMs: number;
  snippet: string;
  line?: number;
};

export type DocumentLibrarySearchResult = {
  ok: boolean;
  results: DocumentLibrarySearchMatch[];
  indexing: boolean;
  indexedCount: number;
  lastIndexedAt: number;
  error?: string;
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
  documents: Array<{
    title: string;
    link: string;
    kind: string;
    updatedAt: number;
  }>;
  interactionDocuments: Array<{
    title: string;
    link: string;
    kind: string;
    updatedAt: number;
  }>;
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
      needsNameReview?: number;
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

export type FeishuSetupResourceNames = {
  baseName: string;
  wikiName: string;
  projectTableName: string;
  peopleTableName: string;
  radarTableName: string;
};

export type FeishuSetupStatus = {
  ok: boolean;
  connected: boolean;
  configured: boolean;
  cliAvailable: boolean;
  userName: string;
  tokenStatus?: string;
  resources?: FeishuSetupResourceNames;
  error?: string;
};

export type FeishuSetupAuthStartResult = {
  ok: boolean;
  flow?: "configuration" | "authorization";
  verificationUrl?: string;
  verificationOpened?: boolean;
  userCode?: string;
  deviceCode?: string;
  expiresAt?: number;
  error?: string;
};

export type FeishuSetupAuthCompleteRequest = {
  deviceCode: string;
};

export type FeishuSetupMapping = {
  projectBaseToken: string;
  projectTableId: string;
  peopleBaseToken: string;
  peopleTableId: string;
  radarBaseToken: string;
  radarTableId: string;
  wikiSpaceId: string;
};

export type FeishuSetupProvisionResult = {
  ok: boolean;
  mapping?: FeishuSetupMapping;
  resources?: {
    base: { name: string; created: boolean };
    tables: {
      project: { name: string; created: boolean };
      people: { name: string; created: boolean };
      radar: { name: string; created: boolean };
    };
    wiki: { name: string; created: boolean };
  };
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
  domains?: string[];
};

export type DomiWeeklyNewsCheckpointResult = {
  ok: boolean;
  radarCheckedThrough?: number;
  radarCheckedThroughByDomain?: Record<string, number>;
  error?: string;
};

export type RadarSourceKind = "news" | "wechat" | "podcast";
export type RadarSourcePriority = "normal" | "important";

export type RadarSource = {
  id: string;
  kind: RadarSourceKind;
  name: string;
  url: string;
  enabled: boolean;
  priority: RadarSourcePriority;
  keywords: string[];
  autoProcess: boolean;
  createdAt: number;
  updatedAt: number;
  lastCheckedAt: number;
  lastSuccessAt: number;
  error: string;
};

export type RadarSourceSaveRequest = {
  id?: string;
  kind: RadarSourceKind;
  name: string;
  url?: string;
  enabled?: boolean;
  priority?: RadarSourcePriority;
  keywords?: string[] | string;
  autoProcess?: boolean;
};

export type RadarSourceBulkImportRequest = {
  kind: "wechat";
  text: string;
  fileName?: string;
  previewOnly?: boolean;
  enabled?: boolean;
  priority?: RadarSourcePriority;
  keywords?: string[] | string;
};

export type RadarSourceBulkImportItem = {
  row: number;
  name: string;
  status: "new" | "duplicate" | "existing" | "invalid";
  source?: RadarSourceSaveRequest;
  duplicateOfRow?: number;
  existingSourceId?: string;
  error?: string;
};

export type RadarSourceBulkImportStats = {
  totalRows: number;
  validCount: number;
  duplicateCount: number;
  invalidCount: number;
  blankCount: number;
  existingCount: number;
  importableCount: number;
  importedCount: number;
};

export type RadarSourceBulkImportResult = {
  ok: boolean;
  previewOnly: boolean;
  format: "list" | "csv" | "tsv";
  stats: RadarSourceBulkImportStats;
  items: RadarSourceBulkImportItem[];
  previewTruncated: boolean;
  added?: RadarSource[];
  sources?: RadarSource[];
  updatedAt?: number;
  error?: string;
};

export type PodcastJobStatus =
  | "discovered"
  | "downloading"
  | "downloaded"
  | "transcribing"
  | "transcript_ready"
  | "failed"
  | "skipped";

export type PodcastJob = {
  id: string;
  sourceId: string;
  title: string;
  description: string;
  publishedAt: number | null;
  durationSec: number | null;
  episodeUrl: string;
  mediaUrl: string;
  podcastTitle: string;
  sourceFormat: string;
  status: PodcastJobStatus;
  localAudioPath: string;
  transcriptPath: string;
  plaudFileId: string;
  discoveredAt: number;
  updatedAt: number;
  error: string;
  archive?: PodcastArchiveProgress;
};

export type PodcastArchiveProgress = {
  status: "pending" | "running" | "notes_ready" | "archived" | "failed";
  runId: string;
  stage: "transcript_ready" | "notes_ready" | "archived";
  attempt: number;
  nextRetryAt: number;
  manifestPath: string;
  notesPath: string;
  qaReceiptPath: string;
  archiveReceiptPath: string;
  verifiedAt: number;
  error?: string;
};

export type PodcastProgressRequest = {
  jobId: string;
  action: "claim" | "checkpoint" | "complete" | "fail";
  runId?: string;
  stage?: "notes_ready" | "archived";
  receiptPath?: string;
  notesPath?: string;
  qaReceiptPath?: string;
  artifactHash?: string;
  error?: string;
};

export type PodcastProgressResult = {
  ok: boolean;
  job?: PodcastJob;
  claimed?: boolean;
  verified?: boolean;
  unsupported?: boolean;
  error?: string;
};

export type RadarNewsDiscovery = {
  schema: "domi.news-discovery.v1";
  sources: Array<{
    sourceId: string; name: string; url: string;
    status: "fetched" | "unchanged" | "requires_search" | "failed";
    checkedAt: number; totalCount: number; omittedCount: number; error?: string;
    candidates: Array<{ id: string; title: string; url: string; publishedAt: number | null; summary: string }>;
  }>;
};

export type RadarSourceSnapshot = {
  ok: boolean;
  sources: RadarSource[];
  jobs: PodcastJob[];
  updatedAt: number;
  error?: string;
  discovery?: RadarNewsDiscovery;
};

export type RadarSourceMutationResult = {
  ok: boolean;
  source?: RadarSource;
  sourceId?: string;
  deleted?: boolean;
  sources?: RadarSource[];
  jobs?: PodcastJob[];
  updatedAt?: number;
  error?: string;
};

export type RadarSourceSyncRequest = {
  sourceId?: string;
  limit?: number;
  fresh?: boolean;
  kind?: "news" | "podcast";
};

export type RadarSourceSyncItem = {
  sourceId: string;
  ok: boolean;
  discoveredCount: number;
  totalCount?: number;
  error?: string;
};

export type RadarSourceSyncResult = {
  ok: boolean;
  partial?: boolean;
  sources: RadarSource[];
  jobs: PodcastJob[];
  results: RadarSourceSyncItem[];
  updatedAt: number;
  error?: string;
  discovery?: RadarNewsDiscovery;
};

export type PodcastProcessRequest = {
  jobId: string;
  timeoutSec?: number;
  pollSec?: number;
  downloadTimeoutMs?: number;
  maxBytes?: number;
  keepAudio?: boolean;
};

export type PodcastProcessResult = {
  ok: boolean;
  reused?: boolean;
  job?: PodcastJob;
  transcriptPath?: string;
  plaudFileId?: string;
  audioRemoved?: boolean;
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
  taxonomy?: DomiProjectTaxonomy;
  classificationReviews?: DomiClassificationReview[];
  error?: string;
};

export type DomiProjectTaxonomy = {
  domains: Array<{
    name: string;
    subdomains: string[];
  }>;
  customSubdomains: Array<{
    id: string;
    parentDomain: string;
    name: string;
    source: "user" | string;
    createdAt: number;
    updatedAt: number;
  }>;
};

export type DomiClassificationEvidence = {
  title: string;
  resource: string;
  relativePath: string;
  role: "project" | "comparable" | "industry";
  snippet: string;
  updatedAt: number;
  canonical: boolean;
};

export type DomiClassificationReview = {
  project: DomiProject;
  status: "pending" | "deferred" | "confirmed";
  suggestedDomain: string;
  suggestedSubdomains: string[];
  confidence: number;
  reason: string;
  deferredAt: number | null;
  updatedAt: number;
  evidence: DomiClassificationEvidence[];
};

export type DomiClassificationActionRequest = {
  action: "apply" | "defer" | "undo";
  recordId: string;
  expectedUpdatedAt: number;
  domain?: string;
  subdomains?: string[];
  createSubdomainName?: string;
  createSubdomainParentDomain?: string;
};

export type DomiClassificationActionResult = {
  ok: boolean;
  action?: "apply" | "defer" | "undo";
  recordId?: string;
  record?: DomiProject;
  taxonomy?: DomiProjectTaxonomy;
  updatedAt?: number;
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

export type DomiDatabasePatchRequest =
  | {
      entityType: "project";
      recordId: string;
      expectedUpdatedAt: number;
      mutationId: string;
      changes: Partial<Omit<DomiProjectDatabaseUpdate, "recordId" | "expectedUpdatedAt">>;
    }
  | {
      entityType: "person";
      recordId: string;
      expectedUpdatedAt: number;
      mutationId: string;
      changes: Partial<Omit<DomiPersonDatabaseUpdate, "recordId" | "expectedUpdatedAt">>;
    }
  | {
      entityType: "news";
      recordId: string;
      expectedUpdatedAt: number;
      mutationId: string;
      changes: Partial<Omit<DomiNewsDatabaseUpdate, "recordId" | "expectedUpdatedAt">>;
    };

export type DomiDatabaseUpdateResult = {
  ok: boolean;
  entityType?: "project" | "person" | "news";
  record?: DomiProject | DomiPerson | DomiNewsItem;
  snapshot?: DomiSnapshot;
  updatedAt?: number;
  mutationId?: string;
  replayed?: boolean;
  materialization?: "pending" | "complete";
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
  stale?: boolean;
  syncedAt?: number;
  checkedAt?: number;
  contentUpdatedAt?: number;
  radarCheckedThrough?: number;
  radarCheckedThroughByDomain?: Record<string, number>;
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
  purposeKey?: string;
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
  documentSha256?: string;
  ledgerSha256?: string;
  syncReceipt?: import("./todo-sync-policy").TodoRunReceipt;
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
  syncOutcome?: "ready" | "waiting" | "retryable" | "failed";
  retryable?: boolean;
  errorCode?: string;
  generationAcceptedAt?: string;
  generationRequestedAt?: string;
  resumeEligible?: boolean;
};

export type DomiPlaudConnectionRequest = {
  browser?: "chrome" | "tabbit";
};

export type DomiPlaudRemoteStatus =
  | "connected"
  | "auth_required"
  | "authorization_pending"
  | "access_denied"
  | "verification_pending"
  | "profile_locked"
  | "browser_unavailable"
  | "runtime_unavailable"
  | "network_error"
  | "rate_limited"
  | "service_unavailable"
  | "service_changed"
  | "unknown";

export type DomiPlaudConnectionResult = {
  ok: boolean;
  connected?: boolean;
  browser?: "chrome" | "tabbit";
  browserLabel?: string;
  accountFingerprint?: string;
  status?: DomiPlaudRemoteStatus;
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
  remoteStatus?: DomiPlaudRemoteStatus;
  retryable?: boolean;
  lastSuccessfulSnapshot?: DomiPlaudSnapshot;
  warning?: string;
  error?: string;
};

export type DomiPlaudSyncResult = {
  ok: boolean;
  status?: "complete" | "partial" | "waiting" | "failed";
  generatedCount?: number;
  recoveredCount?: number;
  failedCount?: number;
  waitingCount?: number;
  retryableCount?: number;
  resumePendingCount?: number;
  results?: Array<{
    fileId: string;
    ok: boolean;
    outcome: "ready" | "waiting" | "retryable" | "failed";
    stage?: string;
    transcriptPath?: string;
    retryable?: boolean;
    errorCode?: string;
    error?: string;
  }>;
  warning?: string;
  listRefreshFailed?: boolean;
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
  workspacePath?: string;
  files: DomiEntityMaterial[];
  generatedAt: number;
};

export type DomiEntityMaterialsRequest = {
  entityType: "project" | "person";
  recordId: string;
  repairMissing?: boolean;
};

export type DomiEntityWorkspaceResult = {
  ok: boolean;
  workspacePath?: string;
  recovered?: boolean;
  snapshot?: DomiSnapshot;
  error?: string;
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
  version: 9;
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
  radarFollowedDomains: Array<"AI" | "半导体" | "智能出行" | "前沿科技" | "具身智能&机器人" | "消费" | "生物医药">;
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
  warning?: string;
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
  requestId: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
  keepExistingKey?: boolean;
  codexPath?: string;
};

export type CodexConnectionTestRequest = {
  requestId: string;
};

export type CodexConnectionTestCancelResult = {
  ok: boolean;
  requestId: string;
  cancelled: boolean;
  error?: string;
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
  requestId?: string;
  configured?: boolean;
  codex?: CodexCheckResult;
  verification?: CodexConnectionVerification;
  pausedBackgroundRuns?: number;
  cancelled?: boolean;
  timedOut?: boolean;
  stage?: string;
  diagnosticCode?: string;
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
  bytesPerSecond?: number;
  etaSeconds?: number;
  slow?: boolean;
  downloadMode?: "differential" | "full";
  releaseDate: string;
  restartPending?: boolean;
  busyTaskCount?: number;
  installing?: boolean;
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
    | "codex-run"
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
  /**
   * Whether the submitted request came directly from the user's composer or
   * was generated by a client workflow. Programmatic requests never authorize
   * Feishu writes.
   */
  requestOrigin?: "user" | "programmatic";
  /** Exact composer text used by the host for explicit Feishu write intent. */
  userInstructionText?: string;
  /**
   * Host-selected local document context. The main process still validates
   * real paths and the user's original write intent before any Feishu write.
   */
  activeDocumentPath?: string;
  attachmentPaths?: string[];
  threadId?: string;
  ephemeral?: boolean;
  background?: boolean;
  allowUserInput?: boolean;
  workflowId?: string;
  webSearch?: boolean;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  /**
   * Host-classified Slides deliverable contract. The Electron main process
   * treats a non-empty value as a fail-closed completion gate.
   */
  slidesDeliveryPolicy?: DomiSlidesDeliveryPolicy;
  workspacePath?: string;
  privateOutput?: boolean;
  externalType?: "project" | "person";
  externalRecordId?: string;
  entityUpdatedAt?: number;
};

export type DomiSlidesDeliveryPolicy =
  | "html_pdf"
  | "html_pdf_preserve_template"
  | "explicit_pptx"
  | "explicit_pptx_preserve_template";

export type CodexThreadRecoveryRequest = {
  /** Persisted with the running assistant message so restart recovery cannot bypass QA. */
  slidesDeliveryPolicy?: DomiSlidesDeliveryPolicy;
};

export type CodexRunResult = {
  ok: boolean;
  runId: string;
  code?: number;
  signal?: string;
  stopped?: boolean;
  awaitingSlidesInput?: boolean;
  threadId?: string;
  turnId?: string;
  output: string;
  outputPath?: string;
  error?: string;
  workspacePath?: string;
  eventCount?: number;
};

export type CodexThreadRecoveryResult = {
  ok: boolean;
  runId?: string;
  threadId: string;
  turnId?: string;
  status: "running" | "completed" | "waiting-input" | "stopped" | "failed" | "unknown";
  output?: string;
  error?: string;
  pendingUserInputRequests?: CodexUserInputRequest[];
};

export type CodexUserInputOption = {
  label: string;
  description: string;
};

export type CodexUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: CodexUserInputOption[] | null;
};

export type CodexUserInputRequest = {
  requestId: string | number;
  threadId: string;
  turnId: string;
  itemId: string;
  questions: CodexUserInputQuestion[];
  isBlocking: boolean;
  autoResolutionMs: number | null;
};

export type CodexUserInputAnswerRequest = {
  runId: string;
  requestId: string | number;
  answers: Record<string, string[]>;
};

export type CodexUserInputAnswerResult = {
  ok: boolean;
  duplicate?: boolean;
  error?: string;
};

export type CodexEventPayload = {
  runId: string;
  type:
    | "thread"
    | "started"
    | "compatibility"
    | "reconnecting"
    | "reconnected"
    | "assistant-delta"
    | "usage"
    | "json"
    | "stdout"
    | "stderr"
    | "error"
    | "user-input-request"
    | "user-input-resolved"
    | "completed"
    | "waiting-input"
    | "stopped"
    | "failed";
  threadId?: string;
  turnId?: string;
  summary?: string;
  attempt?: number | null;
  total?: number | null;
  text?: string;
  error?: string;
  code?: number;
  signal?: string;
  output?: string;
  outputPath?: string;
  stderr?: string;
  eventCount?: number;
  request?: CodexUserInputRequest;
  requestId?: string | number;
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
  cache_write_input_tokens?: number;
  output_tokens: number;
  reasoning_output_tokens: number;
  usage_scope?: "run_observed" | string;
  usage_complete?: boolean;
  usage_source?: "raw_response" | "thread_updates" | "none" | string;
  usage_samples?: number;
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
