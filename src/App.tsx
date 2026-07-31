import {
  AlertCircle,
  ArrowUp,
  BriefcaseBusiness,
  Brain,
  CalendarPlus,
  CheckCircle2,
  Check,
  Clock3,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  Database,
  ExternalLink,
  FileText,
  FilePlus2,
  FileType2,
  Folder,
  FolderOpen,
  FolderPlus,
  Gauge,
  Atom,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  Mic,
  MoreHorizontal,
  Newspaper,
  PanelRightClose,
  PanelRightOpen,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  RefreshCw,
  Scale,
  Search,
  Save,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  Trash2,
  UsersRound,
  Zap,
  X
} from "lucide-react";
import {
  CSSProperties,
  ClipboardEvent as ReactClipboardEvent,
  DragEvent as ReactDragEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SyntheticEvent,
  Suspense,
  lazy,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { hasNativeWorkbench, workbench } from "./bridge";
import MarkdownEditorErrorBoundary from "./MarkdownEditorErrorBoundary";
import SectionErrorBoundary, { RenderRegion } from "./SectionErrorBoundary";
import {
  AppSettings,
  AppSettingsSaveRequest,
  AppSettingsSaveResult,
  ChatGPTLoginResult,
  ClipboardAttachmentPayload,
  CodexCheckResult,
  CodexEventPayload,
  CodexEventItem,
  CodexUsage,
  DomiPerson,
  DomiDatabaseDeleteRequest,
  DomiDatabaseSnapshot,
  DomiDatabaseUpdateRequest,
  DomiNewsItem,
  DomiPlaudItem,
  DomiPlaudSnapshot,
  DomiPlaudSyncResult,
  DomiProject,
  DomiEntityMaterials,
  DomiSnapshot,
  DomiTask,
  DomiTaskBoardSnapshot,
  DomiWeeklyNewsSnapshot,
  DocumentLibraryNode,
  DocumentLibrarySnapshot,
  LocalAttachment,
  MarkdownDocument,
  PdfDocument
} from "./env";
import {
  quickStartWorkflows,
  radarDiscoveryWindow,
  radarPriorityPeopleContext,
  TODO_NEW_ENTRY_WINDOW_MS,
  todoRecentEntriesContext,
  Workflow,
  workflowPrompt,
  workflows
} from "./workflows";
import {
  FOLLOWED_PROJECT_TAXONOMY_PROMPT,
  projectDomainsForNews,
  projectSubdomainsForNews
} from "./investmentTaxonomy";

const RichMarkdownEditor = lazy(() => import("./RichMarkdownEditor"));
const SetupCenter = lazy(() => import("./SetupCenter"));
const MessageContent = lazy(() => import("./MessageContent"));

type Role = "user" | "assistant" | "system";
type WorkspaceView = "conversation" | "tasks" | "news" | "data" | "documents";
type DatabaseEntityType = "project" | "person" | "news";
type DatabaseSortKey = "updated" | "name" | "created";
type DatabaseSortDirection = "asc" | "desc";

type DatabaseDraft = {
  entityType: DatabaseEntityType;
  recordId: string;
  expectedUpdatedAt: number;
  name: string;
  title: string;
  domain: string;
  subdomains: string;
  status: string;
  rating: string;
  notes: string;
  cities: string;
  investors: string;
  financingHistory: string;
  latestValuationUsd100m: string;
  types: string;
  organization: string;
  lastContact: string;
  domains: string;
  newsTypes: string;
  publishedAt: string;
  summary: string;
  investmentMeaning: string;
  url: string;
  source: string;
  companies: string;
  institutions: string;
  importance: string;
  confidence: string;
  evidenceStatus: string;
  action: string;
  worthFollowing: boolean;
};

type DatabaseExpandedCell = {
  entityType: DatabaseEntityType;
  recordId: string;
  field: keyof DatabaseDraft;
  label: string;
  left: number;
  top: number;
  width: number;
};

type DatabaseDeleteTarget = DomiDatabaseDeleteRequest & {
  title: string;
};

type DatabaseRowContextMenu = DatabaseDeleteTarget & {
  left: number;
  top: number;
};

const DATABASE_FIELD_LABELS: Partial<Record<keyof DatabaseDraft, string>> = {
  name: "名称",
  title: "标题",
  domain: "领域",
  domains: "领域",
  subdomains: "子领域",
  status: "进展状态",
  rating: "评级",
  notes: "Notes",
  cities: "城市",
  investors: "投资机构",
  financingHistory: "历史融资",
  latestValuationUsd100m: "最新估值",
  types: "类型",
  organization: "所属组织与身份",
  lastContact: "最后联系",
  newsTypes: "信息类型",
  publishedAt: "发布时间",
  summary: "核心事实",
  source: "来源",
  importance: "重要性",
  confidence: "置信度",
  evidenceStatus: "证据状态",
  action: "建议动作"
};

const DATABASE_EXPANDED_TEXT_FIELDS = new Set<keyof DatabaseDraft>([
  "name",
  "title",
  "notes",
  "organization",
  "financingHistory",
  "summary",
  "action"
]);

function splitDatabaseList(value: string) {
  return [...new Set(
    String(value || "")
      .split(/[,，、;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function localDateInput(value: number | null | undefined, includeTime = false) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "";
  const date = new Date(timestamp);
  const offset = date.getTimezoneOffset() * 60_000;
  const local = new Date(date.getTime() - offset).toISOString();
  return includeTime ? local.slice(0, 16) : local.slice(0, 10);
}

function databaseDraftForRecord(
  entityType: DatabaseEntityType,
  record: DomiProject | DomiPerson | DomiNewsItem
): DatabaseDraft {
  const blank: DatabaseDraft = {
    entityType,
    recordId: record.recordId,
    expectedUpdatedAt: Number(record.updatedAt) || 0,
    name: "",
    title: "",
    domain: "",
    subdomains: "",
    status: "",
    rating: "",
    notes: "",
    cities: "",
    investors: "",
    financingHistory: "",
    latestValuationUsd100m: "",
    types: "",
    organization: "",
    lastContact: "",
    domains: "",
    newsTypes: "",
    publishedAt: "",
    summary: "",
    investmentMeaning: "",
    url: "",
    source: "",
    companies: "",
    institutions: "",
    importance: "",
    confidence: "",
    evidenceStatus: "",
    action: "",
    worthFollowing: true
  };
  if (entityType === "project") {
    const project = record as DomiProject;
    return {
      ...blank,
      name: project.name,
      domain: project.domain,
      subdomains: project.subdomains.join("、"),
      status: project.status,
      rating: project.rating,
      notes: project.notes || "",
      cities: (project.cities || []).join("、"),
      investors: (project.investors || []).join("、"),
      financingHistory: project.financingHistory || "",
      latestValuationUsd100m: project.latestValuationUsd100m === null
        || project.latestValuationUsd100m === undefined
        ? ""
        : String(project.latestValuationUsd100m)
    };
  }
  if (entityType === "person") {
    const person = record as DomiPerson;
    return {
      ...blank,
      name: person.name,
      types: person.types.join("、"),
      organization: person.organization,
      status: person.status,
      rating: person.rating,
      lastContact: localDateInput(person.lastContact),
      cities: person.cities.join("、")
    };
  }
  const item = record as DomiNewsItem;
  return {
    ...blank,
    title: item.title,
    domains: item.domains.join("、"),
    subdomains: item.subdomains.join("、"),
    newsTypes: item.types.join("、"),
    publishedAt: localDateInput(item.publishedAt, true),
    summary: item.summary,
    investmentMeaning: item.investmentMeaning,
    url: item.url,
    source: item.source,
    companies: item.companies,
    institutions: item.institutions,
    importance: String(item.importance),
    confidence: String(item.confidence),
    evidenceStatus: item.evidenceStatus,
    action: item.action,
    worthFollowing: item.worthFollowing !== false
  };
}

function databaseRecords(
  snapshot: DomiDatabaseSnapshot | null,
  entityType: DatabaseEntityType
): Array<DomiProject | DomiPerson | DomiNewsItem> {
  if (!snapshot) return [];
  if (entityType === "project") return snapshot.projects || [];
  if (entityType === "person") return snapshot.people || [];
  return snapshot.news || [];
}

function replaceDatabaseSnapshotRecord(
  snapshot: DomiDatabaseSnapshot | null,
  entityType: DatabaseEntityType,
  record: DomiProject | DomiPerson | DomiNewsItem
) {
  if (!snapshot) return snapshot;
  const collectionKey = entityType === "project"
    ? "projects"
    : entityType === "person"
      ? "people"
      : "news";
  const current = snapshot[collectionKey] as Array<DomiProject | DomiPerson | DomiNewsItem>;
  const next = current.some((item) => item.recordId === record.recordId)
    ? current.map((item) => item.recordId === record.recordId ? record : item)
    : [record, ...current];
  return {
    ...snapshot,
    loadedAt: Date.now(),
    [collectionKey]: next
  } as DomiDatabaseSnapshot;
}

function removeDatabaseSnapshotRecord(
  snapshot: DomiDatabaseSnapshot | null,
  entityType: DatabaseEntityType,
  recordId: string
) {
  if (!snapshot) return snapshot;
  const collectionKey = entityType === "project"
    ? "projects"
    : entityType === "person"
      ? "people"
      : "news";
  const current = snapshot[collectionKey] as Array<DomiProject | DomiPerson | DomiNewsItem>;
  return {
    ...snapshot,
    loadedAt: Date.now(),
    [collectionKey]: current.filter((item) => item.recordId !== recordId)
  } as DomiDatabaseSnapshot;
}

function databaseRecordTitle(
  entityType: DatabaseEntityType,
  record: DomiProject | DomiPerson | DomiNewsItem
) {
  return entityType === "news"
    ? (record as DomiNewsItem).title
    : (record as DomiProject | DomiPerson).name;
}

function databaseDate(value: number | null | undefined, includeTime = false) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "—";
  const date = new Date(timestamp);
  return includeTime
    ? date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      })
    : date.toLocaleDateString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      });
}

function databasePillTone(value: string) {
  const text = String(value || "");
  if (["S", "A"].includes(text)) return "blue";
  if (["深度跟踪", "已联系", "已投", "官方确认"].includes(text)) return "green";
  if (["Miss", "放弃", "未联系"].includes(text)) return "red";
  if (["待交流", "待联系", "待核验"].includes(text)) return "indigo";
  const tones = ["sand", "purple", "cyan", "pink", "blue"];
  let checksum = 0;
  for (const character of text) checksum += character.codePointAt(0) || 0;
  return tones[checksum % tones.length];
}

function databasePills(values: string[], empty = "—") {
  const items = [...new Set(values.map(String).map((item) => item.trim()).filter(Boolean))];
  if (!items.length) return <span className="database-grid-empty-value">{empty}</span>;
  return (
    <span className="database-pill-list">
      {items.map((item) => (
        <span className={`database-pill ${databasePillTone(item)}`} key={item}>{item}</span>
      ))}
    </span>
  );
}

type CalendarRecipientOption = {
  name: string;
  email: string;
  label: string;
};

function calendarRecipientOptions(value: string): CalendarRecipientOption[] {
  const seen = new Set<string>();
  return String(value || "")
    .split(/[,;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const labeled = entry.match(/^(.*?)\s*<([^<>]+)>$/);
      const name = labeled ? labeled[1].trim() : "";
      const email = (labeled ? labeled[2] : entry).trim();
      return { name, email, label: name ? `${name} <${email}>` : email };
    })
    .filter((recipient) => {
      const key = recipient.email.toLocaleLowerCase("en-US");
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function filterDocumentLibraryNodes(nodes: DocumentLibraryNode[], rawQuery: string) {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  if (!query) return nodes;
  const filter = (node: DocumentLibraryNode): DocumentLibraryNode | null => {
    const children = (node.children || [])
      .map(filter)
      .filter((child): child is DocumentLibraryNode => Boolean(child));
    if (node.name.toLocaleLowerCase("zh-CN").includes(query) || children.length > 0) {
      return node.kind === "folder" ? { ...node, children } : node;
    }
    return null;
  };
  return nodes.map(filter).filter((node): node is DocumentLibraryNode => Boolean(node));
}

function documentLibrarySearchMatches(
  nodes: DocumentLibraryNode[],
  rawQuery: string,
  rootPath: string
) {
  const query = rawQuery.trim().toLocaleLowerCase("zh-CN");
  if (!query) return [];
  const matches: Array<{ node: DocumentLibraryNode; parentPath: string }> = [];
  const visit = (items: DocumentLibraryNode[], parentPath: string) => {
    for (const node of items) {
      if (node.name.toLocaleLowerCase("zh-CN").includes(query)) {
        matches.push({ node, parentPath });
      }
      if (node.kind === "folder" && node.children?.length) {
        visit(node.children, node.path);
      }
    }
  };
  visit(nodes, rootPath);
  return matches;
}

type Message = {
  id: string;
  role: Role;
  content: string;
  workflowId?: string;
  status?: "idle" | "running" | "done" | "error";
  attachments?: LocalAttachment[];
  runId?: string;
  runStartedAt?: number;
  runCompletedAt?: number;
  runEventCount?: number;
};

type Thread = {
  id: string;
  codexThreadId?: string;
  projectId: string;
  workspacePath?: string;
  title: string;
  project: string;
  updatedAt: string;
  lastActiveAt?: number;
  pinned: boolean;
  manualTitle: boolean;
  externalType?: "project" | "person";
  externalRecordId?: string;
  hasUnreadCompletion?: boolean;
  messages: Message[];
  timeline: TimelineItem[];
  lastUsage: CodexUsage | null;
};

type SubmitToCodexOptions = {
  thread?: Thread;
  useDomiPlugin?: boolean;
  displayText?: string;
  attachments?: LocalAttachment[];
  background?: boolean;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  preserveComposer?: boolean;
};

type QueuedSubmission = {
  id: string;
  threadId: string;
  input: string;
  workflowId?: string;
  attachments: LocalAttachment[];
  useDomiPlugin: boolean;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  createdAt: number;
};

type ComposerDraft = {
  input: string;
  attachments: LocalAttachment[];
  attachmentError: string;
  selectedWorkflowId?: string;
};

type ChatScrollPosition = {
  top: number;
  atBottom: boolean;
};

const EMPTY_COMPOSER_DRAFT: ComposerDraft = {
  input: "",
  attachments: [],
  attachmentError: ""
};

type ExecutionSuggestionPriority = "P1" | "P2" | "P3";

type ExecutionSuggestion = {
  id: string;
  title: string;
  context: string;
  reason: string;
  priority: ExecutionSuggestionPriority;
  workflowId: string;
  prompt: string;
  projectLabel: string;
  externalType?: "project" | "person";
  externalRecordId?: string;
};

type ExecutionSuggestionDisposition = {
  dismissedAt?: number;
  snoozedUntil?: number;
  executedAt?: number;
};

type WeeklyNewsRefreshOptions = {
  silent?: boolean;
  preserveView?: boolean;
};

type WeeklyNewsScanOutcome = {
  status: "success" | "failed" | "skipped";
  addedItems?: DomiNewsItem[];
};

type WeeklyNewsAutomationPhase = "idle" | "syncing" | "scanning" | "retrying";

type WeeklyNewsAutomationState = {
  phase: WeeklyNewsAutomationPhase;
  lastLightSyncAt: number;
  lastRadarSuccessAt: number;
  nextRadarAt: number;
  retryAttempt: number;
};

const WEEKLY_NEWS_LIGHT_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const WEEKLY_NEWS_FOCUS_SYNC_STALE_MS = 60 * 1000;
const WEEKLY_NEWS_RADAR_INTERVAL_MS = 60 * 60 * 1000;
const WEEKLY_NEWS_AUTOMATION_TICK_MS = 60 * 1000;
const WEEKLY_NEWS_RADAR_RETRY_DELAYS_MS = [5, 15, 60].map((minutes) => minutes * 60 * 1000);
const WEEKLY_NEWS_AUTOMATION_STORAGE_KEY = "domi.weeklyNews.automation.v1";
const WEEKLY_NEWS_NOTIFIED_STORAGE_KEY = "domi.weeklyNews.notified.v1";

function defaultWeeklyNewsAutomationState(): WeeklyNewsAutomationState {
  return {
    phase: "idle",
    lastLightSyncAt: 0,
    lastRadarSuccessAt: 0,
    nextRadarAt: 0,
    retryAttempt: 0
  };
}

function readWeeklyNewsAutomationState(): WeeklyNewsAutomationState {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WEEKLY_NEWS_AUTOMATION_STORAGE_KEY) || "null");
    const fallback = defaultWeeklyNewsAutomationState();
    if (!stored || typeof stored !== "object") return fallback;
    return {
      phase: Number(stored.retryAttempt) > 0 && Number(stored.nextRadarAt) > Date.now()
        ? "retrying"
        : "idle",
      lastLightSyncAt: Number(stored.lastLightSyncAt) || 0,
      lastRadarSuccessAt: Number(stored.lastRadarSuccessAt) || 0,
      nextRadarAt: Number(stored.nextRadarAt) || 0,
      retryAttempt: Math.max(0, Number(stored.retryAttempt) || 0)
    };
  } catch {
    return defaultWeeklyNewsAutomationState();
  }
}

function formatWeeklyNewsAutomationTime(timestamp: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
}

function readWeeklyNewsNotifiedIds() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(WEEKLY_NEWS_NOTIFIED_STORAGE_KEY) || "[]");
    return new Set<string>(Array.isArray(stored) ? stored.map(String) : []);
  } catch {
    return new Set<string>();
  }
}

function saveWeeklyNewsNotifiedIds(recordIds: Set<string>) {
  try {
    window.localStorage.setItem(
      WEEKLY_NEWS_NOTIFIED_STORAGE_KEY,
      JSON.stringify([...recordIds].slice(-300))
    );
  } catch {
    // Notification deduplication remains best-effort if persistence is unavailable.
  }
}

type TimelineItem = {
  id: string;
  runId: string;
  title: string;
  detail?: string;
  status?: string;
  kind: CodexEventItem["kind"] | "event";
};

function isLocalPdfResource(resource?: string) {
  if (!resource || /^https?:\/\//i.test(resource) || resource.startsWith("#")) return false;
  return /\.pdf(?:[?#].*)?$/i.test(resource);
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatMessageRunDuration(startedAt?: number, completedAt?: number) {
  if (!startedAt) return "";
  const elapsedSeconds = Math.max(1, Math.round(((completedAt || Date.now()) - startedAt) / 1000));
  const minutes = Math.floor(elapsedSeconds / 60);
  const seconds = elapsedSeconds % 60;
  return minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function describeOperationError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  const text = String(error || "").trim();
  return text || fallback;
}

function reportDocumentOperation(operation: string, error: unknown) {
  const resolved = error instanceof Error ? error : new Error(String(error));
  console.error(`文档操作失败：${operation}`, resolved);
  workbench.reportRendererIssue({
    kind: "document-operation",
    message: `${operation}: ${resolved.message || "文档操作失败"}`,
    stack: resolved.stack
  });
}

const nowLabel = () =>
  new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date());

const todayLabel = () =>
  new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "short"
  }).format(new Date());

const newsDateLabel = (timestamp?: number | null) => timestamp
  ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(timestamp)
  : "时间待补充";

const newsRangeLabel = (start?: number, end?: number) => start && end
  ? `${newsDateLabel(start)} - ${newsDateLabel(end)}`
  : "日期范围待补充";

const reasoningLabels: Record<string, string> = {
  none: "关闭",
  minimal: "最少",
  low: "轻量",
  medium: "中等",
  high: "高",
  xhigh: "超高",
  max: "Max",
  ultra: "Ultra"
};

const reasoningLabel = (effort: string) => reasoningLabels[effort] || effort;
const speedLabel = (tier: string) => tier === "priority" || tier === "fast" ? "Fast" : "标准";

const createId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const NEW_THREAD_TITLE = "新的投资任务";
const NEW_THREAD_PROJECT = "未命名项目";
const NEW_THREAD_GREETING = "新对话已创建。选择一个 workflow，或直接输入你要 Codex 完成的投资任务。";
const NEW_THREAD_MODEL = "default";
const NEW_THREAD_REASONING_EFFORT = "max";
const NEW_THREAD_SERVICE_TIER = "priority";
const TODO_SYNC_TIMEOUT_MS = 4 * 60 * 1000;
type TodoSyncPhase =
  | "idle"
  | "refreshing"
  | "preparing"
  | "generating"
  | "stopping"
  | "reading"
  | "completed"
  | "failed";
type TodoSyncState = {
  phase: TodoSyncPhase;
  label: string;
  startedAt: number | null;
  completedAt: number | null;
  candidateCount: number;
};
const IDLE_TODO_SYNC_STATE: TodoSyncState = {
  phase: "idle",
  label: "",
  startedAt: null,
  completedAt: null,
  candidateCount: 0
};

function recentTodoCandidateCount(snapshot?: DomiSnapshot | null, now = Date.now()) {
  if (!snapshot) return 0;
  const cutoff = now - TODO_NEW_ENTRY_WINDOW_MS;
  return [...snapshot.projects, ...snapshot.people].filter((item) =>
    Number(item.createdAt) >= cutoff && Number(item.createdAt) <= now
  ).length;
}
const COMPOSER_SUGGESTIONS = [
  "分析 NetShort 付费 Cohort 和增长质量",
  "整理今天的项目交流录音并生成纪要",
  "寻找 AI4S 领域值得沟通的创业者",
  "研究具身智能赛道的市场格局与关键公司",
  "对这个项目评级，并给出继续或放弃建议",
  "核查这家公司的融资历史和投资人背景",
  "根据项目材料撰写一份 IC Memo",
  "分析公司的商业模式、财务表现和核心风险",
  "为明天与创始人的会议准备问题清单",
  "比较这轮 Term Sheet 条款并准备谈判策略",
  "从 Watching List 找出本周应优先推进的项目",
  "把这份研究材料整理入项目库"
];

function isUnusedDraftThread(thread: Thread) {
  return !thread.externalType
    && !thread.codexThreadId
    && !thread.manualTitle
    && thread.title === NEW_THREAD_TITLE
    && thread.project === NEW_THREAD_PROJECT
    && thread.timeline.length === 0
    && thread.messages.every((message) =>
      message.role === "assistant"
      && message.status === "idle"
      && message.content === NEW_THREAD_GREETING
    );
}

function compactUnusedDraftThreads(threads: Thread[], activeThreadId: string) {
  const activeDraft = threads.find(
    (thread) => thread.id === activeThreadId && isUnusedDraftThread(thread)
  );
  const keeperId = activeDraft?.id || threads.find(isUnusedDraftThread)?.id;
  if (!keeperId) return threads;
  return threads.filter(
    (thread) => !isUnusedDraftThread(thread) || thread.id === keeperId
  );
}

function migrateLegacyTodoThreadLabels(thread: Thread) {
  const title = thread.title === "更新任务建议" ? "同步待办事项" : thread.title;
  const project = thread.project === "1.Task · 更新建议"
    ? "1.待办事项 · 同步"
    : thread.project;
  return title === thread.title && project === thread.project
    ? thread
    : { ...thread, title, project };
}

const EXECUTION_FOCUS_PRESETS = [
  {
    label: "AI4S",
    pattern: /\bAI4S\b|AI\s*for\s*Science|科学智能|药物发现|计算生物|计算化学|材料研发/i,
    personKeywords: ["ai", "seed", "air", "sia", "research", "研究员", "科学", "生物", "材料", "药物", "清华"]
  },
  {
    label: "半导体",
    pattern: /半导体|芯片|GPU|算力芯片|晶圆|碳化硅|SiC/i,
    personKeywords: ["半导体", "芯片", "gpu", "算力", "晶圆", "sic", "硬件"]
  },
  {
    label: "具身智能",
    pattern: /具身智能|机器人|人形机器人|embodied|robotics/i,
    personKeywords: ["具身", "机器人", "robot", "自动化", "控制", "清华"]
  },
  {
    label: "智能出行",
    pattern: /智能出行|自动驾驶|新能源汽车|汽车|智驾/i,
    personKeywords: ["汽车", "智驾", "自动驾驶", "出行", "新能源"]
  },
  {
    label: "AI",
    pattern: /人工智能|大模型|基础模型|模型层|\bLLM\b|\bAI\b/i,
    personKeywords: ["ai", "大模型", "模型", "算法", "seed", "air", "研究员", "清华"]
  }
];

function compactLabel(value: string, maximum = 14) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const characters = Array.from(normalized);
  return characters.length > maximum
    ? `${characters.slice(0, maximum).join("")}…`
    : normalized;
}

function concisePersonName(name: string) {
  const normalized = name.split(/[（(·]/)[0].trim();
  if (/\p{Script=Han}/u.test(normalized) && normalized.includes(" ")) {
    return normalized.split(/\s+/)[0];
  }
  return compactLabel(normalized, 10);
}

function conciseRecordingTitle(title: string) {
  const normalized = title.trim().replace(/\.(m4a|mp3|wav|aac|flac)$/i, "");
  const timestamp = normalized.match(
    /^20\d{2}[-./年](\d{1,2})[-./月](\d{1,2})(?:日)?(?:[\sT_-]+(\d{1,2})[:：](\d{2})(?::\d{2})?)?$/
  );
  if (timestamp) {
    const [, month, day, hour, minute] = timestamp;
    return `${Number(month)}月${Number(day)}日${hour ? ` ${hour.padStart(2, "0")}:${minute}` : ""}录音`;
  }
  const withoutDate = normalized
    .replace(/^20\d{2}[-_.年/]?\d{1,2}[-_.月/]?\d{1,2}(?:日)?[-_\s]*/, "")
    .replace(/^\d{2}[-_.月/]\d{2}(?:日)?[-_\s]*/, "")
    .replace(/^\d{1,2}[:：]\d{2}(?::\d{2})?[-_\s]*/, "")
    .trim();
  return compactLabel(withoutDate || normalized || "最新录音", 16);
}

function executionTextForThread(thread: Thread) {
  return [
    thread.title,
    thread.project,
    ...thread.messages
      .filter((message) => message.role === "user")
      .slice(-3)
      .map((message) => message.content)
  ].join(" ");
}

function inferExecutionFocus(activeThread: Thread, threads: Thread[]) {
  const candidates = [
    activeThread,
    ...[...threads]
      .filter((thread) => thread.id !== activeThread.id)
      .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0))
  ];
  const sourceThread = candidates.find((thread) => !isUnusedDraftThread(thread));
  const text = sourceThread ? executionTextForThread(sourceThread) : "";
  const preset = EXECUTION_FOCUS_PRESETS.find((item) => item.pattern.test(text));
  const fallbackLabel = sourceThread?.externalType === "project"
    ? sourceThread.title
    : sourceThread?.project && sourceThread.project !== NEW_THREAD_PROJECT
      ? sourceThread.project.split(" · ")[0]
      : "当前重点";
  return {
    label: compactLabel(preset?.label || fallbackLabel, 10),
    keywords: preset?.personKeywords || [],
    sourceThread,
    text
  };
}

const DEFAULT_LEFT_PANEL_WIDTH = 252;
const DEFAULT_CONTEXT_PANEL_WIDTH = 314;
const MIN_LEFT_PANEL_WIDTH = 210;
const MIN_CONTEXT_PANEL_WIDTH = 280;
const MIN_DOCUMENT_PANEL_WIDTH = 360;
const MIN_CHAT_PANEL_WIDTH = 420;

function defaultDocumentPanelWidth() {
  return Math.round(Math.min(720, Math.max(440, window.innerWidth * 0.38)));
}

function readStoredWidth(key: string, fallback: number) {
  try {
    const stored = Number(window.localStorage.getItem(key));
    return Number.isFinite(stored) && stored > 0 ? stored : fallback;
  } catch {
    return fallback;
  }
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum));
}

const ratingWeight: Record<string, number> = { S: 4, A: 3, B: 2, C: 1 };
const FOLLOWED_NEWS_DOMAINS = ["AI", "半导体", "智能出行", "前沿科技", "具身智能&机器人"];

function followedDomainsForNews(item: DomiNewsItem) {
  return projectDomainsForNews(item.domains, item.subdomains)
    .filter((domain) => FOLLOWED_NEWS_DOMAINS.includes(domain));
}

function isFollowedNewsItem(item: DomiNewsItem) {
  return followedDomainsForNews(item).length > 0;
}

function newsMatchesTaxonomyFilter(
  item: DomiNewsItem,
  domain: string,
  subdomain = "全部"
) {
  if (domain === "全部") return subdomain === "全部";
  if (!followedDomainsForNews(item).includes(domain)) return false;
  return subdomain === "全部"
    || projectSubdomainsForNews(item.subdomains, domain).includes(subdomain);
}

function cleanPeopleStatus(status: string) {
  return status.replace(/^\d+\./, "") || "待补充";
}

function peopleProgressStage(status: string) {
  const match = status.match(/^(\d+)\./);
  return match ? Number(match[1]) : 0;
}

function formatPlaudDuration(duration: number | null) {
  if (!duration) return "时长未知";
  const totalMinutes = Math.max(1, Math.round(duration / 60000));
  if (totalMinutes < 60) return `${totalMinutes} 分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours} 小时 ${minutes} 分钟` : `${hours} 小时`;
}

function formatWeeklyNewsScanElapsed(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatWeeklyNewsUpdatedAt(timestamp?: number) {
  if (!timestamp) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
}

function formatTaskTimestamp(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.getFullYear() === today.getFullYear()
    && date.getMonth() === today.getMonth()
    && date.getDate() === today.getDate();
  return new Intl.DateTimeFormat("zh-CN", sameDay
    ? { hour: "2-digit", minute: "2-digit", hour12: false }
    : { month: "numeric", day: "numeric" }
  ).format(date);
}

function formatManagedTaskDate(value?: string | null) {
  if (!value) return "";
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(timestamp);
}

function weeklyNewsScanStageFromOutput(output: string) {
  const recent = output.slice(-1600);
  if (/写入|创建.*记录|回读|归档/.test(recent)) return "正在写入并回读新动态";
  if (/查重|去重|事件\s*ID|事件账本/.test(recent)) return "正在去重并确认信息增量";
  if (/原文|核验|候选|第二信源|佐证/.test(recent)) return "正在核验候选事件原文";
  if (/联网|检索|搜索/.test(recent)) return "正在联网检索最新动态";
  if (/schema|表结构|Watching List|People|重点项目|分类/.test(recent)) {
    return "正在读取重点对象与行业分类";
  }
  return "domi 行业雷达正在运行";
}

function radarCheckpointFromOutput(output: string) {
  const lines = String(output || "").split(/\r?\n/).reverse();
  for (const line of lines) {
    const markerIndex = line.indexOf("RADAR_RESULT");
    if (markerIndex < 0) continue;
    const jsonStart = line.indexOf("{", markerIndex);
    const jsonEnd = line.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) continue;
    try {
      const result = JSON.parse(line.slice(jsonStart, jsonEnd + 1)) as { checked_through?: unknown };
      const checkedThrough = Date.parse(String(result.checked_through || ""));
      if (Number.isFinite(checkedThrough) && checkedThrough > 0) return checkedThrough;
    } catch {
      // Ignore malformed status lines and keep looking for an earlier valid result.
    }
  }
  return null;
}

function plaudItemStatus(item: DomiPlaudItem) {
  if (item.queueStage === "managed") return "已生成并入库";
  if (item.queueStage === "notes_non_project") return "纪要已生成";
  if (item.transcriptPath || item.queueStage === "transcript_ready") return "文字稿待整理";
  if (item.hasTranscript && item.queueStage) return "已生成，待同步";
  if (item.hasTranscript || item.hasSummary) return "已有文字稿";
  if (item.processing) return "正在生成";
  if (item.error) return "需要重试";
  return "未生成文字稿";
}

function canGeneratePlaudNotes(item: DomiPlaudItem) {
  if (["managed", "notes_non_project"].includes(item.queueStage)) return false;
  return Boolean(
    item.hasTranscript
    || item.hasSummary
    || item.transcriptPath
    || [
      "transcript_ready",
      "context_pending",
      "context_ready",
      "notes_project",
      "reviewed",
      "documented"
    ].includes(item.queueStage)
  );
}

function plaudNotesWorkflowRequest(item: DomiPlaudItem) {
  return [
    "请运行 domi PLAUD 投资录音处理工作流，只处理下面这一条指定录音，不要扫描或处理其他 PLAUD 录音：",
    `- fileId：${item.fileId}`,
    `- 录音标题：${item.fileName}`,
    `- 当前队列阶段：${item.queueStage || "本地队列尚未记录"}`,
    item.transcriptPath ? `- 已有本地文字稿：${item.transcriptPath}` : "- PLAUD 远端已有文字稿，本地尚未绑定文字稿路径",
    "",
    "目标：生成完整结构化纪要；如果实质内容属于创业项目或创始人交流，继续完成投资快评、飞书 Wiki 文档、本地资料库归档和 Watching List 新增或更新。非项目录音只生成并保存纪要，不做项目入库。",
    "",
    "执行要求：",
    "1. 先采用 domi 插件的 domi-router，并完整读取 PLAUD 投资录音工作流及各阶段 Skill。",
    "2. 先用 plaud queue 定位这个 fileId；如果 PLAUD 已生成但本地没有 transcriptPath，使用 plaud download 下载现成文字稿并建立恢复记录，禁止重新触发生成。",
    "3. 如果已经有 transcriptPath，直接复用，不要重新下载或生成。",
    "4. 严格从当前队列阶段恢复，不重复生成纪要、文档或外部记录。",
    "5. 按工作流生成回忆提示并确认对话背景和参会人；需要我补充时在该阶段提问并暂停，收到回复后再继续后续阶段。",
    "6. 外部写入前执行去重、字段校验和写后回读，最终报告纪要、项目判断、评分、Wiki、本地资料库和 Watching List 的实际结果。"
  ].join("\n");
}

function plaudQueueSummary(snapshot: DomiPlaudSnapshot) {
  const items = snapshot.items || [];
  const pending = snapshot.pendingCount || 0;
  const needsSync = items.filter((item) =>
    item.hasTranscript && Boolean(item.queueStage) && !item.transcriptPath
  ).length;
  const ready = items.filter((item) =>
    Boolean(item.transcriptPath) || item.queueStage === "transcript_ready"
  ).length;
  const retry = pending ? 0 : items.filter((item) => plaudItemStatus(item) === "需要重试").length;
  const parts = [
    pending ? `${pending} 个待生成` : "",
    needsSync ? `${needsSync} 个待同步` : "",
    ready ? `${ready} 个待整理` : "",
    retry ? `${retry} 个需重试` : ""
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "队列已清";
}

function markdownLink(label: string, resource: string) {
  const safeLabel = label.replace(/([\\\[\]])/g, "\\$1");
  const target = resource.trim();
  if (/^https?:\/\//i.test(target)) return `[${safeLabel}](${target})`;
  if (/^[a-z0-9.-]+\.(?:feishu|larksuite)\.cn\//i.test(target)) {
    return `[${safeLabel}](https://${target})`;
  }
  return `[${safeLabel}](<${target.replace(/>/g, "%3E")}>)`;
}

function isOpenableResource(resource: string) {
  return /^(?:https?:\/\/|file:\/\/|\/)/i.test(resource.trim())
    || /^[a-z0-9.-]+\.(?:feishu|larksuite)\.cn\//i.test(resource.trim());
}

function projectOverview(
  project: DomiProject,
  materials?: DomiEntityMaterials,
  materialError?: string
) {
  const lines = [
    `## ${project.name} · 项目资料`,
    "",
    "| 项目字段 | 当前信息 |",
    "| --- | --- |",
    `| 领域 | ${project.domain || "未填写"} |`,
    `| 子领域 | ${project.subdomains.join("、") || "未填写"} |`,
    `| 进展状态 | ${project.status || "未填写"} |`,
    `| 项目评级 | ${project.rating || "未填写"} |`,
    `| 城市 | ${project.cities?.join("、") || "未填写"} |`,
    `| 投资机构 | ${project.investors?.join("、") || "未填写"} |`,
    `| 入库时间 | ${project.createdAt ? new Date(project.createdAt).toLocaleString("zh-CN") : "未填写"} |`,
    `| 最后更新 | ${project.lastFollowup ? new Date(project.lastFollowup).toLocaleDateString("zh-CN") : "未填写"} |`,
    "",
    "### 库内入口"
  ];
  if (project.link && isOpenableResource(project.link)) {
    lines.push(`- ${markdownLink("飞书 Wiki 项目文档", project.link)}`);
  } else if (project.link) {
    lines.push(`- 关联文档记录：${project.link}`);
  } else {
    lines.push("- 飞书 Wiki：尚未关联");
  }
  if (materials?.searchRoot) lines.push(`- ${markdownLink("打开本地资料库", materials.searchRoot)}`);
  if (project.notes) lines.push("", "### Notes", "", project.notes);
  lines.push("", `### 关联材料${materials ? `（${materials.files.length}）` : ""}`);
  if (materialError) {
    lines.push(`> 本地材料检索失败：${materialError}`);
  } else if (!materials?.files.length) {
    lines.push("> 暂未按项目名称匹配到本地文件；可以继续让 Codex 按别名、主体名或创始人补查。");
  } else {
    for (const file of materials.files) {
      const details = [file.kind, file.size ? formatFileSize(file.size) : ""].filter(Boolean).join(" · ");
      lines.push(`- ${markdownLink(file.name, file.path)}${details ? `  \n  ${details}` : ""}`);
    }
  }
  lines.push("", "> 以上内容来自 domi 已同步记录和本地资料库；点击 PDF 或 Markdown 会在右栏打开。");
  return lines.join("\n");
}

function personOverview(
  person: DomiPerson,
  materials?: DomiEntityMaterials,
  materialError?: string
) {
  const lines = [
    `## ${person.name} · 人脉资料`,
    "",
    "| 人脉字段 | 当前信息 |",
    "| --- | --- |",
    `| 所属组织与身份 | ${person.organization || "未填写"} |`,
    `| 类型 | ${person.types.join("、") || "未填写"} |`,
    `| 关系进展 | ${cleanPeopleStatus(person.status)} |`,
    `| 人脉评级 | ${person.rating || "未填写"} |`,
    `| 入库时间 | ${person.createdAt ? new Date(person.createdAt).toLocaleString("zh-CN") : "未填写"} |`,
    `| 最后联系 | ${person.lastContact ? new Date(person.lastContact).toLocaleDateString("zh-CN") : "未填写"} |`,
    `| 城市 | ${person.cities.join("、") || "未填写"} |`,
    "",
    "### 库内入口"
  ];
  if (person.link && isOpenableResource(person.link)) {
    lines.push(`- ${markdownLink("People 人脉记录或关联文档", person.link)}`);
  } else if (person.link) {
    lines.push(`- 关联记录：${person.link}`);
  } else {
    lines.push("- People 链接：尚未关联");
  }
  if (materials?.searchRoot) lines.push(`- ${markdownLink("打开本地资料库", materials.searchRoot)}`);
  lines.push("", `### 关联材料${materials ? `（${materials.files.length}）` : ""}`);
  if (materialError) {
    lines.push(`> 本地材料检索失败：${materialError}`);
  } else if (!materials?.files.length) {
    lines.push("> 暂未按姓名匹配到本地文件；可以继续让 Codex 按公司、项目或别名补查。");
  } else {
    for (const file of materials.files) {
      const details = [file.kind, file.size ? formatFileSize(file.size) : ""].filter(Boolean).join(" · ");
      lines.push(`- ${markdownLink(file.name, file.path)}${details ? `  \n  ${details}` : ""}`);
    }
  }
  lines.push("", "> 以上内容来自 domi 已同步记录和本地投资资料；点击 PDF 或 Markdown 会在右栏打开。");
  return lines.join("\n");
}

function domiContextForThread(snapshot: DomiSnapshot | null, thread: Thread) {
  if (!snapshot || !thread.externalRecordId || !thread.externalType) return "";
  if (thread.externalType === "project") {
    const project = snapshot.projects.find((item) => item.recordId === thread.externalRecordId);
    if (!project) return "";
    return [
      "实体类型：Watching List项目",
      `record_id：${project.recordId}`,
      `公司名称：${project.name}`,
      `领域：${project.domain || "未填写"}`,
      `子领域：${project.subdomains.join("、") || "未填写"}`,
      `进展状态：${project.status || "未填写"}`,
      `项目评级：${project.rating || "未填写"}`,
      `城市：${project.cities?.join("、") || "未填写"}`,
      `投资机构：${project.investors?.join("、") || "未填写"}`,
      `Notes：${project.notes || "未填写"}`,
      `入库时间：${project.createdAt ? new Date(project.createdAt).toISOString() : "未填写"}`,
      `最近跟进时间：${project.lastFollowup ? new Date(project.lastFollowup).toISOString().slice(0, 10) : "未填写"}`,
      `Wiki链接：${project.link || "未填写"}`
    ].join("\n");
  }
  const person = snapshot.people.find((item) => item.recordId === thread.externalRecordId);
  if (!person) return "";
  return [
    "实体类型：People人脉记录",
    `record_id：${person.recordId}`,
    `人名：${person.name}`,
    `所属组织与身份：${person.organization || "未填写"}`,
    `类型：${person.types.join("、") || "未填写"}`,
    `进展状态：${person.status || "未填写"}`,
    `评级：${person.rating || "未填写"}`,
    `入库时间：${person.createdAt ? new Date(person.createdAt).toISOString() : "未填写"}`,
    `最后联系日期：${person.lastContact ? new Date(person.lastContact).toISOString().slice(0, 10) : "未填写"}`,
    `城市：${person.cities.join("、") || "未填写"}`,
    `链接：${person.link || "未填写"}`
  ].join("\n");
}

const initialThreads: Thread[] = [
  {
    id: "thread-initial",
    projectId: "project-initial",
    title: NEW_THREAD_TITLE,
    project: NEW_THREAD_PROJECT,
    updatedAt: nowLabel(),
    lastActiveAt: Date.now(),
    pinned: false,
    manualTitle: false,
    timeline: [],
    lastUsage: null,
    messages: [
      {
        id: "assistant-initial",
        role: "assistant",
        status: "idle",
        content: NEW_THREAD_GREETING
      }
    ]
  }
];

type WorkbenchSnapshot = {
  version: 1 | 2;
  activeThreadId: string;
  threads: Thread[];
  agentPreferences?: {
    model: string;
    reasoningEffort: string;
    serviceTier: string;
    domiPluginEnabled?: boolean;
  };
  executionSuggestionState?: Record<string, ExecutionSuggestionDisposition>;
};

const initialSnapshot: WorkbenchSnapshot = {
  version: 1,
  activeThreadId: initialThreads[0].id,
  threads: initialThreads
};

const workflowIconMap: Record<string, typeof FileText> = {
  "domi-router": RefreshCw,
  "meeting-prep": ClipboardList,
  "people-intake": UsersRound,
  "project-research": Search,
  "project-intake": Database,
  "quick-discussion": Mic,
  "meeting-note": FileText,
  "investment-review": ClipboardList,
  "ic-memo": BriefcaseBusiness,
  "desk-research": Search,
  "deal-negotiation": Scale,
  "investment-analysis": LayoutDashboard,
  "investment-mgmt": Database,
  task: ListChecks,
  schedule: CalendarPlus,
  sourcing: UsersRound
};

const NEW_TASK_QUOTE = "We (the whole industry, not just OpenAI) are building a brain for the world.";

function App() {
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState(initialThreads[0].id);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("conversation");
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const [documentLibrarySidebarExpanded, setDocumentLibrarySidebarExpanded] = useState(false);
  const [composerDraftsByThread, setComposerDraftsByThread] = useState<
    Record<string, ComposerDraft>
  >({});
  const activeComposerDraft = composerDraftsByThread[activeThreadId] || EMPTY_COMPOSER_DRAFT;
  const input = activeComposerDraft.input;
  const attachments = activeComposerDraft.attachments;
  const attachmentError = activeComposerDraft.attachmentError;
  const selectedWorkflowId = activeComposerDraft.selectedWorkflowId;
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [codexStatus, setCodexStatus] = useState<CodexCheckResult | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"connection" | "data" | "plaud" | "updates" | "diagnostics">("connection");
  const [domiSnapshot, setDomiSnapshot] = useState<DomiSnapshot | null>(null);
  const [domiSyncing, setDomiSyncing] = useState(false);
  const [domiError, setDomiError] = useState("");
  const [domiQuery, setDomiQuery] = useState("");
  const [databaseSnapshot, setDatabaseSnapshot] = useState<DomiDatabaseSnapshot | null>(null);
  const [databaseEntityType, setDatabaseEntityType] = useState<DatabaseEntityType>("project");
  const [databaseSelectedId, setDatabaseSelectedId] = useState("");
  const [databaseEditingId, setDatabaseEditingId] = useState("");
  const [databaseDraft, setDatabaseDraft] = useState<DatabaseDraft | null>(null);
  const [databaseExpandedCell, setDatabaseExpandedCell] = useState<DatabaseExpandedCell | null>(null);
  const [databaseQuery, setDatabaseQuery] = useState("");
  const [databaseStatusFilter, setDatabaseStatusFilter] = useState("全部");
  const [databaseSortKey, setDatabaseSortKey] = useState<DatabaseSortKey>("updated");
  const [databaseSortDirection, setDatabaseSortDirection] = useState<DatabaseSortDirection>("desc");
  const [databaseVisibleLimit, setDatabaseVisibleLimit] = useState(100);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseSaving, setDatabaseSaving] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [databaseDeleteTarget, setDatabaseDeleteTarget] = useState<DatabaseDeleteTarget | null>(null);
  const [databaseRowContextMenu, setDatabaseRowContextMenu] = useState<DatabaseRowContextMenu | null>(null);
  const [databaseDeleting, setDatabaseDeleting] = useState(false);
  const [weeklyNews, setWeeklyNews] = useState<DomiWeeklyNewsSnapshot | null>(null);
  const [weeklyNewsLoading, setWeeklyNewsLoading] = useState(false);
  const [weeklyNewsScanning, setWeeklyNewsScanning] = useState(false);
  const [weeklyNewsError, setWeeklyNewsError] = useState("");
  const [weeklyNewsNotice, setWeeklyNewsNotice] = useState("");
  const [weeklyNewsFreshRecordIds, setWeeklyNewsFreshRecordIds] = useState<string[]>([]);
  const [weeklyNewsScanStartedAt, setWeeklyNewsScanStartedAt] = useState<number | null>(null);
  const [weeklyNewsScanElapsed, setWeeklyNewsScanElapsed] = useState(0);
  const [weeklyNewsScanStage, setWeeklyNewsScanStage] = useState("domi 行业雷达正在运行");
  const [weeklyNewsDomain, setWeeklyNewsDomain] = useState("全部");
  const [weeklyNewsSubdomain, setWeeklyNewsSubdomain] = useState("全部");
  const [weeklyNewsPage, setWeeklyNewsPage] = useState(0);
  const [weeklyNewsContinuation, setWeeklyNewsContinuation] = useState<DomiNewsItem | null>(null);
  const [weeklyNewsBorrowedByPage, setWeeklyNewsBorrowedByPage] = useState<Record<number, string>>({});
  const [weeklyNewsAutomationReady, setWeeklyNewsAutomationReady] = useState(false);
  const [weeklyNewsAutomation, setWeeklyNewsAutomation] = useState<WeeklyNewsAutomationState>(
    readWeeklyNewsAutomationState
  );
  const [domiTaskBoard, setDomiTaskBoard] = useState<DomiTaskBoardSnapshot | null>(null);
  const [domiTaskLoading, setDomiTaskLoading] = useState(false);
  const [domiTaskMutationId, setDomiTaskMutationId] = useState<string | null>(null);
  const [domiTaskError, setDomiTaskError] = useState("");
  const [domiTaskSyncState, setDomiTaskSyncState] = useState<TodoSyncState>(
    IDLE_TODO_SYNC_STATE
  );
  const [domiTaskSyncElapsed, setDomiTaskSyncElapsed] = useState(0);
  const [documentLibrary, setDocumentLibrary] = useState<DocumentLibrarySnapshot | null>(null);
  const [documentLibraryLoading, setDocumentLibraryLoading] = useState(false);
  const [documentLibraryError, setDocumentLibraryError] = useState("");
  const [documentLibraryQuery, setDocumentLibraryQuery] = useState("");
  const [documentLibrarySearchActivePath, setDocumentLibrarySearchActivePath] = useState("");
  const [documentLibraryExpandedPaths, setDocumentLibraryExpandedPaths] = useState<Set<string>>(
    () => new Set()
  );
  const [documentLibrarySelectedFolder, setDocumentLibrarySelectedFolder] = useState("");
  const [documentLibraryCreateKind, setDocumentLibraryCreateKind] = useState<
    "folder" | "markdown" | null
  >(null);
  const [documentLibraryCreateName, setDocumentLibraryCreateName] = useState("");
  const [documentLibraryCreating, setDocumentLibraryCreating] = useState(false);
  const [documentLibraryCreateError, setDocumentLibraryCreateError] = useState("");
  const [plaudSnapshot, setPlaudSnapshot] = useState<DomiPlaudSnapshot | null>(null);
  const [plaudLoading, setPlaudLoading] = useState(false);
  const [plaudLoadingMore, setPlaudLoadingMore] = useState(false);
  const [plaudSyncing, setPlaudSyncing] = useState(false);
  const [plaudError, setPlaudError] = useState("");
  const [plaudNotice, setPlaudNotice] = useState("");
  const [editingPlaudId, setEditingPlaudId] = useState<string | null>(null);
  const [plaudTitleDraft, setPlaudTitleDraft] = useState("");
  const [renamingPlaudId, setRenamingPlaudId] = useState<string | null>(null);
  const [launchingPlaudIds, setLaunchingPlaudIds] = useState<Set<string>>(() => new Set());
  const [deletingPlaudId, setDeletingPlaudId] = useState<string | null>(null);
  const [storageReady, setStorageReady] = useState(false);
  const [activeRunsByThread, setActiveRunsByThread] = useState<Record<string, string>>({});
  const [queuedSubmissionsByThread, setQueuedSubmissionsByThread] = useState<
    Record<string, QueuedSubmission[]>
  >({});
  const [model, setModel] = useState(NEW_THREAD_MODEL);
  const [reasoningEffort, setReasoningEffort] = useState(NEW_THREAD_REASONING_EFFORT);
  const [serviceTier, setServiceTier] = useState(NEW_THREAD_SERVICE_TIER);
  const [domiPluginEnabled, setDomiPluginEnabled] = useState(true);
  const [composerSuggestionIndex, setComposerSuggestionIndex] = useState(() =>
    Math.floor(Math.random() * COMPOSER_SUGGESTIONS.length)
  );
  const [executionSuggestionState, setExecutionSuggestionState] = useState<
    Record<string, ExecutionSuggestionDisposition>
  >({});
  const [executingSuggestionId, setExecutingSuggestionId] = useState<string | null>(null);
  const [executionSuggestionError, setExecutionSuggestionError] = useState("");
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [rightPanelOpen, setRightPanelOpen] = useState(true);
  const [leftPanelWidth, setLeftPanelWidth] = useState(() =>
    readStoredWidth("domi.layout.leftPanelWidth", DEFAULT_LEFT_PANEL_WIDTH)
  );
  const [contextPanelWidth, setContextPanelWidth] = useState(() =>
    readStoredWidth("domi.layout.contextPanelWidth", DEFAULT_CONTEXT_PANEL_WIDTH)
  );
  const [documentPanelWidth, setDocumentPanelWidth] = useState(() =>
    readStoredWidth("domi.layout.documentPanelWidth", defaultDocumentPanelWidth())
  );
  const [markdownDocument, setMarkdownDocument] = useState<MarkdownDocument | null>(null);
  const [markdownDraft, setMarkdownDraft] = useState("");
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownSaving, setMarkdownSaving] = useState(false);
  const [markdownCopying, setMarkdownCopying] = useState(false);
  const [markdownCopied, setMarkdownCopied] = useState(false);
  const [markdownRenaming, setMarkdownRenaming] = useState(false);
  const [markdownTitleEditing, setMarkdownTitleEditing] = useState(false);
  const [markdownTitleDraft, setMarkdownTitleDraft] = useState("");
  const [markdownError, setMarkdownError] = useState("");
  const [markdownRequestLabel, setMarkdownRequestLabel] = useState("");
  const [pdfDocument, setPdfDocument] = useState<PdfDocument | null>(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [pdfFrameLoading, setPdfFrameLoading] = useState(false);
  const [pdfError, setPdfError] = useState("");
  const [pdfRequestLabel, setPdfRequestLabel] = useState("");
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [threadRenderLimit, setThreadRenderLimit] = useState(80);
  const [threadMenuId, setThreadMenuId] = useState<string | null>(null);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [openSections, setOpenSections] = useState({
    domi: true,
    timeline: true
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const chatScrollPositionsRef = useRef(new Map<string, ChatScrollPosition>());
  const chatScrollRestoreFrameRef = useRef<number | null>(null);
  const chatScrollRestoreTimersRef = useRef<number[]>([]);
  const threadListRef = useRef<HTMLDivElement>(null);
  const activeThreadIdRef = useRef(activeThreadId);
  const threadsRef = useRef(threads);
  const persistedThreadsRef = useRef(new Map<string, Thread>());
  const persistenceQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const weeklyNewsRef = useRef<HTMLElement>(null);
  const weeklyNewsRunIdRef = useRef<string | null>(null);
  const weeklyNewsOutputRef = useRef("");
  const weeklyNewsReadInFlightRef = useRef(false);
  const weeklyNewsSnapshotRef = useRef<DomiWeeklyNewsSnapshot | null>(null);
  const weeklyNewsLatestSnapshotRef = useRef<DomiWeeklyNewsSnapshot | null>(null);
  const weeklyNewsPageRef = useRef(weeklyNewsPage);
  const weeklyNewsLoadingRef = useRef(false);
  const weeklyNewsScanningRef = useRef(false);
  const weeklyNewsAutomationRef = useRef(weeklyNewsAutomation);
  const weeklyNewsAutomationOperationRef = useRef(false);
  const weeklyNewsAutoRefreshActionRef = useRef<(() => Promise<boolean>) | null>(null);
  const weeklyNewsAutoScanActionRef = useRef<(() => Promise<WeeklyNewsScanOutcome>) | null>(null);
  const appSettingsRef = useRef(appSettings);
  const localSearchRefreshAtRef = useRef(0);
  const documentSearchRefreshAtRef = useRef(0);
  const documentLibraryRequestRef = useRef(0);
  const documentLibraryTreeRef = useRef<HTMLDivElement>(null);
  const markdownOpenRequestRef = useRef(0);
  const markdownSaveRequestRef = useRef(0);
  const markdownRenameRequestRef = useRef(0);
  const markdownRenameInFlightRef = useRef(false);
  const markdownTitleCancelRef = useRef(false);
  const pdfOpenRequestRef = useRef(0);
  const markdownDraftRef = useRef(markdownDraft);
  const markdownDocumentRef = useRef(markdownDocument);
  const databaseDraftRef = useRef(databaseDraft);
  const databaseAutoSaveTimerRef = useRef<number | null>(null);
  const databaseAutoSaveQueuedRef = useRef<DatabaseDraft | null>(null);
  const databaseAutoSaveInFlightRef = useRef(false);
  const plaudListPromiseRef = useRef<Promise<DomiPlaudSnapshot | null> | null>(null);
  const plaudSyncPromiseRef = useRef<Promise<DomiPlaudSyncResult | null> | null>(null);
  const plaudSnapshotRevisionRef = useRef(0);
  const plaudMutationIdsRef = useRef(new Set<string>());
  const launchingPlaudIdsRef = useRef(new Set<string>());
  const creatingThreadRef = useRef(false);
  const codexRecoveryStartedRef = useRef(false);
  const queueStartingThreadIdsRef = useRef(new Set<string>());
  const runContextRef = useRef(
    new Map<string, { threadId: string; assistantMessageId: string }>()
  );
  const pendingAssistantDeltasRef = useRef(
    new Map<string, { threadId: string; messageId: string; content: string }>()
  );
  const assistantDeltaFlushTimerRef = useRef<number | null>(null);
  const panelResizeRef = useRef<{
    kind: "left" | "context" | "document";
    startX: number;
    startWidth: number;
    minimum: number;
    maximum: number;
  } | null>(null);

  threadsRef.current = threads;
  markdownDraftRef.current = markdownDraft;
  markdownDocumentRef.current = markdownDocument;
  databaseDraftRef.current = databaseDraft;
  weeklyNewsSnapshotRef.current = weeklyNews;
  weeklyNewsPageRef.current = weeklyNewsPage;
  weeklyNewsLoadingRef.current = weeklyNewsLoading;
  weeklyNewsScanningRef.current = weeklyNewsScanning;
  weeklyNewsAutomationRef.current = weeklyNewsAutomation;
  appSettingsRef.current = appSettings;

  function updateWeeklyNewsAutomation(patch: Partial<WeeklyNewsAutomationState>) {
    const next = { ...weeklyNewsAutomationRef.current, ...patch };
    weeklyNewsAutomationRef.current = next;
    setWeeklyNewsAutomation(next);
    try {
      window.localStorage.setItem(WEEKLY_NEWS_AUTOMATION_STORAGE_KEY, JSON.stringify({
        lastLightSyncAt: next.lastLightSyncAt,
        lastRadarSuccessAt: next.lastRadarSuccessAt,
        nextRadarAt: next.nextRadarAt,
        retryAttempt: next.retryAttempt
      }));
    } catch {
      // Automation continues for the current session if local persistence is unavailable.
    }
  }

  function setPlaudLaunching(fileId: string, launching: boolean) {
    if (launching) launchingPlaudIdsRef.current.add(fileId);
    else launchingPlaudIdsRef.current.delete(fileId);
    setLaunchingPlaudIds(new Set(launchingPlaudIdsRef.current));
  }

  function currentMessageContent(threadId: string, messageId: string) {
    return threadsRef.current
      .find((thread) => thread.id === threadId)
      ?.messages.find((message) => message.id === messageId)?.content || "";
  }

  function flushAssistantDeltas() {
    assistantDeltaFlushTimerRef.current = null;
    const pending = [...pendingAssistantDeltasRef.current.values()];
    pendingAssistantDeltasRef.current.clear();
    if (!pending.length) return;

    const patchesByThread = new Map<string, Map<string, string>>();
    for (const item of pending) {
      const threadPatches = patchesByThread.get(item.threadId) || new Map<string, string>();
      threadPatches.set(item.messageId, item.content);
      patchesByThread.set(item.threadId, threadPatches);
    }

    setThreads((current) => {
      let changed = false;
      const next = current.map((thread) => {
        const patches = patchesByThread.get(thread.id);
        if (!patches) return thread;

        let messagesChanged = false;
        const messages = thread.messages.map((message) => {
          const content = patches.get(message.id);
          if (content === undefined || (message.content === content && message.status === "running")) {
            return message;
          }
          messagesChanged = true;
          return { ...message, content, status: "running" as const };
        });
        if (!messagesChanged) return thread;
        changed = true;
        return { ...thread, messages };
      });
      return changed ? next : current;
    });
  }

  function queueAssistantDelta(
    runId: string,
    context: { threadId: string; assistantMessageId: string },
    payload: CodexEventPayload
  ) {
    const existing = pendingAssistantDeltasRef.current.get(runId);
    const currentContent = existing?.content
      ?? currentMessageContent(context.threadId, context.assistantMessageId);
    const content = payload.output !== undefined
      ? payload.output
      : `${currentContent}${payload.text || ""}`;
    pendingAssistantDeltasRef.current.set(runId, {
      threadId: context.threadId,
      messageId: context.assistantMessageId,
      content
    });

    if (assistantDeltaFlushTimerRef.current === null) {
      assistantDeltaFlushTimerRef.current = window.setTimeout(flushAssistantDeltas, 50);
    }
  }

  function discardAssistantDelta(runId: string) {
    pendingAssistantDeltasRef.current.delete(runId);
  }

  function updateComposerDraft(
    threadId: string,
    updater: (draft: ComposerDraft) => ComposerDraft
  ) {
    setComposerDraftsByThread((current) => ({
      ...current,
      [threadId]: updater(current[threadId] || EMPTY_COMPOSER_DRAFT)
    }));
  }

  function setInput(next: string | ((current: string) => string)) {
    const threadId = activeThreadId;
    updateComposerDraft(threadId, (draft) => ({
      ...draft,
      input: typeof next === "function" ? next(draft.input) : next
    }));
  }

  function setAttachments(
    next: LocalAttachment[] | ((current: LocalAttachment[]) => LocalAttachment[])
  ) {
    const threadId = activeThreadId;
    updateComposerDraft(threadId, (draft) => ({
      ...draft,
      attachments: typeof next === "function" ? next(draft.attachments) : next
    }));
  }

  function setAttachmentError(next: string) {
    const threadId = activeThreadId;
    updateComposerDraft(threadId, (draft) => ({ ...draft, attachmentError: next }));
  }

  function setSelectedWorkflowId(next?: string) {
    const threadId = activeThreadId;
    updateComposerDraft(threadId, (draft) => ({ ...draft, selectedWorkflowId: next }));
  }

  function clearComposerDraft(threadId: string) {
    setComposerDraftsByThread((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  function composerDraftHasContent(threadId: string) {
    const draft = composerDraftsByThread[threadId];
    return Boolean(
      draft?.input.trim()
      || draft?.attachments.length
      || draft?.selectedWorkflowId
    );
  }

  const activeThread = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId) || threads[0] || initialThreads[0],
    [activeThreadId, threads]
  );
  activeThreadIdRef.current = activeThreadId;
  const activeRunId = activeRunsByThread[activeThread.id] || null;
  const isRunning = Boolean(activeRunId);
  const activeQueuedSubmissions = queuedSubmissionsByThread[activeThread.id] || [];

  const timeline = activeThread.timeline || [];
  const lastUsage = activeThread.lastUsage || null;
  const markdownDirty = Boolean(markdownDocument && markdownDraft !== markdownDocument.content);
  const markdownPanelActive = Boolean(markdownDocument || markdownLoading || markdownRequestLabel);
  const pdfPanelActive = Boolean(pdfDocument || pdfLoading || pdfRequestLabel);
  const openDocumentActive = markdownPanelActive || pdfPanelActive;
  const documentPanelActive = workspaceView !== "documents" && openDocumentActive;
  const activeRightPanelWidth = documentPanelActive ? documentPanelWidth : contextPanelWidth;
  const filteredDocumentLibraryNodes = useMemo(
    () => filterDocumentLibraryNodes(documentLibrary?.nodes || [], documentLibraryQuery),
    [documentLibrary, documentLibraryQuery]
  );
  const searchableDocumentLibraryNodes = useMemo(
    () => documentLibrarySearchMatches(
      documentLibrary?.nodes || [],
      documentLibraryQuery,
      documentLibrary?.rootPath || ""
    ),
    [documentLibrary, documentLibraryQuery]
  );
  const selectedDocumentLibraryPath = markdownDocument?.path || pdfDocument?.path || "";

  const selectedWorkflow = useMemo(
    () => workflows.find((workflow) => workflow.id === selectedWorkflowId),
    [selectedWorkflowId]
  );
  const plaudEnabled = appSettings?.plaudConnectionMode === "enabled";
  const todoDocumentLabel = appSettings?.storageBackend === "local"
    ? "0.待办事项.md"
    : "1.待办事项";
  const visibleQuickStartWorkflows = useMemo(
    () => quickStartWorkflows.filter((workflow) => !workflow.requiresPlaud || plaudEnabled),
    [plaudEnabled]
  );
  const commonCalendarRecipients = useMemo(
    () => calendarRecipientOptions(appSettings?.outlookCalendarRecipients || ""),
    [appSettings?.outlookCalendarRecipients]
  );

  const selectedModel = useMemo(() => {
    if (!codexStatus?.models.length) return undefined;
    if (model !== "default") {
      const explicit = codexStatus.models.find((item) => item.id === model);
      if (explicit) return explicit;
    }
    return codexStatus.models.find((item) => item.id === codexStatus.configuredModel)
      || codexStatus.models.find((item) => item.isDefault)
      || codexStatus.models[0];
  }, [codexStatus, model]);

  const effectiveReasoningEffort = reasoningEffort === "default"
    ? codexStatus?.configuredReasoningEffort || selectedModel?.defaultReasoningEffort || "medium"
    : reasoningEffort;
  const effectiveServiceTier = serviceTier === "default"
    ? codexStatus?.configuredServiceTier || "standard"
    : serviceTier;

  const deferredThreadQuery = useDeferredValue(threadQuery);
  const displayedThreads = useMemo(() => {
    const query = deferredThreadQuery.trim().toLocaleLowerCase("zh-CN");
    return [...threads]
      .filter((thread) =>
        !isUnusedDraftThread(thread)
        && (!query || `${thread.title} ${thread.project}`.toLocaleLowerCase("zh-CN").includes(query))
      )
      .sort((left, right) => {
        const activityDelta = (right.lastActiveAt || 0) - (left.lastActiveAt || 0);
        if (activityDelta) return activityDelta;
        return Number(right.pinned) - Number(left.pinned);
      });
  }, [deferredThreadQuery, threads]);
  const renderedThreads = useMemo(
    () => displayedThreads.slice(0, threadRenderLimit),
    [displayedThreads, threadRenderLimit]
  );

  const executionFocus = useMemo(
    () => inferExecutionFocus(activeThread, threads),
    [activeThread, threads]
  );

  const allExecutionSuggestions = useMemo(() => {
    if (!domiSnapshot) return [];
    const suggestions: ExecutionSuggestion[] = [];
    const focusKey = executionFocus.label.replace(/\s+/g, "-").toLocaleLowerCase("zh-CN");
    const peopleCandidates = domiSnapshot.people
      .filter((person) =>
        ["S", "A"].includes(person.rating)
          && ["1.待Pitch", "3.加上联系方式"].includes(person.status)
      )
      .map((person) => {
        const haystack = [person.organization, ...person.types, ...person.cities]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        const matchedKeywords = executionFocus.keywords.filter((keyword) =>
          haystack.includes(keyword.toLocaleLowerCase("zh-CN"))
        );
        return {
          person,
          matchedKeywords,
          score: (ratingWeight[person.rating] || 0) * 20
            + matchedKeywords.length * 7
            + (person.status === "1.待Pitch" ? 6 : 2)
            + (person.lastContact ? 0 : 3)
        };
      })
      .sort((left, right) => right.score - left.score);
    const relevantPeople = executionFocus.keywords.length
      ? peopleCandidates.filter((candidate) => candidate.matchedKeywords.length > 0)
      : peopleCandidates;
    const relevantPeopleIds = new Set(relevantPeople.map(({ person }) => person.recordId));
    const selectedPeople = (relevantPeople.length
      ? [
          ...relevantPeople,
          ...peopleCandidates.filter(({ person }) => !relevantPeopleIds.has(person.recordId))
        ]
      : peopleCandidates
    ).slice(0, 12);

    selectedPeople.forEach(({ person, matchedKeywords }, index) => {
      const displayName = concisePersonName(person.name);
      const focusMatched = matchedKeywords.length > 0 && executionFocus.label !== "当前重点";
      const context = focusMatched
        ? `${executionFocus.label} · 验证关键判断`
        : `${compactLabel(person.organization || person.types[0] || cleanPeopleStatus(person.status), 12)} · 建立联系`;
      suggestions.push({
        id: `person:${person.recordId}:${focusKey}`,
        title: `联系${displayName}`,
        context,
        reason: `${person.rating} 级人脉，${cleanPeopleStatus(person.status)}${focusMatched ? `；与${executionFocus.label}当前研究相关` : ""}`,
        priority: index === 0 && (focusMatched || person.rating === "S") ? "P1" : "P2",
        workflowId: "meeting-prep",
        prompt: [
          `围绕当前重点“${executionFocus.label}”准备联系“${person.name}”。`,
          "先使用 domi 插件查询 People 人脉记录、历史互动、相关项目材料和必要的公开资料，核验推荐理由。",
          "输出：沟通目标、需要验证的关键判断、5 个优先问题，以及一段简短联系话术草案。",
          "不要直接发送消息；如需修改 People 或其他外部记录，先展示变更并等待确认。"
        ].join("\n"),
        projectLabel: `推进执行 · ${executionFocus.label}`,
        externalType: "person",
        externalRecordId: person.recordId
      });
    });

    const projectCandidates = domiSnapshot.projects
      .filter((project) => ["S", "A"].includes(project.rating) && !/Miss|已投/i.test(project.status))
      .map((project) => {
        const haystack = [project.name, project.domain, ...project.subdomains, project.notes || ""]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        const focusMatched = executionFocus.label !== "当前重点"
          && haystack.includes(executionFocus.label.toLocaleLowerCase("zh-CN"));
        const isSourceProject = executionFocus.sourceThread?.externalType === "project"
          && project.recordId === executionFocus.sourceThread.externalRecordId;
        return { project, focusMatched, isSourceProject };
      })
      .sort((left, right) => {
        if (left.isSourceProject !== right.isSourceProject) return Number(right.isSourceProject) - Number(left.isSourceProject);
        if (left.focusMatched !== right.focusMatched) return Number(right.focusMatched) - Number(left.focusMatched);
        const ratingDelta = (ratingWeight[right.project.rating] || 0) - (ratingWeight[left.project.rating] || 0);
        if (ratingDelta) return ratingDelta;
        return (left.project.lastFollowup || 0) - (right.project.lastFollowup || 0);
      })
      .slice(0, 8);

    projectCandidates.forEach(({ project: activeProject, focusMatched, isSourceProject }, index) => {
      suggestions.push({
        id: `project:${activeProject.recordId}:followup`,
        title: `跟进${compactLabel(activeProject.name, 10)}`,
        context: `${activeProject.domain || "项目"} · 补齐最新进展`,
        reason: `${activeProject.rating || "未"}评级 · ${activeProject.status || "状态待补充"} · ${activeProject.lastFollowup ? "需要复核近期进展" : "尚无跟进日期"}`,
        priority: activeProject.rating === "S" && (isSourceProject || focusMatched || index === 0) ? "P1" : "P2",
        workflowId: "meeting-prep",
        prompt: [
          `为项目“${activeProject.name}”制定下一步推进方案。`,
          "先读取 Watching List、Wiki、本地资料库、历史沟通和最新公开动态，核对当前状态与信息缺口。",
          "输出本周最优先的 3 个动作、每个动作的目标、负责人建议和完成标准。",
          "默认只读；涉及外部写入或对外沟通时先等待确认。"
        ].join("\n"),
        projectLabel: `推进执行 · ${activeProject.name}`,
        externalType: "project",
        externalRecordId: activeProject.recordId
      });
    });

    const plaudItems = [...(plaudSnapshot?.items || [])]
      .filter(canGeneratePlaudNotes)
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))
      .slice(0, 8);
    plaudItems.forEach((plaudItem, index) => {
      suggestions.push({
        id: `plaud:${plaudItem.fileId}:notes`,
        title: `整理${conciseRecordingTitle(plaudItem.fileName)}`,
        context: `PLAUD · ${formatPlaudDuration(plaudItem.duration)} · 生成纪要并入库`,
        reason: `${plaudItem.fileName} · 已有文字稿 · ${formatPlaudDuration(plaudItem.duration)}`,
        priority: index === 0 ? "P1" : "P2",
        workflowId: "domi-router",
        prompt: plaudNotesWorkflowRequest(plaudItem),
        projectLabel: "推进执行 · PLAUD 纪要"
      });
    });

    const priorityWeight: Record<ExecutionSuggestionPriority, number> = { P1: 3, P2: 2, P3: 1 };
    return suggestions
      .sort((left, right) => priorityWeight[right.priority] - priorityWeight[left.priority]);
  }, [domiSnapshot, executionFocus, plaudSnapshot]);

  const executionSuggestions = useMemo(() => {
    const now = Date.now();
    return allExecutionSuggestions
      .filter((suggestion) => {
        const disposition = executionSuggestionState[suggestion.id];
        return !disposition?.dismissedAt
          && !disposition?.executedAt
          && (!disposition?.snoozedUntil || disposition.snoozedUntil <= now);
      })
      .slice(0, 4);
  }, [allExecutionSuggestions, executionSuggestionState]);

  const taskBoardSuggestions = useMemo(() => {
    const now = Date.now();
    return allExecutionSuggestions
      .filter((suggestion) => {
        const disposition = executionSuggestionState[suggestion.id];
        return !disposition?.dismissedAt
          && !disposition?.executedAt
          && (!disposition?.snoozedUntil || disposition.snoozedUntil <= now);
      })
      .slice(0, 12);
  }, [allExecutionSuggestions, executionSuggestionState]);

  const snoozedTaskSuggestions = useMemo(() => {
    const now = Date.now();
    return allExecutionSuggestions
      .filter((suggestion) => {
        const disposition = executionSuggestionState[suggestion.id];
        return !disposition?.dismissedAt
          && !disposition?.executedAt
          && Boolean(disposition?.snoozedUntil && disposition.snoozedUntil > now);
      })
      .sort((left, right) =>
        (executionSuggestionState[left.id]?.snoozedUntil || 0)
        - (executionSuggestionState[right.id]?.snoozedUntil || 0)
      );
  }, [allExecutionSuggestions, executionSuggestionState]);

  const queuedTaskItems = useMemo(() => Object.entries(queuedSubmissionsByThread)
    .flatMap(([threadId, submissions]) => submissions.map((submission) => ({
      submission,
      thread: threads.find((thread) => thread.id === threadId)
    })))
    .filter((item): item is { submission: QueuedSubmission; thread: Thread } => Boolean(item.thread))
    .sort((left, right) => left.submission.createdAt - right.submission.createdAt),
  [queuedSubmissionsByThread, threads]);

  const runningTaskThreads = useMemo(() => threads
    .filter((thread) => Boolean(activeRunsByThread[thread.id]))
    .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0)),
  [activeRunsByThread, threads]);

  const failedTaskThreads = useMemo(() => threads
    .filter((thread) => {
      if (activeRunsByThread[thread.id]) return false;
      const latestAssistant = [...thread.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      return latestAssistant?.status === "error";
    })
    .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0))
    .slice(0, 8),
  [activeRunsByThread, threads]);

  const completedTaskThreads = useMemo(() => threads
    .filter((thread) => {
      if (activeRunsByThread[thread.id] || isUnusedDraftThread(thread)) return false;
      const latestAssistant = [...thread.messages]
        .reverse()
        .find((message) => message.role === "assistant");
      return latestAssistant?.status === "done";
    })
    .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0))
    .slice(0, 12),
  [activeRunsByThread, threads]);

  const managedTasksByCategory = useMemo(() => {
    const priorityWeight: Record<DomiTask["priority"], number> = { P1: 3, P2: 2, P3: 1 };
    const sorted = [...(domiTaskBoard?.tasks || [])].sort((left, right) =>
      priorityWeight[right.priority] - priorityWeight[left.priority]
      || (Date.parse(left.dueAt || "") || Number.MAX_SAFE_INTEGER)
        - (Date.parse(right.dueAt || "") || Number.MAX_SAFE_INTEGER)
      || Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    );
    const active = sorted.filter((task) => task.status === "open" || task.status === "in_progress");
    return {
      active,
      keyMilestone: active.filter((task) => task.category === "key-milestone"),
      newEntry: active.filter((task) => task.category === "new-entry"),
      relationshipFollowUp: active.filter((task) => task.category === "relationship-follow-up"),
      projectFollowUp: active.filter((task) => task.category === "project-follow-up")
    };
  }, [domiTaskBoard]);

  const managedTaskCount = managedTasksByCategory.active.length;
  const taskNavigationCount = (domiTaskBoard?.configured
    ? managedTaskCount
    : taskBoardSuggestions.length + snoozedTaskSuggestions.length)
    + queuedTaskItems.length
    + failedTaskThreads.length
    + runningTaskThreads.length;

  const weeklyNewsDomains = FOLLOWED_NEWS_DOMAINS;
  const followedWeeklyNews = useMemo(() => {
    const borrowedFromThisPage = weeklyNewsPage > 0
      ? weeklyNewsBorrowedByPage[weeklyNewsPage - 1]
      : undefined;
    return (weeklyNews?.items || []).filter((item) =>
      item.recordId !== borrowedFromThisPage
        && isFollowedNewsItem(item)
    );
  }, [weeklyNews, weeklyNewsBorrowedByPage, weeklyNewsPage]);
  const weeklyNewsSubdomains = useMemo(() => {
    if (weeklyNewsDomain === "全部") return [];
    const counts = new Map<string, number>();
    followedWeeklyNews.forEach((item) => {
      if (!followedDomainsForNews(item).includes(weeklyNewsDomain)) return;
      projectSubdomainsForNews(item.subdomains, weeklyNewsDomain).forEach((subdomain) => {
        counts.set(subdomain, (counts.get(subdomain) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) =>
        right.count - left.count || left.name.localeCompare(right.name, "zh-CN")
      );
  }, [followedWeeklyNews, weeklyNewsDomain]);
  const visibleWeeklyNews = useMemo(() => followedWeeklyNews
    .filter((item) => weeklyNewsDomain === "全部"
      || newsMatchesTaxonomyFilter(item, weeklyNewsDomain, weeklyNewsSubdomain)),
  [followedWeeklyNews, weeklyNewsDomain, weeklyNewsSubdomain]);
  const weeklyNewsFreshRecordIdSet = useMemo(
    () => new Set(weeklyNewsFreshRecordIds),
    [weeklyNewsFreshRecordIds]
  );
  const displayedWeeklyNews = useMemo(() => {
    const items = !(
      !weeklyNewsContinuation
      || (
        weeklyNewsDomain !== "全部"
        && !newsMatchesTaxonomyFilter(
          weeklyNewsContinuation,
          weeklyNewsDomain,
          weeklyNewsSubdomain
        )
      )
    )
      ? [...visibleWeeklyNews, weeklyNewsContinuation]
      : visibleWeeklyNews;
    return [...items].sort((left, right) => {
      const freshness = Number(weeklyNewsFreshRecordIdSet.has(right.recordId))
        - Number(weeklyNewsFreshRecordIdSet.has(left.recordId));
      return freshness || (right.publishedAt || 0) - (left.publishedAt || 0);
    });
  }, [
    visibleWeeklyNews,
    weeklyNewsContinuation,
    weeklyNewsDomain,
    weeklyNewsSubdomain,
    weeklyNewsFreshRecordIdSet
  ]);
  const displayedFreshWeeklyNewsCount = displayedWeeklyNews.reduce(
    (count, item) => count + Number(weeklyNewsFreshRecordIdSet.has(item.recordId)),
    0
  );

  const deferredDomiQuery = useDeferredValue(domiQuery);
  const deferredDatabaseQuery = useDeferredValue(databaseQuery);
  const domiSearchResults = useMemo(() => {
    const query = deferredDomiQuery.trim().toLocaleLowerCase("zh-CN");
    if (!query || !domiSnapshot) return { projects: [], people: [] };
    const projects = domiSnapshot.projects
      .filter((project) =>
        [
          project.name,
          project.domain,
          project.status,
          project.notes || "",
          ...project.subdomains,
          ...(project.cities || []),
          ...(project.investors || [])
        ]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(query)
      )
      .slice(0, 5);
    const people = domiSnapshot.people
      .filter((person) =>
        [person.name, person.organization, person.status, ...person.types, ...person.cities]
          .join(" ")
          .toLocaleLowerCase("zh-CN")
          .includes(query)
      )
      .slice(0, 5);
    return { projects, people };
  }, [deferredDomiQuery, domiSnapshot]);

  const hasConversation = activeThread.messages.some((message) => message.role === "user")
    || Boolean(activeThread.externalType && activeThread.messages.length);
  const visibleMessages = useMemo(() => hasConversation
    ? activeThread.messages.filter(
        (message, index) => !(
          index === 0
          && message.role === "assistant"
          && message.status === "idle"
          && !activeThread.externalType
        )
      )
    : [], [activeThread.messages, hasConversation]);

  useLayoutEffect(() => {
    const textarea = composerRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";
    textarea.style.height = `${textarea.scrollHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight + 1
      ? "auto"
      : "hidden";
  }, [hasConversation, input]);

  useEffect(() => {
    let cancelled = false;
    workbench.loadSettings().then((result) => {
      if (cancelled || !result.ok || !result.settings) return;
      setAppSettings(result.settings);
      if (!result.settings.onboardingComplete) setSettingsOpen(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const cached = await workbench.loadDomiCache();
      if (cancelled) return;
      if (cached.snapshot) setDomiSnapshot(cached.snapshot);
      if (!hasNativeWorkbench) {
        setWeeklyNewsAutomationReady(true);
        return;
      }

      try {
        const [cachedNews, cachedTasks] = await Promise.all([
          workbench.listWeeklyNews({
            days: 7,
            limit: 100,
            page: 0,
            cacheOnly: true
          }),
          workbench.listDomiTasks({ cacheOnly: true })
        ]);
        const hasCachedNews = Boolean(cachedNews.ok && cachedNews.items);
        if (hasCachedNews) {
          weeklyNewsSnapshotRef.current = cachedNews;
          weeklyNewsLatestSnapshotRef.current = cachedNews;
          setWeeklyNews(cachedNews);
        }
        if (cachedTasks.configured || cachedTasks.tasks.length > 0) {
          setDomiTaskBoard(cachedTasks);
        }
        const status = await workbench.checkCodex();
        setCodexStatus(status);
        if (!status.pluginSetup?.ok) {
          const pluginError = status.pluginSetup?.error
            || "domi 插件尚未准备完成，请在 Codex 连接中重新检测。";
          setDomiError(pluginError);
          setDomiTaskError(pluginError);
          setWeeklyNewsError(pluginError);
          return;
        }

        await Promise.allSettled([
          refreshDomi(),
          refreshDomiTaskBoard({ silent: Boolean(cachedTasks.tasks.length) }),
          refreshWeeklyNews(0, { silent: hasCachedNews, preserveView: true })
        ]);
      } finally {
        if (!cancelled) setWeeklyNewsAutomationReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (workspaceView !== "tasks" || !hasNativeWorkbench || domiTaskLoading) return;
    if (!domiTaskBoard) void refreshDomiTaskBoard();
  }, [workspaceView, domiTaskBoard, domiTaskLoading]);

  useEffect(() => {
    if (!appSettings) return;
    if (!plaudEnabled) {
      setPlaudSnapshot(null);
      setPlaudError("");
      setPlaudNotice("");
      setPlaudLoading(false);
      setPlaudLoadingMore(false);
      setPlaudSyncing(false);
      return;
    }
    if (!weeklyNewsAutomationReady) return;
    const timer = window.setTimeout(() => {
      void refreshPlaudQueue();
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [plaudEnabled, appSettings?.plaudBrowser, weeklyNewsAutomationReady]);

  useEffect(() => {
    if (!selectedWorkflow?.requiresPlaud || plaudEnabled) return;
    setSelectedWorkflowId(undefined);
  }, [plaudEnabled, selectedWorkflow?.requiresPlaud]);

  useEffect(() => {
    if (weeklyNewsDomain !== "全部" && !weeklyNewsDomains.includes(weeklyNewsDomain)) {
      setWeeklyNewsDomain("全部");
      setWeeklyNewsSubdomain("全部");
    }
  }, [weeklyNewsDomain, weeklyNewsDomains]);

  useEffect(() => {
    if (
      weeklyNewsDomain === "全部"
      || (
        weeklyNewsSubdomain !== "全部"
        && !weeklyNewsSubdomains.some((subdomain) => subdomain.name === weeklyNewsSubdomain)
      )
    ) {
      setWeeklyNewsSubdomain("全部");
    }
  }, [weeklyNewsDomain, weeklyNewsSubdomain, weeklyNewsSubdomains]);

  useEffect(() => {
    if (!weeklyNewsScanning || !weeklyNewsScanStartedAt) return;
    const updateElapsed = () => {
      setWeeklyNewsScanElapsed(Math.max(0, Math.floor((Date.now() - weeklyNewsScanStartedAt) / 1000)));
    };
    updateElapsed();
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [weeklyNewsScanning, weeklyNewsScanStartedAt]);

  useEffect(() => {
    if (!domiTaskSyncState.startedAt) {
      setDomiTaskSyncElapsed(0);
      return;
    }
    const updateElapsed = () => {
      const end = domiTaskSyncState.completedAt || Date.now();
      setDomiTaskSyncElapsed(Math.max(
        0,
        Math.floor((end - domiTaskSyncState.startedAt!) / 1000)
      ));
    };
    updateElapsed();
    if (domiTaskSyncState.completedAt) return;
    const timer = window.setInterval(updateElapsed, 1000);
    return () => window.clearInterval(timer);
  }, [domiTaskSyncState.startedAt, domiTaskSyncState.completedAt]);

  useEffect(() => {
    let cancelled = false;
    workbench.loadState(initialSnapshot).then((result) => {
      if (cancelled) {
        return;
      }
      const state = result.state as WorkbenchSnapshot | undefined;
      if (result.ok && state?.threads?.length) {
        const loadedThreads = compactUnusedDraftThreads(
          state.threads.map(migrateLegacyTodoThreadLabels),
          state.activeThreadId
        );
        const loadedActiveThreadId = loadedThreads.some(
          (thread) => thread.id === state.activeThreadId
        )
          ? state.activeThreadId
          : loadedThreads[0].id;
        persistedThreadsRef.current = new Map(state.threads.map((thread) => [thread.id, thread]));
        setThreads(loadedThreads);
        setActiveThreadId(loadedActiveThreadId);
        setExecutionSuggestionState(state.executionSuggestionState || {});
        if (state.agentPreferences) {
          const loadedActiveThread = loadedThreads.find(
            (thread) => thread.id === loadedActiveThreadId
          );
          const useNewThreadDefaults = Boolean(
            loadedActiveThread && isUnusedDraftThread(loadedActiveThread)
          );
          setModel(useNewThreadDefaults
            ? NEW_THREAD_MODEL
            : state.agentPreferences.model || NEW_THREAD_MODEL);
          setReasoningEffort(useNewThreadDefaults
            ? NEW_THREAD_REASONING_EFFORT
            : state.agentPreferences.reasoningEffort || NEW_THREAD_REASONING_EFFORT);
          setServiceTier(useNewThreadDefaults
            ? NEW_THREAD_SERVICE_TIER
            : state.agentPreferences.serviceTier || NEW_THREAD_SERVICE_TIER);
          setDomiPluginEnabled(
            useNewThreadDefaults
              ? true
              : state.agentPreferences.domiPluginEnabled !== false
          );
        }
      }
      setStorageReady(true);
    }).catch(() => {
      if (!cancelled) {
        setStorageReady(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }
    const timer = window.setTimeout(() => {
      const previousThreads = persistedThreadsRef.current;
      const nextThreadIds = new Set(threads.map((thread) => thread.id));
      const changedThreads = threads.filter((thread) => previousThreads.get(thread.id) !== thread);
      const deletedThreadIds = [...previousThreads.keys()].filter((id) => !nextThreadIds.has(id));
      const persistedSnapshot = new Map(threads.map((thread) => [thread.id, thread]));
      const patch = {
        meta: {
          version: 2,
          activeThreadId,
          agentPreferences: { model, reasoningEffort, serviceTier, domiPluginEnabled },
          executionSuggestionState
        },
        threads: changedThreads,
        deletedThreadIds,
        threadOrder: threads.map((thread) => thread.id)
      };
      persistenceQueueRef.current = persistenceQueueRef.current
        .catch(() => undefined)
        .then(() => workbench.saveStatePatch(patch))
        .then((result) => {
          if (result.ok) persistedThreadsRef.current = persistedSnapshot;
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    activeThreadId,
    domiPluginEnabled,
    executionSuggestionState,
    model,
    reasoningEffort,
    serviceTier,
    storageReady,
    threads
  ]);

  useEffect(() => {
    const closeModelMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".model-picker")) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("pointerdown", closeModelMenu);
    return () => document.removeEventListener("pointerdown", closeModelMenu);
  }, []);

  useEffect(() => {
    const closeThreadMenu = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && !target.closest(".thread-row")) {
        setThreadMenuId(null);
      }
    };
    document.addEventListener("pointerdown", closeThreadMenu);
    return () => document.removeEventListener("pointerdown", closeThreadMenu);
  }, []);

  useEffect(() => {
    const unsubscribe = workbench.onCodexEvent((payload) => {
      if (payload.runId === weeklyNewsRunIdRef.current && payload.type === "assistant-delta") {
        weeklyNewsOutputRef.current = payload.output !== undefined
          ? payload.output
          : `${weeklyNewsOutputRef.current}${payload.text || ""}`;
        setWeeklyNewsScanStage(weeklyNewsScanStageFromOutput(weeklyNewsOutputRef.current));
      }
      handleCodexEvent(payload);
    });
    return () => {
      unsubscribe();
      if (assistantDeltaFlushTimerRef.current !== null) {
        window.clearTimeout(assistantDeltaFlushTimerRef.current);
        assistantDeltaFlushTimerRef.current = null;
      }
      pendingAssistantDeltasRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!storageReady || codexRecoveryStartedRef.current) return;
    if (typeof workbench.recoverCodexThread !== "function") return;
    codexRecoveryStartedRef.current = true;

    const candidates = threadsRef.current
      .filter((thread) => {
        const latestAssistant = [...thread.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        return Boolean(
          thread.codexThreadId
          && latestAssistant
          && (latestAssistant.status === "running" || latestAssistant.status === "error")
        );
      })
      .slice(0, 12);

    void (async () => {
      for (const thread of candidates) {
        const latestAssistant = [...thread.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (!thread.codexThreadId || !latestAssistant) continue;

        const result = await workbench.recoverCodexThread(thread.codexThreadId);
        if (!result.ok) continue;

        if (result.status === "running" && result.runId) {
          runContextRef.current.set(result.runId, {
            threadId: thread.id,
            assistantMessageId: latestAssistant.id
          });
          setActiveRunsByThread((current) => ({ ...current, [thread.id]: result.runId! }));
          patchMessage(latestAssistant.id, {
            content: result.output || latestAssistant.content,
            status: "running"
          });
          continue;
        }

        if (result.status === "completed" && result.output) {
          patchMessage(latestAssistant.id, { content: result.output, status: "done" });
          patchThread(thread.id, {
            updatedAt: nowLabel(),
            lastActiveAt: Date.now(),
            hasUnreadCompletion: thread.id !== activeThreadIdRef.current
          });
          continue;
        }

        if (result.status === "stopped") {
          const recoveryNote = "任务已中断。如果不是你主动停止，通常是 domi 重启、开发版刷新或 Codex 连接断开导致；在当前对话发送“继续”即可从中断处续做。";
          const previousContent = latestAssistant.content
            .replace(/\n*执行失败：Codex turn 状态：(interrupted|cancelled|canceled)\s*$/i, "")
            .trim();
          patchMessage(latestAssistant.id, {
            content: [result.output || previousContent, recoveryNote]
              .filter(Boolean)
              .join("\n\n"),
            status: "done"
          });
          patchThread(thread.id, {
            updatedAt: nowLabel(),
            lastActiveAt: Date.now(),
            hasUnreadCompletion: thread.id !== activeThreadIdRef.current
          });
          addTimeline(thread.id, {
            runId: result.runId || `recovery-${thread.id}`,
            title: "执行已中断",
            detail: "可在当前对话发送“继续”续做",
            kind: "event",
            status: "stopped"
          });
          continue;
        }

        if (result.status === "failed" && result.error) {
          patchMessage(latestAssistant.id, {
            content: [result.output, `执行失败：${result.error}`].filter(Boolean).join("\n\n"),
            status: "error"
          });
        }
      }
    })();
  }, [storageReady]);

  useEffect(() => {
    for (const [threadId, queue] of Object.entries(queuedSubmissionsByThread)) {
      if (queue.length === 0 || activeRunsByThread[threadId]) continue;
      if (queueStartingThreadIdsRef.current.has(threadId)) continue;
      if ([...runContextRef.current.values()].some((context) => context.threadId === threadId)) continue;

      const targetThread = threads.find((thread) => thread.id === threadId);
      if (!targetThread) {
        setQueuedSubmissionsByThread((current) => {
          const next = { ...current };
          delete next[threadId];
          return next;
        });
        continue;
      }

      const queued = queue[0];
      const workflow = workflows.find((item) => item.id === queued.workflowId);
      queueStartingThreadIdsRef.current.add(threadId);
      setQueuedSubmissionsByThread((current) => {
        const remaining = (current[threadId] || []).slice(1);
        if (remaining.length > 0) return { ...current, [threadId]: remaining };
        const next = { ...current };
        delete next[threadId];
        return next;
      });

      void submitToCodex(workflow, queued.input, {
        thread: targetThread,
        useDomiPlugin: queued.useDomiPlugin,
        attachments: queued.attachments,
        model: queued.model,
        reasoningEffort: queued.reasoningEffort,
        serviceTier: queued.serviceTier,
        preserveComposer: true
      }).finally(() => {
        queueStartingThreadIdsRef.current.delete(threadId);
      });
    }
  }, [activeRunsByThread, queuedSubmissionsByThread, threads]);

  useLayoutEffect(() => {
    if (workspaceView !== "conversation" || !hasConversation) return;
    const position = chatScrollPositionsRef.current.get(activeThreadId) || {
      top: 0,
      atBottom: true
    };
    scheduleChatScrollRestore(activeThreadId, position);
    return cancelScheduledChatScrollRestore;
  }, [activeThreadId, hasConversation, workspaceView]);

  useEffect(() => {
    if (workspaceView !== "conversation" || !hasConversation) return;
    const position = chatScrollPositionsRef.current.get(activeThreadId);
    if (position && !position.atBottom) return;
    scheduleChatScrollRestore(activeThreadId, { top: 0, atBottom: true });
  }, [activeThread?.messages, activeThreadId, hasConversation, isRunning, workspaceView]);

  useEffect(() => {
    setThreadRenderLimit(80);
  }, [deferredThreadQuery]);

  useEffect(() => {
    setThreads((current) => {
      const activeHasUnreadCompletion = current.some(
        (thread) => thread.id === activeThreadId && thread.hasUnreadCompletion
      );
      if (!activeHasUnreadCompletion) return current;
      return current.map((thread) => thread.id === activeThreadId
        ? { ...thread, hasUnreadCompletion: false }
        : thread);
    });
  }, [activeThreadId]);

  useEffect(() => {
    if (!markdownDocument || !rightPanelOpen) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveOpenMarkdown();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [markdownDocument, markdownDraft, markdownSaving, rightPanelOpen]);

  useEffect(() => {
    try {
      window.localStorage.setItem("domi.layout.leftPanelWidth", String(Math.round(leftPanelWidth)));
    } catch {
      // Layout persistence is optional when local storage is unavailable.
    }
  }, [leftPanelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem("domi.layout.contextPanelWidth", String(Math.round(contextPanelWidth)));
    } catch {
      // Layout persistence is optional when local storage is unavailable.
    }
  }, [contextPanelWidth]);

  useEffect(() => {
    try {
      window.localStorage.setItem("domi.layout.documentPanelWidth", String(Math.round(documentPanelWidth)));
    } catch {
      // Layout persistence is optional when local storage is unavailable.
    }
  }, [documentPanelWidth]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const resize = panelResizeRef.current;
      if (!resize) return;

      if (resize.kind === "left") {
        setLeftPanelWidth(clamp(
          resize.startWidth + event.clientX - resize.startX,
          resize.minimum,
          resize.maximum
        ));
        return;
      }

      const nextWidth = clamp(
        resize.startWidth - (event.clientX - resize.startX),
        resize.minimum,
        resize.maximum
      );
      if (resize.kind === "document") setDocumentPanelWidth(nextWidth);
      else setContextPanelWidth(nextWidth);
    };

    const finishPanelResize = () => {
      if (!panelResizeRef.current) return;
      panelResizeRef.current = null;
      document.body.classList.remove("panel-resizing");
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", finishPanelResize);
    window.addEventListener("pointercancel", finishPanelResize);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishPanelResize);
      window.removeEventListener("pointercancel", finishPanelResize);
      document.body.classList.remove("panel-resizing");
    };
  }, []);

  function beginPanelResize(
    kind: "left" | "context" | "document",
    event: ReactPointerEvent<HTMLDivElement>
  ) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const minimum = kind === "left"
      ? MIN_LEFT_PANEL_WIDTH
      : kind === "document"
        ? MIN_DOCUMENT_PANEL_WIDTH
        : MIN_CONTEXT_PANEL_WIDTH;
    const maximum = kind === "left"
      ? rightPanelOpen
        ? Math.min(420, window.innerWidth - activeRightPanelWidth - MIN_CHAT_PANEL_WIDTH)
        : Math.min(420, window.innerWidth - MIN_CHAT_PANEL_WIDTH)
      : window.innerWidth - leftPanelWidth - MIN_CHAT_PANEL_WIDTH;
    panelResizeRef.current = {
      kind,
      startX: event.clientX,
      startWidth: kind === "left"
        ? leftPanelWidth
        : kind === "document"
          ? documentPanelWidth
          : contextPanelWidth,
      minimum,
      maximum
    };
    document.body.classList.add("panel-resizing");
  }

  function resizePanelWithKeyboard(
    kind: "left" | "context" | "document",
    event: ReactKeyboardEvent<HTMLDivElement>
  ) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const amount = event.shiftKey ? 40 : 12;
    const direction = event.key === "ArrowRight" ? 1 : -1;

    if (kind === "left") {
      const maximum = rightPanelOpen
        ? Math.min(420, window.innerWidth - activeRightPanelWidth - MIN_CHAT_PANEL_WIDTH)
        : Math.min(420, window.innerWidth - MIN_CHAT_PANEL_WIDTH);
      setLeftPanelWidth((current) => clamp(current + amount * direction, MIN_LEFT_PANEL_WIDTH, maximum));
      return;
    }

    const minimum = kind === "document" ? MIN_DOCUMENT_PANEL_WIDTH : MIN_CONTEXT_PANEL_WIDTH;
    const maximum = window.innerWidth - leftPanelWidth - MIN_CHAT_PANEL_WIDTH;
    const update = (current: number) => clamp(current - amount * direction, minimum, maximum);
    if (kind === "document") setDocumentPanelWidth(update);
    else setContextPanelWidth(update);
  }

  async function refreshDomi() {
    if (domiSyncing) return;
    setDomiSyncing(true);
    setDomiError("");
    try {
      const result = await workbench.syncDomi();
      if (result.snapshot) setDomiSnapshot(result.snapshot);
      if (!result.ok) setDomiError(result.error || "domi 同步失败。 ");
    } catch (error) {
      setDomiError(error instanceof Error ? error.message : String(error));
    } finally {
      setDomiSyncing(false);
    }
  }

  function selectDatabaseRecord(
    entityType: DatabaseEntityType,
    recordId: string,
    snapshot = databaseSnapshot
  ) {
    const record = databaseRecords(snapshot, entityType)
      .find((item) => item.recordId === recordId);
    setDatabaseEntityType(entityType);
    setDatabaseSelectedId(record?.recordId || "");
    setDatabaseDraft(record ? databaseDraftForRecord(entityType, record) : null);
    setDatabaseExpandedCell(null);
    setDatabaseError("");
    setDatabaseNotice("");
  }

  function beginDatabaseRecordEdit(
    entityType: DatabaseEntityType,
    recordId: string,
    snapshot = databaseSnapshot
  ) {
    selectDatabaseRecord(entityType, recordId, snapshot);
    setDatabaseEditingId(recordId);
  }

  function beginDatabaseCellEdit(
    entityType: DatabaseEntityType,
    recordId: string,
    cell: HTMLTableCellElement
  ) {
    const field = cell.dataset.databaseField as keyof DatabaseDraft | undefined;
    const content = cell.querySelector<HTMLElement>(
      ".database-grid-clamp, strong, .database-pill-list"
    );
    const truncated = Boolean(content) && (
      (content?.scrollWidth || 0) > (content?.clientWidth || 0) + 1
      || (content?.scrollHeight || 0) > (content?.clientHeight || 0) + 1
    );
    const shouldExpand = Boolean(field) && (
      DATABASE_EXPANDED_TEXT_FIELDS.has(field as keyof DatabaseDraft)
      || truncated
    );
    const alreadyEditing = databaseEditingId === recordId
      && databaseDraft?.entityType === entityType;
    if (!alreadyEditing) beginDatabaseRecordEdit(entityType, recordId);
    if (field && shouldExpand) {
      const rect = cell.getBoundingClientRect();
      const width = Math.min(480, Math.max(340, rect.width * 1.8));
      const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
      const estimatedHeight = 210;
      const top = rect.top + estimatedHeight > window.innerHeight - 12
        ? Math.max(12, rect.bottom - estimatedHeight)
        : rect.top;
      setDatabaseExpandedCell({
        entityType,
        recordId,
        field,
        label: DATABASE_FIELD_LABELS[field] || "完整内容",
        left,
        top,
        width
      });
      return;
    }
    setDatabaseExpandedCell(null);
    window.setTimeout(() => {
      const editor = cell.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
        "input, select, textarea"
      );
      if (!editor) return;
      editor.focus({ preventScroll: true });
      if (editor instanceof HTMLTextAreaElement || (editor instanceof HTMLInputElement && editor.type === "text")) {
        editor.select();
      }
    }, 0);
  }

  function reopenExpandedDatabaseCell(
    event: SyntheticEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    event.stopPropagation();
    const field = event.currentTarget
      .closest<HTMLTableCellElement>("td[data-database-field]")
      ?.dataset.databaseField as keyof DatabaseDraft | undefined;
    if (!field || !DATABASE_EXPANDED_TEXT_FIELDS.has(field)) return;
    const cell = event.currentTarget.closest<HTMLTableCellElement>("td");
    const draft = databaseDraftRef.current;
    if (!cell || !draft) return;
    beginDatabaseCellEdit(draft.entityType, draft.recordId, cell);
  }

  function handleDatabaseRowClick(
    event: SyntheticEvent<HTMLTableRowElement>,
    entityType: DatabaseEntityType,
    recordId: string
  ) {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a")) return;
    const editableCell = target.closest<HTMLTableCellElement>("td[data-database-editable]");
    if (editableCell) {
      beginDatabaseCellEdit(entityType, recordId, editableCell);
      return;
    }
    selectDatabaseRecord(entityType, recordId);
  }

  function handleDatabaseRowKeyDown(
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    entityType: DatabaseEntityType,
    recordId: string
  ) {
    if (databaseEditingId !== recordId || databaseDraft?.entityType !== entityType) return;
    if (event.key === "Escape") {
      event.preventDefault();
      finishDatabaseRecordEdit(entityType, recordId);
      return;
    }
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void flushDatabaseAutoSave();
    }
  }

  function finishDatabaseRecordEdit(
    _entityType: DatabaseEntityType,
    _recordId: string
  ) {
    void flushDatabaseAutoSave();
    setDatabaseEditingId("");
    setDatabaseExpandedCell(null);
  }

  async function refreshDatabase(options: { preserveSelection?: boolean } = {}) {
    if (databaseLoading) return null;
    setDatabaseLoading(true);
    setDatabaseError("");
    try {
      const result = await workbench.listDomiDatabase();
      setDatabaseSnapshot(result);
      if (!result.ok) {
        setDatabaseError(result.error || "资料库读取失败。");
        return result;
      }
      const records = databaseRecords(result, databaseEntityType);
      const preferredId = options.preserveSelection ? databaseSelectedId : "";
      const selected = records.find((item) => item.recordId === preferredId) || records[0];
      setDatabaseSelectedId(selected?.recordId || "");
      setDatabaseEditingId("");
      setDatabaseExpandedCell(null);
      setDatabaseVisibleLimit(100);
      setDatabaseDraft(
        selected ? databaseDraftForRecord(databaseEntityType, selected) : null
      );
      return result;
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setDatabaseLoading(false);
    }
  }

  function switchDatabaseEntity(entityType: DatabaseEntityType) {
    const records = databaseRecords(databaseSnapshot, entityType);
    const selected = records[0];
    setDatabaseEntityType(entityType);
    setDatabaseQuery("");
    setDatabaseStatusFilter("全部");
    setDatabaseSortKey("updated");
    setDatabaseSortDirection("desc");
    setDatabaseVisibleLimit(100);
    setDatabaseSelectedId(selected?.recordId || "");
    setDatabaseEditingId("");
    setDatabaseExpandedCell(null);
    setDatabaseDraft(selected ? databaseDraftForRecord(entityType, selected) : null);
    setDatabaseError("");
    setDatabaseNotice("");
  }

  function updateDatabaseDraft<K extends keyof DatabaseDraft>(
    key: K,
    value: DatabaseDraft[K]
  ) {
    const current = databaseDraftRef.current;
    if (!current) return;
    const next = { ...current, [key]: value };
    databaseDraftRef.current = next;
    setDatabaseDraft(next);
    scheduleDatabaseAutoSave(next);
    setDatabaseError("");
    setDatabaseNotice("");
  }

  function scheduleDatabaseAutoSave(draft: DatabaseDraft, delay = 650) {
    databaseAutoSaveQueuedRef.current = draft;
    if (databaseAutoSaveTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveTimerRef.current);
    }
    databaseAutoSaveTimerRef.current = window.setTimeout(() => {
      databaseAutoSaveTimerRef.current = null;
      void flushDatabaseAutoSave();
    }, delay);
  }

  async function flushDatabaseAutoSave() {
    if (databaseAutoSaveTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveTimerRef.current);
      databaseAutoSaveTimerRef.current = null;
    }
    if (databaseAutoSaveInFlightRef.current) return;
    const draft = databaseAutoSaveQueuedRef.current;
    if (!draft) return;
    databaseAutoSaveQueuedRef.current = null;
    databaseAutoSaveInFlightRef.current = true;
    let request: DomiDatabaseUpdateRequest;
    if (draft.entityType === "project") {
      const valuation = draft.latestValuationUsd100m.trim();
      request = {
        entityType: "project",
        record: {
          recordId: draft.recordId,
          expectedUpdatedAt: draft.expectedUpdatedAt,
          name: draft.name.trim(),
          domain: draft.domain.trim(),
          subdomains: splitDatabaseList(draft.subdomains),
          status: draft.status,
          rating: draft.rating,
          notes: draft.notes,
          cities: splitDatabaseList(draft.cities),
          investors: splitDatabaseList(draft.investors),
          financingHistory: draft.financingHistory,
          latestValuationUsd100m: valuation ? Number(valuation) : null
        }
      };
    } else if (draft.entityType === "person") {
      request = {
        entityType: "person",
        record: {
          recordId: draft.recordId,
          expectedUpdatedAt: draft.expectedUpdatedAt,
          name: draft.name.trim(),
          types: splitDatabaseList(draft.types),
          organization: draft.organization,
          status: draft.status,
          rating: draft.rating,
          lastContact: draft.lastContact
            ? new Date(`${draft.lastContact}T00:00:00`).getTime()
            : null,
          cities: splitDatabaseList(draft.cities)
        }
      };
    } else {
      request = {
        entityType: "news",
        record: {
          recordId: draft.recordId,
          expectedUpdatedAt: draft.expectedUpdatedAt,
          title: draft.title.trim(),
          domains: splitDatabaseList(draft.domains),
          subdomains: splitDatabaseList(draft.subdomains),
          types: splitDatabaseList(draft.newsTypes),
          publishedAt: new Date(draft.publishedAt).getTime(),
          summary: draft.summary,
          investmentMeaning: draft.investmentMeaning,
          url: draft.url.trim(),
          source: draft.source,
          companies: draft.companies,
          institutions: draft.institutions,
          importance: Number(draft.importance),
          confidence: Number(draft.confidence),
          evidenceStatus: draft.evidenceStatus,
          action: draft.action,
          worthFollowing: draft.worthFollowing
        }
      };
    }
    setDatabaseSaving(true);
    setDatabaseError("");
    setDatabaseNotice("");
    try {
      const result = await workbench.updateDomiDatabaseRecord(request);
      if (!result.ok) {
        setDatabaseError(result.error || "资料库记录保存失败。");
        return;
      }
      if (result.snapshot) setDomiSnapshot(result.snapshot);
      const record = result.record;
      if (record) {
        setDatabaseSnapshot((current) =>
          replaceDatabaseSnapshotRecord(current, draft.entityType, record)
        );
        const savedDraft = databaseDraftForRecord(draft.entityType, record);
        const queuedAfterSave = databaseAutoSaveQueuedRef.current as DatabaseDraft | null;
        if (
          queuedAfterSave?.entityType === draft.entityType
          && queuedAfterSave.recordId === record.recordId
        ) {
          databaseAutoSaveQueuedRef.current = {
            ...queuedAfterSave,
            expectedUpdatedAt: savedDraft.expectedUpdatedAt
          };
        }
        if (
          databaseDraftRef.current?.entityType === draft.entityType
          && databaseDraftRef.current.recordId === record.recordId
        ) {
          setDatabaseSelectedId(record.recordId);
        }
        setDatabaseDraft((current) => {
          if (current?.entityType !== draft.entityType || current.recordId !== record.recordId) {
            return current;
          }
          const next = { ...current, expectedUpdatedAt: savedDraft.expectedUpdatedAt };
          databaseDraftRef.current = next;
          return next;
        });
      }
      setDatabaseNotice("已自动保存，并同步更新数据库、Markdown 和资料目录。");
      if (draft.entityType === "news") {
        void refreshWeeklyNews(weeklyNewsPage, { silent: true });
      }
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : String(error));
    } finally {
      databaseAutoSaveInFlightRef.current = false;
      setDatabaseSaving(false);
      if (databaseAutoSaveQueuedRef.current) {
        scheduleDatabaseAutoSave(databaseAutoSaveQueuedRef.current, 180);
      }
    }
  }

  async function previewDatabaseRecord(
    entityType: DatabaseEntityType,
    record: DomiProject | DomiPerson | DomiNewsItem
  ) {
    setDatabaseError("");
    if (entityType === "news") {
      const url = (record as DomiNewsItem).url;
      if (!url) {
        setDatabaseError("这条行业信息没有可打开的原文链接。");
        return;
      }
      void workbench.openResource(url);
      return;
    }
    try {
      const result = await workbench.previewDomiDatabaseRecord({
        entityType,
        recordId: record.recordId
      });
      if (!result.ok || !result.resource) {
        setDatabaseError(result.error || "没有找到可在 domi 内预览的项目文档。");
        return;
      }
      openDocument(result.resource);
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : String(error));
    }
  }

  function openDatabaseRowContextMenu(
    event: ReactMouseEvent<HTMLTableRowElement>,
    entityType: DatabaseEntityType,
    record: DomiProject | DomiPerson | DomiNewsItem
  ) {
    event.preventDefault();
    event.stopPropagation();
    const menuWidth = 188;
    const menuHeight = 74;
    setDatabaseSelectedId(record.recordId);
    setDatabaseExpandedCell(null);
    setDatabaseRowContextMenu({
      entityType,
      recordId: record.recordId,
      expectedUpdatedAt: Number(record.updatedAt) || 0,
      title: databaseRecordTitle(entityType, record),
      left: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      top: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    });
  }

  function requestContextMenuDatabaseDelete() {
    if (!databaseRowContextMenu) return;
    const { entityType, recordId, expectedUpdatedAt, title } = databaseRowContextMenu;
    setDatabaseRowContextMenu(null);
    setDatabaseDeleteTarget({ entityType, recordId, expectedUpdatedAt, title });
    setDatabaseError("");
  }

  async function confirmDatabaseDelete() {
    const target = databaseDeleteTarget;
    if (!target || databaseDeleting || databaseSaving) return;
    setDatabaseDeleting(true);
    setDatabaseError("");
    setDatabaseNotice("");
    try {
      const result = await workbench.deleteDomiDatabaseRecord({
        entityType: target.entityType,
        recordId: target.recordId,
        expectedUpdatedAt: target.expectedUpdatedAt
      });
      if (!result.ok) {
        setDatabaseError(result.error || "资料库记录删除失败。");
        return;
      }
      if (result.snapshot) setDomiSnapshot(result.snapshot);
      const nextSnapshot = removeDatabaseSnapshotRecord(
        databaseSnapshot,
        target.entityType,
        target.recordId
      );
      setDatabaseSnapshot(nextSnapshot);
      const remaining = databaseRecords(nextSnapshot, target.entityType);
      const selected = remaining[0];
      setDatabaseSelectedId(selected?.recordId || "");
      setDatabaseEditingId("");
      setDatabaseExpandedCell(null);
      databaseAutoSaveQueuedRef.current = null;
      setDatabaseDraft(selected ? databaseDraftForRecord(target.entityType, selected) : null);
      setDatabaseNotice(
        result.filesPreserved
          ? `已从资料库移除“${target.title}”；本地原始文件仍保留。`
          : `已删除“${target.title}”。`
      );
      if (target.entityType === "news") {
        void refreshWeeklyNews(weeklyNewsPage, { silent: true });
      }
      setDatabaseDeleteTarget(null);
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setDatabaseDeleting(false);
    }
  }

  function refreshLocalIndexForSearch() {
    if (appSettingsRef.current?.storageBackend !== "local" || domiSyncing) return;
    const now = Date.now();
    if (now - localSearchRefreshAtRef.current < 15_000) return;
    localSearchRefreshAtRef.current = now;
    void refreshDomi();
  }

  async function refreshDomiTaskBoard(options: { silent?: boolean; fresh?: boolean } = {}) {
    if (!options.silent) setDomiTaskLoading(true);
    setDomiTaskError("");
    try {
      const result = await workbench.listDomiTasks({ fresh: options.fresh === true });
      setDomiTaskBoard(result);
      if (!result.ok && !result.stale && result.configured) {
        setDomiTaskError(result.error || `无法读取 ${todoDocumentLabel}。`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setDomiTaskError(message);
      return null;
    } finally {
      if (!options.silent) setDomiTaskLoading(false);
    }
  }

  async function refreshWeeklyNews(
    page = weeklyNewsPage,
    options: WeeklyNewsRefreshOptions = {}
  ) {
    if (weeklyNewsReadInFlightRef.current) return null;
    weeklyNewsReadInFlightRef.current = true;
    if (!options.silent) {
      weeklyNewsLoadingRef.current = true;
      setWeeklyNewsLoading(true);
      setWeeklyNewsError("");
    }
    try {
      const result = await workbench.listWeeklyNews({ days: 7, limit: 100, page });
      const resultPage = result.page ?? page;
      const borrowedFromThisPage = resultPage > 0
        ? weeklyNewsBorrowedByPage[resultPage - 1]
        : undefined;
      const eligibleItems = (result.items || []).filter((item) =>
        item.recordId !== borrowedFromThisPage
          && isFollowedNewsItem(item)
      );
      let continuation: DomiNewsItem | null = null;

      if (result.ok && result.hasOlder && eligibleItems.length % 2 === 1) {
        try {
          const olderResult = await workbench.listWeeklyNews({ days: 7, limit: 100, page: resultPage + 1 });
          continuation = (olderResult.items || []).find(isFollowedNewsItem) || null;
        } catch {
          continuation = null;
        }
      }

      if (!result.ok) {
        if (!options.silent) setWeeklyNewsError(result.error || "行业新闻读取失败。 ");
        return result;
      }

      if (resultPage === 0) weeklyNewsLatestSnapshotRef.current = result;
      const shouldUpdateVisiblePage = !options.preserveView || resultPage === weeklyNewsPageRef.current;
      if (shouldUpdateVisiblePage) {
        weeklyNewsSnapshotRef.current = result;
        setWeeklyNews(result);
        setWeeklyNewsContinuation(continuation);
      }
      setWeeklyNewsBorrowedByPage((current) => {
        const next = { ...current };
        if (continuation) next[resultPage] = continuation.recordId;
        else delete next[resultPage];
        return next;
      });
      if (!options.preserveView) {
        setWeeklyNewsPage(resultPage);
        setWeeklyNewsDomain("全部");
        window.requestAnimationFrame(() => weeklyNewsRef.current?.scrollTo({ top: 0, behavior: "smooth" }));
      }
      return result;
    } catch (error) {
      if (!options.silent) {
        setWeeklyNewsError(error instanceof Error ? error.message : String(error));
      }
      return null;
    } finally {
      weeklyNewsReadInFlightRef.current = false;
      if (!options.silent) {
        weeklyNewsLoadingRef.current = false;
        setWeeklyNewsLoading(false);
      }
    }
  }

  async function scanWeeklyNews(automatic = false): Promise<WeeklyNewsScanOutcome> {
    if (weeklyNewsScanningRef.current || weeklyNewsLoadingRef.current) {
      return { status: "skipped" };
    }
    if (automatic && Object.keys(activeRunsByThread).length > 0) {
      return { status: "skipped" };
    }
    const radarWorkflow = workflows.find((workflow) => workflow.id === "investment-radar");
    if (!radarWorkflow) {
      setWeeklyNewsError("未找到 domi 行业雷达工作流。 ");
      return { status: "failed" };
    }

    weeklyNewsScanningRef.current = true;
    setWeeklyNewsScanning(true);
    setWeeklyNewsError("");
    setWeeklyNewsNotice("");
    setWeeklyNewsFreshRecordIds([]);
    const runId = createId("news-radar");
    weeklyNewsRunIdRef.current = runId;
    weeklyNewsOutputRef.current = "";
    setWeeklyNewsScanStartedAt(Date.now());
    setWeeklyNewsScanElapsed(0);
    setWeeklyNewsScanStage("正在建立增量检索水位");
    const now = Date.now();
    const currentWeeklyNews = weeklyNewsLatestSnapshotRef.current || weeklyNewsSnapshotRef.current;
    const lastRadarCheckpoint = Number(currentWeeklyNews?.radarCheckedThrough || 0);
    const { discoveryFrom, checkedAfter } = radarDiscoveryWindow(now, lastRadarCheckpoint);
    const priorityPeopleContext = radarPriorityPeopleContext(domiSnapshot?.people || []);
    const requestText = [
      radarWorkflow.defaultPrompt,
      FOLLOWED_PROJECT_TAXONOMY_PROMPT,
      `本轮发现窗口起点：${new Date(discoveryFrom).toISOString()}；上次成功检查水位：${checkedAfter ? new Date(checkedAfter).toISOString() : "无"}；本轮检查截止：${new Date(now).toISOString()}。`,
      "发现窗口包含重叠回看：窗口内水位之前发布但此前未收录的迟索引事件仍可新增；必须靠事件ID、规范标题、主体和关键事实去重，不能只按发布时间过滤。",
      "如果整个发现窗口没有达到收录标准的新事件，直接返回 added=0，不要为了凑数量扩大到更早日期，也不要重复扫描全部重点对象。"
    ].join("\n");
    const hasLatestBaseline = Boolean(currentWeeklyNews?.ok);
    const knownRecordIds = new Set(
      (hasLatestBaseline ? currentWeeklyNews?.items : [])?.map((item) => item.recordId)
    );
    let pollingPromise: Promise<void> | null = null;
    const pollLatestRecords = () => {
      if (!hasLatestBaseline || pollingPromise) return;
      pollingPromise = refreshWeeklyNews(0, { silent: true, preserveView: true })
        .then((snapshot) => {
          if (!snapshot?.ok) return;
          const addedItems = (snapshot.items || []).filter((item) =>
            !knownRecordIds.has(item.recordId)
              && isFollowedNewsItem(item)
          );
          if (!addedItems.length) return;
          setWeeklyNewsFreshRecordIds(addedItems.map((item) => item.recordId));
          setWeeklyNewsNotice(`扫描仍在进行：已写入 ${addedItems.length} 条新动态`);
        })
        .finally(() => {
          pollingPromise = null;
        });
    };
    const pollingTimer = window.setInterval(pollLatestRecords, 8000);
    const readLatestWithRetry = async (attempts = 3) => {
      let latest: DomiWeeklyNewsSnapshot | null = null;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        latest = await refreshWeeklyNews(0, {
          silent: attempt > 0,
          preserveView: attempt > 0
        });
        const hasNewRecord = Boolean(latest?.items?.some((item) => !knownRecordIds.has(item.recordId)));
        if (hasNewRecord || attempt === attempts - 1) return latest;
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      return latest;
    };
    try {
      const result = await workbench.runCodex({
        runId,
        prompt: workflowPrompt(radarWorkflow, requestText, priorityPeopleContext, true),
        requestText,
        ephemeral: true,
        background: automatic,
        workflowId: radarWorkflow.id,
        webSearch: true,
        model,
        reasoningEffort,
        serviceTier,
        workspacePath: activeThread.workspacePath
      });
      window.clearInterval(pollingTimer);
      if (pollingPromise) await pollingPromise;
      if (result.stopped) {
        setWeeklyNewsNotice(
          automatic
            ? "后台行业扫描已暂停，Codex 连接维护完成后会自动重试"
            : "行业扫描已停止"
        );
        return { status: "skipped" };
      }
      if (!result.ok) {
        const partial = await readLatestWithRetry(1);
        const partialAdded = (partial?.items || []).filter((item) =>
          !knownRecordIds.has(item.recordId)
            && isFollowedNewsItem(item)
        );
        if (partialAdded.length > 0) {
          setWeeklyNewsFreshRecordIds(partialAdded.map((item) => item.recordId));
          setWeeklyNewsNotice(`任务中断前已写入 ${partialAdded.length} 条新动态，已回读显示`);
        }
        setWeeklyNewsError(
          `${result.error || "domi 行业雷达执行中断。"}${partialAdded.length ? "" : " 本轮未写入新动态，旧新闻已保留。"}`
        );
        return { status: "failed", addedItems: partialAdded };
      }
      const parsedRadarCheckpoint = radarCheckpointFromOutput(result.output);
      let checkpointWarning = "";
      if (parsedRadarCheckpoint) {
        const checkpointResult = await workbench.saveWeeklyNewsCheckpoint({
          checkedThrough: parsedRadarCheckpoint
        });
        if (checkpointResult.ok && checkpointResult.radarCheckedThrough) {
          if (weeklyNewsLatestSnapshotRef.current) {
            weeklyNewsLatestSnapshotRef.current = {
              ...weeklyNewsLatestSnapshotRef.current,
              radarCheckedThrough: checkpointResult.radarCheckedThrough
            };
          }
          setWeeklyNews((current) => current
            ? { ...current, radarCheckedThrough: checkpointResult.radarCheckedThrough }
            : current);
        } else {
          checkpointWarning = "；检索水位保存失败，下次仍会回看最近 72 小时";
        }
      } else {
        checkpointWarning = "；本轮未返回检索水位，下次仍会回看最近 72 小时";
      }
      const refreshed = await readLatestWithRetry();
      if (!refreshed?.ok) return { status: "failed" };
      const latestItems = (refreshed.items || []).filter(isFollowedNewsItem);
      const addedItems = hasLatestBaseline
        ? latestItems.filter((item) => !knownRecordIds.has(item.recordId))
        : [];
      setWeeklyNewsFreshRecordIds(addedItems.map((item) => item.recordId));
      const completedAt = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(Date.now());
      setWeeklyNewsNotice(
        hasLatestBaseline
          ? addedItems.length > 0
            ? `${completedAt} 更新完成：新增 ${addedItems.length} 条，已置顶显示${checkpointWarning}`
            : `${completedAt} 扫描完成：本次没有符合筛选条件的新动态${checkpointWarning}`
          : `${completedAt} 扫描完成：已显示最新一周的行业动态${checkpointWarning}`
      );
      if (!automatic) {
        const finishedAt = Date.now();
        updateWeeklyNewsAutomation({
          phase: "idle",
          lastRadarSuccessAt: finishedAt,
          nextRadarAt: finishedAt + WEEKLY_NEWS_RADAR_INTERVAL_MS,
          retryAttempt: 0
        });
      }
      return { status: "success", addedItems };
    } catch (error) {
      setWeeklyNewsError(error instanceof Error ? error.message : String(error));
      return { status: "failed" };
    } finally {
      window.clearInterval(pollingTimer);
      if (weeklyNewsRunIdRef.current === runId) weeklyNewsRunIdRef.current = null;
      weeklyNewsScanningRef.current = false;
      setWeeklyNewsScanning(false);
    }
  }

  async function notifyImportantWeeklyNews(items: DomiNewsItem[]) {
    const notifiedRecordIds = readWeeklyNewsNotifiedIds();
    const importantItems = items.filter((item) =>
      item.importance >= 9 && !notifiedRecordIds.has(item.recordId)
    );
    if (!importantItems.length) return;

    importantItems.forEach((item) => notifiedRecordIds.add(item.recordId));
    saveWeeklyNewsNotifiedIds(notifiedRecordIds);
    if (document.hasFocus()) return;

    const title = importantItems.length === 1
      ? "domi 发现一条重要行业动态"
      : `domi 发现 ${importantItems.length} 条重要行业动态`;
    const body = importantItems
      .slice(0, 2)
      .map((item) => item.title)
      .join("；");
    await workbench.showNotification({ title, body });
  }

  async function runAutomaticWeeklyNewsSync() {
    if (weeklyNewsReadInFlightRef.current || weeklyNewsScanningRef.current) return false;
    const previous = weeklyNewsLatestSnapshotRef.current;
    const previousRecordIds = new Set((previous?.items || []).map((item) => item.recordId));
    const result = await refreshWeeklyNews(0, { silent: true, preserveView: true });
    if (!result?.ok) return false;

    if (previous?.ok) {
      const addedItems = (result.items || []).filter((item) =>
        !previousRecordIds.has(item.recordId)
          && isFollowedNewsItem(item)
      );
      if (addedItems.length > 0) {
        setWeeklyNewsFreshRecordIds(addedItems.map((item) => item.recordId));
        setWeeklyNewsNotice(`自动同步发现 ${addedItems.length} 条新动态，已置顶显示`);
        await notifyImportantWeeklyNews(addedItems);
      }
    }
    return true;
  }

  weeklyNewsAutoRefreshActionRef.current = runAutomaticWeeklyNewsSync;
  weeklyNewsAutoScanActionRef.current = () => scanWeeklyNews(true);

  useEffect(() => {
    if (!hasNativeWorkbench || !weeklyNewsAutomationReady || !appSettings?.onboardingComplete) return;
    let disposed = false;

    const runTick = async (focusTriggered = false) => {
      if (disposed || weeklyNewsAutomationOperationRef.current) return;
      const now = Date.now();
      const automation = weeklyNewsAutomationRef.current;
      const lightSyncStaleAfter = focusTriggered
        ? WEEKLY_NEWS_FOCUS_SYNC_STALE_MS
        : WEEKLY_NEWS_LIGHT_SYNC_INTERVAL_MS;

      if (now - automation.lastLightSyncAt >= lightSyncStaleAfter) {
        weeklyNewsAutomationOperationRef.current = true;
        updateWeeklyNewsAutomation({ phase: "syncing" });
        try {
          const synced = await weeklyNewsAutoRefreshActionRef.current?.();
          if (synced) updateWeeklyNewsAutomation({ lastLightSyncAt: Date.now() });
        } finally {
          weeklyNewsAutomationOperationRef.current = false;
          updateWeeklyNewsAutomation({ phase: "idle" });
        }
      }

      if (disposed || weeklyNewsAutomationOperationRef.current) return;
      const latestAutomation = weeklyNewsAutomationRef.current;
      const latestCheckpoint = Number(
        weeklyNewsLatestSnapshotRef.current?.radarCheckedThrough || 0
      );
      const lastSuccessfulRadar = Math.max(
        latestAutomation.lastRadarSuccessAt,
        latestCheckpoint
      );
      const regularNextRadarAt = lastSuccessfulRadar
        ? lastSuccessfulRadar + WEEKLY_NEWS_RADAR_INTERVAL_MS
        : now;
      const nextRadarAt = Math.max(latestAutomation.nextRadarAt, regularNextRadarAt);

      if (nextRadarAt > Date.now()) {
        if (nextRadarAt !== latestAutomation.nextRadarAt) {
          updateWeeklyNewsAutomation({ nextRadarAt });
        }
        return;
      }

      if (!appSettingsRef.current) return;
      if (appSettingsRef.current.externalAccessMode !== "always") {
        updateWeeklyNewsAutomation({
          phase: "idle",
          nextRadarAt: Date.now() + WEEKLY_NEWS_RADAR_INTERVAL_MS
        });
        return;
      }

      weeklyNewsAutomationOperationRef.current = true;
      updateWeeklyNewsAutomation({ phase: "scanning" });
      try {
        const outcome = await weeklyNewsAutoScanActionRef.current?.();
        const completedAt = Date.now();
        if (outcome?.status === "success") {
          await notifyImportantWeeklyNews(outcome.addedItems || []);
          updateWeeklyNewsAutomation({
            phase: "idle",
            lastRadarSuccessAt: completedAt,
            nextRadarAt: completedAt + WEEKLY_NEWS_RADAR_INTERVAL_MS,
            retryAttempt: 0
          });
        } else if (outcome?.status === "failed") {
          await notifyImportantWeeklyNews(outcome.addedItems || []);
          const retryAttempt = Math.min(
            latestAutomation.retryAttempt,
            WEEKLY_NEWS_RADAR_RETRY_DELAYS_MS.length - 1
          );
          updateWeeklyNewsAutomation({
            phase: "retrying",
            nextRadarAt: completedAt + WEEKLY_NEWS_RADAR_RETRY_DELAYS_MS[retryAttempt],
            retryAttempt: Math.min(retryAttempt + 1, WEEKLY_NEWS_RADAR_RETRY_DELAYS_MS.length - 1)
          });
        } else {
          updateWeeklyNewsAutomation({
            phase: "idle",
            nextRadarAt: completedAt + WEEKLY_NEWS_RADAR_RETRY_DELAYS_MS[0]
          });
        }
      } finally {
        weeklyNewsAutomationOperationRef.current = false;
      }
    };

    const handleFocus = () => void runTick(true);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void runTick(true);
    };
    const interval = window.setInterval(() => void runTick(), WEEKLY_NEWS_AUTOMATION_TICK_MS);
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    void runTick(true);

    return () => {
      disposed = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [weeklyNewsAutomationReady, appSettings?.onboardingComplete]);

  async function openWeeklyNews(item: DomiNewsItem) {
    if (!item.url) return;
    const result = await workbench.openResource(item.url);
    if (!result.ok) setWeeklyNewsError(result.error || "无法打开新闻原文。 ");
  }

  async function refreshPlaudQueue({ fresh = false }: { fresh?: boolean } = {}): Promise<DomiPlaudSnapshot | null> {
    if (appSettings?.plaudConnectionMode !== "enabled") return null;
    if (plaudListPromiseRef.current) return plaudListPromiseRef.current;
    if (plaudSyncPromiseRef.current || plaudMutationIdsRef.current.size > 0) return null;
    const revision = plaudSnapshotRevisionRef.current;
    setPlaudLoading(true);
    setPlaudError("");
    const request = (async (): Promise<DomiPlaudSnapshot | null> => {
      try {
        const result = await workbench.listPlaud({ fresh, offset: 0, limit: 50 });
        if (revision === plaudSnapshotRevisionRef.current) {
          setPlaudSnapshot(result);
          if (!result.ok) setPlaudError(result.error || "PLAUD 队列同步失败。 ");
        }
        return result;
      } catch (error) {
        if (revision === plaudSnapshotRevisionRef.current) {
          setPlaudError(error instanceof Error ? error.message : String(error));
        }
        return null;
      } finally {
        plaudListPromiseRef.current = null;
        setPlaudLoading(false);
      }
    })();
    plaudListPromiseRef.current = request;
    return request;
  }

  async function loadMorePlaudQueue(): Promise<DomiPlaudSnapshot | null> {
    if (appSettings?.plaudConnectionMode !== "enabled") return null;
    if (!plaudSnapshot?.ok || !plaudSnapshot.hasMore) return null;
    if (plaudListPromiseRef.current) return plaudListPromiseRef.current;
    if (plaudSyncPromiseRef.current || plaudMutationIdsRef.current.size > 0) return null;
    const revision = plaudSnapshotRevisionRef.current;
    const offset = Number(plaudSnapshot.nextOffset)
      || Number(plaudSnapshot.pageOffset || 0) + Number(plaudSnapshot.pageSize || 50);
    setPlaudLoadingMore(true);
    setPlaudError("");
    const request = (async (): Promise<DomiPlaudSnapshot | null> => {
      try {
        const result = await workbench.listPlaud({ offset, limit: 50 });
        if (revision !== plaudSnapshotRevisionRef.current) return result;
        if (!result.ok) {
          setPlaudError(result.error || "更早的 PLAUD 录音读取失败。 ");
          return result;
        }
        setPlaudSnapshot((current) => {
          if (!current) return result;
          const itemsById = new Map(
            (current.items || []).map((item) => [item.fileId, item])
          );
          for (const item of result.items || []) {
            itemsById.set(item.fileId, {
              ...itemsById.get(item.fileId),
              ...item
            });
          }
          const items = [...itemsById.values()].sort((left, right) => {
            const leftTime = Number(left.createdAt || left.editedAt) || 0;
            const rightTime = Number(right.createdAt || right.editedAt) || 0;
            return rightTime - leftTime || left.fileName.localeCompare(right.fileName, "zh-CN");
          });
          return {
            ...current,
            syncedAt: result.syncedAt || current.syncedAt,
            pageOffset: 0,
            pageSize: result.pageSize || current.pageSize,
            hasMore: Boolean(result.hasMore),
            nextOffset: result.nextOffset,
            items
          };
        });
        return result;
      } catch (error) {
        if (revision === plaudSnapshotRevisionRef.current) {
          setPlaudError(error instanceof Error ? error.message : String(error));
        }
        return null;
      } finally {
        plaudListPromiseRef.current = null;
        setPlaudLoadingMore(false);
      }
    })();
    plaudListPromiseRef.current = request;
    return request;
  }

  async function syncPlaudQueue(confirmed = false): Promise<DomiPlaudSyncResult | null> {
    if (appSettings?.plaudConnectionMode !== "enabled") return null;
    if (plaudSyncPromiseRef.current) return plaudSyncPromiseRef.current;
    if (plaudListPromiseRef.current) return null;
    if (plaudMutationIdsRef.current.size > 0) return null;
    plaudSnapshotRevisionRef.current += 1;
    setPlaudSyncing(true);
    setPlaudError("");
    setPlaudNotice("");
    const request = (async (): Promise<DomiPlaudSyncResult | null> => {
      try {
        let result = await workbench.syncPlaud({ confirmed });
        if (result.requiresConfirmation) {
          const count = result.pendingCount || 0;
          const approved = window.confirm(`PLAUD 中有 ${count} 条录音尚未生成文字稿，是否全部提交生成？`);
          if (!approved) return result;
          result = await workbench.syncPlaud({ confirmed: true });
        }
        if (result.snapshot) setPlaudSnapshot(result.snapshot);
        if (!result.ok) {
          setPlaudError(result.error || "PLAUD 同步或文字稿生成失败。 ");
          return result;
        }
        const generated = result.generatedCount || 0;
        const recovered = result.recoveredCount || 0;
        const failed = result.failedCount || 0;
        const completed: string[] = [];
        if (recovered) completed.push(`同步 ${recovered} 份已生成文字稿`);
        if (generated) completed.push(`生成 ${generated} 份文字稿`);
        setPlaudNotice(completed.length
          ? `已${completed.join("并")}${failed ? `，${failed} 份需要重试` : ""}`
          : failed
            ? `同步完成，${failed} 份文字稿仍需重试`
            : "已同步到最新 PLAUD 队列");
        return result;
      } catch (error) {
        setPlaudError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        plaudSyncPromiseRef.current = null;
        setPlaudSyncing(false);
      }
    })();
    plaudSyncPromiseRef.current = request;
    return request;
  }

  async function runPlaudNotesWorkflow(item: DomiPlaudItem) {
    if (appSettings?.plaudConnectionMode !== "enabled") {
      setSettingsInitialTab("plaud");
      setSettingsOpen(true);
      return;
    }
    if (launchingPlaudIdsRef.current.has(item.fileId)) return;
    const workflow = workflows.find((entry) => entry.id === "domi-router");
    if (!workflow) {
      setPlaudError("未找到 domi 录音主工作流。 ");
      return;
    }

    setPlaudLaunching(item.fileId, true);
    setPlaudError("");
    setPlaudNotice("");
    let handedOff = false;
    try {
      const projectId = `plaud-${item.fileId}`;
      let targetThread = threads.find((thread) => thread.projectId === projectId);
      if (!targetThread) {
        const workspaceResult = await workbench.createProjectWorkspace({
          projectId,
          projectName: `${item.fileName} 纪要`
        });
        if (!workspaceResult.ok || !workspaceResult.workspacePath) {
          setPlaudError(workspaceResult.error || "无法为该录音创建纪要工作区。 ");
          return;
        }
        targetThread = {
          id: createId("thread"),
          projectId,
          workspacePath: workspaceResult.workspacePath,
          title: `${item.fileName} 纪要`,
          project: "PLAUD · 纪要入库",
          updatedAt: nowLabel(),
          lastActiveAt: Date.now(),
          pinned: false,
          manualTitle: true,
          messages: [],
          timeline: [],
          lastUsage: null
        };
        setThreads((current) => [targetThread as Thread, ...current]);
      }

      const targetAlreadyRunning = Boolean(activeRunsByThread[targetThread.id])
        || [...runContextRef.current.values()].some((context) => context.threadId === targetThread.id);
      if (targetAlreadyRunning) {
        setPlaudNotice(`“${item.fileName}”的纪要入库任务正在执行`);
        return;
      }

      setActiveThreadId(targetThread.id);
      setDomiPluginEnabled(true);
      setPlaudNotice(`已启动“${item.fileName}”的 domi 纪要入库任务`);
      const execution = submitToCodex(workflow, plaudNotesWorkflowRequest(item), {
        thread: targetThread,
        useDomiPlugin: true,
        displayText: `生成“${item.fileName}”的纪要并按 domi 工作流入库`
      });
      handedOff = true;
      void execution
        .catch((error) => {
          setPlaudError(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setPlaudLaunching(item.fileId, false);
          void refreshPlaudQueue({ fresh: true });
        });
    } catch (error) {
      setPlaudError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!handedOff) setPlaudLaunching(item.fileId, false);
    }
  }

  function beginPlaudRename(item: DomiPlaudItem) {
    if (
      plaudListPromiseRef.current
      || plaudSyncPromiseRef.current
      || plaudMutationIdsRef.current.size > 0
      || launchingPlaudIdsRef.current.has(item.fileId)
    ) return;
    setEditingPlaudId(item.fileId);
    setPlaudTitleDraft(item.fileName);
    setPlaudError("");
    setPlaudNotice("");
  }

  function cancelPlaudRename() {
    setEditingPlaudId(null);
    setPlaudTitleDraft("");
  }

  async function savePlaudTitle(item: DomiPlaudItem) {
    if (plaudMutationIdsRef.current.has(item.fileId)) return;
    const fileName = plaudTitleDraft.trim();
    if (!fileName) {
      setPlaudError("录音标题不能为空。 ");
      return;
    }
    if (fileName === item.fileName) {
      cancelPlaudRename();
      return;
    }
    plaudMutationIdsRef.current.add(item.fileId);
    plaudSnapshotRevisionRef.current += 1;
    setRenamingPlaudId(item.fileId);
    setPlaudError("");
    setPlaudNotice("");
    try {
      const result = await workbench.renamePlaud({ fileId: item.fileId, fileName });
      if (!result.ok || !result.fileName) {
        setPlaudError(result.error || "PLAUD 标题修改失败。 ");
        return;
      }
      setPlaudSnapshot((current) => current ? {
        ...current,
        syncedAt: Date.now(),
        items: (current.items || []).map((entry) =>
          entry.fileId === item.fileId ? { ...entry, fileName: result.fileName || fileName } : entry
        )
      } : current);
      setPlaudNotice("录音标题已同步到 PLAUD");
      cancelPlaudRename();
    } catch (error) {
      setPlaudError(error instanceof Error ? error.message : String(error));
    } finally {
      plaudMutationIdsRef.current.delete(item.fileId);
      setRenamingPlaudId(null);
    }
  }

  async function deletePlaudRecording(item: DomiPlaudItem) {
    if (
      plaudListPromiseRef.current
      || plaudSyncPromiseRef.current
      || plaudMutationIdsRef.current.size > 0
      || launchingPlaudIdsRef.current.has(item.fileId)
    ) return;
    const approved = window.confirm(
      `确定将 PLAUD 录音“${item.fileName}”移入回收站吗？\n\ndomi 本地已生成的文字稿和纪要不会删除。`
    );
    if (!approved) return;

    plaudMutationIdsRef.current.add(item.fileId);
    plaudSnapshotRevisionRef.current += 1;
    setDeletingPlaudId(item.fileId);
    setPlaudError("");
    setPlaudNotice("");
    if (editingPlaudId === item.fileId) cancelPlaudRename();
    try {
      const result = await workbench.deletePlaud({ fileId: item.fileId });
      if (!result.ok || !result.trashed) {
        setPlaudError(result.error || "PLAUD 录音删除失败。 ");
        return;
      }
      setPlaudSnapshot((current) => current ? {
        ...current,
        syncedAt: Date.now(),
        pendingCount: Math.max(
          0,
          (current.pendingCount || 0) - (!item.hasTranscript && !item.hasSummary ? 1 : 0)
        ),
        queueCount: Math.max(0, (current.queueCount || 0) - (item.queueStage ? 1 : 0)),
        items: (current.items || []).filter((entry) => entry.fileId !== item.fileId)
      } : current);
      setPlaudNotice(`已将“${item.fileName}”移入 PLAUD 回收站`);
    } catch (error) {
      setPlaudError(error instanceof Error ? error.message : String(error));
    } finally {
      plaudMutationIdsRef.current.delete(item.fileId);
      setDeletingPlaudId(null);
    }
  }

  function selectModel(modelId: string) {
    const nextModel = codexStatus?.models.find((item) => item.id === modelId);
    if (!nextModel) return;

    setModel(modelId);
    if (!nextModel.supportedReasoningEfforts.some((option) => option.id === effectiveReasoningEffort)) {
      setReasoningEffort(nextModel.defaultReasoningEffort);
    }
    if (
      effectiveServiceTier !== "standard"
      && !nextModel.serviceTiers.some((tier) => tier.id === effectiveServiceTier)
    ) {
      setServiceTier("standard");
    }
  }

  async function saveAppSettings(request: AppSettingsSaveRequest): Promise<AppSettingsSaveResult> {
    const result = await workbench.saveSettings(request);
    if (result.ok && result.settings) {
      setAppSettings(result.settings);
      if (result.codex) setCodexStatus(result.codex);
      const dataConnectionChanged = [
        "storageBackend",
        "projectBaseToken",
        "projectTableId",
        "peopleBaseToken",
        "peopleTableId",
        "radarBaseToken",
        "radarTableId",
        "wikiSpaceId",
        "taskDocumentUrl",
        "localLibraryDir",
        "localRepositoryDir"
      ].some((key) => Object.prototype.hasOwnProperty.call(request, key));
      const documentLibraryLocationChanged = [
        "storageBackend",
        "localLibraryDir",
        "localRepositoryDir"
      ].some((key) => Object.prototype.hasOwnProperty.call(request, key));
      if (documentLibraryLocationChanged) {
        documentLibraryRequestRef.current += 1;
        setDocumentLibrary(null);
        setDocumentLibraryError("");
        setDocumentLibrarySelectedFolder("");
        setDocumentLibraryExpandedPaths(new Set());
        if (result.settings.onboardingComplete) void refreshDocumentLibrary();
      }
      if (dataConnectionChanged && result.settings.onboardingComplete) {
        void refreshAfterDataConnectionSave(result.settings);
      }
    }
    return result;
  }

  async function refreshAfterDataConnectionSave(savedSettings: AppSettings) {
    setDomiSyncing(true);
    setDomiError("");
    try {
      const synced = await workbench.syncDomi();
      if (synced.snapshot) setDomiSnapshot(synced.snapshot);
      if (!synced.ok) setDomiError(synced.error || "资料库设置已保存，但首次同步失败。");
      if (savedSettings.storageBackend === "feishu") {
        await refreshDomiTaskBoard({ fresh: true });
      }
    } catch (syncError) {
      setDomiError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setDomiSyncing(false);
    }
  }

  async function startChatGPTLogin(): Promise<ChatGPTLoginResult> {
    return workbench.startChatGPTLogin();
  }

  async function refreshCodex() {
    const status = await workbench.checkCodex();
    setCodexStatus(status);
  }

  function chooseWorkflow(workflow: Workflow) {
    setWorkspaceView("conversation");
    setSelectedWorkflowId(workflow.id);
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function addCalendarRecipient(recipient: CalendarRecipientOption) {
    setInput((current) => {
      if (current.toLocaleLowerCase("en-US").includes(recipient.email.toLocaleLowerCase("en-US"))) {
        return current;
      }
      const attendeeLine = /(^|\n)参会人：([^\n]*)/;
      if (attendeeLine.test(current)) {
        return current.replace(
          attendeeLine,
          (_match, prefix: string, attendees: string) =>
            `${prefix}参会人：${attendees.trim()}、${recipient.label}`
        );
      }
      const prefix = current.trimEnd();
      return `${prefix}${prefix ? "\n" : ""}参会人：${recipient.label}`;
    });
    window.requestAnimationFrame(() => composerRef.current?.focus());
  }

  function snoozeExecutionSuggestion(suggestion: ExecutionSuggestion) {
    setExecutionSuggestionState((current) => ({
      ...current,
      [suggestion.id]: {
        ...current[suggestion.id],
        snoozedUntil: Date.now() + 24 * 60 * 60 * 1000
      }
    }));
    setExecutionSuggestionError("");
  }

  function restoreExecutionSuggestion(suggestion: ExecutionSuggestion) {
    setExecutionSuggestionState((current) => ({
      ...current,
      [suggestion.id]: {
        ...current[suggestion.id],
        snoozedUntil: undefined
      }
    }));
    setExecutionSuggestionError("");
  }

  function dismissExecutionSuggestion(suggestion: ExecutionSuggestion) {
    setExecutionSuggestionState((current) => ({
      ...current,
      [suggestion.id]: {
        ...current[suggestion.id],
        dismissedAt: Date.now()
      }
    }));
    setExecutionSuggestionError("");
  }

  async function executeSuggestion(suggestion: ExecutionSuggestion) {
    if (executingSuggestionId) return false;
    const workflow = workflows.find((item) => item.id === suggestion.workflowId);
    if (!workflow) {
      setExecutionSuggestionError(`未找到“${suggestion.title}”对应的 domi 工作流。`);
      return false;
    }

    setExecutingSuggestionId(suggestion.id);
    setExecutionSuggestionError("");
    try {
      const threadId = createId("thread");
      const projectId = createId("execution");
      const workspaceResult = await workbench.createProjectWorkspace({
        projectId,
        projectName: suggestion.title
      });
      const nextThread: Thread = {
        id: threadId,
        projectId,
        workspacePath: workspaceResult.ok ? workspaceResult.workspacePath : undefined,
        title: suggestion.title,
        project: suggestion.projectLabel,
        updatedAt: nowLabel(),
        lastActiveAt: Date.now(),
        pinned: false,
        manualTitle: true,
        externalType: suggestion.externalType,
        externalRecordId: suggestion.externalRecordId,
        timeline: [],
        lastUsage: null,
        messages: []
      };

      setThreads((current) => [nextThread, ...current]);
      setActiveThreadId(nextThread.id);
      setWorkspaceView("conversation");
      clearComposerDraft(nextThread.id);
      setDomiPluginEnabled(true);
      setThreadMenuId(null);
      setExecutionSuggestionState((current) => ({
        ...current,
        [suggestion.id]: {
          ...current[suggestion.id],
          executedAt: Date.now()
        }
      }));

      const result = await submitToCodex(workflow, suggestion.prompt, {
        thread: nextThread,
        useDomiPlugin: true,
        displayText: suggestion.title,
        attachments: []
      });
      if (!result?.ok || result.stopped) {
        setExecutionSuggestionError(
          result?.error || (result?.stopped ? "任务同步已停止。" : "任务 Skill 未能启动。")
        );
        return false;
      }
      return true;
    } catch (error) {
      setExecutionSuggestionError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setExecutingSuggestionId(null);
    }
  }

  async function updateManagedTask(taskId: string, status: DomiTask["status"]) {
    setDomiTaskMutationId(taskId);
    setDomiTaskError("");
    try {
      const result = await workbench.updateDomiTask({ taskId, status });
      if (!result.ok || !result.snapshot) {
        setDomiTaskError(result.error || `${todoDocumentLabel} 状态更新失败。`);
        return false;
      }
      setDomiTaskBoard(result.snapshot);
      return true;
    } catch (error) {
      setDomiTaskError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setDomiTaskMutationId(null);
    }
  }

  async function executeManagedTask(task: DomiTask) {
    if (domiTaskMutationId || executingSuggestionId) return;
    const marked = await updateManagedTask(task.id, "in_progress");
    if (!marked) return;
    const workflowId = task.suggestedAction.kind === "schedule" ? "schedule" : "task";
    const executed = await executeSuggestion({
      id: `managed:${task.id}`,
      title: task.title,
      context: task.summary || task.source.displayName || todoDocumentLabel,
      reason: task.reason,
      priority: task.priority,
      workflowId,
      prompt: [
        `taskId=${task.id}`,
        task.suggestedAction.prompt || `执行 ${todoDocumentLabel} 中“${task.title}”的下一动作。`,
        workflowId === "schedule"
          ? "只整理并发送本次 Outlook 日程邀请；客户端会在成功后更新待办事项状态，不要读取资料库或待办事项文档。"
          : `先读取 ${todoDocumentLabel} 中该待办事项的最新状态和证据；只执行下一动作，状态由客户端在成功后更新。`
      ].join("\n"),
      projectLabel: `${todoDocumentLabel} · ${task.source.displayName || task.title}`,
      externalType: task.source.kind === "project" || task.source.kind === "person"
        ? task.source.kind
        : undefined,
      externalRecordId: task.source.recordId || undefined
    });
    if (!executed) {
      await updateManagedTask(task.id, "open");
    } else {
      await updateManagedTask(task.id, "done");
    }
  }

  async function syncManagedTasks() {
    if (executingSuggestionId) return;
    const todoWorkflow = workflows.find((workflow) => workflow.id === "task");
    if (!todoWorkflow) {
      setDomiTaskError("未找到 domi 待办事项工作流。");
      return;
    }
    const requestText = todoWorkflow.defaultPrompt || `更新 ${todoDocumentLabel}。`;
    const runId = createId("todo-sync");
    let timeoutHandle: number | undefined;
    const startedAt = Date.now();
    let candidateCount = 0;
    let outcome = "failed";
    let boardRefreshedAfterFailure = false;
    const updateSyncPhase = (phase: TodoSyncPhase, label: string) => {
      setDomiTaskSyncState({
        phase,
        label,
        startedAt,
        completedAt: ["completed", "failed"].includes(phase) ? Date.now() : null,
        candidateCount
      });
    };
    setExecutingSuggestionId("managed-refresh");
    setDomiTaskError("");
    updateSyncPhase("refreshing", "正在刷新项目与人脉资料");
    try {
      const synced = await workbench.syncDomi();
      const currentSnapshot = synced.snapshot || domiSnapshot;
      if (synced.snapshot) setDomiSnapshot(synced.snapshot);
      if (!synced.ok && !currentSnapshot) {
        throw new Error(synced.error || "资料库刷新失败，暂时无法生成待办事项。");
      }
      candidateCount = recentTodoCandidateCount(currentSnapshot);
      updateSyncPhase(
        "preparing",
        candidateCount
          ? `已发现 ${candidateCount} 个近 4 周新入库候选`
          : "正在整理关键节点与长期跟进候选"
      );
      const recentEntriesContext = todoRecentEntriesContext(
        currentSnapshot?.projects,
        currentSnapshot?.people
      );
      updateSyncPhase("generating", "Todo Skill 正在排序并维护待办事项文档");
      const runPromise = workbench.runCodex({
          runId,
          prompt: workflowPrompt(todoWorkflow, requestText, recentEntriesContext, true),
          requestText,
          ephemeral: true,
          background: true,
          workflowId: todoWorkflow.id,
          model,
          reasoningEffort,
          serviceTier,
          workspacePath: activeThread.workspacePath
        });
      const resultOrTimeout = await Promise.race([
        runPromise.then((result) => ({ timedOut: false as const, result })),
        new Promise<{ timedOut: true }>((resolve) => {
          timeoutHandle = window.setTimeout(() => {
            resolve({ timedOut: true });
          }, TODO_SYNC_TIMEOUT_MS);
        })
      ]);
      if (resultOrTimeout.timedOut) {
        updateSyncPhase("stopping", "运行超过 4 分钟，正在安全停止并保留已写入内容");
        const stopResult = await workbench.stopCodex(runId);
        updateSyncPhase("reading", "正在回读待办事项文档");
        await refreshDomiTaskBoard({ silent: true, fresh: true });
        boardRefreshedAfterFailure = true;
        throw new Error(stopResult.ok
          ? "后台待办事项同步超过 4 分钟，已安全停止；看板已回读最新文档内容。"
          : `后台待办事项同步超过 4 分钟，但停止确认失败：${stopResult.error || "未知错误"}`);
      }
      const result = resultOrTimeout.result;
      if (result.stopped) {
        throw new Error("后台待办事项同步已暂停，Codex 连接维护完成后可重新同步。");
      }
      if (!result.ok) {
        throw new Error(result.error || "待办事项后台同步失败。");
      }
      updateSyncPhase("reading", "写入完成，正在验证并刷新看板");
      await refreshDomiTaskBoard({ fresh: true });
      outcome = "completed";
      updateSyncPhase("completed", `同步完成，已核验 ${candidateCount} 个新入库候选`);
    } catch (error) {
      if (!boardRefreshedAfterFailure) {
        await refreshDomiTaskBoard({ silent: true, fresh: true });
      }
      setDomiTaskError(error instanceof Error ? error.message : String(error));
      updateSyncPhase("failed", "本轮同步未完整完成，当前看板保留最近一次有效内容");
    } finally {
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      setExecutingSuggestionId(null);
      workbench.reportRendererIssue({
        kind: "workflow-metric",
        message: JSON.stringify({
          workflow: "todo-sync",
          outcome,
          durationMs: Date.now() - startedAt,
          candidateCount
        })
      });
    }
  }

  async function refreshDomiEntityOverview(
    threadId: string,
    entityType: "project" | "person",
    entity: DomiProject | DomiPerson
  ) {
    const overviewId = `domi-overview-${entityType}-${entity.recordId}`;
    const loadingMessage: Message = {
      id: overviewId,
      role: "assistant",
      status: "running",
      content: `正在整理“${entity.name}”的库内信息、关联文档和本地资料…`
    };
    setThreads((current) => current.map((thread) => {
      if (thread.id !== threadId) return thread;
      const retained = thread.messages.filter((message, index) =>
        message.id !== overviewId
        && !(index === 0 && message.role === "assistant" && message.status === "idle" && message.content.startsWith("已绑定"))
      );
      return { ...thread, messages: [loadingMessage, ...retained] };
    }));

    const result = await workbench.loadDomiEntityMaterials({
      entityType,
      recordId: entity.recordId
    });
    const content = entityType === "project"
      ? projectOverview(entity as DomiProject, result.materials, result.ok ? undefined : result.error)
      : personOverview(entity as DomiPerson, result.materials, result.ok ? undefined : result.error);
    patchMessage(overviewId, {
      content,
      status: result.ok ? "done" : "error"
    });
  }

  async function openDomiProject(project: DomiProject) {
    const existing = threads.find(
      (thread) => thread.externalType === "project" && thread.externalRecordId === project.recordId
    );
    if (existing) {
      selectThread(existing.id);
      setDomiQuery("");
      void refreshDomiEntityOverview(existing.id, "project", project);
      return;
    }
    const projectId = `domi-project-${project.recordId}`;
    const workspaceResult = await workbench.createProjectWorkspace({
      projectId,
      projectName: project.name
    });
    const nextThread: Thread = {
      id: createId("thread"),
      projectId,
      workspacePath: workspaceResult.ok ? workspaceResult.workspacePath : undefined,
      title: project.name,
      project: [project.domain, project.subdomains[0], project.status].filter(Boolean).join(" · "),
      updatedAt: nowLabel(),
      lastActiveAt: Date.now(),
      pinned: project.rating === "S",
      manualTitle: true,
      externalType: "project",
      externalRecordId: project.recordId,
      timeline: [],
      lastUsage: null,
      messages: []
    };
    setThreads((current) => [nextThread, ...current]);
    setActiveThreadId(nextThread.id);
    setDomiQuery("");
    void refreshDomiEntityOverview(nextThread.id, "project", project);
  }

  async function openDomiPerson(person: DomiPerson) {
    const existing = threads.find(
      (thread) => thread.externalType === "person" && thread.externalRecordId === person.recordId
    );
    if (existing) {
      selectThread(existing.id);
      setDomiQuery("");
      void refreshDomiEntityOverview(existing.id, "person", person);
      return;
    }
    const projectId = `domi-person-${person.recordId}`;
    const workspaceResult = await workbench.createProjectWorkspace({
      projectId,
      projectName: person.name
    });
    const nextThread: Thread = {
      id: createId("thread"),
      projectId,
      workspacePath: workspaceResult.ok ? workspaceResult.workspacePath : undefined,
      title: person.name,
      project: [person.organization, cleanPeopleStatus(person.status)].filter(Boolean).join(" · "),
      updatedAt: nowLabel(),
      lastActiveAt: Date.now(),
      pinned: false,
      manualTitle: true,
      externalType: "person",
      externalRecordId: person.recordId,
      timeline: [],
      lastUsage: null,
      messages: []
    };
    setThreads((current) => [nextThread, ...current]);
    setActiveThreadId(nextThread.id);
    setDomiQuery("");
    void refreshDomiEntityOverview(nextThread.id, "person", person);
  }

  function updateActiveThread(mutator: (thread: Thread) => Thread) {
    setThreads((current) =>
      current.map((thread) => (thread.id === activeThreadId ? mutator(thread) : thread))
    );
  }

  function appendMessageToThread(threadId: string, message: Message) {
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.id === threadId);
      if (index < 0) return current;
      const thread = current[index];
      const next = current.slice();
      next[index] = {
        ...thread,
        updatedAt: nowLabel(),
        lastActiveAt: message.role === "user" ? Date.now() : thread.lastActiveAt,
        title:
          !thread.manualTitle && thread.messages.length <= 1 && message.role === "user"
            ? message.content.slice(0, 22)
            : thread.title,
        messages: [...thread.messages, message]
      };
      return next;
    });
  }

  function appendMessage(message: Message) {
    appendMessageToThread(activeThreadId, message);
  }

  function patchMessage(messageId: string, patch: Partial<Message>) {
    setThreads((current) => {
      for (let threadIndex = 0; threadIndex < current.length; threadIndex += 1) {
        const thread = current[threadIndex];
        const messageIndex = thread.messages.findIndex((message) => message.id === messageId);
        if (messageIndex < 0) continue;

        const messages = thread.messages.slice();
        messages[messageIndex] = { ...messages[messageIndex], ...patch };
        const next = current.slice();
        next[threadIndex] = { ...thread, messages };
        return next;
      }
      return current;
    });
  }

  function patchThread(threadId: string, patch: Partial<Thread>) {
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.id === threadId);
      if (index < 0) return current;
      const next = current.slice();
      next[index] = { ...current[index], ...patch };
      return next;
    });
  }

  function addTimeline(threadId: string, item: Omit<TimelineItem, "id">) {
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.id === threadId);
      if (index < 0) return current;
      const next = current.slice();
      next[index] = {
        ...current[index],
        timeline: [{ id: createId("timeline"), ...item }, ...(current[index].timeline || [])].slice(0, 18)
      };
      return next;
    });
  }

  function handleCodexEvent(payload: CodexEventPayload) {
    let context = runContextRef.current.get(payload.runId);
    if (!context && payload.threadId) {
      const recoveredThread = threadsRef.current.find(
        (thread) => thread.codexThreadId === payload.threadId
      );
      const recoveredMessage = recoveredThread
        ? [...recoveredThread.messages]
            .reverse()
            .find(
              (message) =>
                message.role === "assistant"
                && (message.status === "running" || message.status === "error")
            )
        : undefined;

      if (recoveredThread && recoveredMessage) {
        context = {
          threadId: recoveredThread.id,
          assistantMessageId: recoveredMessage.id
        };
        runContextRef.current.set(payload.runId, context);

        if (payload.type !== "completed" && payload.type !== "stopped" && payload.type !== "failed") {
          setActiveRunsByThread((current) => ({
            ...current,
            [recoveredThread.id]: payload.runId
          }));
          if (recoveredMessage.status === "error") {
            patchMessage(recoveredMessage.id, { status: "running" });
          }
        }
      }
    }
    if (!context) {
      return;
    }

    if (payload.type === "thread" && payload.threadId) {
      patchThread(context.threadId, { codexThreadId: payload.threadId });
      addTimeline(context.threadId, {
        runId: payload.runId,
        title: payload.summary || "Codex 对话已连接",
        detail: payload.threadId,
        kind: "event",
        status: "done"
      });
      return;
    }

    if (payload.type === "started") {
      addTimeline(context.threadId, {
        runId: payload.runId,
        title: "Codex 进程已启动",
        detail: payload.summary,
        kind: "event",
        status: "running"
      });
      return;
    }

    if (payload.type === "compatibility") {
      addTimeline(context.threadId, {
        runId: payload.runId,
        title: "已切换 Codex 兼容模式",
        detail: payload.summary,
        kind: "event",
        status: "done"
      });
      return;
    }

    if (payload.type === "assistant-delta") {
      queueAssistantDelta(payload.runId, context, payload);
      return;
    }

    if (payload.type === "usage" && payload.usage) {
      patchThread(context.threadId, { lastUsage: payload.usage });
      return;
    }

    if (payload.type === "stderr" && payload.text) {
      addTimeline(context.threadId, {
        runId: payload.runId,
        title: "运行日志",
        detail: payload.text.trim(),
        kind: "event"
      });
      return;
    }

    if (payload.type === "json" && payload.event) {
      if (payload.usage) {
        patchThread(context.threadId, { lastUsage: payload.usage });
      }

      if (payload.event.type === "turn.failed") {
        const message = payload.event.error?.message || "Codex turn failed.";
        addTimeline(context.threadId, { runId: payload.runId, title: "执行失败", detail: message, kind: "error", status: "failed" });
        patchMessage(context.assistantMessageId, { content: message, status: "error" });
      }

      if (payload.item) {
        const item = payload.item;
        const shouldAddTimeline = item.kind !== "assistant";
        if (shouldAddTimeline) {
          addTimeline(context.threadId, {
            runId: payload.runId,
            title: timelineTitle(item),
            detail: item.detail || item.text,
            kind: item.kind,
            status: item.status
          });
        }

        if (item.kind === "assistant" && payload.event.type === "item/completed") {
          discardAssistantDelta(payload.runId);
          patchMessage(context.assistantMessageId, {
            content: item.text || "Codex 已完成，但没有返回文本。",
            status: "running"
          });
        }
      }
    }

    if (payload.type === "completed" || payload.type === "stopped" || payload.type === "failed") {
      discardAssistantDelta(payload.runId);
      const runCompletedAt = Date.now();
      setActiveRunsByThread((current) => {
        if (current[context.threadId] !== payload.runId) return current;
        const next = { ...current };
        delete next[context.threadId];
        return next;
      });

      patchMessage(context.assistantMessageId, {
        content:
          (payload.type === "failed" && payload.error
            ? [payload.output, `执行失败：${payload.error}`].filter(Boolean).join("\n\n")
            : payload.output) ||
          payload.stderr ||
          (payload.type === "completed"
            ? "Codex 已完成。"
            : payload.type === "stopped"
              ? "任务已停止。"
            : payload.error || "Codex 执行失败。"),
        status: payload.type === "failed" ? "error" : "done",
        runCompletedAt,
        runEventCount: payload.eventCount
      });

      patchThread(context.threadId, {
        updatedAt: nowLabel(),
        lastActiveAt: runCompletedAt,
        hasUnreadCompletion:
          payload.type === "completed" && context.threadId !== activeThreadIdRef.current
      });

      addTimeline(context.threadId, {
        runId: payload.runId,
        title:
          payload.type === "completed"
            ? "执行完成"
            : payload.type === "stopped"
              ? "执行已停止"
              : "执行失败",
        detail: payload.outputPath
          ? `${payload.eventCount || 0} 个事件 · 已归档 ${payload.outputPath.split("/").pop()}`
          : `${payload.eventCount || 0} 个事件`,
        kind: payload.type === "failed" ? "error" : "assistant",
        status: payload.type
      });
      runContextRef.current.delete(payload.runId);
    }
  }

  async function submitToCodex(
    workflow?: Workflow,
    overrideInput?: string,
    options: SubmitToCodexOptions = {}
  ) {
    const targetThread = options.thread || activeThread;
    const targetAlreadyRunning = Boolean(activeRunsByThread[targetThread.id])
      || [...runContextRef.current.values()].some((context) => context.threadId === targetThread.id);
    if (targetAlreadyRunning) return;

    const useDomiPlugin = options.useDomiPlugin ?? domiPluginEnabled;
    const rawInput = (overrideInput ?? input).trim();
    const selectedAttachments = options.attachments ?? attachments;
    const messageText = rawInput || workflow?.defaultPrompt || (selectedAttachments.length ? "请分析所附材料" : "");
    if (!messageText) {
      return;
    }
    const displayText = options.displayText?.trim() || messageText;

    const runId = createId("run");
    const runStartedAt = Date.now();
    const userMessage: Message = {
      id: createId("user"),
      role: "user",
      content: workflow ? `启动「${workflow.title}」：${displayText}` : displayText,
      workflowId: workflow?.id,
      attachments: selectedAttachments
    };

    const assistantId = createId("assistant");
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      workflowId: workflow?.id,
      status: "running",
      content: "",
      runId,
      runStartedAt
    };

    appendMessageToThread(targetThread.id, userMessage);
    appendMessageToThread(targetThread.id, assistantMessage);
    if (!options.preserveComposer) {
      clearComposerDraft(targetThread.id);
    }
    patchThread(targetThread.id, { timeline: [], lastUsage: null, hasUnreadCompletion: false });
    runContextRef.current.set(runId, {
      threadId: targetThread.id,
      assistantMessageId: assistantId
    });
    setActiveRunsByThread((current) => ({ ...current, [targetThread.id]: runId }));

    const basePrompt = workflowPrompt(
      workflow,
      messageText,
      domiContextForThread(domiSnapshot, targetThread),
      useDomiPlugin
    );
    const prompt = selectedAttachments.length
      ? `${basePrompt}\n\n本次任务附带以下本地材料，请直接读取并使用：\n${selectedAttachments
          .map((file) => `- ${JSON.stringify(file.path)}`)
          .join("\n")}`
      : basePrompt;
    const result = await workbench.runCodex({
      runId,
      prompt,
      requestText: messageText,
      threadId: targetThread.codexThreadId,
      workflowId: workflow?.id || (useDomiPlugin ? "domi-analyst" : undefined),
      webSearch: Boolean(workflow?.webSearch),
      model: options.model ?? model,
      reasoningEffort: options.reasoningEffort ?? reasoningEffort,
      serviceTier: options.serviceTier ?? serviceTier,
      background: options.background,
      workspacePath: targetThread.workspacePath
    });

    if (result.threadId) {
      patchThread(targetThread.id, { codexThreadId: result.threadId });
    }

    if (result.ok && result.output && !hasNativeWorkbench) {
      const runCompletedAt = Date.now();
      patchMessage(assistantId, {
        content: result.output,
        status: "done",
        runCompletedAt
      });
      setActiveRunsByThread((current) => {
        if (current[targetThread.id] !== runId) return current;
        const next = { ...current };
        delete next[targetThread.id];
        return next;
      });
      patchThread(targetThread.id, {
        updatedAt: nowLabel(),
        lastActiveAt: runCompletedAt,
        hasUnreadCompletion: targetThread.id !== activeThreadIdRef.current
      });
      runContextRef.current.delete(runId);
    } else if (!result.ok) {
      patchMessage(assistantId, {
        content: result.error || "Codex 执行失败。",
        status: "error",
        runCompletedAt: Date.now()
      });
      setActiveRunsByThread((current) => {
        if (current[targetThread.id] !== runId) return current;
        const next = { ...current };
        delete next[targetThread.id];
        return next;
      });
      runContextRef.current.delete(runId);
    }
    return result;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() && attachments.length === 0) return;
    const threadHasActiveRun = Boolean(activeRunsByThread[activeThread.id])
      || [...runContextRef.current.values()].some((context) => context.threadId === activeThread.id);
    if (threadHasActiveRun) {
      enqueueSubmission(selectedWorkflow, input);
      return;
    }
    void submitToCodex(selectedWorkflow, input);
  }

  function enqueueSubmission(workflow?: Workflow, overrideInput?: string) {
    const rawInput = (overrideInput ?? input).trim();
    const messageText = rawInput || workflow?.defaultPrompt || (attachments.length ? "请分析所附材料" : "");
    if (!messageText) return;

    const queuedSubmission: QueuedSubmission = {
      id: createId("queue"),
      threadId: activeThread.id,
      input: messageText,
      workflowId: workflow?.id,
      attachments: [...attachments],
      useDomiPlugin: domiPluginEnabled,
      model,
      reasoningEffort,
      serviceTier,
      createdAt: Date.now()
    };
    setQueuedSubmissionsByThread((current) => ({
      ...current,
      [activeThread.id]: [...(current[activeThread.id] || []), queuedSubmission]
    }));
    clearComposerDraft(activeThread.id);
    patchThread(activeThread.id, { updatedAt: nowLabel(), lastActiveAt: Date.now() });
  }

  function removeQueuedSubmission(threadId: string, queuedId: string) {
    setQueuedSubmissionsByThread((current) => {
      const remaining = (current[threadId] || []).filter((item) => item.id !== queuedId);
      if (remaining.length > 0) {
        return { ...current, [threadId]: remaining };
      }
      const next = { ...current };
      delete next[threadId];
      return next;
    });
  }

  async function chooseAttachments() {
    const result = await workbench.selectFiles(activeThread.workspacePath);
    if (!result.ok) {
      setAttachmentError(result.error || "无法添加所选文件。");
      return;
    }
    if (result.canceled || result.files.length === 0) {
      return;
    }
    setAttachmentError("");
    setAttachments((current) => {
      const paths = new Set(current.map((file) => file.path));
      return [...current, ...result.files.filter((file) => !paths.has(file.path))];
    });
  }

  async function importAttachmentFiles(files: File[]) {
    if (files.length === 0) return;

    const sourcePaths: string[] = [];
    const inMemoryFiles: File[] = [];
    files.forEach((file) => {
      let sourcePath = "";
      try {
        sourcePath = workbench.getPathForFile(file);
      } catch {
        sourcePath = "";
      }
      if (sourcePath) {
        sourcePaths.push(sourcePath);
      } else {
        inMemoryFiles.push(file);
      }
    });

    const importedFiles: LocalAttachment[] = [];
    const errors: string[] = [];
    if (sourcePaths.length > 0) {
      const pathResult = await workbench.importFiles(sourcePaths, activeThread.workspacePath);
      if (pathResult.ok) {
        importedFiles.push(...pathResult.files);
      } else {
        errors.push(pathResult.error || "无法导入本地文件。");
      }
    }

    if (inMemoryFiles.length > 0) {
      try {
        const payloads: ClipboardAttachmentPayload[] = await Promise.all(
          inMemoryFiles.map(async (file, index) => ({
            name: file.name || `clipboard-file-${index + 1}`,
            type: file.type,
            data: await file.arrayBuffer()
          }))
        );
        const dataResult = await workbench.importFileData(payloads, activeThread.workspacePath);
        if (dataResult.ok) {
          importedFiles.push(...dataResult.files);
        } else {
          errors.push(dataResult.error || "无法读取剪贴板文件内容。");
        }
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    }

    setAttachmentError(errors.join("；"));
    if (importedFiles.length === 0) return;
    setAttachments((current) => {
      const paths = new Set(current.map((file) => file.path));
      return [...current, ...importedFiles.filter((file) => !paths.has(file.path))];
    });
  }

  async function importAttachmentPaths(sourcePaths: string[]) {
    if (sourcePaths.length === 0) return;
    const result = await workbench.importFiles(sourcePaths, activeThread.workspacePath);
    if (!result.ok) {
      setAttachmentError(result.error || "无法导入剪贴板中的本地文件。");
      return;
    }
    setAttachmentError("");
    setAttachments((current) => {
      const paths = new Set(current.map((file) => file.path));
      return [...current, ...result.files.filter((file) => !paths.has(file.path))];
    });
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLFormElement>) {
    const directFiles = Array.from(event.clipboardData.files);
    const itemFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
    const files = [...directFiles];
    itemFiles.forEach((file) => {
      const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`;
      const isDuplicate = files.some((current) =>
        `${current.name}:${current.size}:${current.type}:${current.lastModified}` === key
      );
      if (!isDuplicate) files.push(file);
    });
    if (files.length === 0) {
      const fileUrlPaths = event.clipboardData.getData("text/uri-list")
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter((value) => value && !value.startsWith("#"))
        .flatMap((value) => {
          try {
            const url = new URL(value);
            return url.protocol === "file:" ? [decodeURIComponent(url.pathname)] : [];
          } catch {
            return [];
          }
        });
      if (fileUrlPaths.length === 0) return;
      event.preventDefault();
      void importAttachmentPaths(fileUrlPaths);
      return;
    }
    event.preventDefault();
    void importAttachmentFiles(files);
  }

  function handleComposerDrop(event: ReactDragEvent<HTMLFormElement>) {
    event.preventDefault();
    setComposerDragActive(false);
    const files = Array.from(event.dataTransfer.files);
    if (files.length > 0) {
      void importAttachmentFiles(files);
    }
  }

  function removeAttachment(filePath: string) {
    setAttachments((current) => current.filter((file) => file.path !== filePath));
  }

  function applyNewThreadAgentDefaults() {
    setModel(NEW_THREAD_MODEL);
    setReasoningEffort(NEW_THREAD_REASONING_EFFORT);
    setServiceTier(NEW_THREAD_SERVICE_TIER);
    setDomiPluginEnabled(true);
    setComposerSuggestionIndex((current) => (current + 1) % COMPOSER_SUGGESTIONS.length);
  }

  async function createThread() {
    setWorkspaceView("conversation");
    const currentDraftIsUnused = isUnusedDraftThread(activeThread)
      && !input.trim()
      && attachments.length === 0
      && !selectedWorkflowId;
    if (currentDraftIsUnused) {
      applyNewThreadAgentDefaults();
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }

    const reusableDraft = threads.find(
      (thread) => isUnusedDraftThread(thread) && !composerDraftHasContent(thread.id)
    );
    if (reusableDraft) {
      setActiveThreadId(reusableDraft.id);
      clearComposerDraft(reusableDraft.id);
      applyNewThreadAgentDefaults();
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return;
    }

    if (creatingThreadRef.current) return;
    creatingThreadRef.current = true;

    const threadId = createId("thread");
    const projectId = createId("project");
    try {
      const workspaceResult = await workbench.createProjectWorkspace({
        projectId,
        projectName: NEW_THREAD_PROJECT
      });
      const nextThread: Thread = {
        id: threadId,
        projectId,
        workspacePath: workspaceResult.ok ? workspaceResult.workspacePath : undefined,
        title: NEW_THREAD_TITLE,
        project: NEW_THREAD_PROJECT,
        updatedAt: nowLabel(),
        lastActiveAt: Date.now(),
        pinned: false,
        manualTitle: false,
        timeline: [],
        lastUsage: null,
        messages: [
          {
            id: createId("assistant"),
            role: "assistant",
            content: NEW_THREAD_GREETING,
            status: "idle"
          }
        ]
      };
      setThreads((current) => [nextThread, ...current]);
      setActiveThreadId(nextThread.id);
      clearComposerDraft(nextThread.id);
      applyNewThreadAgentDefaults();
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
    } finally {
      creatingThreadRef.current = false;
    }
  }

  async function stopRun() {
    if (!activeRunId) {
      return;
    }
    await workbench.stopCodex(activeRunId);
    addTimeline(activeThread.id, {
      runId: activeRunId,
      title: "用户已停止",
      detail: "Codex 进程已收到终止信号",
      kind: "event",
      status: "stopped"
    });
  }

  function cancelScheduledChatScrollRestore() {
    if (chatScrollRestoreFrameRef.current !== null) {
      window.cancelAnimationFrame(chatScrollRestoreFrameRef.current);
      chatScrollRestoreFrameRef.current = null;
    }
    for (const timer of chatScrollRestoreTimersRef.current) {
      window.clearTimeout(timer);
    }
    chatScrollRestoreTimersRef.current = [];
  }

  function applyChatScrollPosition(threadId: string, position: ChatScrollPosition) {
    const element = scrollRef.current;
    if (!element || activeThreadIdRef.current !== threadId) return;
    const maxTop = Math.max(0, element.scrollHeight - element.clientHeight);
    element.scrollTop = position.atBottom ? maxTop : Math.min(position.top, maxTop);
    chatScrollPositionsRef.current.set(threadId, {
      top: element.scrollTop,
      atBottom: position.atBottom
    });
  }

  function scheduleChatScrollRestore(threadId: string, position: ChatScrollPosition) {
    cancelScheduledChatScrollRestore();
    applyChatScrollPosition(threadId, position);
    chatScrollRestoreFrameRef.current = window.requestAnimationFrame(() => {
      chatScrollRestoreFrameRef.current = null;
      applyChatScrollPosition(threadId, position);
    });
    if (!position.atBottom) return;
    chatScrollRestoreTimersRef.current = [60, 180, 360].map((delay) => window.setTimeout(() => {
      applyChatScrollPosition(threadId, position);
    }, delay));
  }

  function rememberActiveChatScrollPosition() {
    const element = scrollRef.current;
    if (!element) return;
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    chatScrollPositionsRef.current.set(activeThreadIdRef.current, {
      top: element.scrollTop,
      atBottom: distanceFromBottom <= 32
    });
  }

  function selectThread(threadId: string) {
    rememberActiveChatScrollPosition();
    setActiveThreadId(threadId);
    setWorkspaceView("conversation");
    setDocumentLibrarySidebarExpanded(false);
    setThreadMenuId(null);
    setComposerDragActive(false);
  }

  function startThreadRename(thread: Thread) {
    setThreadMenuId(null);
    setRenamingThreadId(thread.id);
    setRenameValue(thread.title);
  }

  function commitThreadRename(threadId: string) {
    const title = renameValue.trim();
    if (title) {
      patchThread(threadId, { title, manualTitle: true });
    }
    setRenamingThreadId(null);
    setRenameValue("");
  }

  function toggleThreadPinned(thread: Thread) {
    patchThread(thread.id, { pinned: !thread.pinned });
    setThreadMenuId(null);
  }

  function deleteThread(thread: Thread) {
    if (threads.length <= 1 || Boolean(activeRunsByThread[thread.id])) {
      return;
    }
    const confirmed = window.confirm(`删除对话“${thread.title}”？\n项目目录和材料不会被删除。`);
    if (!confirmed) {
      return;
    }
    const remaining = threads.filter((item) => item.id !== thread.id);
    setThreads(remaining);
    clearComposerDraft(thread.id);
    if (activeThreadId === thread.id) {
      setActiveThreadId(remaining[0].id);
    }
    setThreadMenuId(null);
  }

  function toggleSection(section: keyof typeof openSections) {
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
  }

  async function refreshDocumentLibrary(options: { silent?: boolean; force?: boolean } = {}) {
    const requestId = ++documentLibraryRequestRef.current;
    if (!options.silent) setDocumentLibraryLoading(true);
    setDocumentLibraryError("");
    try {
      const snapshot = await workbench.listDocumentLibrary({ force: options.force === true });
      if (requestId !== documentLibraryRequestRef.current) return null;
      if (!snapshot.ok) {
        setDocumentLibraryError(snapshot.error || "无法读取本地文档库。");
        setDocumentLibrary(snapshot);
        return null;
      }
      setDocumentLibrary(snapshot);
      setDocumentLibrarySelectedFolder((current) => {
        const normalizedRoot = snapshot.rootPath.replace(/[\\/]+$/, "");
        const normalizedCurrent = current.replace(/[\\/]+$/, "");
        const insideRoot = normalizedCurrent === normalizedRoot
          || normalizedCurrent.startsWith(`${normalizedRoot}/`)
          || normalizedCurrent.startsWith(`${normalizedRoot}\\`);
        return insideRoot ? current : snapshot.rootPath;
      });
      return snapshot;
    } catch (error) {
      if (requestId !== documentLibraryRequestRef.current) return null;
      const message = describeOperationError(error, "无法读取本地文档库。");
      setDocumentLibraryError(message);
      return null;
    } finally {
      if (!options.silent && requestId === documentLibraryRequestRef.current) {
        setDocumentLibraryLoading(false);
      }
    }
  }

  function openDocumentLibrary() {
    setDocumentLibrarySidebarExpanded((current) =>
      workspaceView === "documents" ? !current : true
    );
    setWorkspaceView("documents");
    setThreadMenuId(null);
    setRightPanelOpen(false);
    if (!documentLibraryLoading) {
      void refreshDocumentLibrary({ silent: Boolean(documentLibrary) });
    }
  }

  function refreshDocumentIndexForSearch() {
    if (documentLibraryLoading) return;
    const now = Date.now();
    if (now - documentSearchRefreshAtRef.current < 60_000) return;
    documentSearchRefreshAtRef.current = now;
    void refreshDocumentLibrary({ silent: Boolean(documentLibrary), force: true });
  }

  function scrollDocumentLibrarySearchSelectionIntoView(path: string) {
    window.requestAnimationFrame(() => {
      const rows = documentLibraryTreeRef.current
        ?.querySelectorAll<HTMLButtonElement>("[data-document-library-path]");
      const selected = rows
        ? [...rows].find((row) => row.dataset.documentLibraryPath === path)
        : null;
      selected?.scrollIntoView({ block: "nearest" });
    });
  }

  function moveDocumentLibrarySearchSelection(direction: -1 | 1) {
    if (!searchableDocumentLibraryNodes.length) return;
    const currentIndex = searchableDocumentLibraryNodes.findIndex(
      ({ node }) => node.path === documentLibrarySearchActivePath
    );
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : searchableDocumentLibraryNodes.length - 1
      : Math.max(
          0,
          Math.min(searchableDocumentLibraryNodes.length - 1, currentIndex + direction)
        );
    const nextPath = searchableDocumentLibraryNodes[nextIndex].node.path;
    setDocumentLibrarySearchActivePath(nextPath);
    scrollDocumentLibrarySearchSelectionIntoView(nextPath);
  }

  function openActiveDocumentLibrarySearchResult() {
    const active = searchableDocumentLibraryNodes.find(
      ({ node }) => node.path === documentLibrarySearchActivePath
    ) || searchableDocumentLibraryNodes[0];
    if (!active) return;
    setDocumentLibrarySearchActivePath(active.node.path);
    openDocumentLibraryNode(active.node, active.parentPath);
    scrollDocumentLibrarySearchSelectionIntoView(active.node.path);
  }

  function toggleDocumentLibraryFolder(path: string) {
    setDocumentLibrarySelectedFolder(path);
    setDocumentLibraryExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function beginDocumentLibraryCreate(kind: "folder" | "markdown") {
    setDocumentLibraryCreateKind(kind);
    setDocumentLibraryCreateName("");
    setDocumentLibraryCreateError("");
  }

  function cancelDocumentLibraryCreate() {
    setDocumentLibraryCreateKind(null);
    setDocumentLibraryCreateName("");
    setDocumentLibraryCreateError("");
  }

  async function submitDocumentLibraryCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!documentLibraryCreateKind || documentLibraryCreating || !documentLibrary) return;
    const name = documentLibraryCreateName.trim();
    if (!name) {
      setDocumentLibraryCreateError(
        documentLibraryCreateKind === "folder" ? "请输入文件夹名称。" : "请输入文档名称。"
      );
      return;
    }
    const parentPath = documentLibrarySelectedFolder || documentLibrary.rootPath;
    setDocumentLibraryCreating(true);
    setDocumentLibraryCreateError("");
    try {
      const result = await workbench.createDocumentLibraryEntry({
        parentPath,
        kind: documentLibraryCreateKind,
        name
      });
      if (!result.ok || !result.path) {
        setDocumentLibraryCreateError(result.error || "新建失败。");
        return;
      }
      if (result.snapshot) setDocumentLibrary(result.snapshot);
      setDocumentLibraryExpandedPaths((current) => new Set(current).add(parentPath));
      const createdKind = result.kind;
      cancelDocumentLibraryCreate();
      if (createdKind === "folder") {
        setDocumentLibrarySelectedFolder(result.path);
        setDocumentLibraryExpandedPaths((current) => new Set(current).add(result.path as string));
      } else {
        setDocumentLibrarySelectedFolder(parentPath);
        await openMarkdown(result.path);
      }
    } catch (error) {
      setDocumentLibraryCreateError(describeOperationError(error, "新建失败。"));
    } finally {
      setDocumentLibraryCreating(false);
    }
  }

  function openDocumentLibraryNode(node: DocumentLibraryNode, parentPath: string) {
    if (node.kind === "folder") {
      toggleDocumentLibraryFolder(node.path);
      return;
    }
    setDocumentLibrarySelectedFolder(parentPath);
    if (node.kind === "pdf") void openPdf(node.path);
    else void openMarkdown(node.path);
  }

  async function openMarkdown(resource: string, basePath?: string) {
    if (markdownDirty) {
      const confirmed = window.confirm("当前 Markdown 文件尚未保存，仍要打开其他文件吗？");
      if (!confirmed) return;
    }

    const requestId = ++markdownOpenRequestRef.current;
    pdfOpenRequestRef.current += 1;
    markdownSaveRequestRef.current += 1;
    markdownRenameRequestRef.current += 1;
    setMarkdownSaving(false);
    setMarkdownRenaming(false);
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
    if (workspaceView !== "documents") setRightPanelOpen(true);
    setPdfDocument(null);
    setPdfError("");
    setPdfRequestLabel("");
    setPdfLoading(false);
    setPdfFrameLoading(false);
    setMarkdownDocument(null);
    setMarkdownDraft("");
    markdownDocumentRef.current = null;
    markdownDraftRef.current = "";
    setMarkdownRequestLabel(resource);
    setMarkdownLoading(true);
    setMarkdownError("");
    try {
      const result = await workbench.readMarkdown({ resource, basePath });
      if (requestId !== markdownOpenRequestRef.current) return;
      if (!result.ok || !result.document) {
        setMarkdownError(result.error || "无法读取 Markdown 文件。");
        return;
      }
      markdownDocumentRef.current = result.document;
      markdownDraftRef.current = result.document.content;
      setMarkdownDocument(result.document);
      setMarkdownDraft(result.document.content);
      setMarkdownRequestLabel(result.document.path);
    } catch (error) {
      if (requestId !== markdownOpenRequestRef.current) return;
      reportDocumentOperation("读取 Markdown", error);
      setMarkdownError(describeOperationError(error, "无法读取 Markdown 文件。"));
    } finally {
      if (requestId === markdownOpenRequestRef.current) setMarkdownLoading(false);
    }
  }

  async function openPdf(resource: string, basePath?: string, ignoreDirty = false) {
    if (markdownDirty && !ignoreDirty) {
      const confirmed = window.confirm("当前 Markdown 文件尚未保存，仍要打开 PDF 文件吗？");
      if (!confirmed) return;
    }

    const requestId = ++pdfOpenRequestRef.current;
    markdownOpenRequestRef.current += 1;
    markdownSaveRequestRef.current += 1;
    markdownRenameRequestRef.current += 1;
    setMarkdownSaving(false);
    setMarkdownRenaming(false);
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
    if (workspaceView !== "documents") setRightPanelOpen(true);
    setMarkdownDocument(null);
    setMarkdownDraft("");
    markdownDocumentRef.current = null;
    markdownDraftRef.current = "";
    setMarkdownError("");
    setMarkdownRequestLabel("");
    setMarkdownLoading(false);
    setPdfDocument(null);
    setPdfRequestLabel(resource);
    setPdfLoading(true);
    setPdfFrameLoading(false);
    setPdfError("");
    try {
      const result = await workbench.readPdf({ resource, basePath });
      if (requestId !== pdfOpenRequestRef.current) return;
      if (!result.ok || !result.document) {
        setPdfError(result.error || "无法读取 PDF 文件。");
        return;
      }
      setPdfDocument(result.document);
      setPdfRequestLabel(result.document.path);
      setPdfFrameLoading(true);
    } catch (error) {
      if (requestId !== pdfOpenRequestRef.current) return;
      reportDocumentOperation("读取 PDF", error);
      setPdfError(describeOperationError(error, "无法读取 PDF 文件。"));
    } finally {
      if (requestId === pdfOpenRequestRef.current) setPdfLoading(false);
    }
  }

  function openDocument(resource: string) {
    if (isLocalPdfResource(resource)) {
      void openPdf(resource);
      return;
    }
    void openMarkdown(resource);
  }

  async function saveOpenMarkdown() {
    if (
      !markdownDocument
      || !markdownDirty
      || markdownSaving
      || markdownRenaming
      || markdownTitleEditing
      || markdownRenameInFlightRef.current
    ) return;
    const document = markdownDocument;
    const content = markdownDraft;
    const requestId = ++markdownSaveRequestRef.current;
    setMarkdownSaving(true);
    setMarkdownError("");
    try {
      const result = await workbench.saveMarkdown({
        path: document.path,
        content,
        expectedMtimeMs: document.mtimeMs
      });
      if (
        requestId !== markdownSaveRequestRef.current
        || markdownDocumentRef.current?.path !== document.path
      ) return;
      if (!result.ok || !result.document) {
        setMarkdownError(result.error || "保存 Markdown 文件失败。");
        return;
      }
      markdownDocumentRef.current = result.document;
      setMarkdownDocument(result.document);
      if (markdownDraftRef.current === content) {
        markdownDraftRef.current = result.document.content;
        setMarkdownDraft(result.document.content);
      }
    } catch (error) {
      if (requestId !== markdownSaveRequestRef.current) return;
      reportDocumentOperation("保存 Markdown", error);
      setMarkdownError(describeOperationError(error, "保存 Markdown 文件失败。"));
    } finally {
      if (requestId === markdownSaveRequestRef.current) setMarkdownSaving(false);
    }
  }

  async function copyOpenMarkdown() {
    const document = markdownDocumentRef.current;
    if (!document || markdownCopying) return;
    setMarkdownCopying(true);
    setMarkdownCopied(false);
    setMarkdownError("");
    try {
      const result = await workbench.copyMarkdown({
        documentPath: document.path,
        markdown: markdownDraftRef.current
      });
      if (!result.ok) {
        setMarkdownError(result.error || "复制 Markdown 文档失败。");
        return;
      }
      setMarkdownCopied(true);
      if (result.missingImageCount) {
        setMarkdownError(
          `正文已复制，其中 ${result.missingImageCount} 张本地图片未找到；其余图片已随文档复制。`
        );
      }
      window.setTimeout(() => setMarkdownCopied(false), 2_400);
    } catch (error) {
      reportDocumentOperation("复制 Markdown", error);
      setMarkdownError(describeOperationError(error, "复制 Markdown 文档失败。"));
    } finally {
      setMarkdownCopying(false);
    }
  }

  function beginMarkdownTitleEdit() {
    if (!markdownDocument || markdownSaving || markdownRenaming) return;
    markdownTitleCancelRef.current = false;
    setMarkdownTitleDraft(markdownDocument.name);
    setMarkdownTitleEditing(true);
  }

  function cancelMarkdownTitleEdit() {
    markdownTitleCancelRef.current = true;
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
  }

  async function commitMarkdownTitleEdit() {
    if (markdownTitleCancelRef.current) {
      markdownTitleCancelRef.current = false;
      return;
    }
    if (
      !markdownDocument
      || markdownRenameInFlightRef.current
      || markdownSaving
      || markdownRenaming
    ) return;

    const document = markdownDocument;
    const requestedName = markdownTitleDraft.trim();
    if (!requestedName || requestedName === document.name) {
      setMarkdownTitleEditing(false);
      setMarkdownTitleDraft("");
      if (!requestedName) setMarkdownError("文件名不能为空。");
      return;
    }

    const requestId = ++markdownRenameRequestRef.current;
    markdownRenameInFlightRef.current = true;
    setMarkdownRenaming(true);
    setMarkdownError("");
    try {
      const result = await workbench.renameMarkdown({
        path: document.path,
        name: requestedName,
        expectedMtimeMs: document.mtimeMs
      });
      if (
        requestId !== markdownRenameRequestRef.current
        || markdownDocumentRef.current?.path !== document.path
      ) return;
      if (!result.ok || !result.document) {
        setMarkdownError(result.error || "重命名 Markdown 文件失败。");
        return;
      }

      markdownDocumentRef.current = result.document;
      setMarkdownDocument(result.document);
      setMarkdownRequestLabel(result.document.path);
      setMarkdownTitleEditing(false);
      setMarkdownTitleDraft("");
      if (workspaceView === "documents") {
        void refreshDocumentLibrary({ silent: true, force: true });
      }
    } catch (error) {
      if (requestId !== markdownRenameRequestRef.current) return;
      reportDocumentOperation("重命名 Markdown", error);
      setMarkdownError(describeOperationError(error, "重命名 Markdown 文件失败。"));
    } finally {
      markdownRenameInFlightRef.current = false;
      if (requestId === markdownRenameRequestRef.current) setMarkdownRenaming(false);
    }
  }

  function closeMarkdown() {
    if (markdownDirty) {
      const confirmed = window.confirm("当前 Markdown 文件尚未保存，仍要关闭吗？");
      if (!confirmed) return;
    }
    markdownOpenRequestRef.current += 1;
    markdownSaveRequestRef.current += 1;
    markdownRenameRequestRef.current += 1;
    setMarkdownSaving(false);
    setMarkdownCopying(false);
    setMarkdownCopied(false);
    setMarkdownRenaming(false);
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
    markdownDocumentRef.current = null;
    markdownDraftRef.current = "";
    setMarkdownDocument(null);
    setMarkdownDraft("");
    setMarkdownError("");
    setMarkdownRequestLabel("");
    setMarkdownLoading(false);
  }

  async function reloadOpenPdf() {
    if (!pdfDocument) return;
    await openPdf(pdfDocument.path, undefined, true);
  }

  function closePdf() {
    pdfOpenRequestRef.current += 1;
    setPdfDocument(null);
    setPdfError("");
    setPdfRequestLabel("");
    setPdfLoading(false);
    setPdfFrameLoading(false);
  }

  function renderMarkdownPanel() {
    return (
      <div className="markdown-panel-shell">
        <div className="markdown-panel-header">
          <div className="markdown-file-title">
            <FileText size={17} />
            <span className="markdown-file-meta">
              {markdownDocument && markdownTitleEditing ? (
                <input
                  className="markdown-title-input"
                  type="text"
                  value={markdownTitleDraft}
                  autoFocus
                  maxLength={240}
                  spellCheck={false}
                  disabled={markdownRenaming}
                  aria-label="Markdown 文件名"
                  onFocus={(event) => {
                    const extensionStart = event.currentTarget.value.lastIndexOf(".");
                    event.currentTarget.setSelectionRange(
                      0,
                      extensionStart > 0 ? extensionStart : event.currentTarget.value.length
                    );
                  }}
                  onChange={(event) => setMarkdownTitleDraft(event.currentTarget.value)}
                  onBlur={() => void commitMarkdownTitleEdit()}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    } else if (event.key === "Escape") {
                      event.preventDefault();
                      cancelMarkdownTitleEdit();
                    }
                  }}
                />
              ) : markdownDocument ? (
                <button
                  className="markdown-title-button"
                  type="button"
                  onClick={beginMarkdownTitleEdit}
                  disabled={markdownSaving || markdownRenaming}
                  title="点击修改文件名"
                  aria-label={`修改文件名：${markdownDocument.name}`}
                >
                  <strong>{markdownDocument.name}</strong>
                  <Pencil size={12} aria-hidden="true" />
                </button>
              ) : (
                <strong>Markdown</strong>
              )}
              <small title={markdownDocument?.path || markdownRequestLabel}>
                {markdownDocument?.path || markdownRequestLabel}
              </small>
            </span>
          </div>
          <div className="markdown-header-actions">
            {markdownDocument && (
              <>
                <div className="markdown-save-control">
                  <span className={`markdown-save-state ${markdownDirty ? "dirty" : ""}`}>
                    {markdownSaving
                      ? "正在保存"
                      : markdownRenaming
                        ? "正在重命名"
                        : markdownDirty
                          ? "未保存"
                          : "已保存"}
                  </span>
                  <button
                    className="markdown-save-button"
                    type="button"
                    onClick={saveOpenMarkdown}
                    disabled={
                      !markdownDirty
                      || markdownSaving
                      || markdownRenaming
                      || markdownTitleEditing
                    }
                    title="保存 (⌘S)"
                    aria-label="保存 Markdown"
                  >
                    <Save size={16} />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void copyOpenMarkdown()}
                  disabled={markdownCopying || markdownRenaming || markdownTitleEditing}
                  title={markdownCopied ? "已复制全文和图片" : "复制全文（包含图片）"}
                  aria-label="复制 Markdown 全文和图片"
                >
                  {markdownCopied ? <Check size={16} /> : <Copy size={16} />}
                </button>
                <button
                  type="button"
                  onClick={() => workbench.openResource(markdownDocument.path)}
                  disabled={markdownRenaming || markdownTitleEditing}
                  title="用其他应用打开"
                  aria-label="用其他应用打开"
                >
                  <ExternalLink size={16} />
                </button>
              </>
            )}
            <button type="button" onClick={closeMarkdown} title="关闭文档" aria-label="关闭文档">
              <X size={17} />
            </button>
          </div>
        </div>

        <div className="markdown-panel-body">
          {markdownLoading ? (
            <div className="markdown-panel-state"><RefreshCw className="spinning" size={18} />正在载入</div>
          ) : !markdownDocument ? (
            <div className="markdown-panel-state error"><AlertCircle size={18} />{markdownError}</div>
          ) : (
            <MarkdownEditorErrorBoundary
              documentKey={`${markdownDocument.path}:${markdownDocument.mtimeMs}`}
            >
              <Suspense fallback={<div className="markdown-panel-state"><RefreshCw className="spinning" size={18} />正在加载编辑器</div>}>
                <RichMarkdownEditor
                  key={`${markdownDocument.path}:${markdownDocument.mtimeMs}`}
                  documentPath={markdownDocument.path}
                  markdown={markdownDraft}
                  onCopyDocument={() => void copyOpenMarkdown()}
                  onChange={(content) => {
                    markdownDraftRef.current = content;
                    setMarkdownDraft(content);
                  }}
                />
              </Suspense>
            </MarkdownEditorErrorBoundary>
          )}
          {markdownDocument && markdownError && (
            <div className="markdown-error-banner"><AlertCircle size={15} />{markdownError}</div>
          )}
        </div>
      </div>
    );
  }

  function renderPdfPanel() {
    const previewSrc = pdfDocument
      ? `${pdfDocument.previewUrl}#toolbar=1&navpanes=0&view=FitH`
      : "";

    return (
      <div className="markdown-panel-shell pdf-panel-shell">
        <div className="markdown-panel-header">
          <div className="markdown-file-title">
            <FileType2 size={17} />
            <span>
              <strong>{pdfDocument?.name || "PDF"}</strong>
              <small title={pdfDocument?.path || pdfRequestLabel}>
                {pdfDocument?.path || pdfRequestLabel}
              </small>
            </span>
          </div>
          <div className="markdown-header-actions">
            {pdfDocument && (
              <>
                <button type="button" onClick={reloadOpenPdf} title="重新载入" aria-label="重新载入 PDF">
                  <RefreshCw size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => workbench.openResource(pdfDocument.path)}
                  title="用其他应用打开"
                  aria-label="用其他应用打开 PDF"
                >
                  <ExternalLink size={16} />
                </button>
              </>
            )}
            <button type="button" onClick={closePdf} title="关闭文档" aria-label="关闭 PDF">
              <X size={17} />
            </button>
          </div>
        </div>

        {pdfDocument && (
          <div className="pdf-panel-meta">
            <span>PDF 预览</span>
            <span>{formatFileSize(pdfDocument.size)}</span>
          </div>
        )}

        <div className="markdown-panel-body pdf-panel-body">
          {pdfLoading ? (
            <div className="markdown-panel-state"><RefreshCw className="spinning" size={18} />正在载入 PDF</div>
          ) : !pdfDocument ? (
            <div className="markdown-panel-state error"><AlertCircle size={18} />{pdfError}</div>
          ) : (
            <>
              <iframe
                key={`${pdfDocument.path}:${pdfDocument.mtimeMs}`}
                className="pdf-preview-frame"
                src={previewSrc}
                title={`${pdfDocument.name} PDF 预览`}
                onLoad={() => setPdfFrameLoading(false)}
              />
              {pdfFrameLoading && (
                <div className="pdf-frame-loading"><RefreshCw className="spinning" size={18} />正在渲染 PDF</div>
              )}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderDocumentPanel() {
    return pdfPanelActive ? renderPdfPanel() : renderMarkdownPanel();
  }

  function renderDocumentLibraryNode(
    node: DocumentLibraryNode,
    parentPath: string,
    depth = 0
  ): ReactNode {
    const isFolder = node.kind === "folder";
    const expanded = isFolder && (
      documentLibraryQuery.trim()
        ? true
        : documentLibraryExpandedPaths.has(node.path)
    );
    const selected = isFolder
      ? documentLibrarySelectedFolder === node.path
      : selectedDocumentLibraryPath === node.path;
    const keyboardActive = Boolean(documentLibraryQuery.trim())
      && documentLibrarySearchActivePath === node.path;
    return (
      <div className="document-library-node" key={node.path}>
        <button
          className={[
            "document-library-node-row",
            selected ? "selected" : "",
            keyboardActive ? "keyboard-active" : ""
          ].filter(Boolean).join(" ")}
          type="button"
          style={{ "--tree-indent": `${depth * 14}px` } as CSSProperties}
          onClick={() => openDocumentLibraryNode(node, parentPath)}
          title={node.path}
          role="treeitem"
          aria-expanded={isFolder ? expanded : undefined}
          aria-selected={selected || keyboardActive}
          data-document-library-path={node.path}
        >
          <span className="document-library-disclosure" aria-hidden="true">
            {isFolder ? <ChevronRight className={expanded ? "open" : ""} size={13} /> : null}
          </span>
          <span className={`document-library-node-icon ${node.kind}`} aria-hidden="true">
            {node.kind === "folder"
              ? expanded ? <FolderOpen size={16} /> : <Folder size={16} />
              : node.kind === "pdf" ? <FileType2 size={16} /> : <FileText size={16} />}
          </span>
          <span className="document-library-node-name">{node.name}</span>
          {node.kind !== "folder" && (
            <small>{formatFileSize(node.size)}</small>
          )}
        </button>
        {expanded && node.children && (
          <div className="document-library-children" role="group">
            {node.children.length > 0
              ? node.children.map((child) =>
                  renderDocumentLibraryNode(child, node.path, depth + 1)
                )
              : (
                <span
                  className="document-library-empty-folder"
                  style={{ "--tree-indent": `${(depth + 1) * 14}px` } as CSSProperties}
                >
                  空文件夹
                </span>
              )}
          </div>
        )}
      </div>
    );
  }

  function renderDocumentLibrarySidebar() {
    const rootPath = documentLibrary?.rootPath || "";
    const selectedFolderName = documentLibrarySelectedFolder === rootPath
      ? "文档库根目录"
      : documentLibrarySelectedFolder.split(/[\\/]/).filter(Boolean).pop() || "文档库根目录";
    return (
      <div className="sidebar-document-library" aria-label="本地文档库目录">
        <div className="sidebar-document-toolbar">
          <span title={documentLibrary?.rootName || "本地资料库"}>
            {documentLibrary?.rootName || "本地资料库"}
          </span>
          <div className="document-library-tree-actions">
            <button
              type="button"
              onClick={() => beginDocumentLibraryCreate("markdown")}
              disabled={!documentLibrary?.ok}
              title={`在“${selectedFolderName}”中新建文档`}
              aria-label="新建 Markdown 文档"
            >
              <FilePlus2 size={14} />
            </button>
            <button
              type="button"
              onClick={() => beginDocumentLibraryCreate("folder")}
              disabled={!documentLibrary?.ok}
              title={`在“${selectedFolderName}”中新建文件夹`}
              aria-label="新建文件夹"
            >
              <FolderPlus size={14} />
            </button>
            <button
              type="button"
              onClick={() => rootPath && void workbench.openResource(rootPath)}
              disabled={!rootPath}
              title="在访达中打开文档库"
              aria-label="在访达中打开文档库"
            >
              <ExternalLink size={13} />
            </button>
          </div>
        </div>

        <label className="document-library-search">
          <Search size={13} />
          <input
            value={documentLibraryQuery}
            onChange={(event) => {
              setDocumentLibraryQuery(event.target.value);
              setDocumentLibrarySearchActivePath("");
            }}
            onFocus={refreshDocumentIndexForSearch}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                moveDocumentLibrarySearchSelection(event.key === "ArrowDown" ? 1 : -1);
                return;
              }
              if (event.key === "Enter" && documentLibraryQuery.trim()) {
                event.preventDefault();
                openActiveDocumentLibrarySearchResult();
                return;
              }
              if (event.key === "Escape" && documentLibraryQuery) {
                event.preventDefault();
                setDocumentLibraryQuery("");
                setDocumentLibrarySearchActivePath("");
              }
            }}
            placeholder="搜索文档和文件夹"
            aria-label="搜索本地文档库"
          />
          {documentLibraryQuery && (
            <button
              type="button"
              onClick={() => {
                setDocumentLibraryQuery("");
                setDocumentLibrarySearchActivePath("");
              }}
              title="清除搜索"
              aria-label="清除文档搜索"
            >
              <X size={12} />
            </button>
          )}
        </label>

        {documentLibraryCreateKind && (
          <form className="document-library-create" onSubmit={submitDocumentLibraryCreate}>
            <span>
              {documentLibraryCreateKind === "folder"
                ? <FolderPlus size={14} />
                : <FilePlus2 size={14} />}
            </span>
            <input
              autoFocus
              value={documentLibraryCreateName}
              onChange={(event) => setDocumentLibraryCreateName(event.target.value)}
              placeholder={documentLibraryCreateKind === "folder" ? "文件夹名称" : "文档名称"}
              aria-label={documentLibraryCreateKind === "folder" ? "文件夹名称" : "文档名称"}
              onKeyDown={(event) => {
                if (event.key === "Escape") cancelDocumentLibraryCreate();
              }}
            />
            <button type="submit" disabled={documentLibraryCreating} title="创建">
              {documentLibraryCreating ? <RefreshCw className="spinning" size={12} /> : <Check size={12} />}
            </button>
            <button type="button" onClick={cancelDocumentLibraryCreate} title="取消">
              <X size={12} />
            </button>
            {documentLibraryCreateError && <small>{documentLibraryCreateError}</small>}
          </form>
        )}

        <button
          className={`document-library-root-row ${
            documentLibrarySelectedFolder === rootPath ? "selected" : ""
          }`}
          type="button"
          onClick={() => {
            if (rootPath) setDocumentLibrarySelectedFolder(rootPath);
          }}
          disabled={!rootPath}
          title={rootPath}
        >
          <FolderOpen size={15} />
          <span>全部文档</span>
        </button>

        <div className="document-library-tree" role="tree" ref={documentLibraryTreeRef}>
          {documentLibraryLoading && !documentLibrary && (
            <div className="document-library-state">
              <RefreshCw className="spinning" size={15} />
              正在读取本地目录
            </div>
          )}
          {!documentLibraryLoading && documentLibraryError && (
            <div className="document-library-state error">
              <AlertCircle size={15} />
              <span>{documentLibraryError}</span>
              <button type="button" onClick={() => void refreshDocumentLibrary({ force: true })}>重试</button>
            </div>
          )}
          {documentLibrary?.ok && filteredDocumentLibraryNodes.map((node) =>
            renderDocumentLibraryNode(node, documentLibrary.rootPath)
          )}
          {documentLibrary?.ok && filteredDocumentLibraryNodes.length === 0 && (
            <div className="document-library-state">
              <FileText size={15} />
              {documentLibraryQuery ? "没有匹配的文档" : "文档库还是空的"}
            </div>
          )}
        </div>

        {documentLibrary?.truncated && (
          <div className="document-library-truncated">
            部分内容暂未显示
          </div>
        )}
      </div>
    );
  }

  function renderDocumentLibrary() {
    const rootPath = documentLibrary?.rootPath || "";
    return (
      <section className="document-library-workspace" aria-label="文档阅读与编辑">
        <div className="document-library-content">
          {openDocumentActive ? renderDocumentPanel() : (
            <div className="document-library-welcome">
              <span><LibraryBig size={28} /></span>
              <h2>选择一篇文档开始阅读</h2>
              <p>在左侧“文档库”中展开目录，即可查看并编辑本地 Markdown。</p>
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setDocumentLibrarySidebarExpanded(true);
                    beginDocumentLibraryCreate("markdown");
                  }}
                  disabled={!documentLibrary?.ok}
                >
                  <FilePlus2 size={15} />
                  新建文档
                </button>
                <button
                  type="button"
                  onClick={() => rootPath && void workbench.openResource(rootPath)}
                  disabled={!rootPath}
                >
                  <FolderOpen size={15} />
                  打开本地目录
                </button>
              </div>
            </div>
          )}
        </div>
      </section>
    );
  }

  function renderTaskBoard() {
    const suggestionCount = managedTasksByCategory.active.length;
    const columns: Array<{
      id: string;
      title: string;
      icon: ReactNode;
      tasks: DomiTask[];
      empty: string;
    }> = [
      {
        id: "new-entry",
        title: "新入库约见",
        icon: <Sparkles size={15} />,
        tasks: managedTasksByCategory.newEntry,
        empty: "近 4 周没有值得优先约见的新对象"
      },
      {
        id: "project-follow-up",
        title: "项目跟踪",
        icon: <BriefcaseBusiness size={15} />,
        tasks: managedTasksByCategory.projectFollowUp,
        empty: "当前没有重点项目需要跟踪"
      },
      {
        id: "relationship-follow-up",
        title: "人脉跟进",
        icon: <UsersRound size={15} />,
        tasks: managedTasksByCategory.relationshipFollowUp,
        empty: "当前没有重要人脉需要跟进"
      },
      {
        id: "key-milestone",
        title: "关键节点",
        icon: <Clock3 size={15} />,
        tasks: managedTasksByCategory.keyMilestone,
        empty: "近期没有需要提醒的关键节点"
      }
    ];

    return (
      <section className="task-board managed-task-board" aria-labelledby="task-board-title">
        <div className="task-board-header">
          <div className="task-board-heading">
            <span className="task-board-heading-icon"><ListChecks size={20} /></span>
            <div>
              <h1 id="task-board-title">待办事项</h1>
              <p>
                {domiTaskBoard?.configured
                  ? `${suggestionCount} 个待办事项 · 与 ${todoDocumentLabel} 同步`
                  : "完成资料库连接后显示行动看板"}
              </p>
            </div>
          </div>
          <div className="task-board-header-actions">
            {domiTaskBoard?.stale && <span className="managed-task-stale">正在显示上次同步</span>}
            {domiTaskSyncState.phase !== "idle" && (
              <span
                className={`managed-task-sync-status ${domiTaskSyncState.phase}`}
                title={domiTaskSyncState.label}
              >
                {domiTaskSyncState.phase !== "completed"
                  && domiTaskSyncState.phase !== "failed"
                  && <RefreshCw className="spinning" size={13} />}
                {domiTaskSyncState.label}
                {domiTaskSyncState.startedAt
                  ? ` · ${domiTaskSyncElapsed < 60
                    ? `${domiTaskSyncElapsed}s`
                    : `${Math.floor(domiTaskSyncElapsed / 60)}m ${domiTaskSyncElapsed % 60}s`}`
                  : ""}
              </span>
            )}
            {runningTaskThreads.length > 0 && (
              <button
                className="task-board-running-status"
                type="button"
                onClick={() => selectThread(runningTaskThreads[0].id)}
                title="打开最近运行中的任务"
              >
                <RefreshCw className="spinning" size={14} />
                运行中 {runningTaskThreads.length}
              </button>
            )}
            <button
              className="task-board-generate"
              type="button"
              onClick={() => void syncManagedTasks()}
              disabled={Boolean(executingSuggestionId)
                || !domiTaskBoard?.configured}
              title={`运行 Todo Skill，更新 ${todoDocumentLabel} 后刷新看板`}
            >
              <RefreshCw
                className={executingSuggestionId === "managed-refresh"
                  ? "spinning"
                  : ""}
                size={14}
              />
              {executingSuggestionId === "managed-refresh" ? "同步中" : "同步"}
            </button>
          </div>
        </div>

        {!domiTaskBoard?.configured ? (
          <div className="managed-task-setup">
            <span><ListChecks size={26} /></span>
            <div>
              <strong>完成资料库连接</strong>
              <p>{appSettings?.storageBackend === "local"
                ? "domi 会在本地工作区根目录自动创建“0.待办事项.md”。"
                : "domi 会在同一飞书文档库中自动发现或创建“1.待办事项”，无需另贴文档链接。"}</p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSettingsInitialTab("data");
                setSettingsOpen(true);
              }}
            >
              打开资料连接
            </button>
          </div>
        ) : (
          <div className="task-board-scroll">
            <div className="task-board-grid managed-task-grid">
              {columns.map((column) => (
                <section className={`task-column managed-${column.id}`} aria-labelledby={`managed-task-${column.id}`} key={column.id}>
                  <header className="task-column-header">
                    <span>{column.icon}<strong id={`managed-task-${column.id}`}>{column.title}</strong></span>
                    <b>{column.tasks.length}</b>
                  </header>
                  <div className="task-column-list">
                    {column.tasks.length === 0 && (
                      <div className="task-column-empty">{column.empty}</div>
                    )}
                    {column.tasks.map((task) => {
                      const busy = domiTaskMutationId === task.id
                        || executingSuggestionId === `managed:${task.id}`;
                      const actionable = task.status === "open" || task.status === "in_progress";
                      return (
                        <article className={`task-card managed-task-card priority-${task.priority.toLocaleLowerCase()}`} key={task.id}>
                          <div className="task-card-topline">
                            <span className="task-card-kind">
                              {task.source.displayName || task.source.kind}
                            </span>
                            <b>{task.priority}</b>
                          </div>
                          <strong className="task-card-title">{task.title}</strong>
                          {task.summary && <p>{task.summary}</p>}
                          {task.reason && <small title={task.reason}>{task.reason}</small>}
                          {task.dueAt && (
                            <div className="managed-task-meta">
                              <time><Clock3 size={12} />{formatManagedTaskDate(task.dueAt)}</time>
                            </div>
                          )}
                          {actionable && (
                            <div className="task-card-actions">
                              <button
                                className="task-card-primary"
                                type="button"
                                onClick={() => void executeManagedTask(task)}
                                disabled={Boolean(domiTaskMutationId || executingSuggestionId)}
                              >
                                {busy
                                  ? <RefreshCw className="spinning" size={13} />
                                  : task.suggestedAction.kind === "schedule"
                                    ? <CalendarPlus size={13} />
                                    : <Play size={13} fill="currentColor" />}
                                {task.suggestedAction.label || "执行下一动作"}
                              </button>
                              <button
                                type="button"
                                onClick={() => void updateManagedTask(task.id, "ignored")}
                                disabled={Boolean(domiTaskMutationId || executingSuggestionId)}
                                title="忽略这个任务"
                                aria-label={`忽略 ${task.title}`}
                              >
                                <X size={14} />
                              </button>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        )}

        {(domiTaskError || executionSuggestionError) && (
          <div className="task-board-error">
            <AlertCircle size={15} />
            {domiTaskError || executionSuggestionError}
          </div>
        )}
      </section>
    );
  }

  function renderLegacyTaskBoard() {
    const pendingCount = taskBoardSuggestions.length
      + snoozedTaskSuggestions.length
      + queuedTaskItems.length
      + failedTaskThreads.length;

    return (
      <section className="task-board" aria-labelledby="task-board-title">
        <div className="task-board-header">
          <div className="task-board-heading">
            <span className="task-board-heading-icon"><ClipboardList size={20} /></span>
            <div>
              <h1 id="task-board-title">待办事项</h1>
              <p>{pendingCount} 个待处理</p>
            </div>
          </div>
          <div className="task-board-header-actions">
            {runningTaskThreads.length > 0 && (
              <button
                className="task-board-running-status"
                type="button"
                onClick={() => selectThread(runningTaskThreads[0].id)}
                title="打开最近运行中的任务"
              >
                <RefreshCw className="spinning" size={14} />
                运行中 {runningTaskThreads.length}
              </button>
            )}
            <details className="task-board-history">
              <summary>
                <CheckCircle2 size={14} />
                完成记录
                <b>{completedTaskThreads.length}</b>
                <ChevronDown size={13} />
              </summary>
              <div className="task-board-history-menu">
                <header>
                  <strong>最近完成</strong>
                  <small>{completedTaskThreads.length} 条</small>
                </header>
                <div>
                  {completedTaskThreads.length === 0 && (
                    <p>完成的任务会显示在这里</p>
                  )}
                  {completedTaskThreads.map((thread) => (
                    <button
                      className={thread.hasUnreadCompletion ? "unread" : ""}
                      type="button"
                      onClick={() => selectThread(thread.id)}
                      key={`history-${thread.id}`}
                    >
                      <span>
                        <strong>{thread.title}</strong>
                        <small>{thread.project}</small>
                      </span>
                      <time>{thread.updatedAt}</time>
                    </button>
                  ))}
                </div>
              </div>
            </details>
          </div>
        </div>

        <div className="task-board-scroll">
          <div className="task-board-grid">
            <section className="task-column suggestion-column" aria-labelledby="task-suggestions-title">
              <header className="task-column-header">
                <span><Sparkles size={15} /><strong id="task-suggestions-title">建议</strong></span>
                <b>{taskBoardSuggestions.length}</b>
              </header>
              <div className="task-column-list">
                {!domiSnapshot && <div className="task-column-empty">同步 domi 后生成行动建议</div>}
                {domiSnapshot && taskBoardSuggestions.length === 0 && (
                  <div className="task-column-empty">当前没有新的行动建议</div>
                )}
                {taskBoardSuggestions.map((suggestion) => {
                  const executing = executingSuggestionId === suggestion.id;
                  return (
                    <article className={`task-card priority-${suggestion.priority.toLocaleLowerCase()}`} key={suggestion.id}>
                      <div className="task-card-topline">
                        <span className="task-card-kind">建议</span>
                        <b>{suggestion.priority}</b>
                      </div>
                      <strong className="task-card-title">{suggestion.title}</strong>
                      <p>{suggestion.context}</p>
                      <small title={suggestion.reason}>{suggestion.reason}</small>
                      <div className="task-card-actions">
                        <button
                          className="task-card-primary"
                          type="button"
                          onClick={() => void executeSuggestion(suggestion)}
                          disabled={Boolean(executingSuggestionId)}
                        >
                          {executing
                            ? <RefreshCw className="spinning" size={13} />
                            : <Play size={13} fill="currentColor" />}
                          执行
                        </button>
                        <button
                          type="button"
                          onClick={() => snoozeExecutionSuggestion(suggestion)}
                          disabled={Boolean(executingSuggestionId)}
                          title="明天再处理"
                          aria-label={`明天再处理 ${suggestion.title}`}
                        >
                          <Clock3 size={14} />
                        </button>
                        <button
                          type="button"
                          onClick={() => dismissExecutionSuggestion(suggestion)}
                          disabled={Boolean(executingSuggestionId)}
                          title="忽略建议"
                          aria-label={`忽略 ${suggestion.title}`}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="task-column" aria-labelledby="task-todo-title">
              <header className="task-column-header">
                <span><Clock3 size={15} /><strong id="task-todo-title">待办</strong></span>
                <b>{snoozedTaskSuggestions.length + queuedTaskItems.length + failedTaskThreads.length}</b>
              </header>
              <div className="task-column-list">
                {snoozedTaskSuggestions.length === 0 && queuedTaskItems.length === 0 && failedTaskThreads.length === 0 && (
                  <div className="task-column-empty">没有需要处理的待办事项</div>
                )}
                {queuedTaskItems.map(({ submission, thread }) => (
                  <article className="task-card queued" key={submission.id}>
                    <div className="task-card-topline">
                      <span className="task-card-kind">已排队</span>
                      <time>{formatTaskTimestamp(submission.createdAt)}</time>
                    </div>
                    <button className="task-card-open" type="button" onClick={() => selectThread(thread.id)}>
                      <strong className="task-card-title">{submission.input}</strong>
                      <p>{thread.title}</p>
                    </button>
                    <div className="task-card-actions end-aligned">
                      <button type="button" onClick={() => selectThread(thread.id)} title="打开对话">
                        <ChevronRight size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeQueuedSubmission(thread.id, submission.id)}
                        title="从队列移除"
                        aria-label={`从队列移除 ${submission.input}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {failedTaskThreads.map((thread) => (
                  <article className="task-card failed" key={`failed-${thread.id}`}>
                    <div className="task-card-topline">
                      <span className="task-card-kind"><AlertCircle size={12} />需处理</span>
                      <time>{thread.updatedAt}</time>
                    </div>
                    <button className="task-card-open" type="button" onClick={() => selectThread(thread.id)}>
                      <strong className="task-card-title">{thread.title}</strong>
                      <p>{thread.project}</p>
                    </button>
                    <div className="task-card-actions end-aligned">
                      <button type="button" onClick={() => selectThread(thread.id)} title="查看失败原因">
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </article>
                ))}
                {snoozedTaskSuggestions.map((suggestion) => (
                  <article className="task-card snoozed" key={`snoozed-${suggestion.id}`}>
                    <div className="task-card-topline">
                      <span className="task-card-kind">稍后处理</span>
                      <time>{formatTaskTimestamp(executionSuggestionState[suggestion.id]?.snoozedUntil)}</time>
                    </div>
                    <strong className="task-card-title">{suggestion.title}</strong>
                    <p>{suggestion.context}</p>
                    <div className="task-card-actions">
                      <button
                        className="task-card-primary"
                        type="button"
                        onClick={() => void executeSuggestion(suggestion)}
                        disabled={Boolean(executingSuggestionId)}
                      >
                        <Play size={13} fill="currentColor" />执行
                      </button>
                      <button
                        type="button"
                        onClick={() => restoreExecutionSuggestion(suggestion)}
                        title="恢复到建议"
                        aria-label={`恢复 ${suggestion.title}`}
                      >
                        <RefreshCw size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => dismissExecutionSuggestion(suggestion)}
                        title="忽略建议"
                        aria-label={`忽略 ${suggestion.title}`}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </section>

          </div>
        </div>

        {executionSuggestionError && (
          <div className="task-board-error"><AlertCircle size={15} />{executionSuggestionError}</div>
        )}
      </section>
    );
  }

  function renderWeeklyNews() {
    const contentUpdatedAt = weeklyNews?.contentUpdatedAt || weeklyNews?.syncedAt;
    const checkedAt = weeklyNews?.checkedAt;
    const radarCheckedThrough = weeklyNews?.radarCheckedThrough;
    const automaticRadarEnabled = appSettings?.externalAccessMode === "always";
    const automationLabel = !hasNativeWorkbench
      ? ""
      : weeklyNewsAutomation.phase === "syncing"
        ? "正在自动同步"
        : weeklyNewsAutomation.retryAttempt > 0 && weeklyNewsAutomation.nextRadarAt
          ? `自动更新 ${formatWeeklyNewsAutomationTime(weeklyNewsAutomation.nextRadarAt)} 重试`
          : !automaticRadarEnabled
            ? "自动读取已开启，雷达需授权"
            : weeklyNewsAutomation.nextRadarAt
              ? `自动雷达 ${formatWeeklyNewsAutomationTime(weeklyNewsAutomation.nextRadarAt)}`
              : "自动更新已开启";
    const showSeparateCheckTime = Boolean(
      checkedAt && contentUpdatedAt && checkedAt - contentUpdatedAt >= 60_000
    );
    const countLabel = [
      `${displayedWeeklyNews.length} 条值得关注`,
      contentUpdatedAt ? `内容更新 ${formatWeeklyNewsUpdatedAt(contentUpdatedAt)}` : "",
      radarCheckedThrough ? `雷达检索 ${formatWeeklyNewsUpdatedAt(radarCheckedThrough)}` : "",
      showSeparateCheckTime ? `数据读取 ${formatWeeklyNewsUpdatedAt(checkedAt)}` : "",
      displayedFreshWeeklyNewsCount > 0 ? `刚新增 ${displayedFreshWeeklyNewsCount} 条` : "",
      automationLabel
    ].filter(Boolean).join(" · ");
    return (
      <section
        className="home-weekly-news"
        aria-labelledby="weekly-news-title"
        aria-busy={weeklyNewsLoading || weeklyNewsScanning}
        ref={weeklyNewsRef}
      >
        <div className="weekly-news-header">
          <div className="weekly-news-heading">
            <Newspaper size={18} />
            <div>
              <h2 id="weekly-news-title">{weeklyNewsPage === 0 ? "本周行业动态" : "往期行业动态"}</h2>
              <p>{weeklyNewsScanning
                ? `${weeklyNewsScanStage} · ${formatWeeklyNewsScanElapsed(weeklyNewsScanElapsed)}`
                : weeklyNewsLoading && !weeklyNews
                  ? "正在读取 domi 行业雷达"
                  : `${newsRangeLabel(weeklyNews?.rangeStart, weeklyNews?.rangeEnd)} · ${countLabel}`}</p>
            </div>
          </div>
          <div className="weekly-news-actions">
            {weeklyNews?.sourceUrl && (
              <button
                className="weekly-news-source"
                type="button"
                onClick={() => void workbench.openResource(weeklyNews.sourceUrl || "")}
                title="在飞书中查看行业信息追踪"
              >
                查看全部 <ExternalLink size={13} />
              </button>
            )}
            <button
              className="weekly-news-refresh"
              type="button"
              onClick={() => void scanWeeklyNews()}
              disabled={weeklyNewsLoading || weeklyNewsScanning}
              title={weeklyNewsScanning
                ? "domi 行业雷达正在检索最新新闻"
                : "运行 domi 行业雷达，检索并更新最新新闻"}
              aria-label="运行 domi 行业雷达，检索并更新最新新闻"
            >
              <RefreshCw className={weeklyNewsLoading || weeklyNewsScanning ? "spinning" : ""} size={16} />
            </button>
          </div>
        </div>

        {weeklyNewsDomains.length > 1 && (
          <div className="weekly-news-taxonomy">
            <div className="weekly-news-filters" role="tablist" aria-label="按行业领域筛选">
              {["全部", ...weeklyNewsDomains].map((domain) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={weeklyNewsDomain === domain}
                  className={weeklyNewsDomain === domain ? "active" : ""}
                  onClick={() => {
                    setWeeklyNewsDomain(domain);
                    setWeeklyNewsSubdomain("全部");
                  }}
                  key={domain}
                >
                  {domain}
                  {domain !== "全部" && weeklyNewsDomain === domain && (
                    <ChevronDown size={12} aria-hidden="true" />
                  )}
                </button>
              ))}
            </div>
            {weeklyNewsDomain !== "全部" && weeklyNewsSubdomains.length > 0 && (
              <div className="weekly-news-subdomain-panel">
                <span className="weekly-news-subdomain-label">{weeklyNewsDomain} 子领域</span>
                <div
                  className="weekly-news-subdomain-filters"
                  role="tablist"
                  aria-label={`按${weeklyNewsDomain}子领域筛选`}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={weeklyNewsSubdomain === "全部"}
                    className={weeklyNewsSubdomain === "全部" ? "active" : ""}
                    onClick={() => setWeeklyNewsSubdomain("全部")}
                  >
                    全部子领域
                    <small>{followedWeeklyNews.filter(
                      (item) => followedDomainsForNews(item).includes(weeklyNewsDomain)
                    ).length}</small>
                  </button>
                  {weeklyNewsSubdomains.map((subdomain) => (
                    <button
                      type="button"
                      role="tab"
                      aria-selected={weeklyNewsSubdomain === subdomain.name}
                      className={weeklyNewsSubdomain === subdomain.name ? "active" : ""}
                      onClick={() => setWeeklyNewsSubdomain(subdomain.name)}
                      key={subdomain.name}
                    >
                      {subdomain.name}
                      <small>{subdomain.count}</small>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {weeklyNewsError && <div className="weekly-news-error"><AlertCircle size={15} />{weeklyNewsError}</div>}
        {weeklyNewsNotice && (
          <div className="weekly-news-notice">
            {weeklyNewsScanning
              ? <RefreshCw className="spinning" size={15} />
              : <CheckCircle2 size={15} />}
            {weeklyNewsNotice}
          </div>
        )}
        {weeklyNewsLoading && !weeklyNews && (
          <div className="weekly-news-loading" aria-label="正在加载行业新闻">
            {Array.from({ length: 4 }, (_, index) => <span key={index} />)}
          </div>
        )}
        {!weeklyNewsLoading && weeklyNews?.ok && displayedWeeklyNews.length === 0 && (
          <div className="weekly-news-empty">最近 7 天没有符合当前领域或子领域筛选的已核验新闻。</div>
        )}
        {displayedWeeklyNews.length > 0 && (
          <div className="weekly-news-grid">
            {displayedWeeklyNews.map((item) => {
              const itemFollowedDomains = followedDomainsForNews(item);
              const followedDomain = weeklyNewsDomain !== "全部"
                && itemFollowedDomains.includes(weeklyNewsDomain)
                ? weeklyNewsDomain
                : itemFollowedDomains[0];
              const itemSubdomains = followedDomain
                ? projectSubdomainsForNews(item.subdomains, followedDomain)
                : [];
              const matchedSubdomain = weeklyNewsSubdomain !== "全部"
                && itemSubdomains.includes(weeklyNewsSubdomain)
                ? weeklyNewsSubdomain
                : itemSubdomains[0];
              const category = [followedDomain, matchedSubdomain || item.types[0]].filter(Boolean).join(" · ");
              const isFresh = weeklyNewsFreshRecordIdSet.has(item.recordId);
              return (
                <button
                  className={`weekly-news-item${isFresh ? " fresh" : ""}`}
                  type="button"
                  onClick={() => void openWeeklyNews(item)}
                  disabled={!item.url}
                  aria-label={item.url ? `打开新闻原文：${item.title}` : item.title}
                  key={item.recordId}
                >
                  <span className="weekly-news-item-top">
                    <span className="weekly-news-item-label">
                      <small>{category || "行业动态"}</small>
                      {isFresh && <small className="weekly-news-fresh-label">刚更新</small>}
                    </span>
                    {item.url && <ExternalLink size={13} />}
                  </span>
                  <strong>{item.title}</strong>
                  <span className="weekly-news-summary">{item.summary || item.investmentMeaning || "暂无摘要"}</span>
                  <span className="weekly-news-meta">
                    <small>{item.source || item.evidenceStatus || "来源待补充"}</small>
                    <small>{newsDateLabel(item.publishedAt)} · 重要性 {item.importance || "—"}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
        {weeklyNews?.ok && (
          <nav className="weekly-news-pagination" aria-label="行业新闻翻页">
            <button
              type="button"
              onClick={() => void refreshWeeklyNews(Math.max(0, weeklyNewsPage - 1))}
              disabled={weeklyNewsLoading || weeklyNewsScanning || !weeklyNews.hasNewer}
              title="查看较新的行业新闻"
            >
              <ChevronLeft size={15} />
              <span>上一页</span>
            </button>
            <span>
              第 {weeklyNewsPage + 1} 页
              <small>{newsRangeLabel(weeklyNews.rangeStart, weeklyNews.rangeEnd)}</small>
            </span>
            <button
              type="button"
              onClick={() => void refreshWeeklyNews(weeklyNewsPage + 1)}
              disabled={weeklyNewsLoading || weeklyNewsScanning || !weeklyNews.hasOlder}
              title="查看更早的行业新闻"
            >
              <span>下一页</span>
              <ChevronRight size={15} />
            </button>
          </nav>
        )}
      </section>
    );
  }

  function renderNewTaskHome() {
    return (
      <div className="new-task-stage">
        <div className="new-task-content">
          <section className="new-task-intro" aria-labelledby="new-task-quote">
            <div className="new-task-quote-row">
              <blockquote id="new-task-quote" aria-label={NEW_TASK_QUOTE}>
                <Sparkles size={24} aria-hidden="true" />
                “We <span>(the whole industry, not just OpenAI)</span> are building a brain for the world.”
              </blockquote>
            </div>
            <cite>Sam Altman · 2025</cite>
          </section>

          <section className="new-task-suggestions" aria-label="推荐工作流">
            {visibleQuickStartWorkflows.map((workflow) => {
              const Icon = workflowIconMap[workflow.id] || FileText;
              const selected = selectedWorkflowId === workflow.id;
              return (
                <button
                  className={selected ? "active" : ""}
                  type="button"
                  onClick={() => chooseWorkflow(workflow)}
                  aria-pressed={selected}
                  data-workflow={workflow.id}
                  title={`${workflow.description} 选择后填写目标，再发送启动。`}
                  key={workflow.id}
                >
                  <Icon size={20} aria-hidden="true" />
                  <span>
                    <strong>{workflow.title}</strong>
                  </span>
                </button>
              );
            })}
          </section>

          <div className="new-task-composer-zone">
            {renderComposer("home")}
          </div>
        </div>
      </div>
    );
  }

  function renderNewsWorkspace() {
    return (
      <div className="news-stage">
        <div className="news-content">{renderWeeklyNews()}</div>
      </div>
    );
  }

  function renderDatabaseWorkspace() {
    const records = databaseRecords(databaseSnapshot, databaseEntityType);
    const query = deferredDatabaseQuery.trim().toLocaleLowerCase("zh-CN");
    const statusForRecord = (record: DomiProject | DomiPerson | DomiNewsItem) =>
      databaseEntityType === "project"
        ? (record as DomiProject).status || "未填写"
        : databaseEntityType === "person"
          ? (record as DomiPerson).status || "未填写"
          : (record as DomiNewsItem).evidenceStatus || "未填写";
    const statusOptions = [
      "全部",
      ...new Set(records.map(statusForRecord).filter(Boolean))
    ];
    const filtered = records.filter((record) => {
      const searchText = databaseEntityType === "project"
        ? [
            (record as DomiProject).name,
            (record as DomiProject).domain,
            ...(record as DomiProject).subdomains,
            (record as DomiProject).status,
            (record as DomiProject).notes || ""
          ].join(" ")
        : databaseEntityType === "person"
          ? [
              (record as DomiPerson).name,
              (record as DomiPerson).organization,
              ...(record as DomiPerson).types,
              (record as DomiPerson).status
            ].join(" ")
          : [
              (record as DomiNewsItem).title,
              ...(record as DomiNewsItem).domains,
              ...(record as DomiNewsItem).subdomains,
              (record as DomiNewsItem).source,
              (record as DomiNewsItem).summary
            ].join(" ");
      const matchesQuery = !query || searchText.toLocaleLowerCase("zh-CN").includes(query);
      const matchesStatus = databaseStatusFilter === "全部"
        || statusForRecord(record) === databaseStatusFilter;
      return matchesQuery && matchesStatus;
    }).sort((left, right) => {
      const name = (record: DomiProject | DomiPerson | DomiNewsItem) =>
        databaseRecordTitle(databaseEntityType, record);
      const updated = (record: DomiProject | DomiPerson | DomiNewsItem) =>
        databaseEntityType === "project"
          ? Number((record as DomiProject).lastFollowup || record.updatedAt || 0)
          : databaseEntityType === "news"
            ? Number(record.updatedAt || (record as DomiNewsItem).publishedAt || 0)
            : Number(record.updatedAt || 0);
      const created = (record: DomiProject | DomiPerson | DomiNewsItem) =>
        databaseEntityType === "news"
          ? Number((record as DomiNewsItem).publishedAt || 0)
          : Number((record as DomiProject | DomiPerson).createdAt || 0);
      const direction = databaseSortDirection === "asc" ? 1 : -1;
      if (databaseSortKey === "name") {
        return direction * name(left).localeCompare(name(right), "zh-CN");
      }
      const leftValue = databaseSortKey === "created" ? created(left) : updated(left);
      const rightValue = databaseSortKey === "created" ? created(right) : updated(right);
      return direction * (leftValue - rightValue)
        || name(left).localeCompare(name(right), "zh-CN");
    });
    const visibleRecords = filtered.slice(0, databaseVisibleLimit);
    const stopGridEvent = (event: SyntheticEvent) => event.stopPropagation();
    const resourceLink = (
      entityType: DatabaseEntityType,
      record: DomiProject | DomiPerson | DomiNewsItem
    ) => {
      const resource = entityType === "news" ? (record as DomiNewsItem).url : "internal-preview";
      if (!resource) return <span className="database-grid-empty-value">—</span>;
      return (
        <button
          type="button"
          className="database-grid-link"
          title={entityType === "news"
            ? "打开原文"
            : "在右侧预览项目中最有信息量的文档"}
          onClick={(event) => {
            event.stopPropagation();
            void previewDatabaseRecord(entityType, record);
          }}
        >
          <FileText size={14} />
          <span>{entityType === "news" ? "原文" : "预览"}</span>
        </button>
      );
    };

    return (
      <div className="database-stage">
        <div className="database-toolbar">
          <div className="database-tabs" role="tablist" aria-label="资料库类型">
            {([
              ["project", "项目库", databaseSnapshot?.projects?.length || 0],
              ["person", "人脉库", databaseSnapshot?.people?.length || 0],
              ["news", "行业信息库", databaseSnapshot?.news?.length || 0]
            ] as Array<[DatabaseEntityType, string, number]>).map(([type, label, count]) => (
              <button
                key={type}
                type="button"
                className={databaseEntityType === type ? "active" : ""}
                onClick={() => switchDatabaseEntity(type)}
                role="tab"
                aria-selected={databaseEntityType === type}
              >
                {label}<span>{count}</span>
              </button>
            ))}
          </div>
          <div className="database-backend-badge">
            <Database size={15} />
            {databaseSnapshot?.backend === "local" ? "本地 SQLite · 自动保存到 Markdown" : "资料库"}
          </div>
        </div>

        {databaseError && (
          <div className="database-message error"><AlertCircle size={15} />{databaseError}</div>
        )}
        {databaseNotice && (
          <div className="database-message success"><CheckCircle2 size={15} />{databaseNotice}</div>
        )}
        {databaseLoading && !databaseSnapshot && (
          <div className="database-empty"><RefreshCw className="spinning" size={18} />正在读取资料库</div>
        )}
        {databaseSnapshot && !databaseSnapshot.editable && (
          <div className="database-empty">
            <AlertCircle size={18} />
            {databaseSnapshot.error || "当前资料库暂不支持在客户端内直接编辑。"}
          </div>
        )}

        {databaseSnapshot?.editable && (
          <div className="database-grid-layout">
            <div className="database-grid-controls">
              <label className="database-search database-grid-search">
                <Search size={16} />
                <input
                  value={databaseQuery}
                  onChange={(event) => {
                    setDatabaseQuery(event.target.value);
                    setDatabaseVisibleLimit(100);
                  }}
                  placeholder={databaseEntityType === "project"
                    ? "搜索项目"
                    : databaseEntityType === "person"
                      ? "搜索人脉"
                      : "搜索行业信息"}
                />
                {databaseQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setDatabaseQuery("");
                      setDatabaseVisibleLimit(100);
                    }}
                    aria-label="清空搜索"
                  >
                    <X size={14} />
                  </button>
                )}
              </label>
              <label className="database-grid-filter">
                <span>筛选</span>
                <select
                  value={databaseStatusFilter}
                  onChange={(event) => {
                    setDatabaseStatusFilter(event.target.value);
                    setDatabaseVisibleLimit(100);
                  }}
                >
                  {statusOptions.map((item) => <option key={item}>{item}</option>)}
                </select>
              </label>
              <label className="database-grid-filter">
                <span>排序</span>
                <select
                  value={databaseSortKey}
                  onChange={(event) => {
                    setDatabaseSortKey(event.target.value as DatabaseSortKey);
                    setDatabaseVisibleLimit(100);
                  }}
                >
                  <option value="updated">最后更新</option>
                  <option value="created">{databaseEntityType === "news" ? "发布时间" : "入库时间"}</option>
                  <option value="name">{databaseEntityType === "news" ? "标题" : "名称"}</option>
                </select>
              </label>
              <button
                type="button"
                className="database-sort-direction"
                onClick={() => {
                  setDatabaseSortDirection((current) => current === "asc" ? "desc" : "asc");
                  setDatabaseVisibleLimit(100);
                }}
              >
                {databaseSortDirection === "asc" ? "升序" : "降序"}
                <ChevronDown size={14} className={databaseSortDirection === "asc" ? "ascending" : ""} />
              </button>
              <span className="database-grid-count">
                {filtered.length}{filtered.length !== records.length ? ` / ${records.length}` : ""} 条记录
              </span>
            </div>

            <div
              className="database-grid-shell"
              onScroll={() => {
                if (databaseExpandedCell) setDatabaseExpandedCell(null);
              }}
            >
              {filtered.length === 0 ? (
                <div className="database-list-empty">没有匹配的记录</div>
              ) : databaseEntityType === "project" ? (
                <table className="database-grid-table project">
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
                      <th className="primary-column">公司名称</th>
                      <th className="notes-column">Notes</th>
                      <th>链接</th>
                      <th>最后更新</th>
                      <th>领域</th>
                      <th className="tags-column">子领域</th>
                      <th>进展状态</th>
                      <th>项目评级</th>
                      <th>最新估值</th>
                      <th className="tags-column">投资机构</th>
                      <th>城市</th>
                      <th>入库时间</th>
                      <th className="notes-column">历史融资</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(visibleRecords as DomiProject[]).map((project, index) => {
                      const isEditing = databaseEditingId === project.recordId
                        && databaseDraft?.entityType === "project";
                      return (
                        <tr
                          key={project.recordId}
                          className={[
                            databaseSelectedId === project.recordId ? "selected" : "",
                            isEditing ? "editing" : ""
                          ].filter(Boolean).join(" ")}
                          onClick={(event) => handleDatabaseRowClick(event, "project", project.recordId)}
                          onKeyDown={(event) => handleDatabaseRowKeyDown(event, "project", project.recordId)}
                          onContextMenu={(event) => openDatabaseRowContextMenu(event, "project", project)}
                        >
                          <td className="row-number">{index + 1}</td>
                          <td className="primary-column" data-database-editable data-database-field="name">
                            {isEditing
                              ? <input value={databaseDraft.name} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("name", event.target.value)} />
                              : <strong title={project.name}>{project.name}</strong>}
                          </td>
                          <td className="notes-column" data-database-editable data-database-field="notes">
                            {isEditing
                              ? <textarea value={databaseDraft.notes} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("notes", event.target.value)} rows={2} />
                              : <span className="database-grid-clamp" title={project.notes}>{project.notes || "—"}</span>}
                          </td>
                          <td>{resourceLink("project", project)}</td>
                          <td>{databaseDate(project.lastFollowup || project.updatedAt)}</td>
                          <td data-database-editable data-database-field="domain">
                            {isEditing
                              ? <input value={databaseDraft.domain} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("domain", event.target.value)} />
                              : databasePills([project.domain])}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="subdomains">
                            {isEditing
                              ? <input value={databaseDraft.subdomains} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("subdomains", event.target.value)} />
                              : databasePills(project.subdomains)}
                          </td>
                          <td data-database-editable data-database-field="status">
                            {isEditing ? (
                              <select value={databaseDraft.status} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("status", event.target.value)}>
                                {["待交流", "已交流", "深度跟踪", "已投", "Miss", "放弃"].map((item) => <option key={item}>{item}</option>)}
                              </select>
                            ) : databasePills([project.status])}
                          </td>
                          <td data-database-editable data-database-field="rating">
                            {isEditing ? (
                              <select value={databaseDraft.rating} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("rating", event.target.value)}>
                                <option value="">未评级</option>
                                {["S", "A", "B", "C"].map((item) => <option key={item}>{item}</option>)}
                              </select>
                            ) : databasePills(project.rating ? [project.rating] : [], "未评级")}
                          </td>
                          <td data-database-editable data-database-field="latestValuationUsd100m">
                            {isEditing
                              ? <input type="number" min="0" step="0.001" value={databaseDraft.latestValuationUsd100m} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("latestValuationUsd100m", event.target.value)} />
                              : project.latestValuationUsd100m === null || project.latestValuationUsd100m === undefined
                                ? "—"
                                : `${project.latestValuationUsd100m} 亿美元`}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="investors">
                            {isEditing
                              ? <input value={databaseDraft.investors} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("investors", event.target.value)} />
                              : databasePills(project.investors || [])}
                          </td>
                          <td data-database-editable data-database-field="cities">
                            {isEditing
                              ? <input value={databaseDraft.cities} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("cities", event.target.value)} />
                              : databasePills(project.cities || [])}
                          </td>
                          <td>{databaseDate(project.createdAt)}</td>
                          <td className="notes-column" data-database-editable data-database-field="financingHistory">
                            {isEditing
                              ? <textarea value={databaseDraft.financingHistory} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("financingHistory", event.target.value)} rows={2} />
                              : <span className="database-grid-clamp" title={project.financingHistory}>{project.financingHistory || "—"}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : databaseEntityType === "person" ? (
                <table className="database-grid-table person">
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
                      <th className="primary-column">姓名</th>
                      <th className="notes-column">所属组织与身份</th>
                      <th className="tags-column">类型</th>
                      <th>进展状态</th>
                      <th>评级</th>
                      <th>最后联系</th>
                      <th className="tags-column">城市</th>
                      <th>入库时间</th>
                      <th>人物主页</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(visibleRecords as DomiPerson[]).map((person, index) => {
                      const isEditing = databaseEditingId === person.recordId
                        && databaseDraft?.entityType === "person";
                      return (
                        <tr
                          key={person.recordId}
                          className={[
                            databaseSelectedId === person.recordId ? "selected" : "",
                            isEditing ? "editing" : ""
                          ].filter(Boolean).join(" ")}
                          onClick={(event) => handleDatabaseRowClick(event, "person", person.recordId)}
                          onKeyDown={(event) => handleDatabaseRowKeyDown(event, "person", person.recordId)}
                          onContextMenu={(event) => openDatabaseRowContextMenu(event, "person", person)}
                        >
                          <td className="row-number">{index + 1}</td>
                          <td className="primary-column" data-database-editable data-database-field="name">
                            {isEditing
                              ? <input value={databaseDraft.name} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("name", event.target.value)} />
                              : <strong>{person.name}</strong>}
                          </td>
                          <td className="notes-column" data-database-editable data-database-field="organization">
                            {isEditing
                              ? <input value={databaseDraft.organization} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("organization", event.target.value)} />
                              : <span className="database-grid-clamp" title={person.organization}>{person.organization || "—"}</span>}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="types">
                            {isEditing
                              ? <input value={databaseDraft.types} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("types", event.target.value)} />
                              : databasePills(person.types)}
                          </td>
                          <td data-database-editable data-database-field="status">
                            {isEditing
                              ? <input value={databaseDraft.status} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("status", event.target.value)} />
                              : databasePills(person.status ? [person.status] : [])}
                          </td>
                          <td data-database-editable data-database-field="rating">
                            {isEditing ? (
                              <select value={databaseDraft.rating} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("rating", event.target.value)}>
                                <option value="">未评级</option>
                                {["S", "A", "B", "C"].map((item) => <option key={item}>{item}</option>)}
                              </select>
                            ) : databasePills(person.rating ? [person.rating] : [], "未评级")}
                          </td>
                          <td data-database-editable data-database-field="lastContact">
                            {isEditing
                              ? <input type="date" value={databaseDraft.lastContact} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("lastContact", event.target.value)} />
                              : databaseDate(person.lastContact)}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="cities">
                            {isEditing
                              ? <input value={databaseDraft.cities} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("cities", event.target.value)} />
                              : databasePills(person.cities)}
                          </td>
                          <td>{databaseDate(person.createdAt)}</td>
                          <td>{resourceLink("person", person)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              ) : (
                <table className="database-grid-table news">
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
                      <th className="primary-column">新闻标题</th>
                      <th className="notes-column">核心事实</th>
                      <th>发布时间</th>
                      <th className="tags-column">领域</th>
                      <th className="tags-column">子领域</th>
                      <th className="tags-column">信息类型</th>
                      <th>来源</th>
                      <th>重要性</th>
                      <th>置信度</th>
                      <th>证据状态</th>
                      <th className="notes-column">建议动作</th>
                      <th>继续展示</th>
                      <th>原文</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(visibleRecords as DomiNewsItem[]).map((item, index) => {
                      const isEditing = databaseEditingId === item.recordId
                        && databaseDraft?.entityType === "news";
                      return (
                        <tr
                          key={item.recordId}
                          className={[
                            databaseSelectedId === item.recordId ? "selected" : "",
                            isEditing ? "editing" : ""
                          ].filter(Boolean).join(" ")}
                          onClick={(event) => handleDatabaseRowClick(event, "news", item.recordId)}
                          onKeyDown={(event) => handleDatabaseRowKeyDown(event, "news", item.recordId)}
                          onContextMenu={(event) => openDatabaseRowContextMenu(event, "news", item)}
                        >
                          <td className="row-number">{index + 1}</td>
                          <td className="primary-column" data-database-editable data-database-field="title">
                            {isEditing
                              ? <input value={databaseDraft.title} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("title", event.target.value)} />
                              : <strong title={item.title}>{item.title}</strong>}
                          </td>
                          <td className="notes-column" data-database-editable data-database-field="summary">
                            {isEditing
                              ? <textarea value={databaseDraft.summary} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("summary", event.target.value)} rows={2} />
                              : <span className="database-grid-clamp" title={item.summary}>{item.summary || "—"}</span>}
                          </td>
                          <td data-database-editable data-database-field="publishedAt">
                            {isEditing
                              ? <input type="datetime-local" value={databaseDraft.publishedAt} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("publishedAt", event.target.value)} />
                              : databaseDate(item.publishedAt)}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="domains">
                            {isEditing
                              ? <input value={databaseDraft.domains} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("domains", event.target.value)} />
                              : databasePills(item.domains)}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="subdomains">
                            {isEditing
                              ? <input value={databaseDraft.subdomains} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("subdomains", event.target.value)} />
                              : databasePills(item.subdomains)}
                          </td>
                          <td className="tags-column" data-database-editable data-database-field="newsTypes">
                            {isEditing
                              ? <input value={databaseDraft.newsTypes} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("newsTypes", event.target.value)} />
                              : databasePills(item.types)}
                          </td>
                          <td data-database-editable data-database-field="source">
                            {isEditing
                              ? <input value={databaseDraft.source} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("source", event.target.value)} />
                              : item.source || "—"}
                          </td>
                          <td data-database-editable data-database-field="importance">
                            {isEditing
                              ? <input type="number" min="0" max="10" value={databaseDraft.importance} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("importance", event.target.value)} />
                              : item.importance}
                          </td>
                          <td data-database-editable data-database-field="confidence">
                            {isEditing
                              ? <input type="number" min="0" max="10" value={databaseDraft.confidence} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("confidence", event.target.value)} />
                              : item.confidence}
                          </td>
                          <td data-database-editable data-database-field="evidenceStatus">
                            {isEditing
                              ? <input value={databaseDraft.evidenceStatus} onClick={stopGridEvent} onChange={(event) => updateDatabaseDraft("evidenceStatus", event.target.value)} />
                              : databasePills(item.evidenceStatus ? [item.evidenceStatus] : [])}
                          </td>
                          <td className="notes-column" data-database-editable data-database-field="action">
                            {isEditing
                              ? <textarea value={databaseDraft.action} onClick={reopenExpandedDatabaseCell} onChange={(event) => updateDatabaseDraft("action", event.target.value)} rows={2} />
                              : <span className="database-grid-clamp" title={item.action}>{item.action || "—"}</span>}
                          </td>
                          <td data-database-editable data-database-field="worthFollowing">
                            {isEditing ? (
                              <input
                                className="database-grid-checkbox"
                                type="checkbox"
                                checked={databaseDraft.worthFollowing}
                                onClick={stopGridEvent}
                                onChange={(event) => updateDatabaseDraft("worthFollowing", event.target.checked)}
                              />
                            ) : databasePills([item.worthFollowing === false ? "否" : "是"])}
                          </td>
                          <td>{resourceLink("news", item)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
            {visibleRecords.length < filtered.length && (
              <div className="database-grid-more">
                <button
                  type="button"
                  onClick={() => setDatabaseVisibleLimit((current) => current + 100)}
                >
                  加载更多
                  <span>已显示 {visibleRecords.length} / {filtered.length}</span>
                </button>
              </div>
            )}
            <div className="database-grid-hint">
              单击任意可编辑单元格即可修改；右键点击行可删除。长文本会自动展开，修改后自动保存并同步更新 SQLite、Markdown 与资料目录。
            </div>
          </div>
        )}
        {databaseExpandedCell
          && databaseDraft
          && databaseDraft.entityType === databaseExpandedCell.entityType
          && databaseDraft.recordId === databaseExpandedCell.recordId
          && typeof databaseDraft[databaseExpandedCell.field] !== "boolean"
          && (
            <div
              className="database-cell-expanded-editor"
              role="dialog"
              aria-label={`${databaseExpandedCell.label}完整内容`}
              style={{
                left: databaseExpandedCell.left,
                top: databaseExpandedCell.top,
                width: databaseExpandedCell.width
              }}
              onClick={stopGridEvent}
            >
              <header>
                <strong>{databaseExpandedCell.label}</strong>
                <span>完整内容</span>
                <button
                  type="button"
                  onClick={() => setDatabaseExpandedCell(null)}
                  title="收起"
                  aria-label="收起完整内容"
                >
                  <X size={13} />
                </button>
              </header>
              <textarea
                autoFocus
                value={String(databaseDraft[databaseExpandedCell.field] ?? "")}
                onChange={(event) => {
                  updateDatabaseDraft(databaseExpandedCell.field, event.target.value);
                }}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setDatabaseExpandedCell(null);
                    return;
                  }
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void flushDatabaseAutoSave();
                  }
                }}
              />
              <footer>
                <span>输入后自动保存 · Esc 收起</span>
                <span className="database-cell-autosave-status" aria-live="polite">
                  {databaseSaving
                    ? <><RefreshCw className="spinning" size={12} />自动保存中</>
                    : <><Check size={12} />修改自动保存</>}
                </span>
              </footer>
            </div>
          )}
        {databaseRowContextMenu && (
          <div
            className="database-row-context-backdrop"
            role="presentation"
            onMouseDown={() => setDatabaseRowContextMenu(null)}
            onContextMenu={(event) => {
              event.preventDefault();
              setDatabaseRowContextMenu(null);
            }}
          >
            <div
              className="database-row-context-menu"
              role="menu"
              aria-label={`${databaseRowContextMenu.title}的行操作`}
              style={{
                left: databaseRowContextMenu.left,
                top: databaseRowContextMenu.top
              }}
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={requestContextMenuDatabaseDelete}
              >
                <Trash2 size={14} />
                <span>
                  <strong>删除此行</strong>
                  <small>本地文件仍会保留</small>
                </span>
              </button>
            </div>
          </div>
        )}
        {databaseDeleteTarget && (
          <div
            className="database-delete-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !databaseDeleting) {
                setDatabaseDeleteTarget(null);
              }
            }}
          >
            <div
              className="database-delete-dialog"
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="database-delete-title"
              aria-describedby="database-delete-description"
            >
              <div className="database-delete-icon"><Trash2 size={18} /></div>
              <div>
                <h3 id="database-delete-title">从资料库移除这条记录？</h3>
                <p id="database-delete-description">
                  “{databaseDeleteTarget.title}”会从资料库列表和后续索引中移除；本地项目目录、文档和附件会完整保留。
                </p>
              </div>
              <div className="database-delete-actions">
                <button
                  type="button"
                  onClick={() => setDatabaseDeleteTarget(null)}
                  disabled={databaseDeleting}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="danger"
                  onClick={() => void confirmDatabaseDelete()}
                  disabled={databaseDeleting || databaseSaving}
                >
                  {databaseDeleting
                    ? <><RefreshCw className="spinning" size={14} />正在移除</>
                    : <><Trash2 size={14} />移出资料库</>}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  function renderComposer(variant: "home" | "dock") {
    return (
      <>
        {variant === "dock" && activeQueuedSubmissions.length > 0 && (
          <div className="queued-submissions" aria-label="待执行消息" aria-live="polite">
            {activeQueuedSubmissions.map((queued, index) => {
              const workflow = workflows.find((item) => item.id === queued.workflowId);
              return (
                <div className="queued-submission" key={queued.id}>
                  <Clock3 size={15} aria-hidden="true" />
                  <div className="queued-submission-copy">
                    <strong>{workflow ? `启动「${workflow.title}」：${queued.input}` : queued.input}</strong>
                    <span>
                      排队中 · 第 {index + 1} 项
                      {queued.attachments.length > 0 ? ` · ${queued.attachments.length} 个附件` : ""}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeQueuedSubmission(activeThread.id, queued.id)}
                    title="取消这条待执行消息"
                    aria-label="取消这条待执行消息"
                  >
                    <X size={15} />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <form
          className={`composer composer-${variant} ${composerDragActive ? "drag-active" : ""}`}
          onSubmit={handleSubmit}
          onPaste={handleComposerPaste}
          onDragEnter={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              setComposerDragActive(true);
            }
          }}
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files")) {
              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
            }
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setComposerDragActive(false);
            }
          }}
          onDrop={handleComposerDrop}
        >
          <textarea
            ref={composerRef}
            rows={variant === "home" ? 2 : 1}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={selectedWorkflow
              ? `补充材料或目标，运行「${selectedWorkflow.title}」`
              : variant === "dock"
                ? "随心输入"
                : `例如：${COMPOSER_SUGGESTIONS[composerSuggestionIndex]}`}
            aria-label="输入投资任务"
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit(event);
              }
            }}
          />

          {selectedWorkflow?.id === "schedule" && commonCalendarRecipients.length > 0 && (
            <div className="schedule-recipient-picker" aria-label="选择常用参会人">
              <span>常用参会人</span>
              <div>
                {commonCalendarRecipients.map((recipient) => {
                  const selected = input
                    .toLocaleLowerCase("en-US")
                    .includes(recipient.email.toLocaleLowerCase("en-US"));
                  return (
                    <button
                      type="button"
                      className={selected ? "selected" : ""}
                      onClick={() => addCalendarRecipient(recipient)}
                      disabled={selected}
                      title={recipient.email}
                      key={recipient.email.toLocaleLowerCase("en-US")}
                    >
                      {recipient.name || recipient.email}
                      {selected && <Check size={12} />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {attachments.length > 0 && (
            <div className="attachment-list" aria-label="已添加材料">
              {attachments.map((file) => (
                <div className="attachment-chip" key={file.path} title={file.path}>
                  <FileText size={14} />
                  <span>{file.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(file.path)}
                    aria-label={`移除 ${file.name}`}
                    title={`移除 ${file.name}`}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
          {attachmentError && <div className="attachment-error">{attachmentError}</div>}

          <div className="composer-toolbar">
            <div className="composer-tools-left">
              <button
                className="composer-icon-button"
                type="button"
                onClick={chooseAttachments}
                title="选择本地文件"
                aria-label="选择本地文件"
              >
                <Plus size={20} />
              </button>
              {selectedWorkflow ? (
                <button
                  className="selected-workflow"
                  type="button"
                  onClick={() => setSelectedWorkflowId(undefined)}
                  title="取消当前工作流"
                >
                  <Sparkles size={14} />
                  <span>{selectedWorkflow.title}</span>
                  <small>{selectedWorkflow.skill}</small>
                </button>
              ) : (
                <button
                  className={`composer-agent-button ${domiPluginEnabled ? "active" : ""}`}
                  type="button"
                  onClick={() => setDomiPluginEnabled((enabled) => !enabled)}
                  title={domiPluginEnabled
                    ? "domi 插件已启用，点击关闭"
                    : "点击启用 domi 插件"}
                  aria-label={domiPluginEnabled ? "停用 domi 插件" : "启用 domi 插件"}
                  aria-pressed={domiPluginEnabled}
                >
                  <Sparkles size={14} />
                  <span>domi-AI分析师</span>
                  {domiPluginEnabled && <Check className="composer-agent-check" size={13} />}
                </button>
              )}
            </div>

            <div className="composer-tools-right">
              <div className="model-picker">
                <button
                  className="model-picker-trigger"
                  type="button"
                  onClick={() => setModelMenuOpen((open) => !open)}
                  aria-label="选择模型、推理强度和速度"
                  aria-expanded={modelMenuOpen}
                  disabled={!codexStatus?.ok}
                >
                  <Zap className="model-picker-zap" size={14} />
                  <span>{selectedModel?.name.replace("GPT-5.6-", "") || "推荐模型"}</span>
                  <small>{reasoningLabel(effectiveReasoningEffort)} · {speedLabel(effectiveServiceTier)}</small>
                  <ChevronDown size={14} />
                </button>

                {modelMenuOpen && codexStatus?.ok && (
                  <div className="model-picker-menu">
                    <div className="model-menu-heading">
                      <strong>运行设置</strong>
                      <button
                        type="button"
                        onClick={() => {
                          setModel("default");
                          setReasoningEffort("default");
                          setServiceTier("default");
                        }}
                      >
                        跟随 Codex
                      </button>
                    </div>

                    <section className="model-menu-section">
                      <div className="model-menu-label"><Brain size={14} />模型</div>
                      <div className="model-options">
                        {codexStatus.models.map((item) => (
                          <button
                            type="button"
                            className={selectedModel?.id === item.id ? "active" : ""}
                            onClick={() => selectModel(item.id)}
                            key={item.id}
                          >
                            <span><strong>{item.name}</strong><small>{item.description}</small></span>
                            {selectedModel?.id === item.id && <Check size={15} />}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="model-menu-section">
                      <div className="model-menu-label"><Gauge size={14} />推理强度</div>
                      <div className="effort-options">
                        {selectedModel?.supportedReasoningEfforts.map((option) => (
                          <button
                            type="button"
                            className={effectiveReasoningEffort === option.id ? "active" : ""}
                            onClick={() => setReasoningEffort(option.id)}
                            title={option.description}
                            key={option.id}
                          >
                            {reasoningLabel(option.id)}
                          </button>
                        ))}
                      </div>
                    </section>

                    <section className="model-menu-section speed-section">
                      <div className="model-menu-label"><Zap size={14} />速度</div>
                      <div className="speed-options">
                        <button
                          type="button"
                          className={effectiveServiceTier === "standard" ? "active" : ""}
                          onClick={() => setServiceTier("standard")}
                        >
                          标准
                        </button>
                        {selectedModel?.serviceTiers.map((tier) => (
                          <button
                            type="button"
                            className={effectiveServiceTier === tier.id ? "active" : ""}
                            onClick={() => setServiceTier(tier.id)}
                            title={tier.description}
                            key={tier.id}
                          >
                            {tier.name}
                          </button>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </div>
              {variant === "dock" && plaudEnabled && (
                <button
                  className="composer-mic-button"
                  type="button"
                  onClick={() => {
                    const workflow = visibleQuickStartWorkflows.find((item) => item.id === "quick-discussion");
                    if (workflow) chooseWorkflow(workflow);
                  }}
                  title="快速讨论"
                  aria-label="选择快速讨论工作流"
                >
                  <Mic size={18} />
                </button>
              )}
              <button
                className="send-button"
                type="submit"
                title={isRunning ? "加入当前对话的待执行队列" : "发送给 Codex"}
                disabled={!codexStatus?.ok || (!input.trim() && attachments.length === 0)}
              >
                <ArrowUp size={20} />
              </button>
              {isRunning && (
                <button
                  aria-label="停止当前 Codex 运行"
                  className="send-button stop"
                  type="button"
                  onClick={stopRun}
                  title="停止当前 Codex 运行"
                >
                  <Square aria-hidden="true" fill="currentColor" size={11} strokeWidth={0} />
                </button>
              )}
            </div>
          </div>
        </form>

      </>
    );
  }

  return (
    <>
    <div
      className="app-shell"
      style={{ "--left-panel-width": `${leftPanelWidth}px` } as CSSProperties}
    >
      <aside className="sidebar">
        <div className="traffic-space" />
        <div className="brand-row">
          <div className="brand-mark">
            <img src="./domi-icon.png" alt="domi" />
          </div>
          <div>
            <div className="brand-title">domi</div>
            <div className="brand-subtitle">AI 投资工作台</div>
          </div>
        </div>

        <button className="new-thread" type="button" onClick={createThread}>
          <span><Plus size={17} /></span>
          <strong>新建任务</strong>
        </button>

        <nav className="sidebar-primary-nav" aria-label="工作台导航">
          <button
            className={`sidebar-nav-item ${workspaceView === "tasks" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setWorkspaceView("tasks");
              setDocumentLibrarySidebarExpanded(false);
              setThreadMenuId(null);
            }}
          >
            <ListChecks className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
            <strong>待办事项</strong>
            <span className="sidebar-nav-meta">
              {taskNavigationCount > 0 && (
                <span className="sidebar-nav-count">{Math.min(taskNavigationCount, 99)}</span>
              )}
            </span>
          </button>
          <button
            className={`sidebar-nav-item ${workspaceView === "news" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setWorkspaceView("news");
              setDocumentLibrarySidebarExpanded(false);
              setThreadMenuId(null);
            }}
          >
            <Newspaper className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
            <strong>行业动态</strong>
            <span className="sidebar-nav-meta" />
          </button>
          <button
            className={`sidebar-nav-item ${workspaceView === "data" ? "active" : ""}`}
            type="button"
            onClick={() => {
              setWorkspaceView("data");
              setDocumentLibrarySidebarExpanded(false);
              setRightPanelOpen(false);
              setThreadMenuId(null);
              if (!databaseSnapshot && !databaseLoading) void refreshDatabase();
            }}
          >
            <Database className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
            <strong>资料库</strong>
            <span className="sidebar-nav-meta" />
          </button>
          <div className={`sidebar-document-section ${documentLibrarySidebarExpanded ? "open" : ""}`}>
            <button
              className={`sidebar-nav-item ${workspaceView === "documents" ? "active" : ""}`}
              type="button"
              onClick={openDocumentLibrary}
              aria-expanded={documentLibrarySidebarExpanded}
            >
              <LibraryBig className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
              <strong>文档库</strong>
              <span className="sidebar-nav-meta">
                <span className="sidebar-nav-disclosure" aria-hidden="true">
                  <ChevronRight size={14} strokeWidth={2} />
                </span>
              </span>
            </button>
            {documentLibrarySidebarExpanded && renderDocumentLibrarySidebar()}
          </div>
        </nav>

        <div className={`sidebar-workflow-section ${skillsExpanded ? "open" : ""}`}>
          <button
            className="sidebar-section-toggle"
            type="button"
            onClick={() => setSkillsExpanded((current) => !current)}
            aria-expanded={skillsExpanded}
          >
            <Atom className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
            <strong>技能</strong>
            <span className="sidebar-nav-meta">
              <span className="sidebar-nav-disclosure" aria-hidden="true">
                <ChevronRight size={14} strokeWidth={2} />
              </span>
            </span>
          </button>
          {skillsExpanded && (
            <div className="sidebar-workflows">
              {workflows.filter((workflow) => !workflow.hidden).map((workflow) => {
                const Icon = workflowIconMap[workflow.id] || FileText;
                return (
                  <button
                    key={workflow.id}
                    type="button"
                    className="workflow-mini"
                    onClick={() => chooseWorkflow(workflow)}
                    title={workflow.description}
                  >
                    <Icon size={15} />
                    {workflow.title}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="sidebar-thread-section">
          <div className="section-label thread-section-heading">
            <span>最近对话</span>
            <button
              type="button"
              onClick={() => {
                setThreadSearchOpen((current) => !current);
                setThreadMenuId(null);
                if (threadSearchOpen) {
                  setThreadQuery("");
                }
              }}
              title={threadSearchOpen ? "关闭搜索" : "搜索对话"}
              aria-label={threadSearchOpen ? "关闭搜索" : "搜索对话"}
            >
              {threadSearchOpen ? <X size={13} /> : <Search size={13} />}
            </button>
          </div>
          {threadSearchOpen && (
            <div className="thread-search">
              <Search size={13} />
              <input
                autoFocus
                value={threadQuery}
                onChange={(event) => setThreadQuery(event.target.value)}
                placeholder="搜索对话或项目"
                aria-label="搜索对话或项目"
              />
            </div>
          )}
          <div
            className="thread-list"
            ref={threadListRef}
            onScroll={(event) => {
              const element = event.currentTarget;
              if (
                displayedThreads.length > threadRenderLimit
                && element.scrollHeight - element.scrollTop - element.clientHeight < 240
              ) {
                setThreadRenderLimit((current) => Math.min(current + 60, displayedThreads.length));
              }
            }}
          >
            {displayedThreads.length === 0 && (
              <div className="thread-search-empty">
                {deferredThreadQuery.trim() ? "没有匹配的对话" : "暂无最近对话"}
              </div>
            )}
            {renderedThreads.map((thread) => (
              <div className="thread-row" key={thread.id}>
                {renamingThreadId === thread.id ? (
                  <form
                    className="thread-rename-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      commitThreadRename(thread.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(event) => setRenameValue(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          setRenamingThreadId(null);
                          setRenameValue("");
                        }
                      }}
                      aria-label="修改对话名称"
                    />
                    <button type="submit" title="保存名称" aria-label="保存名称">
                      <Check size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingThreadId(null);
                        setRenameValue("");
                      }}
                      title="取消重命名"
                      aria-label="取消重命名"
                    >
                      <X size={13} />
                    </button>
                  </form>
                ) : (
                  <>
                    <button
                      className={`thread-item ${thread.id === activeThreadId ? "active" : ""}`}
                      type="button"
                      onClick={() => selectThread(thread.id)}
                    >
                      <span>
                        <strong>{thread.title}</strong>
                        <small>{thread.project}</small>
                      </span>
                      <span className="thread-item-meta">
                        {activeRunsByThread[thread.id] && (
                          <i
                            className="thread-state-indicator running"
                            role="status"
                            aria-label="任务正在进行"
                            title="任务正在进行"
                          />
                        )}
                        {!activeRunsByThread[thread.id] && thread.hasUnreadCompletion && (
                          <i
                            className="thread-state-indicator unread"
                            role="status"
                            aria-label="任务已完成，结果未读"
                            title="任务已完成，结果未读"
                          />
                        )}
                        {thread.pinned && <Pin size={9} aria-hidden="true" />}
                        <em>{thread.updatedAt}</em>
                      </span>
                    </button>
                    <button
                      className="thread-more"
                      type="button"
                      onClick={() => setThreadMenuId((current) => current === thread.id ? null : thread.id)}
                      title="对话操作"
                      aria-label={`${thread.title} 的操作`}
                    >
                      <MoreHorizontal size={15} />
                    </button>
                  </>
                )}

                {threadMenuId === thread.id && (
                  <div className="thread-menu">
                    <button type="button" onClick={() => startThreadRename(thread)}>
                      <Pencil size={13} />
                      重命名
                    </button>
                    <button type="button" onClick={() => toggleThreadPinned(thread)}>
                      {thread.pinned ? <PinOff size={13} /> : <Pin size={13} />}
                      {thread.pinned ? "取消置顶" : "置顶"}
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => deleteThread(thread)}
                      disabled={threads.length <= 1 || Boolean(activeRunsByThread[thread.id])}
                    >
                      <Trash2 size={13} />
                      删除对话
                    </button>
                  </div>
                )}
              </div>
            ))}
            {renderedThreads.length < displayedThreads.length && (
              <div className="thread-list-more" aria-hidden="true">
                继续下滑加载 {displayedThreads.length - renderedThreads.length} 个对话
              </div>
            )}
          </div>
        </div>

        <button className="codex-card" type="button" onClick={() => {
          setSettingsInitialTab("connection");
          setSettingsOpen(true);
        }} title="打开 Codex 设置">
          <div className={`status-dot ${codexStatus?.ok ? "ok" : "bad"}`} />
          <div>
            <strong>{codexStatus?.ok ? "Codex 已就绪" : hasNativeWorkbench ? "Codex 未就绪" : "浏览器预览"}</strong>
            {!codexStatus?.ok && <span>{codexStatus?.error || "检测中"}</span>}
          </div>
          <Settings size={14} />
        </button>
      </aside>

      <div
        className="panel-resizer left-panel-resizer"
        role="separator"
        aria-label="调整左栏宽度"
        aria-orientation="vertical"
        aria-valuemin={210}
        aria-valuemax={420}
        aria-valuenow={Math.round(leftPanelWidth)}
        tabIndex={0}
        title="拖动调整左栏宽度，双击恢复默认"
        onPointerDown={(event) => beginPanelResize("left", event)}
        onKeyDown={(event) => resizePanelWithKeyboard("left", event)}
        onDoubleClick={() => setLeftPanelWidth(DEFAULT_LEFT_PANEL_WIDTH)}
      />

      <main className="workspace">
        <header className={`topbar ${workspaceView === "conversation" && !hasConversation ? "new-task-topbar" : ""}`}>
          <div className="project-title">
            <strong>{workspaceView === "tasks"
              ? "待办事项"
              : workspaceView === "news"
                ? "行业动态"
                : workspaceView === "data"
                  ? "资料库"
                : workspaceView === "documents"
                  ? "文档库"
                : activeThread.title}</strong>
            <span>{workspaceView === "tasks"
              ? `${taskNavigationCount} 个待办事项`
              : workspaceView === "news"
                ? "domi 行业雷达"
                : workspaceView === "data"
                  ? `${databaseSnapshot?.projects?.length || 0} 项目 / ${databaseSnapshot?.people?.length || 0} 人脉 / ${databaseSnapshot?.news?.length || 0} 行业信息`
                : workspaceView === "documents"
                  ? documentLibrary?.rootName
                    ? `本地资料库 · ${documentLibrary.rootName}`
                    : "本地 Markdown 与资料目录"
                : activeThread.project}</span>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="icon-button"
              onClick={() => void (workspaceView === "tasks"
                ? Promise.all([
                    refreshDomi(),
                    ...(plaudEnabled ? [refreshPlaudQueue({ fresh: true })] : [])
                  ])
                : workspaceView === "news"
                  ? scanWeeklyNews()
                  : workspaceView === "data"
                    ? refreshDatabase({ preserveSelection: true })
                  : workspaceView === "documents"
                    ? refreshDocumentLibrary({ force: true })
                  : refreshDomi())}
              disabled={workspaceView === "news"
                ? weeklyNewsLoading || weeklyNewsScanning
                : workspaceView === "data"
                  ? databaseLoading || databaseSaving
                : workspaceView === "documents"
                  ? documentLibraryLoading
                : domiSyncing || (workspaceView === "tasks" && plaudEnabled && (plaudLoading || plaudSyncing))}
              title={workspaceView === "tasks"
                ? "刷新待办事项来源"
                : workspaceView === "news"
                  ? "运行 domi 行业雷达"
                  : workspaceView === "data"
                    ? "刷新资料库"
                  : workspaceView === "documents"
                    ? "刷新本地文档库"
                  : domiError ? `重新同步 domi：${domiError}` : "同步 domi 项目与人脉"}
              aria-label={workspaceView === "tasks"
                ? "刷新任务来源"
                : workspaceView === "news"
                  ? "运行 domi 行业雷达"
                  : workspaceView === "data"
                    ? "刷新资料库"
                  : workspaceView === "documents"
                    ? "刷新本地文档库"
                  : "同步 domi 项目与人脉"}
            >
              <RefreshCw
                className={workspaceView === "news"
                  ? weeklyNewsLoading || weeklyNewsScanning ? "spinning" : ""
                  : workspaceView === "data"
                    ? databaseLoading || databaseSaving ? "spinning" : ""
                  : workspaceView === "documents"
                    ? documentLibraryLoading ? "spinning" : ""
                  : domiSyncing || (workspaceView === "tasks" && plaudEnabled && (plaudLoading || plaudSyncing)) ? "spinning" : ""}
                size={18}
              />
            </button>
            <button
              type="button"
              className={`icon-button ${rightPanelOpen ? "active" : ""}`}
              onClick={() => setRightPanelOpen((current) => !current)}
              title={rightPanelOpen
                ? documentPanelActive ? "收起文档" : "收起今日工作"
                : documentPanelActive ? "展开文档" : "展开今日工作"}
              aria-label={rightPanelOpen ? "收起侧边栏" : "展开侧边栏"}
            >
              {rightPanelOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
            </button>
          </div>
        </header>

        <div
          className={`main-grid ${rightPanelOpen ? "right-open" : "right-closed"} ${documentPanelActive ? "document-open" : ""} ${workspaceView === "tasks" ? "task-view" : workspaceView === "news" ? "news-view" : workspaceView === "data" ? "data-view" : workspaceView === "documents" ? "document-library-view" : ""}`}
          style={{ "--right-panel-width": `${activeRightPanelWidth}px` } as CSSProperties}
        >
          <section className={`chat-pane ${workspaceView === "tasks" ? "task-mode" : workspaceView === "news" ? "news-mode" : workspaceView === "data" ? "data-mode" : workspaceView === "documents" ? "document-library-mode" : hasConversation ? "has-conversation" : "is-home"}`}>
            <SectionErrorBoundary
              resetKey={`${workspaceView}:${activeThread.id}:${visibleMessages.length}:${visibleMessages[visibleMessages.length - 1]?.content.length || 0}:${weeklyNews?.syncedAt || 0}`}
              title="工作区暂时无法显示"
              description="当前任务和本地数据仍然保留，可以重试加载这部分界面。"
            >
              <RenderRegion render={() => (
              workspaceView === "tasks"
                ? renderTaskBoard()
                : workspaceView === "news"
                  ? renderNewsWorkspace()
                  : workspaceView === "data"
                    ? renderDatabaseWorkspace()
                  : workspaceView === "documents"
                    ? renderDocumentLibrary()
                    : hasConversation ? (
              <>
                <div
                  className="chat-scroll"
                  ref={scrollRef}
                  onScroll={rememberActiveChatScrollPosition}
                >
                  <div className="transcript">
                    {visibleMessages.map((message) => {
                      const workflow = workflows.find((item) => item.id === message.workflowId);
                      const isLatestAssistant = message.role === "assistant"
                        && message.id === [...visibleMessages]
                          .reverse()
                          .find((item) => item.role === "assistant")?.id;
                      const fullRunTimeline = message.runId
                        ? timeline.filter((item) => item.runId === message.runId).reverse()
                        : isLatestAssistant
                          ? [...timeline].reverse()
                          : [];
                      const runTimeline = fullRunTimeline.slice(-5);
                      const runDuration = formatMessageRunDuration(
                        message.runStartedAt,
                        message.runCompletedAt
                      );
                      const showRunSummary = message.role === "assistant"
                        && message.status !== "running"
                        && Boolean(message.content);
                      return (
                        <article key={message.id} className={`message ${message.role} ${message.status || ""}`}>
                          {message.role === "assistant" && (message.status === "running" || message.status === "error") && (
                            <div className="assistant-mark" aria-hidden="true">
                              <Sparkles size={18} />
                            </div>
                          )}
                          <div className="message-body">
                            {message.role === "user" && message.attachments && message.attachments.length > 0 && (
                              <div className="message-attachments" aria-label="消息附件">
                                {message.attachments.map((file) => (
                                  <button
                                    className="message-attachment"
                                    type="button"
                                    key={file.path}
                                    onClick={() => void workbench.openResource(file.path)}
                                    title={`打开 ${file.name}`}
                                  >
                                    <span className="message-attachment-icon"><FileText size={17} /></span>
                                    <span className="message-attachment-copy">
                                      <strong>{file.name}</strong>
                                      <small>{formatFileSize(file.size)}</small>
                                    </span>
                                  </button>
                                ))}
                              </div>
                            )}
                            {message.role === "assistant" && (message.status === "running" || message.status === "error") && (
                              <div className="message-meta">
                                {workflow && <span>{workflow.title}</span>}
                                {message.status === "running" && (
                                  <i className="running-label">
                                    <b />
                                    正在执行
                                  </i>
                                )}
                                {message.status === "error" && <i className="error">执行失败</i>}
                              </div>
                            )}
                            {showRunSummary && (
                              runTimeline.length > 0 ? (
                                <details className={`message-run-summary ${message.status === "error" ? "error" : ""}`}>
                                  <summary>
                                    <span>{message.status === "error" ? "处理失败" : "已处理"}{runDuration ? ` ${runDuration}` : ""}</span>
                                    <ChevronRight size={15} />
                                  </summary>
                                  <div className="message-run-detail">
                                    {runTimeline.map((item) => (
                                      <div key={item.id}>
                                        <strong>{item.title}</strong>
                                        {item.detail && <span>{item.detail}</span>}
                                      </div>
                                    ))}
                                  </div>
                                </details>
                              ) : (
                                <div className={`message-run-summary static ${message.status === "error" ? "error" : ""}`}>
                                  <span>{message.status === "error" ? "处理失败" : "已处理"}{runDuration ? ` ${runDuration}` : ""}</span>
                                </div>
                              )
                            )}
                            {message.status === "running" ? (
                              <>
                                {message.content && (
                                  <SectionErrorBoundary
                                    resetKey={`${message.id}:${message.status}:${message.content.length}`}
                                    title="这条消息暂时无法显示"
                                    description="任务仍在执行，后续内容到达后会自动恢复。"
                                  >
                                    <Suspense fallback={<div className="message-text">{message.content}</div>}>
                                      <MessageContent message={message} onOpenDocument={openDocument} />
                                    </Suspense>
                                  </SectionErrorBoundary>
                                )}
                                <div className="agent-working">
                                  <span>{message.content ? "Codex 仍在执行" : workflow ? `正在运行 ${workflow.title}` : "正在处理任务"}</span>
                                  <i><b /><b /><b /></i>
                                </div>
                              </>
                            ) : (
                              <SectionErrorBoundary
                                resetKey={`${message.id}:${message.status || "idle"}:${message.content.length}`}
                                title="这条消息暂时无法显示"
                                description="消息原文仍保存在本地，可以重试渲染。"
                              >
                                <Suspense fallback={<div className="message-text">{message.content}</div>}>
                                  <MessageContent message={message} onOpenDocument={openDocument} />
                                </Suspense>
                              </SectionErrorBoundary>
                            )}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </div>
                <div className="composer-footer">{renderComposer("dock")}</div>
              </>
            ) : renderNewTaskHome())} />
            </SectionErrorBoundary>
          </section>

          <div
            className="panel-resizer right-panel-resizer"
            role="separator"
            aria-label={documentPanelActive ? "调整文档栏宽度" : "调整今日工作栏宽度"}
            aria-orientation="vertical"
            aria-valuemin={documentPanelActive ? 360 : 280}
            aria-valuemax={Math.max(documentPanelActive ? 360 : 280, window.innerWidth - leftPanelWidth - 420)}
            aria-valuenow={Math.round(activeRightPanelWidth)}
            tabIndex={rightPanelOpen ? 0 : -1}
            title="拖动调整右栏宽度，双击恢复默认"
            onPointerDown={(event) => beginPanelResize(documentPanelActive ? "document" : "context", event)}
            onKeyDown={(event) => resizePanelWithKeyboard(documentPanelActive ? "document" : "context", event)}
            onDoubleClick={() => {
              if (documentPanelActive) setDocumentPanelWidth(defaultDocumentPanelWidth());
              else setContextPanelWidth(DEFAULT_CONTEXT_PANEL_WIDTH);
            }}
          />

          <aside className={`right-panel ${documentPanelActive ? "document-panel" : ""}`}>
            <SectionErrorBoundary
              resetKey={`${documentPanelActive ? "document" : "context"}:${markdownDocument?.path || pdfDocument?.path || "none"}:${markdownDocument?.mtimeMs || pdfDocument?.mtimeMs || plaudSnapshot?.syncedAt || 0}`}
              title={documentPanelActive ? "文档栏暂时无法显示" : "今日工作暂时无法显示"}
              description="主任务没有受到影响，可以重试加载右侧内容。"
            >
              <RenderRegion render={() => (
              documentPanelActive ? renderDocumentPanel() : (
            <>
            <div className="right-panel-header">
              <div>
                <strong>今日工作</strong>
                <span>
                  {todayLabel()} · {domiSnapshot
                    ? `${domiSnapshot.sources.projects.total} 项目 / ${domiSnapshot.sources.people.total} 人脉`
                    : domiSyncing ? "正在连接 domi" : "等待 domi 数据"}
                </span>
              </div>
              <button type="button" onClick={() => setRightPanelOpen(false)} title="收起今日工作">
                <PanelRightClose size={18} />
              </button>
            </div>

            <div className="domi-entity-search">
              <Search size={14} />
              <input
                value={domiQuery}
                onChange={(event) => setDomiQuery(event.target.value)}
                onFocus={refreshLocalIndexForSearch}
                placeholder="搜索项目或人脉"
                aria-label="搜索 domi 项目或人脉"
              />
              {domiQuery && (
                <button type="button" onClick={() => setDomiQuery("")} title="清除搜索">
                  <X size={13} />
                </button>
              )}
            </div>

            {domiQuery.trim() && (
              <div className="domi-search-results">
                {domiSearchResults.projects.length > 0 && (
                  <div className="domi-result-group">
                    <span>项目</span>
                    {domiSearchResults.projects.map((project) => (
                      <button type="button" key={project.recordId} onClick={() => openDomiProject(project)}>
                        <strong>{project.name}</strong>
                        <small>{[project.domain, project.status, project.rating].filter(Boolean).join(" · ")}</small>
                      </button>
                    ))}
                  </div>
                )}
                {domiSearchResults.people.length > 0 && (
                  <div className="domi-result-group">
                    <span>人脉</span>
                    {domiSearchResults.people.map((person) => (
                      <button type="button" key={person.recordId} onClick={() => openDomiPerson(person)}>
                        <strong>{person.name}</strong>
                        <small>{[person.organization, person.rating].filter(Boolean).join(" · ")}</small>
                      </button>
                    ))}
                  </div>
                )}
                {domiSearchResults.projects.length === 0 && domiSearchResults.people.length === 0 && (
                  <div className="empty-state">没有匹配的项目或人脉</div>
                )}
              </div>
            )}

            <section className={`panel-section ${openSections.domi ? "open" : ""}`}>
              <button className="panel-title" type="button" onClick={() => toggleSection("domi")}>
                <span><Database size={17} />{domiSnapshot?.backend === "local" ? "本地资料库" : "外部连接"}</span>
                {openSections.domi ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
              </button>
              <div className="panel-content">
                {domiError && (
                  <div className="domi-inline-error actionable" role="status">
                    <AlertCircle size={14} />
                    <span>{domiError}</span>
                    <button
                      type="button"
                      onClick={() => void refreshDomi()}
                      disabled={domiSyncing}
                    >
                      {domiSyncing ? "重试中" : "重试"}
                    </button>
                  </div>
                )}
                {plaudEnabled ? (
                  <>
                    {plaudError && <div className="domi-inline-error">{plaudError}</div>}
                    {plaudNotice && <div className="plaud-inline-notice">{plaudNotice}</div>}
                    <div className="plaud-queue-header">
                      <strong>最近录音</strong>
                      <small>
                        {plaudLoading
                          ? "正在读取"
                          : plaudSnapshot?.syncedAt
                            ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(plaudSnapshot.syncedAt)
                            : "等待同步"}
                      </small>
                    </div>
                    <div
                      className="plaud-queue-list"
                      onScroll={(event) => {
                        const list = event.currentTarget;
                        if (
                          list.scrollHeight - list.scrollTop - list.clientHeight < 72
                          && plaudSnapshot?.hasMore
                          && !plaudLoadingMore
                        ) {
                          void loadMorePlaudQueue();
                        }
                      }}
                    >
                      {plaudLoading && !plaudSnapshot && (
                        <div className="empty-state">正在读取 PLAUD 最近录音</div>
                      )}
                      {!plaudLoading && plaudSnapshot?.ok && !(plaudSnapshot.items || []).length && (
                        <div className="empty-state">PLAUD 中暂无录音</div>
                      )}
                      {(plaudSnapshot?.items || []).map((item) => {
                    const editing = editingPlaudId === item.fileId;
                    const renaming = renamingPlaudId === item.fileId;
                    const launchingNotes = launchingPlaudIds.has(item.fileId);
                    const notesThread = threads.find((thread) => thread.projectId === `plaud-${item.fileId}`);
                    const notesRunning = launchingNotes || Boolean(
                      notesThread && activeRunsByThread[notesThread.id]
                    );
                    const deleting = deletingPlaudId === item.fileId;
                    const status = plaudItemStatus(item);
                    const showNotesAction = canGeneratePlaudNotes(item);
                    const notesComplete = ["managed", "notes_non_project"].includes(item.queueStage);
                    return (
                      <div className="plaud-queue-row" key={item.fileId}>
                        <div className="plaud-title-line">
                          {editing ? (
                            <>
                              <input
                                value={plaudTitleDraft}
                                maxLength={255}
                                autoFocus
                                disabled={renaming || deleting}
                                aria-label="录音标题"
                                onChange={(event) => setPlaudTitleDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") void savePlaudTitle(item);
                                  if (event.key === "Escape") cancelPlaudRename();
                                }}
                              />
                              <button
                                className="plaud-title-action"
                                type="button"
                                title="保存标题"
                                disabled={renaming || deleting}
                                onClick={() => void savePlaudTitle(item)}
                              >
                                {renaming ? <RefreshCw className="spinning" size={13} /> : <Check size={13} />}
                              </button>
                              <button
                                className="plaud-title-action"
                                type="button"
                                title="取消修改"
                                disabled={renaming || deleting}
                                onClick={cancelPlaudRename}
                              >
                                <X size={13} />
                              </button>
                            </>
                          ) : (
                            <button
                              className="plaud-title-button"
                              type="button"
                              title="修改录音标题"
                              disabled={plaudSyncing || Boolean(renamingPlaudId) || Boolean(deletingPlaudId)}
                              onClick={() => beginPlaudRename(item)}
                            >
                              <span>{item.fileName}</span>
                              <Pencil size={12} />
                            </button>
                          )}
                        </div>
                        <div className="plaud-queue-meta">
                          <span>{formatPlaudDuration(item.duration)}</span>
                          {showNotesAction ? (
                            <button
                              className="plaud-notes-action"
                              type="button"
                              title="使用 domi 插件生成纪要并完成符合条件的项目入库"
                              disabled={notesRunning || plaudSyncing || plaudLoading || Boolean(deletingPlaudId)}
                              onClick={() => void runPlaudNotesWorkflow(item)}
                            >
                              {notesRunning
                                ? <RefreshCw className="spinning" size={12} />
                                : <Sparkles size={12} />}
                              <span>{launchingNotes ? "正在启动" : notesRunning ? "正在执行" : "生成纪要并入库"}</span>
                            </button>
                          ) : (
                            <span className={`plaud-item-status ${notesComplete ? "complete" : ""} ${status === "未生成文字稿" || status === "需要重试" ? "attention" : ""}`}>
                              {notesComplete && <CheckCircle2 size={12} />}
                              {status}
                            </span>
                          )}
                          {item.transcriptPath && (
                            <button
                              className="plaud-transcript-action"
                              type="button"
                              title="打开文字稿"
                              disabled={Boolean(deletingPlaudId)}
                              onClick={() => void openMarkdown(item.transcriptPath)}
                            >
                              <FileText size={12} />
                            </button>
                          )}
                          <button
                            className="plaud-delete-action"
                            type="button"
                            title="删除 PLAUD 录音"
                            aria-label={`删除 PLAUD 录音“${item.fileName}”`}
                            disabled={plaudSyncing || plaudLoading || Boolean(renamingPlaudId) || Boolean(deletingPlaudId) || launchingNotes}
                            onClick={() => void deletePlaudRecording(item)}
                          >
                            {deleting
                              ? <RefreshCw className="spinning" size={12} />
                              : <Trash2 size={12} />}
                          </button>
                        </div>
                      </div>
                    );
                      })}
                      {plaudSnapshot?.ok && (plaudSnapshot.items || []).length > 0 && (
                        <div className="plaud-pagination-status" role="status">
                          {plaudLoadingMore
                            ? <><RefreshCw className="spinning" size={12} />正在加载更早录音</>
                            : plaudSnapshot.hasMore
                              ? "继续下滑加载更早录音"
                              : "已加载全部录音"}
                        </div>
                      )}
                    </div>
                    <button
                      className="domi-run-button"
                      type="button"
                      onClick={() => void syncPlaudQueue()}
                      disabled={plaudSyncing || plaudLoading || plaudLoadingMore || Boolean(renamingPlaudId) || Boolean(deletingPlaudId)}
                    >
                      <RefreshCw className={plaudSyncing || plaudLoading || plaudLoadingMore ? "spinning" : ""} size={14} />
                      {plaudSyncing ? "正在同步并生成文字稿" : "同步 PLAUD 并生成文字稿"}
                    </button>
                  </>
                ) : (
                  <div className="plaud-disabled-card">
                    <Mic size={17} />
                    <span>
                      <strong>PLAUD 未启用</strong>
                      <small>domi 不会连接或读取录音，需要时可随时开启。</small>
                    </span>
                    <button type="button" onClick={() => {
                      setSettingsInitialTab("plaud");
                      setSettingsOpen(true);
                    }}>去设置</button>
                  </div>
                )}
                <div className="domi-health-list">
                  <div>
                    <span>插件</span>
                    <strong>
                      {domiSnapshot?.health.plugin.ok
                        ? `v${domiSnapshot.health.plugin.version}`
                        : "等待检测"}
                    </strong>
                  </div>
                  <div>
                    <span>项目与人脉</span>
                    <strong>{domiSnapshot?.health.lark.ok
                      ? domiSnapshot.backend === "local" ? "本地已同步" : "已同步"
                      : "未连接"}</strong>
                  </div>
                  {plaudEnabled && (
                    <div>
                      <span>PLAUD 队列</span>
                      <strong>
                        {plaudSnapshot?.ok
                          ? plaudQueueSummary(plaudSnapshot)
                          : domiSnapshot?.health.plaud.ok
                            ? `${domiSnapshot.health.plaud.queueCount} 个待恢复`
                            : "未就绪"}
                      </strong>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className={`panel-section timeline-section ${openSections.timeline ? "open" : ""}`}>
              <button className="panel-title" type="button" onClick={() => toggleSection("timeline")}>
                <span><TerminalSquare size={17} />Codex 运行</span>
                {openSections.timeline ? <ChevronDown size={17} /> : <ChevronRight size={17} />}
              </button>
              <div className="panel-content">
                {lastUsage && (
                  <div className="usage-row">
                    <span>Input {lastUsage.input_tokens}</span>
                    <span>Cached {lastUsage.cached_input_tokens}</span>
                    <span>Output {lastUsage.output_tokens}</span>
                  </div>
                )}
                <div className="timeline-list">
                  {timeline.length === 0 && <div className="empty-state">等待下一次运行</div>}
                  {timeline.map((item) => (
                    <div className="timeline-item" key={item.id}>
                      {item.kind === "error" ? <AlertCircle size={15} /> : <CheckCircle2 size={15} />}
                      <div>
                        <strong>{item.title}</strong>
                        {item.detail && <span>{item.detail}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            </>
            ))} />
            </SectionErrorBoundary>
          </aside>
        </div>
      </main>
    </div>
    {settingsOpen && appSettings && (
      <Suspense fallback={<div className="lazy-overlay"><RefreshCw className="spinning" size={20} />正在加载设置</div>}>
        <SetupCenter
          initialTab={settingsInitialTab}
          settings={appSettings}
          codexStatus={codexStatus}
          required={!appSettings.onboardingComplete}
          onClose={() => setSettingsOpen(false)}
          onSave={saveAppSettings}
          onLogin={startChatGPTLogin}
          onRefresh={refreshCodex}
        />
      </Suspense>
    )}
    </>
  );
}

function timelineTitle(item: CodexEventItem) {
  switch (item.kind) {
    case "reasoning":
      return "推理摘要";
    case "command":
      return "执行命令";
    case "file":
      return "文件变更";
    case "tool":
      return "调用工具";
    case "search":
      return "网页搜索";
    case "todo":
      return "任务清单";
    case "error":
      return "错误";
    default:
      return "Codex 事件";
  }
}

export default App;
