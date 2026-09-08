import { newsDiscoveryContext } from "./news-discovery-context";
import { podcastAutomationJob, podcastProgressRequests, podcastWorkflowContract } from "./podcast-progress";
import { canSkipTodoSync, nextTodoEvaluationAt, parseTodoReceipt, todoInputFingerprint, TODO_RULE_VERSION, verifiedTodoReceipt, type TodoSyncCheckpoint } from "./todo-sync-policy";
import { indexBy, indexConversation, latestAssistant } from "./render-indexes";
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
  Download,
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
  Settings,
  Sparkles,
  Square,
  Target,
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
import {
  clearTaskResultUnread,
  isTaskResultVisible,
  navigateTaskNotification,
  recordTaskResult,
  taskNotificationContent,
  taskNotificationId,
  unreadTaskCount,
  type TaskNotificationOutcome
} from "./task-notifications";
import { filesFromClipboardData } from "./clipboard-files";
import { isLocalPdfResource } from "./document-resources";
import {
  automaticallyRoutedProject,
  DomiEntityResult,
  entityCandidatesRequireIsolatedExecution,
  entityFinalizationModeForSourceConversation,
  entityTargetMatchesSourceConversation,
  normalizedEntityMention,
  parseDomiEntityResult,
  projectMentionMatches,
  shouldBindProjectToSourceConversation
} from "./entity-routing";
import MarkdownEditorErrorBoundary from "./MarkdownEditorErrorBoundary";
import SectionErrorBoundary, { RenderRegion } from "./SectionErrorBoundary";
import AssistantChoiceCard from "./AssistantChoiceCard";
import { useAppConfirm } from "./AppConfirmDialog";
import {
  codexThreadOwnerIds,
  isThreadSubmissionBusy,
  quarantineDuplicateCodexThreadOwnership,
  reconcileCommittedAttachmentPaths,
  recoveryCodexThreadId,
  taskConversationCodexThreadId
} from "./submission-safety";
import {
  DatabaseGrid,
  type DatabaseCellOption,
  type DatabaseGridColumn,
  type DatabasePatchContext
} from "./database";
import {
  AppSettings,
  AppSettingsSaveRequest,
  AppSettingsSaveResult,
  ChatGPTLoginResult,
  ClipboardAttachmentPayload,
  CodexCheckResult,
  CodexEventPayload,
  CodexEventItem,
  CodexUserInputRequest,
  CodexUsage,
  DomiPerson,
  DomiClassificationReview,
  DomiDatabaseDeleteRequest,
  DomiDatabasePatchRequest,
  DomiDatabaseSnapshot,
  DomiDatabaseUpdateRequest,
  DomiNewsItem,
  DomiPlaudItem,
  DomiPlaudSnapshot,
  DomiPlaudSyncResult,
  DomiProject,
  DomiSlidesDeliveryPolicy,
  DomiSnapshot,
  DomiTask,
  DomiTaskBoardSnapshot,
  DomiWeeklyNewsSnapshot,
  DocumentLibraryNode,
  DocumentLibrarySearchMatch,
  DocumentLibrarySearchResult,
  DocumentLibrarySnapshot,
  LocalAttachment,
  MarkdownDocument,
  PdfDocument,
  PodcastJob,
  PodcastProcessResult,
  RadarSourceSnapshot,
  RadarSourceSyncResult,
  SkillHubUserSkill,
  UpdateStatus
} from "./env";
import {
  type DomiModelPolicyRunKind,
  resolveDomiModelPolicy
} from "./model-policy";
import { sidebarUpdateEntry } from "./update-entry";
import { newSkillHubCandidatesForReview } from "./skill-hub-review";
import {
  documentLibraryExpansionPath,
  documentLibraryHasDocumentPath,
  entityPrimaryDocumentPath,
  nextSidebarSearchKey,
  validSidebarSearchKey
} from "./sidebar-search-navigation";
import {
  domiSlidesDeliveryPolicyForText,
  quickStartWorkflows,
  radarDiscoveryWindow,
  radarPriorityPeopleContext,
  TODO_NEW_ENTRY_WINDOW_MS,
  todoRecentEntriesContext,
  todoRunContract,
  Workflow,
  workflowPrompt,
  workflows
} from "./workflows";
import {
  PROJECT_DOMAIN_SUBDOMAINS,
  projectDomainsForNews,
  projectSubdomainsForNews,
  radarTaxonomyPrompt
} from "./investmentTaxonomy";
import {
  LEGACY_RADAR_DEFAULT_DOMAINS,
  RADAR_DOMAIN_ORDER,
  type RadarDomain,
  normalizeRadarDomains
} from "./radar-domains";
import { parseRadarResult, radarRejectionSummary } from "./radar-result";
import {
  pendingPlaudContinuation,
  plaudContinuationPrompt
} from "./plaud-continuation";

const RichMarkdownEditor = lazy(() => import("./RichMarkdownEditor"));
const SetupCenter = lazy(() => import("./SetupCenter"));
const MessageContent = lazy(() => import("./MessageContent"));
const RadarSourceManager = lazy(() => import("./RadarSourceManager"));
const SkillHubManager = lazy(() => import("./SkillHubManager"));

type Role = "user" | "assistant" | "system";
type WorkspaceView = "conversation" | "tasks" | "news" | "data" | "documents";

type DomiSearchOption =
  | { key: string; kind: "project"; record: DomiProject }
  | { key: string; kind: "person"; record: DomiPerson }
  | { key: string; kind: "document"; record: DocumentLibrarySearchMatch };

type WorkspaceScrollPosition = {
  key: string;
  top: number;
  left: number;
};

type WorkspaceUiState = {
  rightPanelOpen: boolean;
  scrollPositions: WorkspaceScrollPosition[];
};

type DocumentPreviewOrigin = {
  workspaceView: WorkspaceView;
  threadId: string;
  previousRightPanelOpen: boolean;
};

const WORKSPACE_VIEW_DEFAULT_RIGHT_PANEL: Record<WorkspaceView, boolean> = {
  conversation: true,
  tasks: true,
  news: true,
  data: false,
  documents: false
};

const WORKSPACE_SCROLL_SELECTORS: Record<WorkspaceView, string[]> = {
  // Conversation scroll is already restored per-thread by chatScrollPositionsRef.
  // Keeping it here as well made a workspace-level restore race the thread-level
  // restore, which could make a reopened conversation jump to another task's spot.
  conversation: [".right-panel:not(.document-panel)"],
  tasks: [".task-board-scroll", ".task-column-list", ".right-panel:not(.document-panel)"],
  news: [".home-weekly-news", ".right-panel:not(.document-panel)"],
  data: [".database-grid-shell", ".right-panel:not(.document-panel)"],
  documents: [".rich-markdown-scroll"]
};

const COMPOSER_DRAFTS_STORAGE_KEY = "domi.composerDrafts.v1";
const DATABASE_SAVE_RETRY_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000];
type DatabaseEntityType = "project" | "person" | "news";
type DatabaseWorkspaceTab = DatabaseEntityType | "classification";
type DatabaseFilterKey =
  | "none"
  | "status"
  | "rating"
  | "city"
  | "domain"
  | "subdomain"
  | "investor"
  | "type"
  | "organization"
  | "source"
  | "evidence"
  | "following";
type DatabaseSortKey =
  | "updated"
  | "name"
  | "created"
  | "rating"
  | "city"
  | "domain"
  | "status"
  | "valuation"
  | "organization"
  | "contact"
  | "importance"
  | "confidence"
  | "source";
type DatabaseSortDirection = "asc" | "desc";

type DatabaseToolbarOption<T extends string> = {
  value: T;
  label: string;
};

const DATABASE_EMPTY_FILTER_VALUE = "__domi_empty__";
const DATABASE_FILTER_OPTIONS: Record<DatabaseEntityType, Array<DatabaseToolbarOption<DatabaseFilterKey>>> = {
  project: [
    { value: "none", label: "不筛选" },
    { value: "rating", label: "项目评级" },
    { value: "city", label: "城市" },
    { value: "domain", label: "领域" },
    { value: "subdomain", label: "子领域" },
    { value: "status", label: "进展状态" },
    { value: "investor", label: "投资机构" }
  ],
  person: [
    { value: "none", label: "不筛选" },
    { value: "rating", label: "评级" },
    { value: "city", label: "城市" },
    { value: "status", label: "进展状态" },
    { value: "type", label: "类型" },
    { value: "organization", label: "所属组织与身份" }
  ],
  news: [
    { value: "none", label: "不筛选" },
    { value: "domain", label: "领域" },
    { value: "subdomain", label: "子领域" },
    { value: "type", label: "信息类型" },
    { value: "source", label: "来源" },
    { value: "evidence", label: "证据状态" },
    { value: "following", label: "继续展示" }
  ]
};
const DATABASE_SORT_OPTIONS: Record<DatabaseEntityType, Array<DatabaseToolbarOption<DatabaseSortKey>>> = {
  project: [
    { value: "updated", label: "最后更新" },
    { value: "created", label: "入库时间" },
    { value: "name", label: "公司名称" },
    { value: "rating", label: "项目评级" },
    { value: "valuation", label: "最新估值" },
    { value: "city", label: "城市" },
    { value: "domain", label: "领域" },
    { value: "status", label: "进展状态" }
  ],
  person: [
    { value: "updated", label: "最后更新" },
    { value: "contact", label: "最后联系" },
    { value: "created", label: "入库时间" },
    { value: "name", label: "姓名" },
    { value: "rating", label: "评级" },
    { value: "city", label: "城市" },
    { value: "status", label: "进展状态" },
    { value: "organization", label: "所属组织与身份" }
  ],
  news: [
    { value: "created", label: "发布时间" },
    { value: "updated", label: "最后更新" },
    { value: "name", label: "新闻标题" },
    { value: "importance", label: "重要性" },
    { value: "confidence", label: "置信度" },
    { value: "domain", label: "领域" },
    { value: "source", label: "来源" }
  ]
};

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

type ClassificationCreateDialog = {
  recordId: string;
  name: string;
  parentDomain: string;
};

type ClassificationUndoAction = {
  recordId: string;
  expectedUpdatedAt: number;
  projectName: string;
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

function databaseFilterValues(
  entityType: DatabaseEntityType,
  record: DomiProject | DomiPerson | DomiNewsItem,
  filterKey: DatabaseFilterKey
) {
  let values: Array<string | null | undefined> = [];
  if (entityType === "project") {
    const project = record as DomiProject;
    if (filterKey === "status") values = [project.status];
    else if (filterKey === "rating") values = [project.rating];
    else if (filterKey === "city") values = project.cities || [];
    else if (filterKey === "domain") values = [project.domain];
    else if (filterKey === "subdomain") values = project.subdomains || [];
    else if (filterKey === "investor") values = project.investors || [];
  } else if (entityType === "person") {
    const person = record as DomiPerson;
    if (filterKey === "status") values = [person.status];
    else if (filterKey === "rating") values = [person.rating];
    else if (filterKey === "city") values = person.cities || [];
    else if (filterKey === "type") values = person.types || [];
    else if (filterKey === "organization") values = [person.organization];
  } else {
    const item = record as DomiNewsItem;
    if (filterKey === "domain") values = item.domains || [];
    else if (filterKey === "subdomain") values = item.subdomains || [];
    else if (filterKey === "type") values = item.types || [];
    else if (filterKey === "source") values = [item.source];
    else if (filterKey === "evidence") values = [item.evidenceStatus];
    else if (filterKey === "following") values = [item.worthFollowing === false ? "否" : "是"];
  }
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function databaseFilterValueOptions(
  entityType: DatabaseEntityType,
  records: Array<DomiProject | DomiPerson | DomiNewsItem>,
  filterKey: DatabaseFilterKey
) {
  if (filterKey === "none") return [{ value: "全部", label: "全部" }];
  const values = new Set<string>();
  let hasEmpty = false;
  records.forEach((record) => {
    const recordValues = databaseFilterValues(entityType, record, filterKey);
    if (recordValues.length === 0) hasEmpty = true;
    recordValues.forEach((value) => values.add(value));
  });
  const ratingRank = new Map(["S", "A", "B", "C"].map((value, index) => [value, index]));
  const sorted = [...values].sort((left, right) => {
    if (filterKey === "rating") {
      return (ratingRank.get(left) ?? 99) - (ratingRank.get(right) ?? 99)
        || left.localeCompare(right, "zh-CN", { numeric: true });
    }
    return left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
  });
  return [
    { value: "全部", label: "全部" },
    ...sorted.map((value) => ({ value, label: value })),
    ...(hasEmpty ? [{ value: DATABASE_EMPTY_FILTER_VALUE, label: "未填写" }] : [])
  ];
}

function databaseSortValue(
  entityType: DatabaseEntityType,
  record: DomiProject | DomiPerson | DomiNewsItem,
  sortKey: DatabaseSortKey
): number | string | null {
  if (sortKey === "name") return databaseRecordTitle(entityType, record) || null;
  if (sortKey === "updated") {
    const value = entityType === "project"
      ? Number((record as DomiProject).lastFollowup || record.updatedAt || 0)
      : entityType === "news"
        ? Number(record.updatedAt || (record as DomiNewsItem).publishedAt || 0)
        : Number(record.updatedAt || 0);
    return value > 0 ? value : null;
  }
  if (sortKey === "created") {
    const value = entityType === "news"
      ? Number((record as DomiNewsItem).publishedAt || 0)
      : Number((record as DomiProject | DomiPerson).createdAt || 0);
    return value > 0 ? value : null;
  }
  if (sortKey === "rating") {
    const rating = entityType === "project"
      ? (record as DomiProject).rating
      : (record as DomiPerson).rating;
    return ({ S: 4, A: 3, B: 2, C: 1 } as Record<string, number>)[rating] ?? null;
  }
  if (sortKey === "city") {
    const cities = entityType === "project"
      ? (record as DomiProject).cities
      : (record as DomiPerson).cities;
    return cities?.filter(Boolean).join("、") || null;
  }
  if (sortKey === "domain") {
    return entityType === "project"
      ? (record as DomiProject).domain || null
      : (record as DomiNewsItem).domains?.filter(Boolean).join("、") || null;
  }
  if (sortKey === "status") {
    return entityType === "project"
      ? (record as DomiProject).status || null
      : (record as DomiPerson).status || null;
  }
  if (sortKey === "valuation") {
    const value = (record as DomiProject).latestValuationUsd100m;
    return Number.isFinite(value) ? Number(value) : null;
  }
  if (sortKey === "organization") return (record as DomiPerson).organization || null;
  if (sortKey === "contact") {
    const value = Number((record as DomiPerson).lastContact || 0);
    return value > 0 ? value : null;
  }
  if (sortKey === "importance") return Number((record as DomiNewsItem).importance);
  if (sortKey === "confidence") return Number((record as DomiNewsItem).confidence);
  if (sortKey === "source") return (record as DomiNewsItem).source || null;
  return null;
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

function databaseGridOptions(values: Array<string | null | undefined>): DatabaseCellOption[] {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, "zh-CN", {
      numeric: true,
      sensitivity: "base"
    }))
    .map((value) => ({
      value,
      label: value,
      tone: databasePillTone(value) as DatabaseCellOption["tone"]
    }));
}

function databaseMutationId(entityType: DatabaseEntityType, recordId: string) {
  const suffix = globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `grid:${entityType}:${recordId}:${suffix}`;
}

function databaseRecordKey(entityType: DatabaseEntityType, recordId: string) {
  return `${entityType}:${recordId}`;
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
  entityFinalizationMode?: EntityFinalizationMode;
  entityExecutionIsolated?: boolean;
  executionCodexThreadId?: string;
  /** Fail-closed Slides contract retained across renderer/main restarts. */
  slidesDeliveryPolicy?: DomiSlidesDeliveryPolicy;
  /** This turn requested missing Slides input; no deliverable was completed. */
  awaitingSlidesInput?: boolean;
  /** Durable per-turn receipt prevents duplicate alerts after recovery/reload. */
  taskNotificationId?: string;
  taskNotificationOutcome?: TaskNotificationOutcome;
  taskNotificationRead?: boolean;
};

type Thread = {
  id: string;
  codexThreadId?: string;
  quarantinedCodexThreadIds?: string[];
  projectId: string;
  plaudFileId?: string;
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
  workflowContinuation?: boolean;
  resumeCodexThreadId?: string;
  privateCodexContinuation?: boolean;
  attachments?: LocalAttachment[];
  activeDocumentPath?: string;
  requestOrigin?: "user" | "programmatic";
  userInstructionText?: string;
  repositoryIdentitySnapshot?: string;
  background?: boolean;
  model?: string;
  reasoningEffort?: string;
  serviceTier?: string;
  preserveComposer?: boolean;
  onAccepted?: (queuedSubmission?: QueuedSubmission) => void;
  queuedSubmission?: QueuedSubmission;
};

type EntityFinalizationMode = "bind-source" | "archive-only";

type SubmissionExecutionContext = {
  workspacePath?: string;
  externalType?: "project" | "person";
  externalRecordId?: string;
  entityFinalizationMode: EntityFinalizationMode;
  isolated: boolean;
};

type ProjectBindingResult = {
  thread: Thread;
  attachments: LocalAttachment[];
  execution?: SubmissionExecutionContext;
  canceled?: boolean;
};

type QueuedSubmission = {
  id: string;
  threadId: string;
  input: string;
  workflowId?: string;
  displayText?: string;
  workflowContinuation?: boolean;
  resumeCodexThreadId?: string;
  privateCodexContinuation?: boolean;
  attachments: LocalAttachment[];
  activeDocumentPath?: string;
  requestOrigin?: "user" | "programmatic";
  userInstructionText?: string;
  useDomiPlugin: boolean;
  model: string;
  reasoningEffort: string;
  serviceTier: string;
  createdAt: number;
  repositoryIdentity?: string;
};

const QUEUED_SUBMISSIONS_STORAGE_KEY = "domi.queuedSubmissions.v1";
const PAUSED_QUEUED_SUBMISSIONS_STORAGE_KEY = "domi.pausedQueuedSubmissions.v1";
const DATA_CONNECTION_SETTING_KEYS = [
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
  "localRepositoryDir",
  "localDatabasePath"
] as const;

function requestChangesDataConnection(request: AppSettingsSaveRequest) {
  return DATA_CONNECTION_SETTING_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(request, key)
  );
}

function queueRepositoryIdentity(settings: AppSettings | null | undefined) {
  if (!settings) return "";
  const backend = settings.storageBackend === "local" ? "local" : "feishu";
  const source = backend === "local"
    ? [
        settings.localRepositoryDir,
        settings.localDatabasePath,
        settings.localLibraryDir
      ]
    : [
        settings.projectBaseToken,
        settings.projectTableId,
        settings.peopleBaseToken,
        settings.peopleTableId,
        settings.radarBaseToken,
        settings.radarTableId,
        settings.wikiSpaceId,
        settings.taskDocumentUrl,
        settings.localLibraryDir
      ];
  // Store only a non-reversible local fingerprint, never the user's private
  // Base tokens, Wiki identifiers or absolute repository paths.
  let hash = 0x811c9dc5;
  for (const character of source.map((value) => String(value || "")).join("\u0000")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return `${backend}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function readQueuedSubmissions(): Record<string, QueuedSubmission[]> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(QUEUED_SUBMISSIONS_STORAGE_KEY) || "{}") as Record<
      string,
      unknown
    >;
    return Object.fromEntries(Object.entries(parsed).flatMap(([threadId, value]) => {
      if (!threadId || !Array.isArray(value)) return [];
      const queue = value.filter((item): item is QueuedSubmission => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<QueuedSubmission>;
        return typeof candidate.id === "string"
          && candidate.threadId === threadId
          && typeof candidate.input === "string"
          && Array.isArray(candidate.attachments)
          && (candidate.activeDocumentPath === undefined
            || typeof candidate.activeDocumentPath === "string")
          && (candidate.displayText === undefined
            || typeof candidate.displayText === "string")
          && (candidate.workflowContinuation === undefined
            || typeof candidate.workflowContinuation === "boolean")
          && (candidate.resumeCodexThreadId === undefined
            || typeof candidate.resumeCodexThreadId === "string")
          && (candidate.privateCodexContinuation === undefined
            || typeof candidate.privateCodexContinuation === "boolean")
          && (candidate.requestOrigin === undefined
            || candidate.requestOrigin === "user"
            || candidate.requestOrigin === "programmatic")
          && (candidate.userInstructionText === undefined
            || typeof candidate.userInstructionText === "string")
          && typeof candidate.useDomiPlugin === "boolean"
          && typeof candidate.model === "string"
          && typeof candidate.reasoningEffort === "string"
          && typeof candidate.serviceTier === "string"
          && (candidate.repositoryIdentity === undefined
            || typeof candidate.repositoryIdentity === "string")
          && Number.isFinite(candidate.createdAt);
      });
      return queue.length ? [[threadId, queue] as const] : [];
    }));
  } catch {
    return {};
  }
}

function readPausedQueuedSubmissionIds() {
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(PAUSED_QUEUED_SUBMISSIONS_STORAGE_KEY) || "[]"
    );
    return new Set<string>(
      Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : []
    );
  } catch {
    return new Set<string>();
  }
}

type RunContext = {
  threadId: string;
  assistantMessageId: string;
  userMessageId?: string;
  workflowId?: string;
  requestText?: string;
  attachments?: LocalAttachment[];
  knownProjectIds?: string[];
  knownPersonIds?: string[];
  queuedSubmission?: QueuedSubmission;
  entityFinalizationMode?: EntityFinalizationMode;
  entityExecutionIsolated?: boolean;
  executionCodexThreadId?: string;
};

type AssistantInteraction = {
  key: string;
  runId: string;
  messageId: string;
  request: CodexUserInputRequest;
  status: "pending" | "resolved";
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

function readStoredComposerDrafts(): Record<string, ComposerDraft> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(COMPOSER_DRAFTS_STORAGE_KEY) || "null");
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).flatMap(([threadId, value]) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return [];
      const draft = value as Partial<ComposerDraft>;
      const attachments = Array.isArray(draft.attachments)
        ? draft.attachments.filter((item): item is LocalAttachment => Boolean(
            item
            && typeof item.name === "string"
            && typeof item.path === "string"
            && Number.isFinite(Number(item.size))
          ))
        : [];
      const normalized: ComposerDraft = {
        input: typeof draft.input === "string" ? draft.input : "",
        attachments,
        attachmentError: "",
        selectedWorkflowId: typeof draft.selectedWorkflowId === "string"
          ? draft.selectedWorkflowId
          : undefined
      };
      return normalized.input || normalized.attachments.length || normalized.selectedWorkflowId
        ? [[threadId, normalized]]
        : [];
    }));
  } catch {
    return {};
  }
}

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
const MARKDOWN_AUTO_SAVE_DELAY_MS = 420;
const MARKDOWN_AUTO_SAVE_RETRY_DELAYS_MS = [1_000, 3_000, 10_000];
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
const LEGACY_NEW_THREAD_GREETING = "新对话已创建。选择一个 workflow，或直接输入你要 Codex 完成的投资任务。";
const NEW_THREAD_MODEL = "default";
const NEW_THREAD_REASONING_EFFORT = "max";
const NEW_THREAD_SERVICE_TIER = "priority";
const TODO_SYNC_TIMEOUT_MS = 8 * 60 * 1000;
const TODO_SYNC_LEDGER_POLL_MS = 10 * 1000;
const TODO_SYNC_POST_WRITE_GRACE_MS = 20 * 1000;
type TodoSyncPhase =
  | "idle"
  | "waiting"
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

const PROJECT_TARGET_WORKFLOW_IDS = new Set([
  "project-research",
  "project-intake",
  "desk-research",
  "investment-review",
  "investment-analysis",
  "ic-memo",
  "investment-mgmt",
  "deal-negotiation"
]);
const ENTITY_RESULT_WORKFLOW_IDS = new Set([
  "project-intake",
  "people-intake",
  "domi-router",
  "investment-mgmt"
]);
const PERSON_TARGET_WORKFLOW_IDS = new Set(["people-intake", "sourcing"]);

function workflowAllowsProjectRouting(workflow?: Workflow) {
  return !workflow || PROJECT_TARGET_WORKFLOW_IDS.has(workflow.id);
}

function workflowAllowsEntityResult(
  workflowId: string | undefined,
  entityType: "project" | "person"
) {
  if (workflowId === "project-intake") return entityType === "project";
  if (workflowId === "people-intake") return entityType === "person";
  return !workflowId || ["domi-router", "investment-mgmt"].includes(workflowId);
}

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
      && message.content === LEGACY_NEW_THREAD_GREETING
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
function followedDomainsForNews(item: DomiNewsItem, followedDomains: readonly string[]) {
  return projectDomainsForNews(item.domains, item.subdomains)
    .filter((domain) => followedDomains.includes(domain));
}

function isFollowedNewsItem(item: DomiNewsItem, followedDomains: readonly string[]) {
  return followedDomainsForNews(item, followedDomains).length > 0;
}

function newsMatchesTaxonomyFilter(
  item: DomiNewsItem,
  domain: string,
  followedDomains: readonly string[],
  subdomain = "全部"
) {
  if (domain === "全部") return subdomain === "全部";
  if (!followedDomainsForNews(item, followedDomains).includes(domain)) return false;
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
    "目标：生成完整结构化纪要；如果实质内容属于创业项目或创始人交流，继续完成投资快评，并按运行时锁定的权威主库归档。默认本地主库使用 Markdown 文档和本地项目库；只有运行时明确标为 legacy_feishu_primary 时，才按对应 Skill 维护本机既有固定 Base／唯一 Wiki 主文档。非项目录音只生成并保存纪要，不做项目入库。",
    "",
    "执行要求：",
    "1. 先采用 domi 插件的 domi-router，并完整读取 PLAUD 投资录音工作流及各阶段 Skill。",
    "2. 先用 plaud queue 定位这个 fileId；如果 PLAUD 已生成但本地没有 transcriptPath，使用 plaud download 下载现成文字稿并建立恢复记录，禁止重新触发生成。",
    "3. 如果已经有 transcriptPath，直接复用，不要重新下载或生成。",
    "4. 严格从当前队列阶段恢复，不重复生成纪要、文档或外部记录。",
    "5. 按工作流生成回忆提示并确认对话背景和参会人；需要我补充时在该阶段提问并暂停，收到回复后再继续后续阶段。",
    "6. 如已连接飞书，可按本轮内容需要只读检索飞书 Wiki、云文档或 Base 中的相关信息作为外部参考，并标明采用的来源；飞书只读检索失败不得阻塞文字稿、纪要、快评和本地主库归档。",
    "7. 当前文本是客户端生成的程序化工作流，不是用户对飞书写入的原始指令。除 legacy_feishu_primary 按 Skill 对既有固定 Base／唯一 Wiki 主文档完成管理闭环外，若本轮没有用户明确要求创建、编辑、更新或发布飞书内容的原始消息，禁止创建、编辑、更新、覆盖或发布任何飞书外部内容，也不得运行飞书 Markdown 导出／交接。",
    "8. 权威主库写入前执行去重、字段校验和写后回读；最终只报告纪要、项目判断、评分、主库归档以及飞书只读参考的实际结果。"
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

function domiContextForThread(snapshot: DomiSnapshot | null, thread: Thread) {
  if (!snapshot || !thread.externalRecordId || !thread.externalType) return "";
  if (thread.externalType === "project") {
    const project = indexBy(snapshot.projects, "recordId").get(thread.externalRecordId);
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
      `Wiki链接：${project.link || "未填写"}`,
      "归档约束：该任务已绑定正式项目。项目相关文件必须直接进入稳定项目目录的纪要／研究／原始材料／导出，不得写入任务 outputs 后再搬运。"
    ].join("\n");
  }
  const person = indexBy(snapshot.people, "recordId").get(thread.externalRecordId);
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
    messages: []
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
  todoSyncCheckpoint?: TodoSyncCheckpoint | null;
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

function userSkillWorkflow(skill: SkillHubUserSkill): Workflow {
  return {
    id: skill.id,
    title: skill.title,
    shortTitle: skill.title,
    skill: `$${skill.name}`,
    skillPath: skill.path,
    producesSlides: skill.producesSlides,
    description: skill.description,
    output: `按 $${skill.name} 约定生成的结果`,
    defaultPrompt: `请使用 $${skill.name} 完成我的任务。`,
    source: "user"
  };
}

function App() {
  const { confirm: requestConfirmation, confirmDialog: appConfirmDialog } = useAppConfirm();
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [activeThreadId, setActiveThreadId] = useState(initialThreads[0].id);
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>("conversation");
  const [skillsExpanded, setSkillsExpanded] = useState(true);
  const selectedSkillButtonRef = useRef<HTMLButtonElement>(null);
  const [skillHubOpen, setSkillHubOpen] = useState(false);
  const [skillHubReviewCandidateIds, setSkillHubReviewCandidateIds] = useState<string[]>([]);
  const [skillHubSkills, setSkillHubSkills] = useState<SkillHubUserSkill[]>([]);
  const [skillHubReady, setSkillHubReady] = useState(false);
  const [skillHubLoadError, setSkillHubLoadError] = useState("");
  const [documentLibrarySidebarExpanded, setDocumentLibrarySidebarExpanded] = useState(false);
  const [composerDraftsByThread, setComposerDraftsByThread] = useState<
    Record<string, ComposerDraft>
  >(readStoredComposerDrafts);
  const activeComposerDraft = composerDraftsByThread[activeThreadId] || EMPTY_COMPOSER_DRAFT;
  const input = activeComposerDraft.input;
  const attachments = activeComposerDraft.attachments;
  const attachmentError = activeComposerDraft.attachmentError;
  const selectedWorkflowId = activeComposerDraft.selectedWorkflowId;
  const [composerDragActive, setComposerDragActive] = useState(false);
  const [attachmentImportCount, setAttachmentImportCount] = useState(0);
  const [codexStatus, setCodexStatus] = useState<CodexCheckResult | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"connection" | "data" | "plaud" | "updates" | "diagnostics">("connection");
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [sidebarUpdateBusy, setSidebarUpdateBusy] = useState(false);
  const [domiSnapshot, setDomiSnapshot] = useState<DomiSnapshot | null>(null);
  const [domiSyncing, setDomiSyncing] = useState(false);
  const [domiError, setDomiError] = useState("");
  const [domiQuery, setDomiQuery] = useState("");
  const [domiSearchError, setDomiSearchError] = useState("");
  const [domiSearchActiveKey, setDomiSearchActiveKey] = useState("");
  const [domiDocumentSearch, setDomiDocumentSearch] = useState<DocumentLibrarySearchResult>({
    ok: true,
    results: [],
    indexing: false,
    indexedCount: 0,
    lastIndexedAt: 0
  });
  const [databaseSnapshot, setDatabaseSnapshot] = useState<DomiDatabaseSnapshot | null>(null);
  const [databaseWorkspaceTab, setDatabaseWorkspaceTab] = useState<DatabaseWorkspaceTab>("project");
  const [databaseEntityType, setDatabaseEntityType] = useState<DatabaseEntityType>("project");
  const [databaseSelectedId, setDatabaseSelectedId] = useState("");
  const [databaseEditingId, setDatabaseEditingId] = useState("");
  const [databaseDraft, setDatabaseDraft] = useState<DatabaseDraft | null>(null);
  const [databaseExpandedCell, setDatabaseExpandedCell] = useState<DatabaseExpandedCell | null>(null);
  const [databaseQuery, setDatabaseQuery] = useState("");
  const [databaseFilterKey, setDatabaseFilterKey] = useState<DatabaseFilterKey>("none");
  const [databaseFilterValue, setDatabaseFilterValue] = useState("全部");
  const [databaseSortKey, setDatabaseSortKey] = useState<DatabaseSortKey>("updated");
  const [databaseSortDirection, setDatabaseSortDirection] = useState<DatabaseSortDirection>("desc");
  const [databaseVisibleLimit, setDatabaseVisibleLimit] = useState(100);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseSaving, setDatabaseSaving] = useState(false);
  const [databaseError, setDatabaseError] = useState("");
  const [databaseNotice, setDatabaseNotice] = useState("");
  const [globalPersistenceError, setGlobalPersistenceError] = useState("");
  const [databaseDeleteTarget, setDatabaseDeleteTarget] = useState<DatabaseDeleteTarget | null>(null);
  const [databaseRowContextMenu, setDatabaseRowContextMenu] = useState<DatabaseRowContextMenu | null>(null);
  const [databaseDeleting, setDatabaseDeleting] = useState(false);
  const [classificationSelectedId, setClassificationSelectedId] = useState("");
  const [classificationDomain, setClassificationDomain] = useState("");
  const [classificationSubdomains, setClassificationSubdomains] = useState("");
  const [classificationSaving, setClassificationSaving] = useState(false);
  const [classificationCreateDialog, setClassificationCreateDialog] = useState<ClassificationCreateDialog | null>(null);
  const [classificationUndo, setClassificationUndo] = useState<ClassificationUndoAction | null>(null);
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
  const [radarSourceManagerOpen, setRadarSourceManagerOpen] = useState(false);
  const [radarDomainManagerOpen, setRadarDomainManagerOpen] = useState(false);
  const [radarDomainDraft, setRadarDomainDraft] = useState<RadarDomain[]>([]);
  const [radarDomainSaving, setRadarDomainSaving] = useState(false);
  const [radarSourceSnapshot, setRadarSourceSnapshot] = useState<RadarSourceSnapshot | null>(null);
  const radarSourceSnapshotRef = useRef(radarSourceSnapshot);
  radarSourceSnapshotRef.current = radarSourceSnapshot;
  const [assistantInteractions, setAssistantInteractions] = useState<AssistantInteraction[]>([]);
  const [domiTaskBoard, setDomiTaskBoard] = useState<DomiTaskBoardSnapshot | null>(null);
  const [domiTaskLoading, setDomiTaskLoading] = useState(false);
  const [domiTaskMutationId, setDomiTaskMutationId] = useState<string | null>(null);
  const [domiTaskError, setDomiTaskError] = useState("");
  const [domiTaskSyncState, setDomiTaskSyncState] = useState<TodoSyncState>(
    IDLE_TODO_SYNC_STATE
  );
  const [domiTaskSyncElapsed, setDomiTaskSyncElapsed] = useState(0);
  const [domiTaskSyncQueued, setDomiTaskSyncQueued] = useState(false);
  const [documentLibrary, setDocumentLibrary] = useState<DocumentLibrarySnapshot | null>(null);
  const [documentLibraryLoading, setDocumentLibraryLoading] = useState(false);
  const [documentLibraryError, setDocumentLibraryError] = useState("");
  const [documentLibraryNotice, setDocumentLibraryNotice] = useState("");
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
  const [codexRecoveryReady, setCodexRecoveryReady] = useState(false);
  const [activeRunsByThread, setActiveRunsByThread] = useState<Record<string, string>>({});
  const [submissionBusyThreadIds, setSubmissionBusyThreadIds] = useState<Set<string>>(
    () => new Set()
  );
  const [queuedSubmissionsByThread, setQueuedSubmissionsByThread] = useState<
    Record<string, QueuedSubmission[]>
  >(readQueuedSubmissions);
  const [pausedQueuedSubmissionIds, setPausedQueuedSubmissionIds] = useState<Set<string>>(
    readPausedQueuedSubmissionIds
  );
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
  const [markdownInitialSearchQuery, setMarkdownInitialSearchQuery] = useState("");
  const [markdownLoading, setMarkdownLoading] = useState(false);
  const [markdownSaving, setMarkdownSaving] = useState(false);
  const [markdownExternalOpening, setMarkdownExternalOpening] = useState(false);
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
  const threadSelectionIntentRef = useRef(0);
  const skillCreatorBaselinesRef = useRef(
    new Map<string, Promise<Set<string>>>()
  );
  const threadListRef = useRef<HTMLDivElement>(null);
  const activeThreadIdRef = useRef(activeThreadId);
  const workspaceViewRef = useRef<WorkspaceView>(workspaceView);
  const rightPanelOpenRef = useRef(rightPanelOpen);
  const workspaceUiStateRef = useRef<Record<WorkspaceView, WorkspaceUiState>>({
    conversation: { rightPanelOpen: true, scrollPositions: [] },
    tasks: { rightPanelOpen: true, scrollPositions: [] },
    news: { rightPanelOpen: true, scrollPositions: [] },
    data: { rightPanelOpen: false, scrollPositions: [] },
    documents: { rightPanelOpen: false, scrollPositions: [] }
  });
  const documentPreviewOriginRef = useRef<DocumentPreviewOrigin | null>(null);
  const documentPanelFocusedRef = useRef(false);
  const windowFocusedRef = useRef(document.hasFocus());
  const threadsRef = useRef(threads);
  const composerDraftsByThreadRef = useRef(composerDraftsByThread);
  const activeRunsByThreadRef = useRef(activeRunsByThread);
  const domiSnapshotRef = useRef(domiSnapshot);
  const persistedThreadsRef = useRef(new Map<string, Thread>());
  const persistenceQueueRef = useRef<Promise<unknown>>(Promise.resolve());
  const flushClientStateRef = useRef<() => Promise<{ ok: boolean; error?: string }>>(
    async () => ({ ok: true })
  );
  const settingsDirtyRef = useRef(false);
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
  const [todoSyncCheckpoint, setTodoSyncCheckpoint] = useState<TodoSyncCheckpoint | null>(null);
  const todoSyncCheckpointRef = useRef<TodoSyncCheckpoint | null>(null);
  const podcastSourceAutomationRef = useRef(false);
  const podcastArchiveRunIdsRef = useRef(new Set<string>());
  const podcastProgressRunsRef = useRef(new Map<string, {
    jobId: string; output: string; seen: Set<string>; pending: Promise<void>;
    verified: boolean; error?: string;
  }>());
  const appSettingsRef = useRef(appSettings);
  const localSearchRefreshAtRef = useRef(0);
  const domiSearchComposingRef = useRef(false);
  const domiSearchOptionRefs = useRef(new Map<string, HTMLButtonElement>());
  const domiDocumentSearchRequestRef = useRef(0);
  const domiEntityOpenRequestRef = useRef(0);
  const documentSearchRefreshAtRef = useRef(0);
  const documentLibraryRequestRef = useRef(0);
  const documentLibraryTreeRef = useRef<HTMLDivElement>(null);
  const markdownOpenRequestRef = useRef(0);
  const markdownSaveRequestRef = useRef(0);
  const markdownAutoSaveTimerRef = useRef<number | null>(null);
  const markdownSaveInFlightRef = useRef<Promise<boolean> | null>(null);
  const markdownAutoSaveRetryRef = useRef(0);
  const markdownRenameRequestRef = useRef(0);
  const markdownRenameInFlightRef = useRef(false);
  const markdownExternalOpenInFlightRef = useRef(false);
  const markdownTitleCancelRef = useRef(false);
  const pdfOpenRequestRef = useRef(0);
  const markdownDraftRef = useRef(markdownDraft);
  const markdownDocumentRef = useRef(markdownDocument);
  const pdfDocumentRef = useRef(pdfDocument);
  const databaseDraftRef = useRef(databaseDraft);
  const databaseEntityTypeRef = useRef(databaseEntityType);
  const databaseSelectedIdRef = useRef(databaseSelectedId);
  const classificationSelectedIdRef = useRef(classificationSelectedId);
  const databaseAutoSaveTimerRef = useRef<number | null>(null);
  const databaseAutoSaveQueuedRef = useRef<DatabaseDraft | null>(null);
  const databaseAutoSaveInFlightRef = useRef(false);
  const databaseAutoSaveRetryTimerRef = useRef<number | null>(null);
  const databaseAutoSaveRetryRef = useRef(0);
  const databaseRefreshInFlightRef = useRef<Promise<DomiDatabaseSnapshot | null> | null>(null);
  const databasePatchQueuesRef = useRef(new Map<string, Promise<void>>());
  const databaseCanonicalRecordsRef = useRef(
    new Map<string, DomiProject | DomiPerson | DomiNewsItem>()
  );
  const databaseGridSaveCountRef = useRef(0);
  const plaudListPromiseRef = useRef<Promise<DomiPlaudSnapshot | null> | null>(null);
  const plaudSyncPromiseRef = useRef<Promise<DomiPlaudSyncResult | null> | null>(null);
  const plaudSnapshotRevisionRef = useRef(0);
  const plaudMutationIdsRef = useRef(new Set<string>());
  const launchingPlaudIdsRef = useRef(new Set<string>());
  const creatingThreadRef = useRef(false);
  const attachmentImportCountRef = useRef(0);
  const submissionStartingThreadIdsRef = useRef(new Set<string>());
  const codexRecoveryStartedRef = useRef(false);
  const queueStartingThreadIdsRef = useRef(new Set<string>());
  const settlingThreadIdsRef = useRef(new Set<string>());
  const queuedSubmissionsByThreadRef = useRef(queuedSubmissionsByThread);
  const completedRunIdsRef = useRef(new Set<string>());
  const announcedTaskResultIdsRef = useRef(new Set<string>());
  const taskNotificationSendingRef = useRef(false);
  const clickedTaskNotificationIdsRef = useRef(new Set<string>());
  const openingTaskNotificationIdsRef = useRef(new Set<string>());
  const [pendingTaskNotifications, setPendingTaskNotifications] = useState<Array<{
    threadId: string;
    messageId: string;
    notificationId: string;
    outcome: TaskNotificationOutcome;
  }>>([]);
  const runContextRef = useRef(new Map<string, RunContext>());
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
  composerDraftsByThreadRef.current = composerDraftsByThread;
  activeRunsByThreadRef.current = activeRunsByThread;
  domiSnapshotRef.current = domiSnapshot;
  workspaceViewRef.current = workspaceView;
  rightPanelOpenRef.current = rightPanelOpen;
  markdownDraftRef.current = markdownDraft;
  markdownDocumentRef.current = markdownDocument;
  pdfDocumentRef.current = pdfDocument;
  databaseDraftRef.current = databaseDraft;
  databaseEntityTypeRef.current = databaseEntityType;
  databaseSelectedIdRef.current = databaseSelectedId;
  classificationSelectedIdRef.current = classificationSelectedId;
  weeklyNewsSnapshotRef.current = weeklyNews;
  weeklyNewsPageRef.current = weeklyNewsPage;
  weeklyNewsLoadingRef.current = weeklyNewsLoading;
  weeklyNewsScanningRef.current = weeklyNewsScanning;
  weeklyNewsAutomationRef.current = weeklyNewsAutomation;
  appSettingsRef.current = appSettings;
  queuedSubmissionsByThreadRef.current = queuedSubmissionsByThread;
  if (databaseSnapshot) {
    ([
      ["project", databaseSnapshot.projects || []],
      ["person", databaseSnapshot.people || []],
      ["news", databaseSnapshot.news || []]
    ] as const).forEach(([entityType, items]) => {
      items.forEach((record) => {
        const key = databaseRecordKey(entityType, record.recordId);
        const known = databaseCanonicalRecordsRef.current.get(key);
        if (!known || Number(record.updatedAt || 0) >= Number(known.updatedAt || 0)) {
          databaseCanonicalRecordsRef.current.set(key, record);
        }
      });
    });
  }

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

  function changeAttachmentImportCount(delta: number) {
    attachmentImportCountRef.current = Math.max(0, attachmentImportCountRef.current + delta);
    setAttachmentImportCount(attachmentImportCountRef.current);
  }

  function markThreadSubmissionStart(
    threadId: string,
    source: "foreground" | "queue",
    starting: boolean
  ) {
    const target = source === "foreground"
      ? submissionStartingThreadIdsRef.current
      : queueStartingThreadIdsRef.current;
    if (starting) target.add(threadId);
    else target.delete(threadId);
    setSubmissionBusyThreadIds(new Set([
      ...submissionStartingThreadIdsRef.current,
      ...queueStartingThreadIdsRef.current
    ]));
  }

  function threadDeletionIsBusy(threadId: string) {
    if (!codexRecoveryReady) return true;
    const liveRun = [...runContextRef.current.entries()].find(
      ([, context]) => context.threadId === threadId
    );
    return submissionBusyThreadIds.has(threadId) || isThreadSubmissionBusy(
      threadId,
      activeRunsByThreadRef.current[threadId] || liveRun?.[0],
      submissionStartingThreadIdsRef.current,
      queueStartingThreadIdsRef.current,
      settlingThreadIdsRef.current
    );
  }

  function queuedSubmissionRemovalIsBusy(threadId: string, queuedId: string) {
    return queueStartingThreadIdsRef.current.has(threadId)
      && queuedSubmissionsByThreadRef.current[threadId]?.[0]?.id === queuedId;
  }

  function currentMessageContent(threadId: string, messageId: string) {
    const thread = indexBy(threadsRef.current, "id").get(threadId);
    return thread ? indexBy(thread.messages, "id").get(messageId)?.content || "" : "";
  }

  function workspaceScrollElements(view: WorkspaceView) {
    return WORKSPACE_SCROLL_SELECTORS[view].flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element, index) => ({
        element,
        key: `${selector}:${index}`
      }))
    );
  }

  function captureWorkspaceUiState(
    view = workspaceViewRef.current,
    options: { preserveRightPanel?: boolean } = {}
  ) {
    const previous = workspaceUiStateRef.current[view];
    workspaceUiStateRef.current[view] = {
      rightPanelOpen: options.preserveRightPanel
        ? previous?.rightPanelOpen ?? WORKSPACE_VIEW_DEFAULT_RIGHT_PANEL[view]
        : rightPanelOpenRef.current,
      scrollPositions: workspaceScrollElements(view).map(({ element, key }) => ({
        key,
        top: element.scrollTop,
        left: element.scrollLeft
      }))
    };
  }

  function restoreWorkspaceUiState(view: WorkspaceView) {
    const state = workspaceUiStateRef.current[view];
    if (!state) return;
    setRightPanelOpen(state.rightPanelOpen);
    window.requestAnimationFrame(() => {
      const positions = new Map(state.scrollPositions.map((item) => [item.key, item]));
      for (const { element, key } of workspaceScrollElements(view)) {
        const position = positions.get(key);
        if (!position) continue;
        element.scrollTop = position.top;
        element.scrollLeft = position.left;
      }
    });
  }

  async function navigateWorkspace(
    view: WorkspaceView,
    preserveDomiEntityOpen = false
  ): Promise<boolean> {
    if (!preserveDomiEntityOpen) cancelPendingDomiEntityOpen();
    if (view === workspaceViewRef.current) return true;
    if (
      workspaceViewRef.current === "data"
      && view !== "data"
      && !await flushDatabaseAutoSaveAndWait()
    ) {
      setDatabaseError("资料库修改尚未安全保存，已留在当前页面并保留草稿重试。");
      return false;
    }
    captureWorkspaceUiState();
    workspaceViewRef.current = view;
    setWorkspaceView(view);
    return true;
  }

  function isThreadActivelyVisible(threadId: string) {
    return isTaskResultVisible({
      threadId,
      activeThreadId: activeThreadIdRef.current,
      workspaceView: workspaceViewRef.current,
      windowFocused: windowFocusedRef.current && document.hasFocus(),
      visibilityState: document.visibilityState,
      documentPanelFocused: documentPanelFocusedRef.current
    });
  }

  function clearVisibleThreadCompletion() {
    const threadId = activeThreadIdRef.current;
    if (!isThreadActivelyVisible(threadId)) return;
    setThreads((current) => clearTaskResultUnread(current, threadId));
  }

  function announceTaskResult(threadId: string, messageId: string, outcome: TaskNotificationOutcome) {
    const notificationId = taskNotificationId(threadId, messageId);
    const thread = threadsRef.current.find((item) => item.id === threadId);
    const message = thread?.messages.find((item) => item.id === messageId);
    if (!thread || !message || message.taskNotificationId === notificationId
      || announcedTaskResultIdsRef.current.has(notificationId)) return;
    announcedTaskResultIdsRef.current.add(notificationId);
    const visible = isThreadActivelyVisible(threadId);
    setThreads((current) => recordTaskResult(current, threadId, messageId, outcome, visible));
    if (outcome !== "stopped" && !visible) {
      setPendingTaskNotifications((current) => [
        ...current, { threadId, messageId, notificationId, outcome }
      ]);
    }
  }

  async function persistWorkbenchStateNow(): Promise<boolean> {
    const currentThreads = flushAssistantDeltas();
    const patch = {
      meta: {
        version: 2,
        activeThreadId: activeThreadIdRef.current,
        agentPreferences: { model, reasoningEffort, serviceTier, domiPluginEnabled },
        executionSuggestionState,
        todoSyncCheckpoint: todoSyncCheckpointRef.current
      },
      threads: currentThreads,
      deletedThreadIds: [...persistedThreadsRef.current.keys()]
        .filter((id) => !currentThreads.some((thread) => thread.id === id)),
      threadOrder: currentThreads.map((thread) => thread.id)
    };
    const persistedSnapshot = new Map(currentThreads.map((thread) => [thread.id, thread]));
    const operation = persistenceQueueRef.current
      .catch(() => undefined)
      .then(() => workbench.saveStatePatch(patch));
    persistenceQueueRef.current = operation;
    try {
      const result = await operation;
      if (!result.ok) return false;
      persistedThreadsRef.current = persistedSnapshot;
      window.localStorage.setItem(
        COMPOSER_DRAFTS_STORAGE_KEY,
        JSON.stringify(composerDraftsByThread)
      );
      window.localStorage.setItem(
        QUEUED_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify(queuedSubmissionsByThread)
      );
      window.localStorage.setItem(
        PAUSED_QUEUED_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify([...pausedQueuedSubmissionIds])
      );
      setGlobalPersistenceError("");
      return true;
    } catch {
      setGlobalPersistenceError("对话和草稿尚未安全保存，domi 已阻止关闭；请重试。");
      return false;
    }
  }

  flushClientStateRef.current = async () => {
    if (settingsDirtyRef.current) {
      return { ok: false, error: "设置页还有未保存的修改，请先保存或放弃修改后再关闭 domi。" };
    }
    // The main process allows 12 seconds for renderer shutdown. Keep all renderer-side
    // settling inside one shared budget so we can return a useful blocking reason first.
    const closeDeadline = Date.now() + 9_000;
    while (attachmentImportCountRef.current > 0 && Date.now() < closeDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (attachmentImportCountRef.current > 0) {
      return { ok: false, error: "附件仍在导入，请等待完成后再关闭 domi。" };
    }
    while (settlingThreadIdsRef.current.size > 0 && Date.now() < closeDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (settlingThreadIdsRef.current.size > 0) {
      return { ok: false, error: "项目资料仍在归档，请等待完成后再关闭 domi。" };
    }
    if (!await saveOpenMarkdown()) {
      return { ok: false, error: "Markdown 文档尚未保存，请处理保存错误后重试关闭。" };
    }
    while (databaseAutoSaveInFlightRef.current && Date.now() < closeDeadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (databaseAutoSaveInFlightRef.current) {
      return { ok: false, error: "资料库仍在保存，请稍后重试关闭。" };
    }
    if (databaseAutoSaveQueuedRef.current && !await flushDatabaseAutoSave()) {
      return { ok: false, error: "资料库修改尚未保存，草稿已保留并会自动重试。" };
    }
    if (!await persistWorkbenchStateNow()) {
      return { ok: false, error: "对话或输入草稿尚未保存，请稍后重试关闭。" };
    }
    return { ok: true };
  };

  function flushAssistantDeltas(): Thread[] {
    assistantDeltaFlushTimerRef.current = null;
    const pending = [...pendingAssistantDeltasRef.current.values()];
    pendingAssistantDeltasRef.current.clear();
    if (!pending.length) return threadsRef.current;

    const patchesByThread = new Map<string, Map<string, string>>();
    for (const item of pending) {
      const threadPatches = patchesByThread.get(item.threadId) || new Map<string, string>();
      threadPatches.set(item.messageId, item.content);
      patchesByThread.set(item.threadId, threadPatches);
    }

    const applyPendingDeltas = (current: Thread[]) => {
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
    };

    // React state updaters are asynchronous. Update the authoritative ref immediately so
    // a close/save in the same tick cannot persist the pre-delta assistant message.
    const nextSnapshot = applyPendingDeltas(threadsRef.current);
    threadsRef.current = nextSnapshot;
    setThreads((current) => {
      const reconciled = applyPendingDeltas(current);
      threadsRef.current = reconciled;
      return reconciled;
    });
    return nextSnapshot;
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

  function setThreadAttachmentError(threadId: string, next: string) {
    setComposerDraftsByThread((current) => {
      if (!current[threadId] && !next) return current;
      return {
        ...current,
        [threadId]: {
          ...(current[threadId] || EMPTY_COMPOSER_DRAFT),
          attachmentError: next
        }
      };
    });
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

  function replaceComposerDraft(threadId: string, draft: Partial<ComposerDraft>) {
    setComposerDraftsByThread((current) => ({
      ...current,
      [threadId]: {
        ...EMPTY_COMPOSER_DRAFT,
        ...draft,
        attachments: draft.attachments || []
      }
    }));
  }

  function clearSubmittedComposerDraft(
    threadId: string,
    submittedInput: string,
    submittedAttachments: LocalAttachment[],
    submittedWorkflowId?: string
  ) {
    setComposerDraftsByThread((current) => {
      const draft = current[threadId];
      if (!draft) return current;
      const sameAttachments = draft.attachments.length === submittedAttachments.length
        && draft.attachments.every((attachment, index) =>
          attachment.path === submittedAttachments[index]?.path
        );
      if (
        draft.input !== submittedInput
        || draft.selectedWorkflowId !== submittedWorkflowId
        || !sameAttachments
      ) {
        return current;
      }
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
    () => indexBy(threads, "id").get(activeThreadId) || threads[0] || initialThreads[0],
    [activeThreadId, threads]
  );
  activeThreadIdRef.current = activeThreadId;
  const activeRunId = activeRunsByThread[activeThread.id] || null;
  const isRunning = Boolean(activeRunId);
  const activeQueuedSubmissions = queuedSubmissionsByThread[activeThread.id] || [];

  const timeline = activeThread.timeline || [];
  const lastUsage = activeThread.lastUsage || null;
  const lastInputTokens = Math.max(0, Number(lastUsage?.input_tokens || 0));
  const lastCachedInputTokens = Math.min(
    lastInputTokens,
    Math.max(0, Number(lastUsage?.cached_input_tokens || 0))
  );
  const lastUncachedInputTokens = lastUsage
    ? lastInputTokens - lastCachedInputTokens
    : 0;
  const lastCacheHitRate = lastInputTokens
    ? Math.round((lastCachedInputTokens / lastInputTokens) * 100)
    : 0;
  const lastCacheWriteInputTokens = Math.max(
    0,
    Number(lastUsage?.cache_write_input_tokens || 0)
  );
  const lastOutputTokens = Math.max(0, Number(lastUsage?.output_tokens || 0));
  const lastReasoningOutputTokens = Math.max(
    0,
    Number(lastUsage?.reasoning_output_tokens || 0)
  );
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

  const userSkillWorkflows = useMemo<Workflow[]>(() => skillHubSkills
    .filter((skill) => skill.available !== false && skill.enabled !== false)
    .map(userSkillWorkflow), [skillHubSkills]);
  useEffect(() => {
    if (skillsExpanded) selectedSkillButtonRef.current?.scrollIntoView({ block: "nearest" });
  }, [skillsExpanded, selectedWorkflowId]);
  const allWorkflows = useMemo(
    () => [...workflows, ...userSkillWorkflows],
    [userSkillWorkflows]
  );
  const selectedWorkflow = useMemo(
    () => indexBy(allWorkflows, "id").get(selectedWorkflowId || ""),
    [allWorkflows, selectedWorkflowId]
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

  function resolveRunModelPolicy(
    workflowId?: string,
    options: {
      runKind?: DomiModelPolicyRunKind;
      useDomiPlugin?: boolean;
      requestText?: string;
      domiSlidesDeliveryPolicy?: DomiSlidesDeliveryPolicy | "";
      model?: string;
      reasoningEffort?: string;
      serviceTier?: string;
    } = {}
  ) {
    const semanticRequestText = String(options.requestText || "").trim();
    return resolveDomiModelPolicy({
      workflowId,
      runKind: options.runKind,
      useDomiPlugin: options.useDomiPlugin,
      requestText: semanticRequestText,
      domiSlidesDeliveryPolicy: options.useDomiPlugin
        ? options.domiSlidesDeliveryPolicy ?? domiSlidesDeliveryPolicyForText(semanticRequestText)
        : "",
      models: codexStatus?.models,
      userModel: options.model ?? model,
      userReasoningEffort: options.reasoningEffort ?? reasoningEffort,
      userServiceTier: options.serviceTier ?? serviceTier
    });
  }

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
      thread: indexBy(threads, "id").get(threadId)
    })))
    .sort((left, right) => left.submission.createdAt - right.submission.createdAt),
  [queuedSubmissionsByThread, threads]);

  const runningTaskThreads = useMemo(() => threads
    .filter((thread) => Boolean(activeRunsByThread[thread.id]))
    .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0)),
  [activeRunsByThread, threads]);

  const failedTaskThreads = useMemo(() => threads
    .filter((thread) => {
      if (activeRunsByThread[thread.id]) return false;
      const lastAssistant = latestAssistant(thread.messages);
      return lastAssistant?.status === "error";
    })
    .sort((left, right) => (right.lastActiveAt || 0) - (left.lastActiveAt || 0))
    .slice(0, 8),
  [activeRunsByThread, threads]);

  const completedTaskThreads = useMemo(() => threads
    .filter((thread) => {
      if (activeRunsByThread[thread.id] || isUnusedDraftThread(thread)) return false;
      const lastAssistant = latestAssistant(thread.messages);
      return lastAssistant?.status === "done";
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
    + failedTaskThreads.length;

  const weeklyNewsDomains = useMemo(() => normalizeRadarDomains(
    appSettings?.radarFollowedDomains,
    LEGACY_RADAR_DEFAULT_DOMAINS
  ), [appSettings?.radarFollowedDomains]);
  const followedWeeklyNews = useMemo(() => {
    const borrowedFromThisPage = weeklyNewsPage > 0
      ? weeklyNewsBorrowedByPage[weeklyNewsPage - 1]
      : undefined;
    return (weeklyNews?.items || []).filter((item) =>
      item.recordId !== borrowedFromThisPage
        && isFollowedNewsItem(item, weeklyNewsDomains)
    );
  }, [weeklyNews, weeklyNewsBorrowedByPage, weeklyNewsPage]);
  const weeklyNewsSubdomains = useMemo(() => {
    if (weeklyNewsDomain === "全部") return [];
    const counts = new Map<string, number>();
    followedWeeklyNews.forEach((item) => {
      if (!followedDomainsForNews(item, weeklyNewsDomains).includes(weeklyNewsDomain)) return;
      projectSubdomainsForNews(item.subdomains, weeklyNewsDomain).forEach((subdomain) => {
        counts.set(subdomain, (counts.get(subdomain) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) =>
        right.count - left.count || left.name.localeCompare(right.name, "zh-CN")
      );
  }, [followedWeeklyNews, weeklyNewsDomain, weeklyNewsDomains]);
  const visibleWeeklyNews = useMemo(() => followedWeeklyNews
    .filter((item) => weeklyNewsDomain === "全部"
      || newsMatchesTaxonomyFilter(item, weeklyNewsDomain, weeklyNewsDomains, weeklyNewsSubdomain)),
  [followedWeeklyNews, weeklyNewsDomain, weeklyNewsDomains, weeklyNewsSubdomain]);
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
          weeklyNewsDomains,
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
    weeklyNewsDomains,
    weeklyNewsSubdomain,
    weeklyNewsFreshRecordIdSet
  ]);
  const displayedFreshWeeklyNewsCount = displayedWeeklyNews.reduce(
    (count, item) => count + Number(weeklyNewsFreshRecordIdSet.has(item.recordId)),
    0
  );

  const deferredDatabaseQuery = useDeferredValue(databaseQuery);
  const domiSearchResults = useMemo(() => {
    const query = domiQuery.trim().toLocaleLowerCase("zh-CN");
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
  }, [domiQuery, domiSnapshot]);
  const domiSearchOptions = useMemo<DomiSearchOption[]>(() => [
    ...domiSearchResults.projects.map((record) => ({
      key: `project:${record.recordId}`,
      kind: "project" as const,
      record
    })),
    ...domiSearchResults.people.map((record) => ({
      key: `person:${record.recordId}`,
      kind: "person" as const,
      record
    })),
    ...domiDocumentSearch.results.map((record) => ({
      key: `document:${record.path}`,
      kind: "document" as const,
      record
    }))
  ], [domiDocumentSearch.results, domiSearchResults]);
  const domiSearchOptionKeys = useMemo(
    () => domiSearchOptions.map((option) => option.key),
    [domiSearchOptions]
  );
  const domiSearchResolvedActiveKey = validSidebarSearchKey(
    domiSearchOptionKeys,
    domiSearchActiveKey
  );

  useEffect(() => {
    if (domiSearchActiveKey === domiSearchResolvedActiveKey) return;
    setDomiSearchActiveKey(domiSearchResolvedActiveKey);
  }, [domiSearchActiveKey, domiSearchResolvedActiveKey]);

  useEffect(() => {
    if (!domiSearchActiveKey) return;
    domiSearchOptionRefs.current.get(domiSearchActiveKey)?.scrollIntoView({ block: "nearest" });
  }, [domiSearchActiveKey]);

  useEffect(() => {
    const query = domiQuery.trim();
    const requestId = ++domiDocumentSearchRequestRef.current;
    if ([...query].length < 2) {
      setDomiDocumentSearch({
        ok: true,
        results: [],
        indexing: false,
        indexedCount: 0,
        lastIndexedAt: 0
      });
      return;
    }
    setDomiDocumentSearch((current) => ({
      ...current,
      ok: true,
      results: [],
      error: undefined
    }));
    let stopped = false;
    let pollHandle: number | undefined;
    const search = async () => {
      try {
        const result = await workbench.searchDocumentLibrary({ query, limit: 8 });
        if (stopped || requestId !== domiDocumentSearchRequestRef.current) return;
        setDomiDocumentSearch(result);
        if (result.indexing) {
          pollHandle = window.setTimeout(() => {
            void search();
          }, 700);
        }
      } catch (error) {
        if (stopped || requestId !== domiDocumentSearchRequestRef.current) return;
        setDomiDocumentSearch({
          ok: false,
          results: [],
          indexing: false,
          indexedCount: 0,
          lastIndexedAt: 0,
          error: describeOperationError(error, "无法搜索本地文档内容。")
        });
      }
    };
    const debounceHandle = window.setTimeout(() => {
      void search();
    }, 160);
    return () => {
      stopped = true;
      window.clearTimeout(debounceHandle);
      if (pollHandle !== undefined) window.clearTimeout(pollHandle);
    };
  }, [domiQuery]);

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
    : [], [activeThread.messages, activeThread.externalType, hasConversation]);
  const latestVisibleAssistantId = useMemo(
    () => latestAssistant(visibleMessages)?.id,
    [visibleMessages]
  );
  const conversationIndex = useMemo(
    () => indexConversation(timeline, assistantInteractions),
    [timeline, assistantInteractions]
  );

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
    void workbench.listRadarSources().then((snapshot) => {
      if (!cancelled && snapshot.ok) setRadarSourceSnapshot(snapshot);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let receivedLiveStatus = false;
    const unsubscribe = workbench.onUpdateStatus((status) => {
      if (cancelled) return;
      receivedLiveStatus = true;
      setUpdateStatus(status);
    });
    void workbench.getUpdateStatus().then((status) => {
      if (!cancelled && !receivedLiveStatus) setUpdateStatus(status);
    }).catch(() => undefined);
    return () => {
      cancelled = true;
      unsubscribe();
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
        // Repository-backed views do not depend on Codex. Refresh them while
        // the runtime/plugin check is in flight so startup stays useful even
        // when the network is slow.
        const statusPromise = workbench.checkCodex().then((status) => {
          if (!cancelled) setCodexStatus(status);
          return status;
        });
        const dataRefreshPromise = Promise.allSettled([
          refreshDomi(),
          refreshDomiTaskBoard({ silent: Boolean(cachedTasks.tasks.length) }),
          refreshWeeklyNews(0, { silent: hasCachedNews, preserveView: true })
        ]);
        const [status] = await Promise.all([statusPromise, dataRefreshPromise]);
        if (!status.pluginSetup?.ok) {
          const pluginError = status.pluginSetup?.error
            || "domi 插件尚未准备完成，请在 Codex 连接中重新检测。";
          setDomiError(pluginError);
          setDomiTaskError(pluginError);
          setWeeklyNewsError(pluginError);
        }
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
    let cancelled = false;
    workbench.listSkillHub().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setSkillHubLoadError(result.error || "Skill Hub 未能读取本机用户 Skill。");
        return;
      }
      setSkillHubSkills(result.skills);
      setSkillHubLoadError("");
      setSkillHubReady(true);
    }).catch((error) => {
      if (!cancelled) {
        setSkillHubLoadError(error instanceof Error ? error.message : String(error));
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!appSettings || plaudEnabled) return;
    setPlaudSnapshot(null);
    setPlaudError("");
    setPlaudNotice("");
    setPlaudLoading(false);
    setPlaudLoadingMore(false);
    setPlaudSyncing(false);
  }, [plaudEnabled, appSettings]);

  useEffect(() => {
    if (!selectedWorkflow?.requiresPlaud || plaudEnabled) return;
    setSelectedWorkflowId(undefined);
  }, [plaudEnabled, selectedWorkflow?.requiresPlaud]);

  useEffect(() => {
    if (weeklyNewsDomain !== "全部" && !weeklyNewsDomains.some((domain) => domain === weeklyNewsDomain)) {
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
    if (
      !domiTaskSyncQueued
      || runningTaskThreads.length > 0
      || executingSuggestionId
      || !domiTaskBoard?.configured
    ) return;
    setDomiTaskSyncQueued(false);
    void syncManagedTasks({ bypassQueue: true });
  }, [
    domiTaskSyncQueued,
    runningTaskThreads.length,
    executingSuggestionId,
    domiTaskBoard?.configured
  ]);

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
        threadsRef.current = loadedThreads;
        setThreads(loadedThreads);
        activateThreadNow(loadedActiveThreadId);
        setExecutionSuggestionState(state.executionSuggestionState || {});
        todoSyncCheckpointRef.current = state.todoSyncCheckpoint || null;
        setTodoSyncCheckpoint(todoSyncCheckpointRef.current);
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
          executionSuggestionState,
          todoSyncCheckpoint: todoSyncCheckpointRef.current
        },
        threads: changedThreads,
        deletedThreadIds,
        threadOrder: threads.map((thread) => thread.id)
      };
      persistenceQueueRef.current = persistenceQueueRef.current
        .catch(() => undefined)
        .then(() => workbench.saveStatePatch(patch))
        .then((result) => {
          if (result.ok) {
            persistedThreadsRef.current = persistedSnapshot;
            setGlobalPersistenceError((current) => current.startsWith("对话和草稿") ? "" : current);
          } else {
            setGlobalPersistenceError("对话和草稿暂时无法保存；domi 会继续重试，请暂时不要退出。");
          }
        })
        .catch(() => {
          setGlobalPersistenceError("对话和草稿暂时无法保存；domi 会继续重试，请暂时不要退出。");
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [
    activeThreadId,
    domiPluginEnabled,
    executionSuggestionState,
    todoSyncCheckpoint,
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
      const podcastProgress = podcastProgressRunsRef.current.get(payload.runId);
      if (podcastProgress && payload.type === "assistant-delta") {
        podcastProgress.output = payload.output !== undefined
          ? payload.output : `${podcastProgress.output}${payload.text || ""}`;
        consumePodcastProgress(payload.runId, podcastProgress.output);
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
    if (typeof workbench.recoverCodexThread !== "function") {
      setCodexRecoveryReady(true);
      return;
    }
    codexRecoveryStartedRef.current = true;

    const allLocalThreads = threadsRef.current;
    const candidates = allLocalThreads.filter((thread) => {
      const lastAssistant = latestAssistant(thread.messages);
      // Include every unfinished local turn, even when its recovery id is
      // missing. In particular, an isolated turn must fail closed instead of
      // falling back to the source task's canonical Codex conversation.
      return Boolean(
        lastAssistant
        && (lastAssistant.status === "running" || lastAssistant.status === "error")
      );
    });

    const pauseRecoveredThreadQueue = (threadId: string) => {
      const waiting = queuedSubmissionsByThreadRef.current[threadId] || [];
      if (waiting.length === 0) return;
      setPausedQueuedSubmissionIds((current) => {
        const next = new Set(current);
        waiting.forEach((submission) => next.add(submission.id));
        return next;
      });
    };
    const blockRecoveredThread = (thread: Thread, assistant: Message, detail: string) => {
      pauseRecoveredThreadQueue(thread.id);
      patchMessage(assistant.id, {
        content: [
          assistant.content,
          `任务恢复检查失败：${detail || "无法确认上一轮运行状态。"} 为避免重复执行，后续排队任务已暂停，可确认后手动重试。`
        ].filter(Boolean).join("\n\n"),
        status: "error"
      });
      // A legacy error already shown before restart is not a new result.
      if (assistant.status === "running") announceTaskResult(thread.id, assistant.id, "failed");
    };
    const clearRecoveredRun = (threadId: string, runId: string) => {
      if (!runId) return;
      runContextRef.current.delete(runId);
      setActiveRunsByThread((current) => {
        if (!current[threadId] || current[threadId] !== runId) return current;
        const next = { ...current };
        delete next[threadId];
        return next;
      });
    };

    void (async () => {
      for (const thread of candidates) {
        const latestAssistant = [...thread.messages]
          .reverse()
          .find((message) => message.role === "assistant");
        if (!latestAssistant) continue;
        const recoveryThreadId = recoveryCodexThreadId(
          thread.codexThreadId,
          latestAssistant.executionCodexThreadId,
          latestAssistant.entityExecutionIsolated === true
        );
        if (!recoveryThreadId) {
          blockRecoveredThread(
            thread,
            latestAssistant,
            latestAssistant.entityExecutionIsolated
              ? "隔离任务缺少独立的 Codex 对话标识，已拒绝回退到原任务以避免串线。"
              : "任务缺少可恢复的 Codex 对话标识。"
          );
          continue;
        }
        if (thread.quarantinedCodexThreadIds?.includes(recoveryThreadId)) {
          blockRecoveredThread(
            thread,
            latestAssistant,
            "该 Codex 对话已因重复归属被持久隔离，已拒绝自动恢复。"
          );
          continue;
        }
        const recoveryOwners = allLocalThreads.filter((candidate) =>
          candidate.codexThreadId === recoveryThreadId
          || candidate.messages.some((message) =>
            message.role === "assistant"
            && recoveryCodexThreadId(
              undefined,
              message.executionCodexThreadId,
              true
            ) === recoveryThreadId
          )
        );
        if (recoveryOwners.length !== 1) {
          blockRecoveredThread(
            thread,
            latestAssistant,
            `检测到 ${recoveryOwners.length} 个本地任务共用同一个 Codex 对话，已拒绝自动恢复以避免串线。`
          );
          continue;
        }
        // Heal legacy split-context tasks after ownership is proven unique.
        patchThread(thread.id, { codexThreadId: recoveryThreadId });
        let reboundRunId = "";
        try {
          const recoveryRequest = {
            slidesDeliveryPolicy: latestAssistant.slidesDeliveryPolicy
          };
          let result = await workbench.recoverCodexThread(recoveryThreadId, recoveryRequest);
          if (!result.ok) {
            blockRecoveredThread(thread, latestAssistant, result.error || "无法读取上一轮运行状态。");
            continue;
          }

          if (result.status === "running") {
            if (!result.runId) {
              blockRecoveredThread(thread, latestAssistant, "检测到运行中任务，但缺少可恢复的运行标识。");
              continue;
            }
            const recoveredRunId = result.runId;
            reboundRunId = recoveredRunId;
            runContextRef.current.set(recoveredRunId, {
              threadId: thread.id,
              assistantMessageId: latestAssistant.id,
              entityFinalizationMode: latestAssistant.entityFinalizationMode,
              entityExecutionIsolated: latestAssistant.entityExecutionIsolated,
              executionCodexThreadId: recoveryThreadId
            });
            setActiveRunsByThread((current) => ({ ...current, [thread.id]: recoveredRunId }));
            patchMessage(latestAssistant.id, {
              content: result.output || latestAssistant.content,
              status: "running"
            });
            const bound = await workbench.bindCodexRun(recoveredRunId);
            if (bound.ok) {
              reboundRunId = "";
              continue;
            }

            // The run may have finished between the snapshot and bind handshake.
            // Re-read once, then accept only a terminal disposition.
            result = await workbench.recoverCodexThread(recoveryThreadId, recoveryRequest);
            clearRecoveredRun(thread.id, reboundRunId);
            reboundRunId = "";
            if (!result.ok || !["completed", "waiting-input", "stopped", "failed"].includes(result.status)) {
              blockRecoveredThread(
                thread,
                latestAssistant,
                result.error || bound.error || "运行绑定失败且无法确认最终状态。"
              );
              continue;
            }
          }

          if (result.status === "waiting-input") {
            patchMessage(latestAssistant.id, {
              content: result.output || latestAssistant.content,
              status: "done",
              awaitingSlidesInput: true
            });
            pauseRecoveredThreadQueue(thread.id);
            addTimeline(thread.id, {
              runId: result.runId || `recovery-${thread.id}`,
              title: "等待补充 Slides 材料",
              detail: "在当前对话回复即可继续；尚未交付演示文稿",
              kind: "event",
              status: "waiting-input"
            });
            announceTaskResult(thread.id, latestAssistant.id, "waiting-input");
            continue;
          }

          if (result.status === "completed") {
            patchMessage(latestAssistant.id, {
              content: result.output || latestAssistant.content || "Codex 已完成。",
              status: "done"
            });
            patchThread(thread.id, {
              updatedAt: nowLabel(),
              lastActiveAt: Date.now()
            });
            const finalized = await finalizeRecoveredEntityBinding(
              thread,
              latestAssistant,
              result.output || latestAssistant.content
            );
            announceTaskResult(thread.id, latestAssistant.id, finalized.ok ? "completed" : "failed");
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
              lastActiveAt: Date.now()
            });
            addTimeline(thread.id, {
              runId: result.runId || `recovery-${thread.id}`,
              title: "执行已中断",
              detail: "可在当前对话发送“继续”续做",
              kind: "event",
              status: "stopped"
            });
            pauseRecoveredThreadQueue(thread.id);
            announceTaskResult(thread.id, latestAssistant.id, "stopped");
            continue;
          }

          if (result.status === "failed") {
            patchMessage(latestAssistant.id, {
              content: [
                result.output,
                `执行失败：${result.error || "Codex 未返回明确失败原因。"}`
              ].filter(Boolean).join("\n\n"),
              status: "error"
            });
            pauseRecoveredThreadQueue(thread.id);
            if (latestAssistant.status === "running") announceTaskResult(thread.id, latestAssistant.id, "failed");
            continue;
          }

          blockRecoveredThread(thread, latestAssistant, `无法识别运行状态：${result.status || "unknown"}。`);
        } catch (error) {
          clearRecoveredRun(thread.id, reboundRunId);
          blockRecoveredThread(
            thread,
            latestAssistant,
            error instanceof Error ? error.message : String(error)
          );
        }
      }
      // The persistent queue may run only after every candidate has reached a
      // bound-running, finalized-completed, paused-terminal or blocked state.
      setCodexRecoveryReady(true);
    })();
  }, [storageReady]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        QUEUED_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify(queuedSubmissionsByThread)
      );
    } catch {
      // Queue remains available for the current session if local persistence is unavailable.
    }
  }, [queuedSubmissionsByThread]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PAUSED_QUEUED_SUBMISSIONS_STORAGE_KEY,
        JSON.stringify([...pausedQueuedSubmissionIds])
      );
    } catch {
      // Paused state remains available for the current session.
    }
  }, [pausedQueuedSubmissionIds]);

  useEffect(() => {
    if (!storageReady || !codexRecoveryReady || !appSettings) return;
    const currentRepositoryIdentity = queueRepositoryIdentity(appSettings);
    for (const [threadId, queue] of Object.entries(queuedSubmissionsByThread)) {
      if (queue.length === 0 || activeRunsByThread[threadId]) continue;
      if (queueStartingThreadIdsRef.current.has(threadId)) continue;
      if (submissionStartingThreadIdsRef.current.has(threadId)) continue;
      if ([...runContextRef.current.values()].some((context) => context.threadId === threadId)) continue;

      const targetThread = indexBy(threads, "id").get(threadId);
      if (!targetThread) {
        setPausedQueuedSubmissionIds((current) => {
          const next = new Set(current);
          queue.forEach((submission) => next.add(submission.id));
          return next;
        });
        continue;
      }

      const queued = queue[0];
      if (
        !queued.repositoryIdentity
        || queued.repositoryIdentity !== currentRepositoryIdentity
      ) {
        setPausedQueuedSubmissionIds((current) => {
          if (current.has(queued.id)) return current;
          return new Set(current).add(queued.id);
        });
        continue;
      }
      if (pausedQueuedSubmissionIds.has(queued.id)) continue;
      const queuedUserSkill = queued.workflowId?.startsWith("user-skill:");
      // A restored user-Skill task must wait for the persisted Skill Hub
      // registry. Treating an unresolved id as a generic task would silently
      // drop the user's selected Skill and produce the wrong deliverable.
      if (queuedUserSkill && !skillHubReady) continue;
      const workflow = indexBy(allWorkflows, "id").get(queued.workflowId || "");
      if (queuedUserSkill && !workflow) {
        setThreadAttachmentError(
          threadId,
          `用户 Skill“${queued.workflowId}”当前不可用；该排队任务已暂停，请在 Skill Hub 重新导入后重试。`
        );
        setPausedQueuedSubmissionIds((current) => new Set(current).add(queued.id));
        continue;
      }
      let accepted = false;
      let acceptedSubmission = queued;
      void submitToCodex(workflow, queued.input, {
        thread: targetThread,
        useDomiPlugin: queued.useDomiPlugin,
        displayText: queued.displayText,
        workflowContinuation: queued.workflowContinuation,
        resumeCodexThreadId: queued.resumeCodexThreadId,
        privateCodexContinuation: queued.privateCodexContinuation,
        attachments: queued.attachments,
        activeDocumentPath: queued.activeDocumentPath,
        requestOrigin: queued.requestOrigin === "user" ? "user" : "programmatic",
        userInstructionText: queued.requestOrigin === "user"
          ? queued.userInstructionText || ""
          : "",
        model: queued.model,
        reasoningEffort: queued.reasoningEffort,
        serviceTier: queued.serviceTier,
        preserveComposer: true,
        queuedSubmission: queued,
        onAccepted: (routedSubmission) => {
          accepted = true;
          acceptedSubmission = routedSubmission || queued;
          setQueuedSubmissionsByThread((current) => {
            const remaining = (current[threadId] || []).filter((item) => item.id !== queued.id);
            const next = remaining.length > 0
              ? { ...current, [threadId]: remaining }
              : { ...current };
            if (remaining.length === 0) delete next[threadId];
            queuedSubmissionsByThreadRef.current = next;
            return next;
          });
          setPausedQueuedSubmissionIds((current) => {
            if (!current.has(queued.id)) return current;
            const next = new Set(current);
            next.delete(queued.id);
            return next;
          });
        }
      }).then((result) => {
        if (!accepted && result && "queued" in result && result.queued) {
          // Same-thread/same-target race: submitToCodex intentionally retained
          // the item until the active run releases this queue.
          return;
        }
        if (!accepted || !result?.ok || result.stopped) {
          if (accepted) {
            setQueuedSubmissionsByThread((current) => {
              const retryThreadId = acceptedSubmission.threadId;
              const existing = current[retryThreadId] || [];
              if (existing.some((item) => item.id === acceptedSubmission.id)) return current;
              const next = {
                ...current,
                [retryThreadId]: [acceptedSubmission, ...existing]
              };
              queuedSubmissionsByThreadRef.current = next;
              return next;
            });
          }
          setPausedQueuedSubmissionIds((current) => new Set(current).add(acceptedSubmission.id));
        }
      }).catch(() => {
        if (accepted) {
          setQueuedSubmissionsByThread((current) => {
            const retryThreadId = acceptedSubmission.threadId;
            const existing = current[retryThreadId] || [];
            if (existing.some((item) => item.id === acceptedSubmission.id)) return current;
            const next = {
              ...current,
              [retryThreadId]: [acceptedSubmission, ...existing]
            };
            queuedSubmissionsByThreadRef.current = next;
            return next;
          });
        }
        setPausedQueuedSubmissionIds((current) => new Set(current).add(acceptedSubmission.id));
      });
    }
  }, [
    activeRunsByThread,
    allWorkflows,
    appSettings,
    codexRecoveryReady,
    pausedQueuedSubmissionIds,
    queuedSubmissionsByThread,
    skillHubReady,
    storageReady,
    threads
  ]);

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
    if (storageReady) clearVisibleThreadCompletion();
  }, [activeThreadId, activeThread.hasUnreadCompletion, workspaceView, storageReady]);

  const unreadTasks = unreadTaskCount(threads);
  useEffect(() => {
    if (!storageReady) return;
    // Count the complete accessible task list, including search/pagination-hidden rows.
    void workbench.setUnreadTaskCount(unreadTasks).catch(() => undefined);
  }, [storageReady, unreadTasks]);

  useEffect(() => {
    if (!storageReady || taskNotificationSendingRef.current || !pendingTaskNotifications.length) return;
    const pending = pendingTaskNotifications[0];
    taskNotificationSendingRef.current = true;
    void (async () => {
      // Save the per-turn receipt before IPC. Main also durably deduplicates this ID.
      await persistWorkbenchStateNow();
      const thread = threadsRef.current.find((item) => item.id === pending.threadId);
      const message = thread?.messages.find((item) => item.id === pending.messageId);
      if (!thread || !message || !thread.hasUnreadCompletion || message.taskNotificationRead
        || isThreadActivelyVisible(thread.id)) return;
      const content = taskNotificationContent(pending.outcome, thread.title);
      if (content) await workbench.showNotification({
        ...content,
        threadId: thread.id,
        notificationId: pending.notificationId
      });
    })().catch((error) => {
      workbench.reportRendererIssue({
        kind: "codex-run",
        message: `系统提醒未能显示：${error instanceof Error ? error.message : String(error)}`
      });
    }).finally(() => {
      taskNotificationSendingRef.current = false;
      setPendingTaskNotifications((current) => current.filter((item) => item.notificationId !== pending.notificationId));
    });
  }, [pendingTaskNotifications, storageReady]);

  useEffect(() => {
    if (!storageReady) return;
    let disposed = false;
    const openTarget = async (target: { threadId: string; notificationId?: string } | null) => {
      if (!target || disposed || !threadsRef.current.some((thread) => thread.id === target.threadId)) return;
      // selectThread preserves unsaved documents. An obstructed navigation keeps the red dot.
      const opened = await navigateTaskNotification(
        target, clickedTaskNotificationIdsRef.current, openingTaskNotificationIdsRef.current,
        () => selectThread(target.threadId)
      );
      if (!opened || disposed) return;
      window.requestAnimationFrame(() => {
        if (disposed || activeThreadIdRef.current !== target.threadId) return;
        composerRef.current?.focus();
        clearVisibleThreadCompletion();
      });
    };
    const unsubscribe = workbench.onNotificationClicked((target) => {
      void workbench.consumePendingNotification()
        .then((pending) => openTarget(pending || target))
        .catch(() => openTarget(target));
    });
    void workbench.consumePendingNotification().then(openTarget).catch(() => undefined);
    return () => { disposed = true; unsubscribe(); };
  }, [storageReady]);

  useLayoutEffect(() => {
    workspaceViewRef.current = workspaceView;
    restoreWorkspaceUiState(workspaceView);
    return () => captureWorkspaceUiState(workspaceView, { preserveRightPanel: true });
  }, [workspaceView]);

  useEffect(() => {
    workspaceUiStateRef.current[workspaceView].rightPanelOpen = rightPanelOpen;
  }, [rightPanelOpen, workspaceView]);

  useEffect(() => {
    const handleFocus = () => {
      windowFocusedRef.current = true;
      window.requestAnimationFrame(clearVisibleThreadCompletion);
    };
    const handleBlur = () => {
      windowFocusedRef.current = false;
    };
    const handleFocusIn = (event: FocusEvent) => {
      const target = event.target;
      documentPanelFocusedRef.current = target instanceof Element
        && Boolean(target.closest(".right-panel.document-panel, .document-library-content"));
      if (!documentPanelFocusedRef.current) clearVisibleThreadCompletion();
    };
    const handleFocusOut = () => {
      window.requestAnimationFrame(() => {
        const active = document.activeElement;
        documentPanelFocusedRef.current = active instanceof Element
          && Boolean(active.closest(".right-panel.document-panel, .document-library-content"));
        if (!documentPanelFocusedRef.current) clearVisibleThreadCompletion();
      });
    };
    const handleVisibilityChange = () => {
      windowFocusedRef.current = document.visibilityState === "visible" && document.hasFocus();
      clearVisibleThreadCompletion();
    };
    window.addEventListener("focus", handleFocus);
    window.addEventListener("blur", handleBlur);
    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("focus", handleFocus);
      window.removeEventListener("blur", handleBlur);
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          COMPOSER_DRAFTS_STORAGE_KEY,
          JSON.stringify(composerDraftsByThread)
        );
      } catch {
        setGlobalPersistenceError("输入草稿暂时无法保存；请不要关闭 domi，并稍后重试。");
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [composerDraftsByThread]);

  useEffect(() => {
    if (typeof workbench.onPrepareClose !== "function") return;
    return workbench.onPrepareClose(async () => flushClientStateRef.current());
  }, []);

  useEffect(() => {
    if (workspaceView === "data") return;
    setDatabaseExpandedCell(null);
    setDatabaseRowContextMenu(null);
    setClassificationCreateDialog(null);
    if (databaseAutoSaveQueuedRef.current || databaseAutoSaveInFlightRef.current) {
      void flushDatabaseAutoSave();
    }
  }, [workspaceView]);

  useEffect(() => {
    if (!markdownDocument) return;
    const handleSaveShortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveOpenMarkdown();
      }
    };
    window.addEventListener("keydown", handleSaveShortcut);
    return () => window.removeEventListener("keydown", handleSaveShortcut);
  }, [markdownDocument, markdownDraft]);

  useEffect(() => {
    if (
      !markdownDocument
      || markdownDraft === markdownDocument.content
      || markdownRenaming
    ) {
      return;
    }
    scheduleMarkdownAutoSave();
    return clearMarkdownAutoSaveTimer;
  }, [
    markdownDocument?.path,
    markdownDocument?.content,
    markdownDraft,
    markdownRenaming
  ]);

  useEffect(() => () => clearMarkdownAutoSaveTimer(), []);

  useEffect(() => () => {
    if (databaseAutoSaveTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveTimerRef.current);
    }
    if (databaseAutoSaveRetryTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveRetryTimerRef.current);
    }
  }, []);

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

  async function flushDatabaseAutoSaveAndWait(timeoutMs = 7_000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (databaseAutoSaveInFlightRef.current && Date.now() < deadline) {
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    if (databaseAutoSaveInFlightRef.current) return false;
    if (!databaseAutoSaveQueuedRef.current) return true;
    return flushDatabaseAutoSave();
  }

  async function selectDatabaseRecord(
    entityType: DatabaseEntityType,
    recordId: string,
    snapshot = databaseSnapshot
  ): Promise<boolean> {
    const switchingRecord = databaseDraftRef.current
      && (
        databaseDraftRef.current.entityType !== entityType
        || databaseDraftRef.current.recordId !== recordId
      );
    if (switchingRecord && !await flushDatabaseAutoSaveAndWait()) {
      setDatabaseError("上一条记录尚未安全保存，已保留当前编辑内容并阻止切换。");
      return false;
    }
    const record = databaseRecords(snapshot, entityType)
      .find((item) => item.recordId === recordId);
    setDatabaseEntityType(entityType);
    setDatabaseSelectedId(record?.recordId || "");
    setDatabaseDraft(record ? databaseDraftForRecord(entityType, record) : null);
    setDatabaseExpandedCell(null);
    setDatabaseError("");
    setDatabaseNotice("");
    return true;
  }

  async function beginDatabaseRecordEdit(
    entityType: DatabaseEntityType,
    recordId: string,
    snapshot = databaseSnapshot
  ): Promise<boolean> {
    if (!await selectDatabaseRecord(entityType, recordId, snapshot)) return false;
    setDatabaseEditingId(recordId);
    return true;
  }

  async function beginDatabaseCellEdit(
    entityType: DatabaseEntityType,
    recordId: string,
    cell: HTMLTableCellElement
  ): Promise<boolean> {
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
    if (!alreadyEditing && !await beginDatabaseRecordEdit(entityType, recordId)) {
      return false;
    }
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
      return true;
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
    return true;
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
    void beginDatabaseCellEdit(draft.entityType, draft.recordId, cell);
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
      void beginDatabaseCellEdit(entityType, recordId, editableCell);
      return;
    }
    void selectDatabaseRecord(entityType, recordId);
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

  function setClassificationDraftFromReview(review?: DomiClassificationReview) {
    if (!review) {
      setClassificationSelectedId("");
      setClassificationDomain("");
      setClassificationSubdomains("");
      return;
    }
    const currentDomain = review.project.domain && !["_未分类", "未分类"].includes(review.project.domain)
      ? review.project.domain
      : "";
    const currentSubdomains = review.project.subdomains.filter((item) =>
      !["_未分类", "未分类"].includes(item)
    );
    setClassificationSelectedId(review.project.recordId);
    setClassificationDomain(currentDomain || review.suggestedDomain || "");
    setClassificationSubdomains(
      (currentSubdomains.length ? currentSubdomains : review.suggestedSubdomains).join("、")
    );
  }

  function refreshDatabase(options: { preserveSelection?: boolean } = {}) {
    if (databaseRefreshInFlightRef.current) return databaseRefreshInFlightRef.current;
    const request = (async (): Promise<DomiDatabaseSnapshot | null> => {
      let loadingStarted = false;
      try {
        if (!await flushDatabaseAutoSaveAndWait()) {
          setDatabaseError("当前资料库修改尚未安全保存，刷新已取消并保留草稿。");
          return null;
        }
        setDatabaseLoading(true);
        loadingStarted = true;
        setDatabaseError("");
        const result = await workbench.listDomiDatabase({ fresh: true });
        setDatabaseSnapshot(result);
        if (!result.ok) {
          setDatabaseError(result.error || "资料库读取失败。");
          return result;
        }
        const currentEntityType = databaseEntityTypeRef.current;
        const records = databaseRecords(result, currentEntityType);
        const preferredId = options.preserveSelection ? databaseSelectedIdRef.current : "";
        const selected = records.find((item) => item.recordId === preferredId) || records[0];
        setDatabaseSelectedId(selected?.recordId || "");
        setDatabaseEditingId("");
        setDatabaseExpandedCell(null);
        setDatabaseVisibleLimit(100);
        setDatabaseDraft(
          selected ? databaseDraftForRecord(currentEntityType, selected) : null
        );
        const reviews = result.classificationReviews || [];
        const preferredReviewId = options.preserveSelection
          ? classificationSelectedIdRef.current
          : "";
        const selectedReview = reviews.find((item) => item.project.recordId === preferredReviewId)
          || reviews[0];
        setClassificationDraftFromReview(selectedReview);
        return result;
      } catch (error) {
        setDatabaseError(error instanceof Error ? error.message : String(error));
        return null;
      } finally {
        if (loadingStarted) setDatabaseLoading(false);
      }
    })();
    databaseRefreshInFlightRef.current = request;
    const clearRequest = () => {
      if (databaseRefreshInFlightRef.current === request) {
        databaseRefreshInFlightRef.current = null;
      }
    };
    void request.then(clearRequest, clearRequest);
    return request;
  }

  async function switchDatabaseEntity(entityType: DatabaseEntityType) {
    if (!await flushDatabaseAutoSaveAndWait()) {
      setDatabaseError("当前资料库修改尚未安全保存，已阻止切换。");
      return;
    }
    const records = databaseRecords(databaseSnapshot, entityType);
    const selected = records[0];
    setDatabaseWorkspaceTab(entityType);
    setDatabaseEntityType(entityType);
    setDatabaseQuery("");
    setDatabaseFilterKey("none");
    setDatabaseFilterValue("全部");
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

  async function switchDatabaseClassification() {
    if (!await flushDatabaseAutoSaveAndWait()) {
      setDatabaseError("当前资料库修改尚未安全保存，已阻止切换。");
      return;
    }
    const reviews = databaseSnapshot?.classificationReviews || [];
    const selected = reviews.find((item) => item.project.recordId === classificationSelectedId)
      || reviews[0];
    setDatabaseWorkspaceTab("classification");
    setDatabaseEditingId("");
    setDatabaseExpandedCell(null);
    setDatabaseError("");
    setDatabaseNotice("");
    setClassificationDraftFromReview(selected);
  }

  async function mutateProjectClassification(
    action: "apply" | "defer" | "undo",
    createSubdomain?: { name: string; parentDomain: string; subdomains?: string[] }
  ) {
    const reviews = databaseSnapshot?.classificationReviews || [];
    const review = reviews.find((item) => item.project.recordId === classificationSelectedId);
    const undo = classificationUndo;
    const recordId = action === "undo" ? undo?.recordId : review?.project.recordId;
    const expectedUpdatedAt = action === "undo"
      ? undo?.expectedUpdatedAt
      : Number(review?.project.updatedAt);
    const stableExpectedUpdatedAt = Number(expectedUpdatedAt);
    if (!recordId || !Number.isFinite(stableExpectedUpdatedAt)) {
      setDatabaseError(action === "undo" ? "没有可以撤销的分类操作。" : "请先选择一个待审核项目。");
      return;
    }

    const subdomains = createSubdomain?.subdomains || splitDatabaseList(classificationSubdomains);
    if (action === "apply") {
      if (!classificationDomain) {
        setDatabaseError("请先选择正式一级领域。");
        return;
      }
      const allowed = databaseSnapshot?.taxonomy?.domains
        .find((item) => item.name === classificationDomain)?.subdomains || [];
      const unknown = subdomains.find((item) =>
        !allowed.some((candidate) => candidate.localeCompare(item, "zh-CN", { sensitivity: "base" }) === 0)
      );
      if (unknown && !createSubdomain) {
        setClassificationCreateDialog({
          recordId,
          name: unknown,
          parentDomain: classificationDomain
        });
        return;
      }
    }

    setClassificationSaving(true);
    setDatabaseError("");
    setDatabaseNotice("");
    try {
      const result = await workbench.classifyDomiDatabaseProject({
        action,
        recordId,
        expectedUpdatedAt: stableExpectedUpdatedAt,
        domain: classificationDomain,
        subdomains,
        createSubdomainName: createSubdomain?.name,
        createSubdomainParentDomain: createSubdomain?.parentDomain
      });
      if (!result.ok) {
        setDatabaseError(result.error || "分类操作失败。");
        return;
      }
      if (action === "apply" && result.record) {
        setClassificationUndo({
          recordId: result.record.recordId,
          expectedUpdatedAt: Number(result.record.updatedAt) || Number(result.updatedAt) || Date.now(),
          projectName: result.record.name
        });
        setDatabaseNotice(
          `已确认“${result.record.name}”的正式分类，并同步更新 SQLite、项目主页与资料目录。`
        );
      } else if (action === "defer") {
        setDatabaseNotice("已暂缓该项目；材料与建议保留在分类审核台中。");
      } else {
        setClassificationUndo(null);
        setDatabaseNotice("已撤销上一次分类，项目已回到分类审核台。");
      }
      setClassificationCreateDialog(null);
      await refreshDatabase({ preserveSelection: action !== "apply" });
      setDatabaseWorkspaceTab("classification");
    } catch (error) {
      setDatabaseError(error instanceof Error ? error.message : String(error));
    } finally {
      setClassificationSaving(false);
    }
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
    if (databaseAutoSaveRetryTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveRetryTimerRef.current);
      databaseAutoSaveRetryTimerRef.current = null;
    }
    if (databaseAutoSaveTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveTimerRef.current);
    }
    databaseAutoSaveTimerRef.current = window.setTimeout(() => {
      databaseAutoSaveTimerRef.current = null;
      void flushDatabaseAutoSave();
    }, delay);
  }

  function queueDatabaseAutoSaveRetry(draft: DatabaseDraft, message: string) {
    const queued = databaseAutoSaveQueuedRef.current;
    databaseAutoSaveQueuedRef.current = queued?.entityType === draft.entityType
      && queued.recordId === draft.recordId
      ? queued
      : draft;
    const retryIndex = Math.min(
      databaseAutoSaveRetryRef.current,
      DATABASE_SAVE_RETRY_DELAYS_MS.length - 1
    );
    databaseAutoSaveRetryRef.current = Math.min(
      retryIndex + 1,
      DATABASE_SAVE_RETRY_DELAYS_MS.length - 1
    );
    const delay = DATABASE_SAVE_RETRY_DELAYS_MS[retryIndex];
    if (databaseAutoSaveRetryTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveRetryTimerRef.current);
    }
    databaseAutoSaveRetryTimerRef.current = window.setTimeout(() => {
      databaseAutoSaveRetryTimerRef.current = null;
      void flushDatabaseAutoSave();
    }, delay);
    setDatabaseError(`${message} domi 将在后台自动重试。`);
    setGlobalPersistenceError(
      `资料库修改尚未保存，已保留草稿并将在 ${Math.ceil(delay / 1_000)} 秒后重试。`
    );
  }

  async function flushDatabaseAutoSave(): Promise<boolean> {
    if (databaseAutoSaveRetryTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveRetryTimerRef.current);
      databaseAutoSaveRetryTimerRef.current = null;
    }
    if (databaseAutoSaveTimerRef.current !== null) {
      window.clearTimeout(databaseAutoSaveTimerRef.current);
      databaseAutoSaveTimerRef.current = null;
    }
    if (databaseAutoSaveInFlightRef.current) return false;
    const draft = databaseAutoSaveQueuedRef.current;
    if (!draft) return true;
    databaseAutoSaveQueuedRef.current = null;
    databaseAutoSaveInFlightRef.current = true;
    let retryScheduled = false;
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
        retryScheduled = true;
        queueDatabaseAutoSaveRetry(draft, result.error || "资料库记录保存失败。");
        return false;
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
      databaseAutoSaveRetryRef.current = 0;
      setGlobalPersistenceError((current) => current.startsWith("资料库修改") ? "" : current);
      if (draft.entityType === "news") {
        void refreshWeeklyNews(weeklyNewsPage, { silent: true });
      }
      return true;
    } catch (error) {
      retryScheduled = true;
      queueDatabaseAutoSaveRetry(
        draft,
        error instanceof Error ? error.message : String(error)
      );
      return false;
    } finally {
      databaseAutoSaveInFlightRef.current = false;
      setDatabaseSaving(false);
      if (databaseAutoSaveQueuedRef.current && !retryScheduled) {
        scheduleDatabaseAutoSave(databaseAutoSaveQueuedRef.current, 180);
      }
    }
  }

  async function patchDatabaseGridRecord<T extends DomiProject | DomiPerson | DomiNewsItem>(
    entityType: DatabaseEntityType,
    record: T,
    patch: Partial<T>,
    _context: DatabasePatchContext<T>
  ): Promise<T> {
    const key = databaseRecordKey(entityType, record.recordId);
    const prior = databasePatchQueuesRef.current.get(key) || Promise.resolve();
    let resolveRecord!: (value: T) => void;
    let rejectRecord!: (reason?: unknown) => void;
    const resultPromise = new Promise<T>((resolve, reject) => {
      resolveRecord = resolve;
      rejectRecord = reject;
    });

    const operation = prior.catch(() => undefined).then(async () => {
      const current = (databaseCanonicalRecordsRef.current.get(key) || record) as T;
      const changes = Object.fromEntries(
        Object.entries(patch).filter(([, value]) => value !== undefined)
      );
      if (!Object.keys(changes).length) {
        resolveRecord(current);
        return;
      }
      const request = {
        entityType,
        recordId: current.recordId,
        expectedUpdatedAt: Number(current.updatedAt) || 0,
        mutationId: databaseMutationId(entityType, current.recordId),
        changes
      } as DomiDatabasePatchRequest;

      databaseGridSaveCountRef.current += 1;
      setDatabaseSaving(true);
      try {
        const result = await workbench.updateDomiDatabaseRecordPatch(request);
        if (!result.ok || !result.record) {
          throw new Error(result.error || "资料库字段保存失败，请重试。");
        }
        const saved = result.record as T;
        databaseCanonicalRecordsRef.current.set(key, saved);
        setDatabaseSnapshot((snapshot) =>
          replaceDatabaseSnapshotRecord(snapshot, entityType, saved)
        );
        if (result.snapshot) setDomiSnapshot(result.snapshot);
        if (
          databaseDraftRef.current?.entityType === entityType
          && databaseDraftRef.current.recordId === saved.recordId
        ) {
          const nextDraft = databaseDraftForRecord(entityType, saved);
          databaseDraftRef.current = nextDraft;
          setDatabaseDraft(nextDraft);
        }
        setDatabaseSelectedId(saved.recordId);
        setDatabaseError("");
        if (entityType === "news") {
          void refreshWeeklyNews(weeklyNewsPage, { silent: true });
        }
        resolveRecord(saved);
      } catch (error) {
        rejectRecord(error);
      } finally {
        databaseGridSaveCountRef.current = Math.max(0, databaseGridSaveCountRef.current - 1);
        if (databaseGridSaveCountRef.current === 0) setDatabaseSaving(false);
      }
    });
    const tail = operation.then(() => undefined, () => undefined);
    databasePatchQueuesRef.current.set(key, tail);
    void tail.finally(() => {
      if (databasePatchQueuesRef.current.get(key) === tail) {
        databasePatchQueuesRef.current.delete(key);
      }
    });
    return resultPromise;
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
          ? `已从投资档案移除“${target.title}”；本地原始文件仍保留。`
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
          && isFollowedNewsItem(item, weeklyNewsDomains)
      );
      let continuation: DomiNewsItem | null = null;

      if (result.ok && result.hasOlder && eligibleItems.length % 2 === 1) {
        try {
          const olderResult = await workbench.listWeeklyNews({ days: 7, limit: 100, page: resultPage + 1 });
          continuation = (olderResult.items || []).find((item) =>
            isFollowedNewsItem(item, weeklyNewsDomains)
          ) || null;
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
    const radarDomainsSnapshot = normalizeRadarDomains(
      appSettingsRef.current?.radarFollowedDomains,
      LEGACY_RADAR_DEFAULT_DOMAINS
    );
    if (!radarDomainsSnapshot.length) {
      setWeeklyNewsNotice("行业雷达已暂停：请先在“关注领域”中至少选择一个领域");
      return { status: "skipped" };
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
    const checkpointsByDomain = currentWeeklyNews?.radarCheckedThroughByDomain || {};
    const selectedCheckpoints = radarDomainsSnapshot
      .map((domain) => Number(checkpointsByDomain[domain]) || 0)
      .filter((checkpoint) => checkpoint > 0);
    const lastRadarCheckpoint = selectedCheckpoints.length === radarDomainsSnapshot.length
      ? Math.min(...selectedCheckpoints)
      : 0;
    const { discoveryFrom, checkedAfter } = radarDiscoveryWindow(now, lastRadarCheckpoint);
    const priorityPeopleContext = radarPriorityPeopleContext(domiSnapshot?.people || []);
    const configuredSourceLines = (radarSourceSnapshot?.sources || [])
      .filter((source) => source.enabled && source.kind !== "podcast")
      .map((source) => {
        const typeLabel = source.kind === "wechat" ? "重点公众号" : "优先新闻源";
        const keywords = source.keywords.length ? `；关注：${source.keywords.join("、")}` : "";
        const address = source.url ? `；${source.url}` : "";
        return `- ${typeLabel}：${source.name}${address}${keywords}`;
      });
    let discoveryContext = "";
    if (configuredSourceLines.length) {
      setWeeklyNewsScanStage("正在读取已配置新闻信源的候选索引");
      try {
        const discovered = await workbench.syncRadarSources({ kind: "news", limit: 50 });
        discoveryContext = newsDiscoveryContext(discovered.discovery);
        if (discovered.sources) setRadarSourceSnapshot({
          ok: discovered.ok || Boolean(discovered.partial), sources: discovered.sources,
          jobs: discovered.jobs, updatedAt: discovered.updatedAt,
          discovery: discovered.discovery, error: discovered.error
        });
        if (!discoveryContext) discoveryContext = "程序抓取未返回候选；按原规则逐个尝试已配置新闻信源，不能因此省略搜索或计作已覆盖。";
      } catch {
        discoveryContext = "程序抓取暂时失败；继续按原规则搜索补查已配置新闻信源，失败范围如实记入覆盖结果。";
      }
    }
    const requestText = [
      radarWorkflow.defaultPrompt,
      discoveryContext,
      `followed_domains=${JSON.stringify(radarDomainsSnapshot)}`,
      `本轮设置修订快照只包含以上 ${radarDomainsSnapshot.length} 个关注领域；不得搜索、返回、归档或通知其他领域。`,
      radarTaxonomyPrompt(radarDomainsSnapshot),
      configuredSourceLines.length
        ? `用户在本机配置了以下重点信源。本轮优先检查并交叉核验，但仍需遵守来源可信度、时效性和去重规则：\n${configuredSourceLines.join("\n")}`
        : "用户尚未配置自定义重点信源，按默认公开来源执行。",
      `覆盖硬约束：每个 followed_domains 领域至少完成 1 组明确针对该领域的检索；不得用同一条泛化查询为未出现的领域记完成。DeepTech 深科技必须尝试定向扫源；${configuredSourceLines.length ? `本轮 ${configuredSourceLines.length} 个已启用重点信源必须逐个尝试` : "本轮没有已启用重点信源"}。未完成的领域或信源必须如实写入 coverage，禁止推进其水位。`,
      "RADAR_RESULT 必须额外包含 coverage：{\"searched_domains\":[规范领域],\"queries_by_domain\":{\"规范领域\":非负整数},\"deeptech_checked\":true|false,\"configured_sources_attempted\":非负整数,\"configured_sources_failed\":非负整数}。searched_domains 只能列出真正完成至少一组领域检索的领域；检索失败或未执行时不得列入。",
      `各领域上次成功水位：${JSON.stringify(Object.fromEntries(radarDomainsSnapshot.map((domain) => [domain, checkpointsByDomain[domain] ? new Date(checkpointsByDomain[domain]).toISOString() : null])))}。`,
      `本轮统一发现窗口起点：${new Date(discoveryFrom).toISOString()}；最早有效检查水位：${checkedAfter ? new Date(checkedAfter).toISOString() : "无"}；本轮检查截止：${new Date(now).toISOString()}。`,
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
              && isFollowedNewsItem(item, weeklyNewsDomains)
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
      const runModelPolicy = resolveRunModelPolicy(radarWorkflow.id);
      const result = await workbench.runCodex({
        runId,
        prompt: workflowPrompt(radarWorkflow, requestText, priorityPeopleContext, true, "programmatic"),
        requestText,
        requestOrigin: "programmatic",
        userInstructionText: "",
        ephemeral: true,
        background: automatic,
        allowUserInput: false,
        workflowId: radarWorkflow.id,
        webSearch: true,
        model: runModelPolicy.model,
        reasoningEffort: runModelPolicy.reasoningEffort,
        serviceTier: runModelPolicy.serviceTier,
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
            && isFollowedNewsItem(item, weeklyNewsDomains)
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
      const parsedRadarResult = parseRadarResult(
        result.output,
        radarDomainsSnapshot,
        configuredSourceLines.length
      );
      let checkpointWarning = "";
      if (parsedRadarResult?.checkedThrough && parsedRadarResult.checkpointDomains.length) {
        const checkpointResult = await workbench.saveWeeklyNewsCheckpoint({
          checkedThrough: parsedRadarResult.checkedThrough,
          domains: parsedRadarResult.checkpointDomains
        });
        if (checkpointResult.ok && checkpointResult.radarCheckedThrough) {
          if (weeklyNewsLatestSnapshotRef.current) {
            weeklyNewsLatestSnapshotRef.current = {
              ...weeklyNewsLatestSnapshotRef.current,
              radarCheckedThrough: checkpointResult.radarCheckedThrough,
              radarCheckedThroughByDomain: checkpointResult.radarCheckedThroughByDomain
            };
          }
          setWeeklyNews((current) => current
            ? {
              ...current,
              radarCheckedThrough: checkpointResult.radarCheckedThrough,
              radarCheckedThroughByDomain: checkpointResult.radarCheckedThroughByDomain
            }
            : current);
        } else {
          checkpointWarning = "；检索水位保存失败，下次仍会回看最近 72 小时";
        }
        if (parsedRadarResult.incompleteDomains.length) {
          checkpointWarning += `；${parsedRadarResult.incompleteDomains.join("、")}未完成，本轮未推进这些领域的水位`;
        }
        const sourceCoverageIssues = parsedRadarResult.coverageIssues.filter((issue) =>
          !issue.startsWith("未完整检索：")
        );
        if (sourceCoverageIssues.length) {
          checkpointWarning += `；${sourceCoverageIssues.join("；")}`;
        }
      } else if (parsedRadarResult?.checkedThrough) {
        checkpointWarning = `；覆盖记录未通过校验，所有领域均未推进水位${parsedRadarResult.coverageIssues.length ? `（${parsedRadarResult.coverageIssues.join("；")}）` : ""}`;
      } else {
        checkpointWarning = "；本轮未返回可验证的覆盖记录和检索水位，下次仍会回看最近 72 小时";
      }
      const refreshed = await readLatestWithRetry();
      if (!refreshed?.ok) return { status: "failed" };
      const latestItems = (refreshed.items || []).filter((item) =>
        isFollowedNewsItem(item, weeklyNewsDomains)
      );
      const addedItems = hasLatestBaseline
        ? latestItems.filter((item) => !knownRecordIds.has(item.recordId))
        : [];
      setWeeklyNewsFreshRecordIds(addedItems.map((item) => item.recordId));
      const completedAt = new Intl.DateTimeFormat("zh-CN", {
        hour: "2-digit",
        minute: "2-digit"
      }).format(Date.now());
      const rejectionSummary = parsedRadarResult
        ? radarRejectionSummary(parsedRadarResult)
        : "";
      const candidateSummary = parsedRadarResult?.candidates
        ? `；发现候选 ${parsedRadarResult.candidates} 条${rejectionSummary ? `（${rejectionSummary}）` : ""}`
        : "";
      const incompleteCoverage = Boolean(
        !parsedRadarResult
        || parsedRadarResult.incompleteDomains.length
        || !parsedRadarResult.checkpointDomains.length
      );
      setWeeklyNewsNotice(
        hasLatestBaseline
          ? addedItems.length > 0
            ? `${completedAt} 更新完成：新增 ${addedItems.length} 条，已置顶显示${checkpointWarning}`
            : incompleteCoverage
              ? `${completedAt} 本轮检索未完整完成${candidateSummary}${checkpointWarning}`
              : `${completedAt} 扫描完成${candidateSummary}，没有达到收录门槛的新动态${checkpointWarning}`
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

  function consumePodcastProgress(runId: string, output: string) {
    const progress = podcastProgressRunsRef.current.get(runId);
    if (!progress) return;
    for (const request of podcastProgressRequests(output, progress.jobId, runId)) {
      const key = JSON.stringify(request);
      if (progress.seen.has(key)) continue;
      progress.seen.add(key);
      progress.pending = progress.pending.then(async () => {
        const updated = await workbench.updatePodcastProgress(request);
        if (!updated.ok) { progress.error = updated.error; return; }
        if (updated.job) setRadarSourceSnapshot((current) => current ? {
          ...current, jobs: current.jobs.map((job) => job.id === updated.job!.id ? updated.job! : job)
        } : current);
        if (request.action === "complete" && updated.verified) progress.verified = true;
      }).catch((error) => { progress.error = error instanceof Error ? error.message : String(error); });
    }
  }

  async function archivePodcastTranscript(
    job: PodcastJob,
    result: PodcastProcessResult
  ): Promise<boolean> {
    const transcriptPath = result.transcriptPath || result.job?.transcriptPath || job.transcriptPath;
    if (!transcriptPath) throw new Error("PLAUD 已完成，但没有返回可读取的文字稿路径。");
    if (podcastArchiveRunIdsRef.current.has(job.id)) return false;
    const routerWorkflow = indexBy(workflows, "id").get("domi-router");
    if (!routerWorkflow) throw new Error("未找到 domi 播客归档工作流。");
    podcastArchiveRunIdsRef.current.add(job.id);
    let archiveRunId = createId("podcast-archive");
    let claimed = false;
    const durable = appSettingsRef.current?.storageBackend === "local";
    try {
      let progressContract = "";
      if (durable) {
        const claim = await workbench.updatePodcastProgress({ jobId: job.id, action: "claim", runId: archiveRunId });
        if (!claim.ok) throw new Error(claim.error || "无法安全恢复播客归档进度。");
        if (claim.verified && claim.job?.archive?.status === "archived") return true;
        if (!claim.claimed) return false;
        claimed = true;
        job = claim.job || job;
        archiveRunId = job.archive?.runId || archiveRunId;
        progressContract = podcastWorkflowContract(job, archiveRunId);
        podcastProgressRunsRef.current.set(archiveRunId, {
          jobId: job.id, output: "", seen: new Set(), pending: Promise.resolve(), verified: false
        });
      }
      const normalizedEpisodeText = `${job.title} ${job.description}`
        .toLocaleLowerCase("zh-CN")
        .replace(/\s+/g, "");
      const matchedProjects = (domiSnapshotRef.current?.projects || []).filter((project) => {
        const normalizedName = project.name.toLocaleLowerCase("zh-CN").replace(/\s+/g, "");
        return normalizedName.length >= 2 && normalizedEpisodeText.includes(normalizedName);
      });
      const projectHint = matchedProjects.length === 1 ? matchedProjects[0] : null;
      const primaryArchiveHint = projectHint ? "project_dominant" : "industry_dominant";
      const canonicalDocumentId = `podcast:${job.sourceFormat || "public"}:${job.id}`;
      const requestText = [
        progressContract,
        "处理一条已经由用户自己的 PLAUD 完成转写的公开播客。不要调用本地 ASR，不要重新下载音频，也不要创建临时任务工作区或 outputs 目录。",
        `sourceKind=podcast`,
        `transcriptProvider=plaud`,
        `transcriptPath=${transcriptPath}`,
        `sourceId=${job.sourceId}`,
        `provider=${job.sourceFormat || "public-web-page"}`,
        `episodeId=${job.id}`,
        `episodeUrl=${job.episodeUrl}`,
        `podcastName=${job.podcastTitle || ""}`,
        `episodeTitle=${job.title}`,
        `publishedAt=${job.publishedAt ? new Date(job.publishedAt).toISOString() : ""}`,
        `description=${job.description || ""}`,
        `canonicalDocumentId=${canonicalDocumentId}`,
        `primaryArchiveHint=${primaryArchiveHint}`,
        projectHint
          ? `唯一明确项目匹配：${projectHint.name}（recordId=${projectHint.recordId}）。若正文证据一致，将主文档归入该项目的“纪要”，原始 PLAUD 文字稿归入“原始材料”。`
          : "标题和简介未唯一匹配项目库中的单一公司；按行业趋势材料归档到对应行业研究/播客目录。若正文明确由唯一公司创始人或高管主讲，再按规则校正。",
        "先用 asr-notes 把转写错误校正为准确结果，删去校验过程和低信息量废话；再用 investment-mgmt 完成唯一主归档。其他相关项目、人脉和行业入口仅保存 URI 与摘要引用，不复制第二份正文。",
        "若正文证据与 primaryArchiveHint 冲突且仍无法确定，不要猜测写入错误目录：进入分类待审核，并在最终结果中明确返回待审核原因。"
      ].join("\n");

      const runModelPolicy = resolveRunModelPolicy(routerWorkflow.id, { runKind: "podcast-archive" });
      const archiveResult = await workbench.runCodex({
        runId: archiveRunId,
        prompt: workflowPrompt(routerWorkflow, requestText, "播客处理必须使用 PLAUD 文字稿，并遵守唯一主归档规则。", true, "programmatic"),
        requestText, requestOrigin: "programmatic", userInstructionText: "",
        ephemeral: true, background: true, allowUserInput: false,
        workflowId: routerWorkflow.id, webSearch: true,
        model: runModelPolicy.model, reasoningEffort: runModelPolicy.reasoningEffort,
        serviceTier: runModelPolicy.serviceTier,
        workspacePath: appSettingsRef.current?.localRepositoryDir || codexStatus?.workspacePath || activeThread.workspacePath
      });
      const progress = podcastProgressRunsRef.current.get(archiveRunId);
      if (progress) {
        await progress.pending;
        if (!progress.verified) {
          progress.seen.clear();
          consumePodcastProgress(archiveRunId, archiveResult.output || progress.output);
          await progress.pending;
        }
        if (!progress.verified) {
          // A completed manifest may survive even when the final marker was lost.
          const recovered = await workbench.updatePodcastProgress({ jobId: job.id, action: "complete", runId: archiveRunId });
          progress.verified = Boolean(recovered.ok && recovered.verified);
          if (!progress.verified) throw new Error(recovered.error || progress.error || "纪要已保留，唯一归档的真实回执尚未通过；稍后从检查点继续。");
        }
      } else if (!archiveResult.ok) {
        throw new Error(archiveResult.error || "播客纪要整理或归档失败。");
      }
      // The durable receipt is authoritative; a transient view refresh must not
      // turn an already committed archive into a failed job.
      const refreshed = await Promise.allSettled([
        refreshDomi(), refreshDocumentLibrary({ silent: true, force: true }), workbench.listRadarSources()
      ]);
      const sourceRefresh = refreshed[2];
      if (sourceRefresh.status === "fulfilled" && sourceRefresh.value.ok) setRadarSourceSnapshot(sourceRefresh.value);
      return true;
    } catch (error) {
      if (claimed) await workbench.updatePodcastProgress({
        jobId: job.id, action: "fail", runId: archiveRunId,
        error: error instanceof Error ? error.message : String(error)
      }).catch(() => undefined);
      throw error;
    } finally {
      podcastProgressRunsRef.current.delete(archiveRunId);
      podcastArchiveRunIdsRef.current.delete(job.id);
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

  function openRadarDomainManager() {
    setRadarDomainDraft([...weeklyNewsDomains]);
    setRadarDomainManagerOpen(true);
  }

  function toggleRadarDomainDraft(domain: RadarDomain) {
    setRadarDomainDraft((current) => current.includes(domain)
      ? current.filter((item) => item !== domain)
      : RADAR_DOMAIN_ORDER.filter((item) => item === domain || current.includes(item))
    );
  }

  async function saveRadarDomainPreferences() {
    if (radarDomainSaving) return;
    setRadarDomainSaving(true);
    setWeeklyNewsError("");
    const normalized = normalizeRadarDomains(radarDomainDraft, []);
    try {
      const result = await saveAppSettings({ radarFollowedDomains: normalized });
      if (!result.ok) {
        setWeeklyNewsError(result.error || "关注领域保存失败。 ");
        return;
      }
      setRadarDomainManagerOpen(false);
      setWeeklyNewsNotice(normalized.length
        ? `已关注 ${normalized.join("、")}；下一轮 Radar 按新范围搜集`
        : "已暂停行业雷达；历史动态仍保留");
    } finally {
      setRadarDomainSaving(false);
    }
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
          && isFollowedNewsItem(item, weeklyNewsDomains)
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
      if (!normalizeRadarDomains(
        appSettingsRef.current.radarFollowedDomains,
        LEGACY_RADAR_DEFAULT_DOMAINS
      ).length) {
        updateWeeklyNewsAutomation({
          phase: "idle",
          nextRadarAt: Date.now() + WEEKLY_NEWS_RADAR_INTERVAL_MS,
          retryAttempt: 0
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

  useEffect(() => {
    if (
      !hasNativeWorkbench
      || !appSettings?.onboardingComplete
      || appSettings.plaudConnectionMode !== "enabled"
    ) return;
    let disposed = false;

    const runPodcastSourceTick = async () => {
      if (
        disposed
        || podcastSourceAutomationRef.current
        || runContextRef.current.size > 0
      ) return;
      podcastSourceAutomationRef.current = true;
      try {
        let synced: RadarSourceSyncResult | undefined;
        let discoveryError = "";
        try {
          synced = await workbench.syncRadarSources({ kind: "podcast", limit: 10 });
          discoveryError = synced.error || (!synced.ok ? "部分播客信源更新失败，已保留可恢复任务。" : "");
        } catch (error) {
          discoveryError = error instanceof Error ? error.message : String(error);
        }
        if (disposed) return;
        const discoveryReliable = Boolean(synced?.ok || synced?.partial);
        const cached = radarSourceSnapshotRef.current;
        const nextSnapshot: RadarSourceSnapshot = {
          ok: discoveryReliable,
          sources: synced?.sources?.length || discoveryReliable ? synced!.sources : cached?.sources || [],
          jobs: synced?.jobs?.length || discoveryReliable ? synced!.jobs : cached?.jobs || [],
          updatedAt: synced?.updatedAt || cached?.updatedAt || 0,
          error: discoveryError
        };
        setRadarSourceSnapshot(nextSnapshot);
        if (discoveryError) setPlaudError(`播客信源更新：${discoveryError}`);
        const nextJob = podcastAutomationJob(nextSnapshot, Date.now(),
          appSettingsRef.current?.storageBackend === "local", discoveryReliable);
        if (!nextJob) return;

        const processed: PodcastProcessResult = nextJob.transcriptPath
          ? { ok: true, reused: true, job: nextJob, transcriptPath: nextJob.transcriptPath }
          : await workbench.processPodcastEpisode({ jobId: nextJob.id });
        if (!processed.ok || !processed.job) {
          setPlaudError(processed.error || `“${nextJob.title}”没有成功交给 PLAUD。`);
          return;
        }
        const archived = await archivePodcastTranscript(processed.job, processed);
        if (archived && !document.hasFocus()) {
          await workbench.showNotification({
            title: "domi 已整理一条播客",
            body: processed.job.title
          });
        }
      } catch (automationError) {
        setPlaudError(automationError instanceof Error ? automationError.message : String(automationError));
      } finally {
        podcastSourceAutomationRef.current = false;
      }
    };

    const startupTimer = window.setTimeout(() => void runPodcastSourceTick(), 30_000);
    const interval = window.setInterval(() => void runPodcastSourceTick(), 30 * 60_000);
    return () => {
      disposed = true;
      window.clearTimeout(startupTimer);
      window.clearInterval(interval);
    };
  }, [appSettings?.onboardingComplete, appSettings?.plaudConnectionMode]);

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
          setPlaudSnapshot((current) => {
            if (result.lastSuccessfulSnapshot) {
              return {
                ...result.lastSuccessfulSnapshot,
                stale: true,
                remoteStatus: result.remoteStatus,
                retryable: result.retryable,
                warning: result.warning
              };
            }
            if (!result.ok && current) {
              return {
                ...current,
                stale: true,
                remoteStatus: result.remoteStatus,
                retryable: result.retryable,
                warning: result.warning || result.error
              };
            }
            return result;
          });
          if (!result.ok) {
            setPlaudError(result.error || result.warning || "PLAUD 队列同步失败。 ");
            setPlaudNotice("");
          } else if (result.stale) {
            setPlaudError(result.warning || "PLAUD 暂时无法刷新，已显示上次成功读取的录音。");
            setPlaudNotice("");
          } else {
            setPlaudError("");
            setPlaudNotice((current) =>
              current.startsWith("PLAUD 暂时无法刷新") ? "" : current
            );
          }
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
        if (!result.ok || result.stale) {
          setPlaudSnapshot((current) => current
            ? {
                ...current,
                stale: true,
                remoteStatus: result.remoteStatus,
                retryable: result.retryable,
                warning: result.warning || result.error
              }
            : current);
          setPlaudError(result.error || result.warning || "更早的 PLAUD 录音读取失败。 ");
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

  async function syncPlaudQueue(): Promise<DomiPlaudSyncResult | null> {
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
        const result = await workbench.syncPlaud();
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
          projectName: NEW_THREAD_PROJECT
        });
        targetThread = {
          id: createId("thread"),
          projectId,
          plaudFileId: item.fileId,
          workspacePath: workspaceResult.ok ? workspaceResult.workspacePath : codexStatus?.workspacePath,
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
        // Programmatic submission follows immediately in this same tick. Make
        // the new owner visible to fail-closed submission checks before React
        // commits the state update.
        threadsRef.current = [
          targetThread as Thread,
          ...threadsRef.current.filter((thread) => thread.id !== targetThread!.id)
        ];
        setThreads((current) => [
          targetThread as Thread,
          ...current.filter((thread) => thread.id !== targetThread!.id)
        ]);
      } else if (targetThread.plaudFileId !== item.fileId) {
        targetThread = { ...targetThread, plaudFileId: item.fileId };
        patchThread(targetThread.id, { plaudFileId: item.fileId });
      }

      const targetAlreadyRunning = Boolean(activeRunsByThread[targetThread.id])
        || [...runContextRef.current.values()].some((context) => context.threadId === targetThread.id);
      if (targetAlreadyRunning) {
        setPlaudNotice(`“${item.fileName}”的纪要入库任务正在执行`);
        return;
      }

      activateThreadNow(targetThread.id);
      setDomiPluginEnabled(true);
      setPlaudNotice(`已启动“${item.fileName}”的 domi 纪要入库任务`);
      const execution = submitToCodex(workflow, plaudNotesWorkflowRequest(item), {
        thread: targetThread,
        useDomiPlugin: true,
        activeDocumentPath: undefined,
        requestOrigin: "programmatic",
        userInstructionText: "",
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
    const approved = await requestConfirmation({
      title: "将这条 PLAUD 录音移入回收站？",
      message: `“${item.fileName}”将从 PLAUD 最近录音列表中移除。`,
      detail: "domi 本地已生成的文字稿和纪要不会删除。",
      confirmLabel: "移入回收站",
      tone: "danger"
    });
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
    const dataConnectionChanged = requestChangesDataConnection(request);
    if (
      dataConnectionChanged
      && (
        submissionStartingThreadIdsRef.current.size > 0
        || queueStartingThreadIdsRef.current.size > 0
        || runContextRef.current.size > 0
        || settlingThreadIdsRef.current.size > 0
        || Object.values(activeRunsByThreadRef.current).some(Boolean)
      )
    ) {
      return {
        ok: false,
        error: "当前仍有任务正在发送、运行或归档。请等待任务完成后再修改资料连接。"
      };
    }
    const result = await workbench.saveSettings(request);
    if (result.ok && result.settings) {
      setAppSettings(result.settings);
      if (result.codex) setCodexStatus(result.codex);
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
        // A snapshot is scoped to the repository that produced it. Clear both
        // the state and synchronous ref before starting the new sync so a send
        // in the same event loop cannot combine new settings with old records.
        domiSnapshotRef.current = null;
        setDomiSnapshot(null);
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
      if (synced.snapshot) {
        domiSnapshotRef.current = synced.snapshot;
        setDomiSnapshot(synced.snapshot);
      }
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

  async function refreshCodex(verifiedStatus?: CodexCheckResult) {
    const status = verifiedStatus || await workbench.checkCodex();
    setCodexStatus(status);
  }

  async function chooseWorkflow(workflow: Workflow) {
    if (!await navigateWorkspace("conversation")) return;
    // Explicitly selecting an official Skill opts into its plugin and QA.
    if (workflow.skill.startsWith("$domi:")) setDomiPluginEnabled(true);
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
    if (!await navigateWorkspace("conversation")) return false;

    setExecutingSuggestionId(suggestion.id);
    setExecutionSuggestionError("");
    try {
      const threadId = createId("thread");
      const projectId = createId("execution");
      const entityWorkspacePath = suggestion.externalType && suggestion.externalRecordId
        ? await resolveDomiEntityWorkspacePath(
            suggestion.externalType,
            suggestion.externalRecordId
          )
        : undefined;
      const runtimeWorkspace = entityWorkspacePath
        ? null
        : await workbench.createProjectWorkspace({
            projectId,
            projectName: NEW_THREAD_PROJECT
          });
      const nextThread: Thread = {
        id: threadId,
        projectId,
        workspacePath: entityWorkspacePath
          || (runtimeWorkspace?.ok ? runtimeWorkspace.workspacePath : codexStatus?.workspacePath),
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

      // submitToCodex runs below before React necessarily flushes setThreads.
      // Register the source synchronously so existence checks cannot mistake
      // this valid programmatic task for a deleted one.
      threadsRef.current = [
        nextThread,
        ...threadsRef.current.filter((thread) => thread.id !== nextThread.id)
      ];
      setThreads((current) => [
        nextThread,
        ...current.filter((thread) => thread.id !== nextThread.id)
      ]);
      activateThreadNow(nextThread.id);
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
        attachments: [],
        activeDocumentPath: undefined,
        requestOrigin: "programmatic",
        userInstructionText: ""
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

  async function syncManagedTasks(options: { bypassQueue?: boolean } = {}) {
    if (executingSuggestionId) return;
    const foregroundRunCount = Object.keys(activeRunsByThread).length;
    if (!options.bypassQueue && foregroundRunCount > 0) {
      setDomiTaskSyncQueued(true);
      setDomiTaskError("");
      setDomiTaskSyncState({
        phase: "waiting",
        label: `等待 ${foregroundRunCount} 个前台任务完成后自动同步`,
        startedAt: null,
        completedAt: null,
        candidateCount: 0
      });
      return;
    }
    const todoWorkflow = workflows.find((workflow) => workflow.id === "task");
    if (!todoWorkflow) {
      setDomiTaskError("未找到 domi 待办事项工作流。");
      return;
    }
    const requestText = todoWorkflow.defaultPrompt || `更新 ${todoDocumentLabel}。`;
    const runId = createId("todo-sync");
    let timeoutHandle: number | undefined;
    let ledgerPollHandle: number | undefined;
    let postWriteGraceHandle: number | undefined;
    let ledgerPollingActive = true;
    const startedAt = Date.now();
    const repositoryIdentity = queueRepositoryIdentity(appSettingsRef.current);
    const localBackend = appSettingsRef.current?.storageBackend === "local";
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
    setDomiTaskSyncQueued(false);
    setExecutingSuggestionId("managed-refresh");
    setDomiTaskError("");
    updateSyncPhase("refreshing", "正在刷新项目与人脉资料");
    try {
      const synced = await workbench.syncDomi();
      const currentSnapshot = synced.snapshot || domiSnapshot;
      const [baselineBoard, newsRevision] = await Promise.all([
        workbench.listDomiTasks({ fresh: true }),
        workbench.listWeeklyNews({ days: 7, limit: 1 })
          .catch(() => ({ ok: false } as DomiWeeklyNewsSnapshot))
      ]);
      if (baselineBoard.ok) setDomiTaskBoard(baselineBoard);
      if (synced.snapshot) setDomiSnapshot(synced.snapshot);
      if (!synced.ok && !currentSnapshot) {
        throw new Error(synced.error || "资料库刷新失败，暂时无法生成待办事项。");
      }
      candidateCount = recentTodoCandidateCount(currentSnapshot);
      const inputFingerprint = currentSnapshot
        ? await todoInputFingerprint(currentSnapshot, baselineBoard, newsRevision, repositoryIdentity)
        : "";
      if (localBackend && canSkipTodoSync(todoSyncCheckpointRef.current, {
        fingerprint: inputFingerprint, repositoryIdentity, now: Date.now(),
        snapshotFresh: synced.ok && !synced.stale && Boolean(synced.snapshot),
        board: baselineBoard, news: newsRevision
      })) {
        outcome = "skipped";
        updateSyncPhase("completed", "资料与待办未变化，已复用最近一次验证结果");
        return;
      }
      const checkpointVerifiedBoard = async (board: DomiTaskBoardSnapshot) => {
        if (!localBackend || !currentSnapshot || !synced.ok || synced.stale
          || !board.documentSha256 || !newsRevision.ok || newsRevision.cacheMiss || newsRevision.stale
          || !Number.isFinite(newsRevision.contentUpdatedAt) || !newsRevision.contentUpdatedAt
          || repositoryIdentity !== queueRepositoryIdentity(appSettingsRef.current)) return;
        const verifiedAt = Date.now();
        // A run crossing a date/cooldown boundary has not necessarily evaluated
        // that new state. Keep its result, but require another evaluation.
        const nextEvaluationAt = Math.min(
          nextTodoEvaluationAt(currentSnapshot, baselineBoard.tasks, startedAt),
          nextTodoEvaluationAt(currentSnapshot, board.tasks, startedAt)
        );
        if (nextEvaluationAt <= verifiedAt) return;
        const checkpoint: TodoSyncCheckpoint = {
          fingerprint: await todoInputFingerprint(currentSnapshot, board, newsRevision, repositoryIdentity),
          ruleVersion: TODO_RULE_VERSION, repositoryIdentity, verifiedAt,
          nextEvaluationAt,
          ledgerFingerprint: board.documentSha256
        };
        todoSyncCheckpointRef.current = checkpoint;
        setTodoSyncCheckpoint(checkpoint);
      };
      updateSyncPhase(
        "preparing",
        candidateCount
          ? `已发现 ${candidateCount} 个近 4 周新入库候选`
          : "正在整理关键节点与长期跟进候选"
      );
      const recentEntriesContext = todoRecentEntriesContext(
        currentSnapshot?.projects,
        currentSnapshot?.people,
        startedAt
      ) + "\n" + todoRunContract(runId, baselineBoard.ledgerSha256);
      updateSyncPhase("generating", "Todo Skill 正在排序并维护待办事项文档");
      const runModelPolicy = resolveRunModelPolicy(todoWorkflow.id);
      const runPromise = workbench.runCodex({
          runId,
          prompt: workflowPrompt(todoWorkflow, requestText, recentEntriesContext, true, "programmatic"),
          requestText,
          requestOrigin: "programmatic",
          userInstructionText: "",
          ephemeral: true,
          background: true,
          allowUserInput: false,
          workflowId: todoWorkflow.id,
          model: runModelPolicy.model,
          reasoningEffort: runModelPolicy.reasoningEffort,
          serviceTier: runModelPolicy.serviceTier,
          workspacePath: activeThread.workspacePath
        });
      const isFreshLedger = (snapshot: DomiTaskBoardSnapshot | null) => {
        return Boolean(localBackend && snapshot
          && verifiedTodoReceipt(snapshot.syncReceipt, runId, snapshot));
      };
      const ledgerWritePromise = new Promise<{
        kind: "ledger";
        snapshot: DomiTaskBoardSnapshot;
      }>((resolve) => {
        const poll = async () => {
          try {
            const snapshot = await workbench.listDomiTasks({ fresh: true });
            if (isFreshLedger(snapshot)) {
              ledgerPollingActive = false;
              resolve({ kind: "ledger", snapshot });
              return;
            }
          } catch {
            // The final read or hard timeout will surface a persistent backend error.
          }
          if (ledgerPollingActive) {
            ledgerPollHandle = window.setTimeout(poll, TODO_SYNC_LEDGER_POLL_MS);
          }
        };
        ledgerPollHandle = window.setTimeout(poll, TODO_SYNC_LEDGER_POLL_MS);
      });
      const resultOrTimeout = await Promise.race([
        runPromise.then((result) => ({ kind: "run" as const, result })),
        ledgerWritePromise,
        new Promise<{ kind: "timeout" }>((resolve) => {
          timeoutHandle = window.setTimeout(() => {
            resolve({ kind: "timeout" });
          }, TODO_SYNC_TIMEOUT_MS);
        })
      ]);
      ledgerPollingActive = false;
      if (resultOrTimeout.kind === "ledger") {
        if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
        if (ledgerPollHandle !== undefined) window.clearTimeout(ledgerPollHandle);
        setDomiTaskBoard(resultOrTimeout.snapshot);
        updateSyncPhase("reading", "文档已写入，正在完成最后验证");
        const completionAfterWrite = await Promise.race([
          runPromise.then((result) => ({ completed: true as const, result })),
          new Promise<{ completed: false }>((resolve) => {
            postWriteGraceHandle = window.setTimeout(
              () => resolve({ completed: false }),
              TODO_SYNC_POST_WRITE_GRACE_MS
            );
          })
        ]);
        if (postWriteGraceHandle !== undefined) window.clearTimeout(postWriteGraceHandle);
        if (!completionAfterWrite.completed) {
          await workbench.stopCodex(runId);
        }
        const verified = await refreshDomiTaskBoard({ fresh: true });
        if (!isFreshLedger(verified)) {
          throw new Error("待办事项文档已写入，但最终回读验证失败。");
        }
        await checkpointVerifiedBoard(verified!);
        outcome = "completed";
        updateSyncPhase("completed", `同步完成，已核验 ${candidateCount} 个新入库候选`);
        return;
      }
      if (resultOrTimeout.kind === "timeout") {
        updateSyncPhase("stopping", "运行超过 8 分钟，正在安全停止并保留已写入内容");
        const stopResult = await workbench.stopCodex(runId);
        updateSyncPhase("reading", "正在回读待办事项文档");
        const recovered = await refreshDomiTaskBoard({ silent: true, fresh: true });
        boardRefreshedAfterFailure = true;
        if (isFreshLedger(recovered)) {
          await checkpointVerifiedBoard(recovered!);
          outcome = "completed";
          setDomiTaskError("");
          updateSyncPhase("completed", `同步完成，已核验 ${candidateCount} 个新入库候选`);
          return;
        }
        throw new Error(stopResult.ok
          ? "后台待办事项同步超过 8 分钟，已安全停止；看板已回读最新文档内容。"
          : `后台待办事项同步超过 8 分钟，但停止确认失败：${stopResult.error || "未知错误"}`);
      }
      const result = resultOrTimeout.result;
      if (result.stopped || !result.ok) {
        // A connection can end after the atomic write but before its final
        // response. Recover the persisted receipt without a second model run.
        const recovered = localBackend
          ? await refreshDomiTaskBoard({ silent: true, fresh: true }) : null;
        if (localBackend) boardRefreshedAfterFailure = true;
        if (isFreshLedger(recovered)) {
          await checkpointVerifiedBoard(recovered!);
          outcome = "completed";
          updateSyncPhase("completed", `同步完成，已核验 ${candidateCount} 个新入库候选`);
          return;
        }
        throw new Error(result.stopped
          ? "后台待办事项同步已暂停，Codex 连接维护完成后可重新同步。"
          : result.error || "待办事项后台同步失败。");
      }
      updateSyncPhase("reading", "写入完成，正在验证并刷新看板");
      const verified = await refreshDomiTaskBoard({ fresh: true });
      if (!verified?.ok || verified.stale) throw new Error("待办事项最终回读失败，已保留当前结果等待重试。");
      if (localBackend && !verifiedTodoReceipt(verified.syncReceipt || parseTodoReceipt(result.output || ""), runId, verified)) {
        // Missing/malformed model output never turns a touched file into success.
        // The backend's persistent receipt lets a later retry verify without a write.
        throw new Error("待办事项已回读，但缺少匹配本轮与文件哈希的真实回执；已保留结果，可重试验证。");
      }
      await checkpointVerifiedBoard(verified);
      outcome = "completed";
      updateSyncPhase("completed", `同步完成，已核验 ${candidateCount} 个新入库候选`);
    } catch (error) {
      if (!boardRefreshedAfterFailure) {
        await refreshDomiTaskBoard({ silent: true, fresh: true });
      }
      setDomiTaskError(error instanceof Error ? error.message : String(error));
      updateSyncPhase("failed", "本轮同步未完整完成，当前看板保留最近一次有效内容");
    } finally {
      ledgerPollingActive = false;
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle);
      if (ledgerPollHandle !== undefined) window.clearTimeout(ledgerPollHandle);
      if (postWriteGraceHandle !== undefined) window.clearTimeout(postWriteGraceHandle);
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

  async function resolveDomiEntityWorkspacePath(
    entityType: "project" | "person",
    recordId: string,
    snapshot: DomiSnapshot | null = domiSnapshot
  ) {
    if (snapshot?.backend !== "local") return undefined;
    const result = await workbench.loadDomiEntityWorkspace({
      entityType,
      recordId,
      repairMissing: true
    });
    if (result.snapshot) {
      domiSnapshotRef.current = result.snapshot;
      setDomiSnapshot(result.snapshot);
    }
    return result.ok ? result.workspacePath : undefined;
  }

  async function recoverBoundEntityWorkspaceForSubmission(
    thread: Thread,
    execution: SubmissionExecutionContext,
    snapshot: DomiSnapshot | null
  ): Promise<{
    thread: Thread;
    execution: SubmissionExecutionContext;
    snapshot: DomiSnapshot | null;
  }> {
    const entityType = execution.externalType;
    const recordId = String(execution.externalRecordId || "").trim();
    if (
      execution.isolated
      || appSettingsRef.current?.storageBackend !== "local"
      || !entityType
      || !recordId
    ) {
      return { thread, execution, snapshot };
    }

    const resolved = await workbench.loadDomiEntityWorkspace({
      entityType,
      recordId,
      repairMissing: true
    });
    const nextSnapshot = resolved.snapshot || snapshot;
    if (resolved.snapshot) {
      domiSnapshotRef.current = resolved.snapshot;
      setDomiSnapshot(resolved.snapshot);
    }
    if (!resolved.ok || !resolved.workspacePath) {
      throw new Error(
        resolved.error
          || "当前项目或人物没有唯一且可访问的本地目录；本次消息尚未发送。"
      );
    }

    const nextThread = thread.workspacePath === resolved.workspacePath
      ? thread
      : { ...thread, workspacePath: resolved.workspacePath };
    if (nextThread !== thread) {
      patchThread(thread.id, { workspacePath: resolved.workspacePath });
    }
    return {
      thread: nextThread,
      execution: { ...execution, workspacePath: resolved.workspacePath },
      snapshot: nextSnapshot
    };
  }

  function cancelPendingDomiEntityOpen() {
    domiEntityOpenRequestRef.current += 1;
    setDocumentLibraryNotice("");
  }

  function clearDomiEntitySearch(cancelPendingOpen = true) {
    if (cancelPendingOpen) cancelPendingDomiEntityOpen();
    setDomiQuery("");
    setDomiSearchError("");
    setDomiSearchActiveKey("");
  }

  function openDomiSearchOption(option: DomiSearchOption) {
    if (option.kind === "project") {
      void openDomiProject(option.record);
      return;
    }
    if (option.kind === "person") {
      void openDomiPerson(option.record);
      return;
    }
    void openDomiDocumentSearchResult(option.record);
  }

  async function openDomiDocumentSearchResult(result: DocumentLibrarySearchMatch) {
    const sourceQuery = domiQuery.trim();
    cancelPendingDomiEntityOpen();
    setDomiSearchError("");
    if (!await navigateWorkspace("documents", true)) return;
    setDocumentLibrarySidebarExpanded(true);
    setThreadMenuId(null);
    setRightPanelOpen(false);
    setDocumentLibraryQuery("");
    setDocumentLibrarySearchActivePath("");
    let library = documentLibrary;
    let expansionPath = library
      ? documentLibraryExpansionPath(library.nodes, result.path)
      : null;
    if (!library || expansionPath === null) {
      library = await refreshDocumentLibrary({ silent: Boolean(library) });
      expansionPath = library
        ? documentLibraryExpansionPath(library.nodes, result.path)
        : null;
    }
    if (workspaceViewRef.current !== "documents") return;
    if (expansionPath) {
      setDocumentLibraryExpandedPaths((current) => {
        const next = new Set(current);
        expansionPath.forEach((folderPath) => next.add(folderPath));
        return next;
      });
      const separatorIndex = Math.max(result.path.lastIndexOf("/"), result.path.lastIndexOf("\\"));
      if (separatorIndex > 0) setDocumentLibrarySelectedFolder(result.path.slice(0, separatorIndex));
    }
    clearDomiEntitySearch(false);
    openDocument(result.path, sourceQuery);
    scrollDocumentLibrarySearchSelectionIntoView(result.path);
  }

  function handleDomiSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (
      domiSearchComposingRef.current
      || event.nativeEvent.isComposing
      || event.keyCode === 229
    ) return;

    if (event.key === "Escape") {
      if (!domiQuery) return;
      event.preventDefault();
      event.stopPropagation();
      clearDomiEntitySearch();
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!domiSearchOptions.length) return;
      event.preventDefault();
      event.stopPropagation();
      setDomiSearchActiveKey(nextSidebarSearchKey(
        domiSearchOptionKeys,
        domiSearchResolvedActiveKey,
        event.key === "ArrowDown" ? "next" : "previous"
      ));
      return;
    }

    if (event.key !== "Enter") return;
    const activeOption = domiSearchOptions.find(
      (option) => option.key === domiSearchResolvedActiveKey
    )
      || domiSearchOptions[0];
    if (!activeOption) return;
    event.preventDefault();
    event.stopPropagation();
    openDomiSearchOption(activeOption);
  }

  function localPathFromDocumentResource(resource: string) {
    const value = String(resource || "").trim();
    if (value.startsWith("/")) return value;
    try {
      const url = new URL(value);
      return url.protocol === "file:" ? decodeURIComponent(url.pathname) : "";
    } catch {
      return "";
    }
  }

  async function openDomiEntityDocuments(
    entityType: "project" | "person",
    entity: DomiProject | DomiPerson
  ) {
    const requestId = ++domiEntityOpenRequestRef.current;
    setDomiSearchError("");
    setDocumentLibraryNotice("");
    if (appSettingsRef.current?.storageBackend === "feishu") {
      if (!entity.link) {
        const message = `“${entity.name}”尚未关联可打开的资料主页。`;
        setDomiError(message);
        setDomiSearchError(message);
        return;
      }
      const opened = await workbench.openResource(entity.link);
      if (requestId !== domiEntityOpenRequestRef.current) return;
      if (!opened.ok) {
        const message = opened.error || `无法打开“${entity.name}”的飞书资料主页。`;
        setDomiError(message);
        setDomiSearchError(message);
        return;
      }
      clearDomiEntitySearch(false);
      return;
    }
    if (!await navigateWorkspace("documents", true)) return;
    if (requestId !== domiEntityOpenRequestRef.current) return;

    setDocumentLibrarySidebarExpanded(true);
    setThreadMenuId(null);
    setRightPanelOpen(false);
    setDocumentLibraryQuery("");
    setDocumentLibrarySearchActivePath("");
    setDocumentLibraryError("");

    const resolved = await workbench.loadDomiEntityWorkspace({
      entityType,
      recordId: entity.recordId,
      repairMissing: true
    });
    if (
      requestId !== domiEntityOpenRequestRef.current
      || workspaceViewRef.current !== "documents"
    ) return;
    if (resolved.snapshot) {
      domiSnapshotRef.current = resolved.snapshot;
      setDomiSnapshot(resolved.snapshot);
    }
    if (!resolved.ok || !resolved.workspacePath) {
      const message = resolved.error || `无法定位“${entity.name}”唯一且可访问的资料目录。`;
      setDocumentLibraryError(message);
      setDomiSearchError(message);
      return;
    }

    const latestEntity = entityType === "project"
      ? resolved.snapshot?.projects.find((item) => item.recordId === entity.recordId)
      : resolved.snapshot?.people.find((item) => item.recordId === entity.recordId);
    const indexedDocumentPath = localPathFromDocumentResource(latestEntity?.link || entity.link);
    let homepageResource = entityPrimaryDocumentPath(
      resolved.workspacePath,
      entityType,
      indexedDocumentPath
    );
    if (!homepageResource) {
      const message = `“${entity.name}”的资料目录缺少规范主页。`;
      setDocumentLibraryError(message);
      setDomiSearchError(message);
      return;
    }
    let library = documentLibrary;
    let expansionPath = library
      ? documentLibraryExpansionPath(library.nodes, resolved.workspacePath)
      : null;
    if (!library || expansionPath === null) {
      const refreshed = await refreshDocumentLibrary({
        silent: Boolean(library),
        force: Boolean(library)
      });
      if (
        requestId !== domiEntityOpenRequestRef.current
        || workspaceViewRef.current !== "documents"
      ) return;
      if (refreshed) library = refreshed;
      expansionPath = library
        ? documentLibraryExpansionPath(library.nodes, resolved.workspacePath)
        : null;
    }

    if (!library) return;
    let fallbackDocumentTitle = "";
    if (!documentLibraryHasDocumentPath(library.nodes, homepageResource)) {
      let preview;
      try {
        preview = await workbench.previewDomiDatabaseRecord({
          entityType,
          recordId: entity.recordId
        });
      } catch (error) {
        preview = {
          ok: false,
          error: error instanceof Error ? error.message : String(error)
        };
      }
      if (
        requestId !== domiEntityOpenRequestRef.current
        || workspaceViewRef.current !== "documents"
      ) return;
      const fallbackPath = localPathFromDocumentResource(preview.resource || "");
      const safeFallbackPath = entityPrimaryDocumentPath(
        resolved.workspacePath,
        entityType,
        fallbackPath
      );
      if (
        preview.ok
        && fallbackPath
        && safeFallbackPath === fallbackPath
        && documentLibraryHasDocumentPath(library.nodes, fallbackPath)
      ) {
        homepageResource = fallbackPath;
        fallbackDocumentTitle = preview.title || fallbackPath.split(/[\\/]/).pop() || "现有资料";
      } else {
        const message = preview.error
          || `“${entity.name}”的资料目录中没有找到可打开的规范主页或现有资料。`;
        setDocumentLibraryError(message);
        setDomiSearchError(message);
        return;
      }
    }
    clearDomiEntitySearch(false);
    if (fallbackDocumentTitle) {
      setDocumentLibraryNotice(
        `该${entityType === "project" ? "项目" : "人物"}尚未生成规范主页，已打开现有资料“${fallbackDocumentTitle}”。`
      );
    }

    setDocumentLibrarySelectedFolder(resolved.workspacePath);
    if (expansionPath) {
      setDocumentLibraryExpandedPaths((current) => {
        const next = new Set(current);
        expansionPath?.forEach((path) => next.add(path));
        return next;
      });
    }

    if (
      requestId !== domiEntityOpenRequestRef.current
      || workspaceViewRef.current !== "documents"
    ) return;
    if (isLocalPdfResource(homepageResource)) {
      await openPdf(homepageResource, undefined, false, requestId);
    } else {
      await openMarkdown(homepageResource, undefined, requestId);
    }
    if (
      requestId !== domiEntityOpenRequestRef.current
      || workspaceViewRef.current !== "documents"
    ) return;
    setRightPanelOpen(false);
    const homepagePath = localPathFromDocumentResource(homepageResource);
    if (homepagePath) scrollDocumentLibrarySearchSelectionIntoView(homepagePath);
  }

  async function openDomiProject(project: DomiProject) {
    await openDomiEntityDocuments("project", project);
  }

  async function openDomiPerson(person: DomiPerson) {
    await openDomiEntityDocuments("person", person);
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

  function updateConnectionRecoveryTimeline(
    threadId: string,
    runId: string,
    recovering: boolean,
    detail?: string
  ) {
    setThreads((current) => {
      const index = current.findIndex((thread) => thread.id === threadId);
      if (index < 0) return current;
      const thread = current[index];
      const timeline = thread.timeline || [];
      const recoveryIndex = timeline.findIndex(
        (item) => item.runId === runId && item.status === "reconnecting"
      );
      if (!recovering && recoveryIndex < 0) return current;

      const nextTimeline = [...timeline];
      if (recoveryIndex >= 0) {
        nextTimeline[recoveryIndex] = {
          ...nextTimeline[recoveryIndex],
          title: recovering ? "连接波动，正在恢复" : "连接已恢复",
          detail: detail || (recovering ? "Codex 正在自动重连" : "任务已继续执行"),
          status: recovering ? "reconnecting" : "done"
        };
      } else {
        nextTimeline.unshift({
          id: createId("timeline"),
          runId,
          title: "连接波动，正在恢复",
          detail: detail || "Codex 正在自动重连",
          kind: "event",
          status: "reconnecting"
        });
      }
      const next = current.slice();
      next[index] = { ...thread, timeline: nextTimeline.slice(0, 18) };
      return next;
    });
  }

  function pauseThreadQueueAfterTerminal(context: RunContext) {
    const currentState = queuedSubmissionsByThreadRef.current;
    const existing = currentState[context.threadId] || [];
    const restored = context.queuedSubmission
      && !existing.some((item) => item.id === context.queuedSubmission!.id)
      ? [context.queuedSubmission, ...existing]
      : existing;
    if (restored !== existing) {
      const nextState = { ...currentState, [context.threadId]: restored };
      queuedSubmissionsByThreadRef.current = nextState;
      setQueuedSubmissionsByThread(nextState);
    }
    const ids = restored.map((item) => item.id);
    if (!ids.length) return;
    setPausedQueuedSubmissionIds((current) => {
      if (ids.every((id) => current.has(id))) return current;
      const next = new Set(current);
      ids.forEach((id) => next.add(id));
      return next;
    });
  }

  async function finalizeRecoveredEntityBinding(
    thread: Thread,
    assistantMessage: Message,
    output: string
  ) {
    // A task may finish while every domi window is closed. Only replay a persisted,
    // machine-verifiable entity marker; never guess an entity from stale free text here.
    if (!parseDomiEntityResult(output)
      && !(assistantMessage.entityExecutionIsolated && assistantMessage.workflowId
        && ENTITY_RESULT_WORKFLOW_IDS.has(assistantMessage.workflowId))) return { ok: true };
    const assistantIndex = thread.messages.findIndex((message) => message.id === assistantMessage.id);
    const userMessage = assistantIndex > 0
      ? [...thread.messages.slice(0, assistantIndex)].reverse().find((message) => message.role === "user")
      : undefined;
    settlingThreadIdsRef.current.add(thread.id);
    try {
      return await finalizeEntityBinding({
        threadId: thread.id,
        assistantMessageId: assistantMessage.id,
        userMessageId: userMessage?.id,
        workflowId: assistantMessage.workflowId,
        requestText: userMessage?.content,
        attachments: userMessage?.attachments,
        entityFinalizationMode: assistantMessage.entityFinalizationMode,
        entityExecutionIsolated: assistantMessage.entityExecutionIsolated
      }, output);
    } catch (error) {
      const message = `恢复任务结果时实体归档失败：${error instanceof Error ? error.message : String(error)}`;
      workbench.reportRendererIssue({ kind: "document-operation", message });
      return { ok: false, error: message };
    } finally {
      settlingThreadIdsRef.current.delete(thread.id);
    }
  }

  async function finalizeEntityBinding(context: RunContext, output: string): Promise<{ ok: boolean; error?: string }> {
    const stableResult = parseDomiEntityResult(output);
    if (!stableResult && (!context.workflowId || !ENTITY_RESULT_WORKFLOW_IDS.has(context.workflowId))) {
      return { ok: true };
    }

    const failBinding = (message: string) => {
      workbench.reportRendererIssue({ kind: "document-operation", message });
      addTimeline(context.threadId, {
        runId: `entity-failed-${context.assistantMessageId}`,
        title: "资料归属尚未完成",
        detail: message,
        kind: "error",
        status: "failed"
      });
      return { ok: false, error: message };
    };

    // An isolated intake deliberately has no canonical entity context. Only a
    // machine-verifiable marker may release its staged files to an entity; do
    // not infer the target from conversational text after the run completes.
    if (!stableResult && context.entityExecutionIsolated) {
      return failBinding(
        "隔离实体任务未返回可验证的 DOMI_ENTITY_RESULT_V1 回执；附件仍保留在本机暂存区，当前任务归属未改变。"
      );
    }

    let synced;
    try {
      synced = await workbench.syncDomi();
    } catch (error) {
      return failBinding(`无法刷新资料库，未根据机器回执改变任务归属：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!synced.ok || synced.stale || !synced.snapshot) {
      return failBinding(synced.error || "资料库刷新失败或只返回旧缓存，未根据机器回执改变任务归属。");
    }
    const snapshot = synced.snapshot;
    domiSnapshotRef.current = snapshot;
    setDomiSnapshot(snapshot);

    let result: DomiEntityResult | null = stableResult;
    if (!result && snapshot && context.workflowId === "project-intake") {
      const knownIds = new Set(context.knownProjectIds || []);
      const newlyCreated = snapshot.projects.filter((project) => !knownIds.has(project.recordId));
      const candidates = projectMentionMatches(
        newlyCreated,
        [context.requestText, output].filter(Boolean).join("\n")
      ).filter((candidate) => candidate.confidence === "high");
      const project = candidates.length === 1 ? candidates[0].project : null;
      if (project) {
        result = { entityType: "project", recordId: project.recordId, name: project.name };
      }
    } else if (!result && snapshot && context.workflowId === "people-intake") {
      const knownIds = new Set(context.knownPersonIds || []);
      const newlyCreated = snapshot.people.filter((person) => !knownIds.has(person.recordId));
      const outputText = normalizedEntityMention([context.requestText, output].filter(Boolean).join("\n"));
      const mentionedPeople = newlyCreated.filter((person) => {
        const name = normalizedEntityMention(person.name);
        return name.length >= 2 && outputText.includes(name);
      });
      if (mentionedPeople.length === 1) {
        result = {
          entityType: "person",
          recordId: mentionedPeople[0].recordId,
          name: mentionedPeople[0].name
        };
      }
    }
    if (!result) return { ok: true };
    if (!workflowAllowsEntityResult(context.workflowId, result.entityType)) {
      return failBinding(`工作流“${context.workflowId || "通用任务"}”与 ${result.entityType} 回执不兼容，未改变任务归属。`);
    }

    const thread = threadsRef.current.find((item) => item.id === context.threadId);
    if (!thread) return { ok: false, error: "任务已移除。" };
    const entity = result.entityType === "project"
      ? snapshot.projects.find((item) => item.recordId === result!.recordId)
      : snapshot.people.find((item) => item.recordId === result!.recordId);
    if (!entity) {
      return failBinding(`最新资料库中不存在回执记录 ${result.recordId}，未改变任务归属。`);
    }
    if (normalizedEntityMention(entity.name) !== normalizedEntityMention(result.name)) {
      return failBinding(`回执名称“${result.name}”与资料库规范名称“${entity.name}”不一致，未改变任务归属。`);
    }
    const archiveOnly = context.entityFinalizationMode === "archive-only";
    if (
      !archiveOnly
      && thread.externalType
      && thread.externalRecordId
      && (thread.externalType !== result.entityType || thread.externalRecordId !== result.recordId)
    ) {
      return failBinding(
        `本轮回执指向“${entity.name}”，但当前任务已归属于“${thread.title}”；为避免后台静默改错归属，已保持当前任务和附件位置不变。`
      );
    }

    let workspace;
    try {
      workspace = await workbench.loadDomiEntityWorkspace({
        entityType: result.entityType,
        recordId: result.recordId,
        repairMissing: true
      });
    } catch (error) {
      return failBinding(`无法读取“${entity.name}”的固定资料目录：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!workspace.ok || !workspace.workspacePath) {
      return failBinding(
        workspace.error
          || `“${entity.name}”当前没有稳定的本地实体目录；未回退到通用任务目录，也未改变任务归属。`
      );
    }

    const assistantIndex = thread.messages.findIndex(
      (message) => message.id === context.assistantMessageId
    );
    const userMessage = context.userMessageId
      ? thread.messages.find((message) => message.id === context.userMessageId && message.role === "user")
      : assistantIndex > 0
        ? [...thread.messages.slice(0, assistantIndex)].reverse().find((message) => message.role === "user")
        : undefined;
    const attachmentsToCommit = context.attachments !== undefined
      ? context.attachments
      : userMessage?.attachments || [];
    if (attachmentsToCommit.length > 0 && !userMessage) {
      return failBinding("无法定位本轮用户消息，未提交附件，也未改变任务归属。");
    }

    const projectLabel = result.entityType === "project" && entity
      ? [
          (entity as DomiProject).domain,
          (entity as DomiProject).subdomains[0],
          (entity as DomiProject).status
        ].filter(Boolean).join(" · ")
      : result.entityType === "person" && entity
        ? [
            (entity as DomiPerson).organization,
            cleanPeopleStatus((entity as DomiPerson).status)
          ].filter(Boolean).join(" · ")
        : result.name;
    const patch: Partial<Thread> = {
      projectId: `domi-${result.entityType}-${result.recordId}`,
      externalType: result.entityType,
      externalRecordId: result.recordId,
      project: projectLabel,
      workspacePath: workspace.workspacePath
    };
    if (!thread.manualTitle) {
      const workflow = indexBy(allWorkflows, "id").get(context.workflowId || "");
      patch.title = `${workflow?.title || (result.entityType === "project" ? "项目任务" : "人物任务")}：${result.name}`;
    }
    const boundThread = { ...thread, ...patch };
    const committed = await commitAttachmentsToEntity(
      boundThread,
      attachmentsToCommit
    );
    if (!committed.ok) {
      return failBinding(committed.error || "附件仍保留在本机暂存区，实体归属未改变。");
    }

    const byPath = new Map(
      attachmentsToCommit.map(
        (attachment, index) => [attachment.path, committed.attachments[index] || attachment] as const
      )
    );
    setThreads((current) => current.map((currentThread) => {
      if (currentThread.id !== context.threadId) return currentThread;
      const messages = currentThread.messages.map((message) =>
        message.id === userMessage?.id && message.attachments?.length
          ? {
              ...message,
              attachments: message.attachments.map(
                (attachment) => byPath.get(attachment.path) || attachment
              )
            }
          : message
      );
      return {
        ...currentThread,
        ...(archiveOnly ? {} : patch),
        messages,
        timeline: [{
          id: createId("timeline"),
          runId: `entity-${result.recordId}`,
          title: archiveOnly
            ? `本轮资料已归入${result.entityType === "project" ? "项目" : "人物"}：${result.name}`
            : `已归入${result.entityType === "project" ? "项目" : "人物"}：${result.name}`,
          detail: archiveOnly
            ? committed.attachments.length
              ? `已归档 ${committed.attachments.length} 个本轮附件；当前对话归属保持不变`
              : "已验证本轮实体；当前对话归属保持不变"
            : committed.attachments.length
              ? `已绑定固定目录并归档 ${committed.attachments.length} 个本轮附件`
              : "已绑定固定资料目录",
          kind: "event" as const,
          status: "done"
        }, ...(currentThread.timeline || [])].slice(0, 18)
      };
    }));
    void refreshDocumentLibrary({ silent: true, force: true });
    return { ok: true };
  }

  function handleCodexEvent(payload: CodexEventPayload) {
    let context = runContextRef.current.get(payload.runId);
    if (!context && payload.threadId) {
      const allLocalThreads = threadsRef.current;
      const recoveryCandidates = allLocalThreads.flatMap((thread) => {
        const message = [...thread.messages]
          .reverse()
          .find(
            (candidate) =>
              candidate.role === "assistant"
              && (candidate.status === "running" || candidate.status === "error")
              && !thread.quarantinedCodexThreadIds?.includes(payload.threadId!)
              && recoveryCodexThreadId(
                thread.codexThreadId,
                candidate.executionCodexThreadId,
                candidate.entityExecutionIsolated === true
              ) === payload.threadId
          );
        return message ? [{ thread, message }] : [];
      });
      // Uniqueness is evaluated against every local task, not just unfinished
      // candidates. A completed duplicate owner is still enough to make an
      // otherwise plausible live event unsafe to bind.
      const recoveryOwners = allLocalThreads.filter((thread) =>
        thread.codexThreadId === payload.threadId
        || thread.messages.some((message) =>
          message.role === "assistant"
          && recoveryCodexThreadId(
            undefined,
            message.executionCodexThreadId,
            true
          ) === payload.threadId
        )
      );
      const recovered = recoveryCandidates.length === 1 && recoveryOwners.length === 1
        ? recoveryCandidates[0]
        : undefined;
      if (recoveryCandidates.length > 1 || recoveryOwners.length > 1) {
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: `检测到 ${recoveryOwners.length} 个本地任务持有同一个 Codex 对话；已拒绝自动绑定本轮事件。`
        });
      }
      const recoveredThread = recovered?.thread;
      const recoveredMessage = recovered?.message;

      if (recoveredThread && recoveredMessage) {
        patchThread(recoveredThread.id, { codexThreadId: payload.threadId });
        context = {
          threadId: recoveredThread.id,
          assistantMessageId: recoveredMessage.id,
          entityFinalizationMode: recoveredMessage.entityFinalizationMode,
          entityExecutionIsolated: recoveredMessage.entityExecutionIsolated,
          executionCodexThreadId: recoveredMessage.executionCodexThreadId
        };
        runContextRef.current.set(payload.runId, context);

        if (payload.type !== "completed" && payload.type !== "waiting-input" && payload.type !== "stopped" && payload.type !== "failed") {
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

    if (payload.type === "user-input-request" && payload.request) {
      const interactionKey = `${payload.runId}:${typeof payload.request.requestId}:${String(payload.request.requestId)}`;
      setAssistantInteractions((current) => {
        const next: AssistantInteraction = {
          key: interactionKey,
          runId: payload.runId,
          messageId: context.assistantMessageId,
          request: payload.request!,
          status: "pending"
        };
        const existingIndex = current.findIndex((interaction) => interaction.key === interactionKey);
        if (existingIndex < 0) return [...current, next];
        return current.map((interaction, index) => index === existingIndex ? next : interaction);
      });
      addTimeline(context.threadId, {
        runId: payload.runId,
        title: "等待你的选择",
        detail: payload.request.questions.map((question) => question.header).filter(Boolean).join(" · "),
        kind: "event",
        status: "running"
      });
      return;
    }

    if (payload.type === "user-input-resolved") {
      const interactionKey = `${payload.runId}:${typeof payload.requestId}:${String(payload.requestId)}`;
      setAssistantInteractions((current) => current.map((interaction) =>
        interaction.key === interactionKey
          ? { ...interaction, status: "resolved" }
          : interaction
      ));
      return;
    }

    if (payload.type === "thread" && payload.threadId) {
      const owner = threadsRef.current.find((thread) => thread.id === context.threadId);
      const conflictingOwners = codexThreadOwnerIds(
        threadsRef.current,
        payload.threadId
      ).filter((threadId) => threadId !== context.threadId);
      if (owner?.quarantinedCodexThreadIds?.includes(payload.threadId)) {
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: "Codex 返回了已隔离的旧对话标识；已忽略该标识，当前任务归属保持不变。"
        });
        return;
      }
      if (conflictingOwners.length > 0) {
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: "Codex 返回了已归属于另一任务的对话标识；已拒绝重新绑定，当前任务归属保持不变。"
        });
        return;
      }
      if (context.entityExecutionIsolated) {
        context.executionCodexThreadId = payload.threadId;
        runContextRef.current.set(payload.runId, context);
        patchMessage(context.assistantMessageId, {
          executionCodexThreadId: payload.threadId
        });
      }
      // One local task always owns one continuous Codex conversation. Entity
      // isolation constrains files and finalization, not conversational memory.
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

    if (payload.type === "reconnecting") {
      updateConnectionRecoveryTimeline(
        context.threadId,
        payload.runId,
        true,
        payload.summary
      );
      return;
    }

    if (payload.type === "reconnected") {
      updateConnectionRecoveryTimeline(
        context.threadId,
        payload.runId,
        false,
        payload.summary
      );
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

    if (payload.type === "completed" || payload.type === "waiting-input" || payload.type === "stopped" || payload.type === "failed") {
      if (completedRunIdsRef.current.has(payload.runId)) return;
      completedRunIdsRef.current.add(payload.runId);
      setAssistantInteractions((current) => current.map((interaction) =>
        interaction.runId === payload.runId
          ? { ...interaction, status: "resolved" }
          : interaction
      ));
      discardAssistantDelta(payload.runId);
      const runCompletedAt = Date.now();

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
            : payload.type === "waiting-input"
              ? "需要你补充材料后继续。"
            : payload.error || "Codex 执行失败。"),
        status: payload.type === "failed" ? "error" : "done",
        awaitingSlidesInput: payload.type === "waiting-input",
        runCompletedAt,
        runEventCount: payload.eventCount
      });

      patchThread(context.threadId, {
        updatedAt: nowLabel(),
        lastActiveAt: runCompletedAt,
        ...(payload.usage ? { lastUsage: payload.usage } : {})
      });

      addTimeline(context.threadId, {
        runId: payload.runId,
        title:
          payload.type === "completed"
            ? "执行完成"
            : payload.type === "waiting-input"
              ? "等待补充 Slides 材料"
            : payload.type === "stopped"
              ? "执行已停止"
              : "执行失败",
        detail: payload.outputPath
          ? `${payload.eventCount || 0} 个事件 · 已归档 ${payload.outputPath.split("/").pop()}`
          : `${payload.eventCount || 0} 个事件`,
        kind: payload.type === "failed" ? "error" : "assistant",
        status: payload.type
      });
      const skillCreatorTask = context.workflowId === "skill-creator"
        || Boolean(threadsRef.current.find((thread) => thread.id === context.threadId)
          ?.messages.some((message) => message.workflowId === "skill-creator"));
      if (payload.type === "completed" && skillCreatorTask) {
        void refreshSkillsAfterCreatorRun(context.threadId).catch((error) => {
          workbench.reportRendererIssue({
            kind: "document-operation",
            message: `Skill Hub 刷新失败：${error instanceof Error ? error.message : String(error)}`
          });
        });
      }
      const releaseRun = () => {
        settlingThreadIdsRef.current.delete(context.threadId);
        runContextRef.current.delete(payload.runId);
        setActiveRunsByThread((current) => {
          if (current[context.threadId] !== payload.runId) return current;
          const next = { ...current };
          delete next[context.threadId];
          return next;
        });
      };
      if (payload.type === "waiting-input") {
        // Pause later queued work, but do not re-enqueue the original request:
        // its next turn must be the user's answer to the clarification.
        pauseThreadQueueAfterTerminal({ ...context, queuedSubmission: undefined });
        releaseRun();
        announceTaskResult(context.threadId, context.assistantMessageId, "waiting-input");
        return;
      }
      if (payload.type !== "completed") {
        // Rebuild and pause the queue before releasing the per-thread run lock.
        // Otherwise the next item can start in the small gap before the failed
        // or stopped item is restored at the head of the queue.
        pauseThreadQueueAfterTerminal(context);
        releaseRun();
        announceTaskResult(context.threadId, context.assistantMessageId, payload.type);
        return;
      }
      settlingThreadIdsRef.current.add(context.threadId);
      let outcome: TaskNotificationOutcome = "completed";
      void finalizeEntityBinding(context, payload.output || "")
        .then((result) => { if (!result.ok) outcome = "failed"; })
        .catch((error) => {
          outcome = "failed";
          workbench.reportRendererIssue({
            kind: "document-operation",
            message: `任务已完成，但实体归档结算失败：${error instanceof Error ? error.message : String(error)}`
          });
        })
        .finally(() => {
          releaseRun();
          announceTaskResult(context.threadId, context.assistantMessageId, outcome);
        });
    }
  }

  async function answerAssistantInteraction(
    interaction: AssistantInteraction,
    answers: Record<string, string[]>
  ) {
    const result = await workbench.answerCodexUserInput({
      runId: interaction.runId,
      requestId: interaction.request.requestId,
      answers
    });
    if (result.ok) {
      setAssistantInteractions((current) => current.map((candidate) =>
        candidate.key === interaction.key
          ? { ...candidate, status: "resolved" }
          : candidate
      ));
    }
    return result;
  }

  async function commitAttachmentsToEntity(
    thread: Thread,
    selectedAttachments: LocalAttachment[]
  ): Promise<{ ok: boolean; attachments: LocalAttachment[]; error?: string }> {
    if (!selectedAttachments.length || !thread.externalType || !thread.externalRecordId) {
      return { ok: true, attachments: selectedAttachments };
    }
    let workspace;
    try {
      workspace = await workbench.loadDomiEntityWorkspace({
        entityType: thread.externalType,
        recordId: thread.externalRecordId,
        repairMissing: true
      });
    } catch (error) {
      return {
        ok: false,
        attachments: selectedAttachments,
        error: `无法读取固定资料目录：${error instanceof Error ? error.message : String(error)}`
      };
    }
    if (!workspace.ok || !workspace.workspacePath) {
      return {
        ok: false,
        attachments: selectedAttachments,
        error: workspace.error || "当前资料库后端没有稳定的本地实体目录；附件仍保留在本机暂存区。"
      };
    }
    const workspacePath = workspace.workspacePath;
    const pending = selectedAttachments.filter(
      (attachment) => !attachment.path.startsWith(`${workspacePath}/`)
    );
    if (!pending.length) {
      return { ok: true, attachments: selectedAttachments };
    }
    const imported = await workbench.importFiles(
      pending.map((attachment) => attachment.path),
      workspacePath,
      { entityType: thread.externalType, recordId: thread.externalRecordId }
    );
    if (!imported.ok || imported.files.length !== pending.length) {
      return {
        ok: false,
        attachments: selectedAttachments,
        error: imported.error || `无法把 ${selectedAttachments.length} 个附件归档到固定资料目录。`
      };
    }
    const replacements = new Map(
      pending.map((attachment, index) => [attachment.path, imported.files[index]] as const)
    );
    const committedAttachments = selectedAttachments.map(
      (attachment) => replacements.get(attachment.path) || attachment
    );
    // importFiles may remove a managed staging source after copying it into the
    // canonical project directory. Reconcile only paths from this submission
    // inside the live source draft; newer text and newly attached files survive.
    setComposerDraftsByThread((current) => {
      const draft = current[thread.id];
      if (!draft) return current;
      const reconciled = reconcileCommittedAttachmentPaths(
        draft.attachments,
        pending,
        imported.files
      );
      if (reconciled === draft.attachments) return current;
      return {
        ...current,
        [thread.id]: { ...draft, attachments: [...reconciled] }
      };
    });
    return {
      ok: true,
      attachments: committedAttachments
    };
  }

  async function prepareIsolatedEntityExecution(
    thread: Thread
  ): Promise<{ execution?: SubmissionExecutionContext; error?: string }> {
    try {
      const workspace = await workbench.createProjectWorkspace({
        projectId: createId("entity-stage"),
        projectName: "待确认实体"
      });
      if (!workspace.ok || !workspace.workspacePath) {
        return {
          error: workspace.error || "无法创建本轮隔离工作区；附件仍保留在本机暂存区。"
        };
      }
      return {
        execution: {
          workspacePath: workspace.workspacePath,
          entityFinalizationMode: entityFinalizationModeForSourceConversation(thread),
          isolated: true
        }
      };
    } catch (error) {
      return {
        error: `无法创建本轮隔离工作区：${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  async function bindThreadToMentionedProject(
    thread: Thread,
    requestText: string,
    selectedAttachments: LocalAttachment[],
    useDomiPlugin: boolean,
    projectSnapshot: DomiSnapshot | null,
    workflow?: Workflow
  ): Promise<ProjectBindingResult> {
    const entityResultWorkflow = Boolean(
      workflow?.id && ENTITY_RESULT_WORKFLOW_IDS.has(workflow.id)
    );
    const isolateEntityExecution = async (errorMessage: string): Promise<ProjectBindingResult> => {
      const isolated = await prepareIsolatedEntityExecution(thread);
      if (!isolated.execution) {
        setThreadAttachmentError(thread.id, isolated.error || errorMessage);
        return { thread, attachments: selectedAttachments, canceled: true };
      }
      return {
        thread,
        attachments: selectedAttachments,
        execution: isolated.execution
      };
    };

    // Without a current snapshot no entity-producing workflow can prove that
    // its eventual project/person is the source conversation's canonical
    // entity. Run neutrally and keep every attachment staged until a verified
    // receipt identifies the destination.
    if (entityResultWorkflow && (!useDomiPlugin || !projectSnapshot)) {
      return isolateEntityExecution("无法准备隔离实体任务。");
    }
    if (!useDomiPlugin || !projectSnapshot) {
      const committed = await commitAttachmentsToEntity(thread, selectedAttachments);
      if (!committed.ok) {
        setThreadAttachmentError(thread.id, committed.error || "附件归档失败，本次消息尚未发送。");
        return { thread, attachments: selectedAttachments, canceled: true };
      }
      return { thread, attachments: committed.attachments };
    }
    const explicitText = [
      requestText,
      ...selectedAttachments.map((attachment) => attachment.name)
    ].join("\n");
    const explicitProjectCandidates = projectMentionMatches(
      projectSnapshot.projects,
      explicitText
    );
    const explicitProject = automaticallyRoutedProject(explicitProjectCandidates, {
      projectIntake: true
    });
    const explicitPersonCandidates = projectMentionMatches(
      projectSnapshot.people,
      explicitText
    );
    const explicitPerson = automaticallyRoutedProject(
      explicitPersonCandidates,
      { projectIntake: true }
    );
    const rawExplicitEntityCandidates = [
      ...explicitProjectCandidates.map((candidate) => ({
        entityType: "project" as const,
        recordId: candidate.project.recordId
      })),
      ...explicitPersonCandidates.map((candidate) => ({
        entityType: "person" as const,
        recordId: candidate.project.recordId
      }))
    ];
    const explicitEntityTargets = [
      ...(workflow?.id !== "people-intake" && explicitProject
        ? [{ entityType: "project" as const, recordId: explicitProject.recordId }]
        : []),
      ...(workflow?.id !== "project-intake" && explicitPerson
        ? [{ entityType: "person" as const, recordId: explicitPerson.recordId }]
        : [])
    ];
    const explicitEntityTarget = explicitEntityTargets.length === 1
      ? explicitEntityTargets[0]
      : undefined;

    // domi-router, people/project intake and investment-mgmt can all return an
    // entity receipt. They may use a canonical workspace directly only when
    // one explicit entity was resolved and it is exactly the source entity.
    if (
      entityResultWorkflow
      && !entityTargetMatchesSourceConversation(thread, explicitEntityTarget)
    ) {
      return isolateEntityExecution("无法准备隔离实体任务。");
    }
    if (
      !workflow
      && entityCandidatesRequireIsolatedExecution(thread, rawExplicitEntityCandidates)
    ) {
      return isolateEntityExecution("无法准备隔离跨实体任务。");
    }

    if (!workflowAllowsProjectRouting(workflow)) {
      if (
        entityResultWorkflow
        || (thread.externalType === "person" && workflow && PERSON_TARGET_WORKFLOW_IDS.has(workflow.id))
      ) {
        const committed = await commitAttachmentsToEntity(thread, selectedAttachments);
        if (!committed.ok) {
          setThreadAttachmentError(thread.id, committed.error || "附件归档失败，本次消息尚未发送。");
          return { thread, attachments: selectedAttachments, canceled: true };
        }
        return { thread, attachments: committed.attachments };
      }
      return { thread, attachments: selectedAttachments };
    }

    let candidates = explicitProjectCandidates;
    if (!candidates.length && !thread.externalType && !entityResultWorkflow) {
      candidates = projectMentionMatches(
        projectSnapshot.projects,
        [thread.title, thread.project].join("\n")
      );
    }
    const project = entityResultWorkflow
      ? explicitProject
      : automaticallyRoutedProject(candidates, {
          currentProjectId: thread.externalType === "project" ? thread.externalRecordId : undefined,
          projectIntake: workflow?.id === "project-intake"
        });
    if (!project) {
      const unresolvedProjectTarget = Boolean(
        workflow
        && PROJECT_TARGET_WORKFLOW_IDS.has(workflow.id)
        && workflow.id !== "investment-mgmt"
      );
      const needsNeutralTarget = unresolvedProjectTarget && (
        thread.externalType === "person"
        || candidates.length > 0
      );
      if (needsNeutralTarget) {
        const isolated = await prepareIsolatedEntityExecution(thread);
        if (!isolated.execution) {
          setThreadAttachmentError(thread.id, isolated.error || "无法准备隔离项目任务。");
          return { thread, attachments: selectedAttachments, canceled: true };
        }
        return {
          thread,
          attachments: selectedAttachments,
          execution: isolated.execution
        };
      }
      const committed = await commitAttachmentsToEntity(thread, selectedAttachments);
      if (!committed.ok) {
        setThreadAttachmentError(thread.id, committed.error || "附件归档失败，本次消息尚未发送。");
        return { thread, attachments: selectedAttachments, canceled: true };
      }
      return { thread, attachments: committed.attachments };
    }

    const entityWorkspacePath = await resolveDomiEntityWorkspacePath(
      "project",
      project.recordId,
      projectSnapshot
    );
    const workspacePath = entityWorkspacePath || thread.workspacePath || codexStatus?.workspacePath;
    const patch: Partial<Thread> = {
      projectId: `domi-project-${project.recordId}`,
      workspacePath,
      externalType: "project",
      externalRecordId: project.recordId,
      project: [project.domain, project.subdomains[0], project.status].filter(Boolean).join(" · ")
    };
    if (isUnusedDraftThread(thread)) {
      patch.title = `${workflow?.title || "项目任务"}：${project.name}`;
    }
    // Project recognition may bind this conversation to the canonical project
    // directory, but it must never replace its conversation identity. Multiple
    // tasks can share one project workspace while retaining independent
    // messages, Codex threads, queues, drafts and UI selection.
    if (!shouldBindProjectToSourceConversation(thread, project.recordId)) {
      const isolated = await prepareIsolatedEntityExecution(thread);
      if (!isolated.execution) {
        setThreadAttachmentError(thread.id, isolated.error || "无法准备隔离项目任务。");
        return { thread, attachments: selectedAttachments, canceled: true };
      }
      return {
        thread,
        attachments: selectedAttachments,
        execution: isolated.execution
      };
    }
    const targetThread: Thread = { ...thread, ...patch };
    const committed = await commitAttachmentsToEntity(targetThread, selectedAttachments);
    if (!committed.ok) {
      setThreadAttachmentError(thread.id, committed.error || "附件归档失败，本次消息尚未发送。");
      return { thread, attachments: selectedAttachments, canceled: true };
    }
    patchThread(thread.id, patch);
    setThreadAttachmentError(thread.id, "");
    return { thread: targetThread, attachments: committed.attachments };
  }

  async function submitToCodex(
    workflow?: Workflow,
    overrideInput?: string,
    options: SubmitToCodexOptions = {}
  ) {
    const sourceThread = options.thread || activeThread;
    const submissionSource = options.queuedSubmission ? "queue" : "foreground";
    // Own the entire preflight lifecycle here so UI sends, queue-pump sends
    // and programmatic sends all participate in the same deletion guard.
    markThreadSubmissionStart(sourceThread.id, submissionSource, true);
    const submittedActiveDocumentPath = Object.prototype.hasOwnProperty.call(
      options,
      "activeDocumentPath"
    )
      ? options.activeDocumentPath
      : selectedDocumentLibraryPath || undefined;
    const submittedRepositoryIdentity = options.repositoryIdentitySnapshot
      ?? options.queuedSubmission?.repositoryIdentity
      ?? queueRepositoryIdentity(appSettingsRef.current);
    try {
      const requestedUserSkillId = workflow?.source === "user"
        ? workflow.id
        : options.queuedSubmission?.workflowId?.startsWith("user-skill:")
          ? options.queuedSubmission.workflowId
          : "";
      if (requestedUserSkillId && !skillHubReady) {
        throw new Error(
          skillHubLoadError
            ? `Skill Hub 读取失败，不能安全启动用户 Skill：${skillHubLoadError}`
            : "Skill Hub 正在读取本机用户 Skill，请稍后重试；当前输入已保留。"
        );
      }
      if (requestedUserSkillId && !workflow) {
        throw new Error(`用户 Skill“${requestedUserSkillId}”当前不可用，请在 Skill Hub 重新导入后重试。`);
      }
      if (requestedUserSkillId) {
        // The user may have edited or renamed SKILL.md outside domi since the
        // sidebar loaded. Resolve the stable id against live metadata before
        // constructing the prompt; never keep invoking a stale alias.
        const refreshed = await workbench.listSkillHub();
        if (!refreshed.ok) throw new Error(refreshed.error || "无法检查用户 Skill，请稍后重试。");
        setSkillHubSkills(refreshed.skills);
        const currentSkill = refreshed.skills.find((skill) => skill.id === requestedUserSkillId);
        if (!currentSkill || currentSkill.available === false || currentSkill.enabled === false) {
          throw new Error(currentSkill?.error || "所选用户 Skill 已不可用，请在 Skill Hub 重新扫描并修复。");
        }
        if (refreshed.activation === "after-current-tasks") {
          throw new Error("Skill 目录正在等待当前任务结束后刷新；当前输入已保留，请稍后重试。");
        }
        workflow = userSkillWorkflow(currentSkill);
      }
      if (!codexRecoveryReady) {
        throw new Error("Codex 任务恢复检查尚未完成，请稍后重试；当前输入已保留。");
      }
      return await submitToCodexInternal(workflow, overrideInput, {
        ...options,
        activeDocumentPath: submittedActiveDocumentPath,
        repositoryIdentitySnapshot: submittedRepositoryIdentity
      });
    } finally {
      markThreadSubmissionStart(sourceThread.id, submissionSource, false);
    }
  }

  async function submitToCodexInternal(
    workflow?: Workflow,
    overrideInput?: string,
    options: SubmitToCodexOptions = {}
  ) {
    const sourceThread = options.thread || activeThread;
    let targetThread = sourceThread;
    const useDomiPlugin = options.useDomiPlugin ?? domiPluginEnabled;
    const submittedInput = overrideInput ?? input;
    const submittedComposerInput = options.workflowContinuation
      ? options.displayText || submittedInput
      : submittedInput;
    const rawInput = submittedInput.trim();
    const requestOrigin = options.requestOrigin === "user" ? "user" : "programmatic";
    const userInstructionText = requestOrigin === "user"
      ? String(options.userInstructionText ?? submittedInput).trim()
      : "";
    const submittedAttachments = options.attachments ?? attachments;
    let selectedAttachments = submittedAttachments;
    const messageText = rawInput || workflow?.defaultPrompt || (selectedAttachments.length ? "请分析所附材料" : "");
    if (!messageText) {
      return;
    }
    const previousAssistant = [...sourceThread.messages].reverse()
      .find((message) => message.role === "assistant");
    const previousSlidesDeliveryPolicy = previousAssistant?.slidesDeliveryPolicy || "";
    const awaitingSlidesInput = previousAssistant?.awaitingSlidesInput === true
      && (!workflow || workflow.id === "slides");
    const slidesDeliveryPolicy = useDomiPlugin && workflow?.source !== "system"
      ? domiSlidesDeliveryPolicyForText(
          messageText,
          selectedAttachments.map((attachment) => attachment.name || attachment.path),
          previousSlidesDeliveryPolicy,
          workflow?.id === "slides" || workflow?.producesSlides === true,
          awaitingSlidesInput
        ) as DomiSlidesDeliveryPolicy | ""
      : "";
    const runModelPolicy = resolveRunModelPolicy(workflow?.id, {
      useDomiPlugin,
      domiSlidesDeliveryPolicy: slidesDeliveryPolicy,
      requestText: [
        messageText,
        ...selectedAttachments.map((attachment) => attachment.name || attachment.path)
      ].filter(Boolean).join("\n"),
      model: options.model,
      reasoningEffort: options.reasoningEffort,
      serviceTier: options.serviceTier
    });
    const assertRepositoryIdentityUnchanged = () => {
      const currentIdentity = queueRepositoryIdentity(appSettingsRef.current);
      if (
        !options.repositoryIdentitySnapshot
        || options.repositoryIdentitySnapshot !== currentIdentity
      ) {
        throw new Error("资料库配置在发送准备期间发生变化；本次任务已安全保留，请确认配置后重试。");
      }
    };
    let effectiveDomiSnapshot = domiSnapshotRef.current;
    if (useDomiPlugin && !effectiveDomiSnapshot) {
      const cached = await workbench.loadDomiCache();
      effectiveDomiSnapshot = cached.snapshot || null;
      if (effectiveDomiSnapshot) {
        domiSnapshotRef.current = effectiveDomiSnapshot;
        setDomiSnapshot(effectiveDomiSnapshot);
      }
    }
    assertRepositoryIdentityUnchanged();
    const latestSourceThread = threadsRef.current.find((thread) => thread.id === sourceThread.id);
    if (!latestSourceThread) {
      throw new Error("发送前原任务已被删除，本次消息未发送。");
    }
    targetThread = latestSourceThread;
    const binding = await bindThreadToMentionedProject(
      targetThread,
      messageText,
      selectedAttachments,
      useDomiPlugin,
      effectiveDomiSnapshot,
      workflow
    );
    if (binding.canceled) return;
    targetThread = binding.thread;
    if (targetThread.id !== sourceThread.id) {
      throw new Error("发送前处理试图改变任务归属；为避免消息串线，本次发送已停止。");
    }
    selectedAttachments = binding.attachments;
    let execution: SubmissionExecutionContext = binding.execution || {
      workspacePath: targetThread.workspacePath,
      externalType: targetThread.externalType,
      externalRecordId: targetThread.externalRecordId,
      entityFinalizationMode: entityFinalizationModeForSourceConversation(targetThread),
      isolated: false
    };
    const recoveredEntityWorkspace = await recoverBoundEntityWorkspaceForSubmission(
      targetThread,
      execution,
      effectiveDomiSnapshot
    );
    targetThread = recoveredEntityWorkspace.thread;
    execution = recoveredEntityWorkspace.execution;
    effectiveDomiSnapshot = recoveredEntityWorkspace.snapshot;
    // Project lookup and attachment import both yield. Revalidate immediately
    // before any queue mutation, optimistic message append or Codex launch.
    // If a stale UI/programmatic action removed the source task, fail closed.
    if (!threadsRef.current.some((thread) => thread.id === sourceThread.id)) {
      throw new Error("发送前原任务已被删除，本次消息未发送。");
    }
    assertRepositoryIdentityUnchanged();
    // A queue item always belongs to the task where the user submitted it.
    // Project routing may replace staging paths after committing attachments,
    // but must never rewrite its conversation owner.
    const routedQueuedSubmission = options.queuedSubmission
      ? {
          ...options.queuedSubmission,
          threadId: targetThread.id,
          attachments: selectedAttachments
        }
      : undefined;
    const targetAlreadyRunning = Boolean(activeRunsByThread[targetThread.id])
      || [...runContextRef.current.values()].some((context) => context.threadId === targetThread.id);
    if (targetAlreadyRunning) {
      if (options.queuedSubmission && routedQueuedSubmission) {
        const movedSubmission: QueuedSubmission = routedQueuedSubmission;
        if (options.queuedSubmission.threadId === targetThread.id) {
          // The pump can race with a run that starts after its initial idle
          // check. Keep this same queue item for the next turn. Applying the
          // normal acceptance callback would dequeue the equal source/target
          // and silently lose the user's pending work.
          setQueuedSubmissionsByThread((current) => {
            const targetQueue = current[targetThread.id] || [];
            const nextQueue = targetQueue.some((item) => item.id === movedSubmission.id)
              ? targetQueue.map((item) => item.id === movedSubmission.id ? movedSubmission : item)
              : [movedSubmission, ...targetQueue];
            const next = { ...current, [targetThread.id]: nextQueue };
            queuedSubmissionsByThreadRef.current = next;
            return next;
          });
          return { ok: true, queued: true, stopped: false, error: undefined };
        }
        throw new Error("排队任务的对话归属发生变化；为避免消息串线，已暂停该任务。");
      }
      const queuedSubmission: QueuedSubmission = {
        id: createId("queue"),
        threadId: targetThread.id,
        input: messageText,
        workflowId: workflow?.id,
        displayText: options.displayText,
        workflowContinuation: options.workflowContinuation,
        resumeCodexThreadId: options.resumeCodexThreadId,
        privateCodexContinuation: options.privateCodexContinuation,
        attachments: selectedAttachments,
        activeDocumentPath: options.activeDocumentPath,
        requestOrigin,
        userInstructionText,
        useDomiPlugin,
        model: runModelPolicy.model,
        reasoningEffort: runModelPolicy.reasoningEffort,
        serviceTier: runModelPolicy.serviceTier,
        createdAt: Date.now(),
        repositoryIdentity: options.repositoryIdentitySnapshot
      };
      setQueuedSubmissionsByThread((current) => {
        const next = {
          ...current,
          [targetThread.id]: [...(current[targetThread.id] || []), queuedSubmission]
        };
        queuedSubmissionsByThreadRef.current = next;
        return next;
      });
      if (!options.preserveComposer) {
        clearSubmittedComposerDraft(
          sourceThread.id,
          submittedComposerInput,
          selectedAttachments,
          options.workflowContinuation ? undefined : workflow?.id
        );
      }
      return;
    }
    const duplicateCanonicalId = targetThread.codexThreadId;
    const quarantinedOwnership = quarantineDuplicateCodexThreadOwnership(
      threadsRef.current,
      duplicateCanonicalId
    );
    if (quarantinedOwnership.quarantinedThreadIds.length > 0) {
      // Clear the polluted canonical id from every local owner atomically.
      // Otherwise A could start a fresh remote conversation while B silently
      // becomes the sole owner of the old id and resumes the wrong history.
      threadsRef.current = quarantinedOwnership.threads;
      setThreads((current) =>
        quarantineDuplicateCodexThreadOwnership(current, duplicateCanonicalId).threads
      );
      targetThread = quarantinedOwnership.threads.find(
        (thread) => thread.id === targetThread.id
      ) || { ...targetThread, codexThreadId: undefined };
      workbench.reportRendererIssue({
        kind: "codex-run",
        message: `检测到 ${quarantinedOwnership.quarantinedThreadIds.length} 个本地任务共用 Codex 对话；已隔离旧对话，本轮将新建独立会话。`
      });
    }
    const resumeCodexThreadId = String(options.resumeCodexThreadId || "").trim();
    if (resumeCodexThreadId) {
      if (targetThread.quarantinedCodexThreadIds?.includes(resumeCodexThreadId)) {
        throw new Error("等待补充信息的 Codex 会话已被安全隔离，无法续接；本次输入已保留。");
      }
      const continuationOwners = codexThreadOwnerIds(
        threadsRef.current,
        resumeCodexThreadId
      );
      if (continuationOwners.length !== 1 || continuationOwners[0] !== targetThread.id) {
        throw new Error("等待补充信息的 Codex 会话归属不唯一；为避免串线，本次输入已保留。");
      }
    }
    // Resolve continuity before appending the new running assistant message;
    // this also heals legacy tasks whose latest completed turn used a private
    // execution id different from the older canonical id.
    const existingTaskConversationId = taskConversationCodexThreadId(
      threadsRef.current,
      targetThread.id
    );
    const displayText = options.displayText?.trim() || messageText;
    const runId = createId("run");
    const runStartedAt = Date.now();
    const userMessage: Message = {
      id: createId("user"),
      role: "user",
      content: workflow && !options.workflowContinuation
        ? `启动「${workflow.title}」：${displayText}`
        : displayText,
      workflowId: workflow?.id,
      attachments: selectedAttachments
    };

    const assistantId = createId("assistant");
    const privateCodexExecution = execution.isolated || options.privateCodexContinuation === true;
    const assistantMessage: Message = {
      id: assistantId,
      role: "assistant",
      workflowId: workflow?.id,
      status: "running",
      content: "",
      runId,
      runStartedAt,
      entityFinalizationMode: execution.entityFinalizationMode,
      entityExecutionIsolated: privateCodexExecution,
      ...(slidesDeliveryPolicy ? { slidesDeliveryPolicy } : {})
    };

    appendMessageToThread(targetThread.id, userMessage);
    appendMessageToThread(targetThread.id, assistantMessage);
    if (!options.preserveComposer) {
      clearSubmittedComposerDraft(
        sourceThread.id,
        submittedComposerInput,
        selectedAttachments,
        options.workflowContinuation ? undefined : workflow?.id
      );
    }
    patchThread(targetThread.id, { timeline: [], lastUsage: null });
    runContextRef.current.set(runId, {
      threadId: targetThread.id,
      assistantMessageId: assistantId,
      userMessageId: userMessage.id,
      workflowId: workflow?.id,
      requestText: messageText,
      attachments: selectedAttachments,
      knownProjectIds: effectiveDomiSnapshot?.projects.map((project) => project.recordId),
      knownPersonIds: effectiveDomiSnapshot?.people.map((person) => person.recordId),
      queuedSubmission: routedQueuedSubmission,
      entityFinalizationMode: execution.entityFinalizationMode,
      entityExecutionIsolated: privateCodexExecution
    });
    setActiveRunsByThread((current) => ({ ...current, [targetThread.id]: runId }));
    options.onAccepted?.(routedQueuedSubmission);

    const executionNotice = execution.isolated
      ? [
          "本轮实体执行隔离规则：",
          "- 当前对话的项目／人物绑定只作为只读背景，不是本轮文件写入目标。",
          "- 本轮运行在隔离任务目录；不得把附件或临时产物写入当前对话已绑定的实体目录。",
          "- 只有完成写入、按 record_id 回读并输出 DOMI_ENTITY_RESULT_V1 后，客户端才会把本轮附件归入该已验证实体。"
        ].join("\n")
      : "";
    const conversationContinuationNotice = targetThread.messages.length > 0
      ? [
          "同一任务连续对话规则：",
          "- 这是左侧当前任务中的后续消息，必须结合该任务此前的用户输入、追问、补充信息和执行结果理解，不得当成新建普通对话。",
          "- 简短的人名、项目名、参会人、目的、纠正或“继续”等输入，默认是在补充或修正上一轮尚未完成的工作。",
          "- 仅当用户明确更换主题或主动选择新的工作流时，才按新任务意图转向；不要要求用户重复已经在本任务中提供的信息。"
        ].join("\n")
      : "";
    const basePrompt = workflowPrompt(
      workflow,
      messageText,
      [
        domiContextForThread(effectiveDomiSnapshot, targetThread),
        conversationContinuationNotice,
        executionNotice
      ].filter(Boolean).join("\n\n"),
      useDomiPlugin,
      requestOrigin,
      selectedAttachments.map((attachment) => attachment.name || attachment.path),
      previousSlidesDeliveryPolicy,
      awaitingSlidesInput
    );
    const prompt = selectedAttachments.length
      ? `${basePrompt}\n\n本次任务附带以下本地材料，请直接读取并使用：\n${selectedAttachments
          .map((file) => `- ${JSON.stringify(file.path)}`)
          .join("\n")}`
      : basePrompt;
    let result: Awaited<ReturnType<typeof workbench.runCodex>>;
    try {
      result = await workbench.runCodex({
        runId,
        prompt,
        requestText: messageText,
        requestOrigin,
        userInstructionText,
        activeDocumentPath: options.activeDocumentPath,
        attachmentPaths: selectedAttachments.map((attachment) => attachment.path),
        // A left-sidebar task is one continuous conversation. Filesystem and
        // entity finalization may be isolated without splitting model context.
        threadId: resumeCodexThreadId || existingTaskConversationId,
        workflowId: workflow?.id || (useDomiPlugin ? "domi-analyst" : undefined),
        webSearch: Boolean(workflow?.webSearch),
        model: runModelPolicy.model,
        reasoningEffort: runModelPolicy.reasoningEffort,
        serviceTier: runModelPolicy.serviceTier,
        ...(slidesDeliveryPolicy ? { slidesDeliveryPolicy } : {}),
        background: options.background,
        workspacePath: execution.workspacePath,
        externalType: execution.externalType,
        externalRecordId: execution.externalRecordId,
        entityUpdatedAt: execution.externalType === "project"
          ? effectiveDomiSnapshot?.projects.find((project) => project.recordId === execution.externalRecordId)?.updatedAt
          : execution.externalType === "person"
            ? effectiveDomiSnapshot?.people.find((person) => person.recordId === execution.externalRecordId)?.updatedAt
            : undefined
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      workbench.reportRendererIssue({
        kind: "codex-run",
        message: `启动 Codex 失败：${message}`
      });
      result = {
        ok: false,
        runId,
        output: "",
        workspacePath: execution.workspacePath || targetThread.workspacePath || "",
        error: `无法启动任务：${message}`
      };
    }

    if (result.threadId) {
      const latestOwner = threadsRef.current.find((thread) => thread.id === targetThread.id)
        || targetThread;
      const conflictingOwners = codexThreadOwnerIds(
        threadsRef.current,
        result.threadId
      ).filter((threadId) => threadId !== targetThread.id);
      if (latestOwner.quarantinedCodexThreadIds?.includes(result.threadId)) {
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: "Codex 启动结果命中了已隔离的旧对话标识；已拒绝重新绑定。"
        });
      } else if (conflictingOwners.length > 0) {
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: "Codex 启动结果命中了另一任务持有的对话标识；已拒绝重新绑定。"
        });
      } else {
        if (privateCodexExecution) {
          patchMessage(assistantId, { executionCodexThreadId: result.threadId });
          const context = runContextRef.current.get(runId);
          if (context) {
            context.executionCodexThreadId = result.threadId;
            runContextRef.current.set(runId, context);
          }
        }
        patchThread(targetThread.id, { codexThreadId: result.threadId });
      }
    }

    if (result.ok && result.output && !hasNativeWorkbench) {
      const runCompletedAt = Date.now();
      patchMessage(assistantId, {
        content: result.output,
        status: "done",
        awaitingSlidesInput: result.awaitingSlidesInput === true,
        runCompletedAt
      });
      patchThread(targetThread.id, {
        updatedAt: nowLabel(),
        lastActiveAt: runCompletedAt
      });
      let outcome: TaskNotificationOutcome = result.awaitingSlidesInput ? "waiting-input" : "completed";
      const context = runContextRef.current.get(runId);
      if (context) {
        const skillCreatorTask = context.workflowId === "skill-creator"
          || Boolean(threadsRef.current.find((thread) => thread.id === context.threadId)
            ?.messages.some((message) => message.workflowId === "skill-creator"));
        if (skillCreatorTask) {
          void refreshSkillsAfterCreatorRun(context.threadId).catch((error) => {
            workbench.reportRendererIssue({
              kind: "document-operation",
              message: `Skill Hub 刷新失败：${error instanceof Error ? error.message : String(error)}`
            });
          });
        }
        settlingThreadIdsRef.current.add(targetThread.id);
        try {
          if (result.awaitingSlidesInput) {
            pauseThreadQueueAfterTerminal({ ...context, queuedSubmission: undefined });
          } else {
            const finalized = await finalizeEntityBinding(context, result.output);
            if (!finalized.ok) outcome = "failed";
          }
        } catch (error) {
          outcome = "failed";
          workbench.reportRendererIssue({
            kind: "document-operation",
            message: `任务已完成，但实体归档结算失败：${error instanceof Error ? error.message : String(error)}`
          });
        } finally {
          settlingThreadIdsRef.current.delete(targetThread.id);
        }
      }
      runContextRef.current.delete(runId);
      setActiveRunsByThread((current) => {
        if (current[targetThread.id] !== runId) return current;
        const next = { ...current };
        delete next[targetThread.id];
        return next;
      });
      announceTaskResult(targetThread.id, assistantId, outcome);
    } else if (!result.ok) {
      patchMessage(assistantId, {
        content: result.error || "Codex 执行失败。",
        status: "error",
        runCompletedAt: Date.now()
      });
      const context = runContextRef.current.get(runId);
      if (context) pauseThreadQueueAfterTerminal(context);
      setActiveRunsByThread((current) => {
        if (current[targetThread.id] !== runId) return current;
        const next = { ...current };
        delete next[targetThread.id];
        return next;
      });
      runContextRef.current.delete(runId);
      announceTaskResult(targetThread.id, assistantId, "failed");
    }
    return result;
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const sourceThread = activeThread;
    const sourceThreadId = sourceThread.id;
    const submittedInput = input;
    const submittedAttachments = [...attachments];
    const submittedActiveDocumentPath = selectedDocumentLibraryPath || undefined;
    const selectedUserSkillId = selectedWorkflowId?.startsWith("user-skill:")
      ? selectedWorkflowId
      : "";
    if (selectedUserSkillId && !skillHubReady) {
      setThreadAttachmentError(
        sourceThreadId,
        skillHubLoadError
          ? `Skill Hub 读取失败，不能安全启动用户 Skill：${skillHubLoadError}`
          : "Skill Hub 正在读取本机用户 Skill，请稍后重试；当前输入已保留。"
      );
      return;
    }
    if (selectedUserSkillId && !selectedWorkflow) {
      setThreadAttachmentError(
        sourceThreadId,
        `用户 Skill“${selectedUserSkillId}”当前不可用，请在 Skill Hub 重新导入后重试。`
      );
      return;
    }
    const skillCreatorContinuation = !selectedWorkflow
      && sourceThread.messages.some((message) => message.workflowId === "skill-creator")
      ? workflows.find((workflow) => workflow.id === "skill-creator")
      : undefined;
    const effectiveSelectedWorkflow = selectedWorkflow || skillCreatorContinuation;
    const plaudContinuation = !effectiveSelectedWorkflow
      ? pendingPlaudContinuation(sourceThread, plaudSnapshot?.items || [])
      : null;
    const submittedWorkflow = plaudContinuation
      ? workflows.find((workflow) => workflow.id === "domi-router")
      : effectiveSelectedWorkflow;
    const submittedRequest = plaudContinuation
      ? plaudContinuationPrompt(
          plaudNotesWorkflowRequest(plaudContinuation.item),
          submittedInput
        )
      : submittedInput;
    const continuationOptions = plaudContinuation
      ? {
          displayText: submittedInput,
          workflowContinuation: true,
          resumeCodexThreadId: plaudContinuation.executionCodexThreadId,
          privateCodexContinuation: Boolean(plaudContinuation.executionCodexThreadId)
        }
      : skillCreatorContinuation
        ? {
            displayText: submittedInput,
            workflowContinuation: true
          }
      : {};
    if (attachmentImportCount > 0) {
      setThreadAttachmentError(sourceThreadId, "附件仍在导入，请等待完成后再发送。");
      return;
    }
    if (!submittedInput.trim() && submittedAttachments.length === 0) return;
    const threadHasActiveRun = Boolean(activeRunsByThread[sourceThreadId])
      || [...runContextRef.current.values()].some((context) => context.threadId === sourceThreadId);
    if (threadHasActiveRun) {
      enqueueSubmission(submittedWorkflow, submittedRequest, {
        thread: sourceThread,
        attachments: submittedAttachments,
        activeDocumentPath: submittedActiveDocumentPath,
        requestOrigin: "user",
        userInstructionText: submittedInput.trim(),
        ...continuationOptions
      });
      return;
    }
    if (
      submissionStartingThreadIdsRef.current.has(sourceThreadId)
      || queueStartingThreadIdsRef.current.has(sourceThreadId)
    ) return;
    void submitToCodex(submittedWorkflow, submittedRequest, {
      thread: sourceThread,
      attachments: submittedAttachments,
      activeDocumentPath: submittedActiveDocumentPath,
      requestOrigin: "user",
      userInstructionText: submittedInput.trim(),
      ...continuationOptions,
      useDomiPlugin: domiPluginEnabled,
      model,
      reasoningEffort,
      serviceTier
    })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        setThreadAttachmentError(sourceThreadId, `本次消息未能发送：${message}`);
        workbench.reportRendererIssue({
          kind: "codex-run",
          message: `发送前处理失败：${message}`
        });
      });
  }

  function enqueueSubmission(
    workflow?: Workflow,
    overrideInput?: string,
    options: {
      thread?: Thread;
      attachments?: LocalAttachment[];
      activeDocumentPath?: string;
      requestOrigin?: "user" | "programmatic";
      userInstructionText?: string;
      displayText?: string;
      workflowContinuation?: boolean;
      resumeCodexThreadId?: string;
      privateCodexContinuation?: boolean;
    } = {}
  ) {
    if (attachmentImportCount > 0) {
      setAttachmentError("附件仍在导入，请等待完成后再加入队列。");
      return;
    }
    const queueThread = options.thread || activeThread;
    const queuedAttachments = options.attachments ?? attachments;
    const queuedRequestOrigin = options.requestOrigin === "user" ? "user" : "programmatic";
    const queuedUserInstructionText = queuedRequestOrigin === "user"
      ? String(options.userInstructionText ?? overrideInput ?? input).trim()
      : "";
    const queuedActiveDocumentPath = Object.prototype.hasOwnProperty.call(
      options,
      "activeDocumentPath"
    )
      ? options.activeDocumentPath
      : selectedDocumentLibraryPath || undefined;
    const rawInput = (overrideInput ?? input).trim();
    const messageText = rawInput || workflow?.defaultPrompt || (queuedAttachments.length ? "请分析所附材料" : "");
    if (!messageText) return;

    const runModelPolicy = (() => {
      try {
        return resolveRunModelPolicy(workflow?.id, {
          useDomiPlugin: domiPluginEnabled,
          requestText: [
            messageText,
            ...queuedAttachments.map((attachment) => attachment.name || attachment.path)
          ].filter(Boolean).join("\n")
        });
      } catch (error) {
        setThreadAttachmentError(
          queueThread.id,
          error instanceof Error ? error.message : String(error)
        );
        return null;
      }
    })();
    if (!runModelPolicy) return;

    const queuedSubmission: QueuedSubmission = {
      id: createId("queue"),
      threadId: queueThread.id,
      input: messageText,
      workflowId: workflow?.id,
      displayText: options.displayText,
      workflowContinuation: options.workflowContinuation,
      resumeCodexThreadId: options.resumeCodexThreadId,
      privateCodexContinuation: options.privateCodexContinuation,
      attachments: [...queuedAttachments],
      activeDocumentPath: queuedActiveDocumentPath,
      requestOrigin: queuedRequestOrigin,
      userInstructionText: queuedUserInstructionText,
      useDomiPlugin: domiPluginEnabled,
      model: runModelPolicy.model,
      reasoningEffort: runModelPolicy.reasoningEffort,
      serviceTier: runModelPolicy.serviceTier,
      createdAt: Date.now(),
      repositoryIdentity: queueRepositoryIdentity(appSettingsRef.current)
    };
    setQueuedSubmissionsByThread((current) => {
      const next = {
        ...current,
        [queueThread.id]: [...(current[queueThread.id] || []), queuedSubmission]
      };
      queuedSubmissionsByThreadRef.current = next;
      return next;
    });
    clearComposerDraft(queueThread.id);
    patchThread(queueThread.id, { updatedAt: nowLabel(), lastActiveAt: Date.now() });
  }

  function removeQueuedSubmission(threadId: string, queuedId: string) {
    if (queuedSubmissionRemovalIsBusy(threadId, queuedId)) return;
    const currentState = queuedSubmissionsByThreadRef.current;
    const queued = currentState[threadId]?.find((item) => item.id === queuedId);
    const remaining = (currentState[threadId] || []).filter((item) => item.id !== queuedId);
    const nextState = remaining.length > 0
      ? { ...currentState, [threadId]: remaining }
      : { ...currentState };
    if (remaining.length === 0) delete nextState[threadId];
    queuedSubmissionsByThreadRef.current = nextState;
    setQueuedSubmissionsByThread(nextState);
    if (queued) {
      void Promise.allSettled(
        queued.attachments.map((attachment) => workbench.discardStagedAttachment(attachment.path))
      );
    }
    setPausedQueuedSubmissionIds((current) => {
      if (!current.has(queuedId)) return current;
      const next = new Set(current);
      next.delete(queuedId);
      return next;
    });
  }

  async function retryQueuedSubmission(queuedId: string) {
    const located = Object.values(queuedSubmissionsByThreadRef.current)
      .flat()
      .find((item) => item.id === queuedId);
    if (!located || !appSettingsRef.current) return;
    const currentIdentity = queueRepositoryIdentity(appSettingsRef.current);
    if (!located.repositoryIdentity || located.repositoryIdentity !== currentIdentity) {
      const confirmed = await requestConfirmation({
        title: "使用当前资料库重新执行？",
        message: "这项任务来自另一个或无法确认的资料库配置。",
        detail: "继续会改用当前资料库；取消后任务保持暂停，你也可以直接从队列删除。",
        confirmLabel: "使用当前资料库"
      });
      if (!confirmed) return;
      setQueuedSubmissionsByThread((current) => {
        const next = Object.fromEntries(Object.entries(current).map(([threadId, items]) => [
          threadId,
          items.map((item) => item.id === queuedId
            ? { ...item, repositoryIdentity: currentIdentity }
            : item)
        ]));
        queuedSubmissionsByThreadRef.current = next;
        return next;
      });
    }
    setPausedQueuedSubmissionIds((current) => {
      if (!current.has(queuedId)) return current;
      const next = new Set(current);
      next.delete(queuedId);
      return next;
    });
  }

  async function chooseAttachments() {
    changeAttachmentImportCount(1);
    try {
      const result = await workbench.selectFiles(activeThread.workspacePath);
      if (!result.ok) {
        setAttachmentError(result.error || "无法添加所选文件。");
        return;
      }
      if (result.canceled || result.files.length === 0) return;
      setAttachmentError("");
      setAttachments((current) => {
        const paths = new Set(current.map((file) => file.path));
        return [...current, ...result.files.filter((file) => !paths.has(file.path))];
      });
    } finally {
      changeAttachmentImportCount(-1);
    }
  }

  async function importAttachmentFiles(files: File[]) {
    if (files.length === 0) return;
    changeAttachmentImportCount(1);
    try {
      const sourcePaths: string[] = [];
      const inMemoryFiles: File[] = [];
      files.forEach((file) => {
        let sourcePath = "";
        try {
          sourcePath = workbench.getPathForFile(file);
        } catch {
          sourcePath = "";
        }
        if (sourcePath) sourcePaths.push(sourcePath);
        else inMemoryFiles.push(file);
      });

      const importedFiles: LocalAttachment[] = [];
      const errors: string[] = [];
      if (sourcePaths.length > 0) {
        const pathResult = await workbench.importFiles(sourcePaths, activeThread.workspacePath);
        if (pathResult.ok) importedFiles.push(...pathResult.files);
        else errors.push(pathResult.error || "无法导入本地文件。");
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
          if (dataResult.ok) importedFiles.push(...dataResult.files);
          else errors.push(dataResult.error || "无法读取剪贴板文件内容。");
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
    } finally {
      changeAttachmentImportCount(-1);
    }
  }

  async function importAttachmentPaths(sourcePaths: string[]) {
    if (sourcePaths.length === 0) return;
    changeAttachmentImportCount(1);
    try {
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
    } finally {
      changeAttachmentImportCount(-1);
    }
  }

  function handleComposerPaste(event: ReactClipboardEvent<HTMLFormElement>) {
    const files = filesFromClipboardData(event.clipboardData);
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
      event.stopPropagation();
      void importAttachmentPaths(fileUrlPaths);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
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

  async function removeAttachment(filePath: string) {
    setAttachments((current) => current.filter((file) => file.path !== filePath));
    const discarded = await workbench.discardStagedAttachment(filePath);
    if (!discarded.ok && discarded.error && !discarded.error.includes("不是 domi 本轮管理")) {
      setAttachmentError(`附件已从本轮移除，但暂存副本清理失败：${discarded.error}`);
    }
  }

  function applyNewThreadAgentDefaults() {
    setModel(NEW_THREAD_MODEL);
    setReasoningEffort(NEW_THREAD_REASONING_EFFORT);
    setServiceTier(NEW_THREAD_SERVICE_TIER);
    setDomiPluginEnabled(true);
    setComposerSuggestionIndex((current) => (current + 1) % COMPOSER_SUGGESTIONS.length);
  }

  async function createThread(seed?: Partial<ComposerDraft>) {
    if (!await navigateWorkspace("conversation")) return;
    const currentDraftIsUnused = isUnusedDraftThread(activeThread)
      && !input.trim()
      && attachments.length === 0
      && !selectedWorkflowId;
    if (currentDraftIsUnused) {
      applyNewThreadAgentDefaults();
      if (seed) replaceComposerDraft(activeThread.id, seed);
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return activeThread.id;
    }

    const reusableDraft = threads.find(
      (thread) => isUnusedDraftThread(thread) && !composerDraftHasContent(thread.id)
    );
    if (reusableDraft) {
      activateThreadNow(reusableDraft.id);
      if (seed) replaceComposerDraft(reusableDraft.id, seed);
      else clearComposerDraft(reusableDraft.id);
      applyNewThreadAgentDefaults();
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return reusableDraft.id;
    }

    if (creatingThreadRef.current) return;
    creatingThreadRef.current = true;

    const threadId = createId("thread");
    const projectId = createId("project");
    try {
      const nextThread: Thread = {
        id: threadId,
        projectId,
        // A blank task does not allocate a hidden workspace. It uses the shared runtime
        // until an actual project is resolved, then switches to that entity's fixed directory.
        workspacePath: codexStatus?.workspacePath,
        title: NEW_THREAD_TITLE,
        project: NEW_THREAD_PROJECT,
        updatedAt: nowLabel(),
        lastActiveAt: Date.now(),
        pinned: false,
        manualTitle: false,
        timeline: [],
        lastUsage: null,
        messages: []
      };
      threadsRef.current = [
        nextThread,
        ...threadsRef.current.filter((thread) => thread.id !== nextThread.id)
      ];
      setThreads((current) => [
        nextThread,
        ...current.filter((thread) => thread.id !== nextThread.id)
      ]);
      activateThreadNow(nextThread.id);
      if (seed) replaceComposerDraft(nextThread.id, seed);
      else clearComposerDraft(nextThread.id);
      applyNewThreadAgentDefaults();
      setThreadMenuId(null);
      window.requestAnimationFrame(() => composerRef.current?.focus());
      return nextThread.id;
    } finally {
      creatingThreadRef.current = false;
    }
  }

  async function openNewSkillConversation(editSkill?: SkillHubUserSkill) {
    setSkillHubOpen(false);
    setSkillHubReviewCandidateIds([]);
    const threadId = await createThread({ selectedWorkflowId: "skill-creator" });
    if (!threadId) return;
    // Establish the pre-creation snapshot before Codex can write a new Skill;
    // otherwise a very fast creator run could appear in both sides of the
    // comparison and never be registered in Skill Hub.
    try {
      const baselineResult = await workbench.scanSkillHub();
      if (baselineResult.ok) {
        const baseline = new Set(baselineResult.candidates.map((candidate) => candidate.id));
        skillCreatorBaselinesRef.current.set(threadId, Promise.resolve(baseline));
      }
    } catch {
      // Fail closed: without a trustworthy baseline, never auto-register every
      // unimported local Skill after this conversation completes.
    }
    const thread = threadsRef.current.find((candidate) => candidate.id === threadId);
    const workflow = workflows.find((candidate) => candidate.id === "skill-creator");
    if (!thread || !workflow) return;
    try {
      const instruction = editSkill
        ? `请使用 skill-creator，通过对话引导我修改自己的 Skill。唯一目标为 ${JSON.stringify(editSkill.path)}/SKILL.md。先完整读取并询问我希望怎样修改；保留相关资源，只修改这个用户副本，不能修改官方插件或来源目录。`
        : "请先通过对话引导我创建一个新的 Skill。";
      await submitToCodex(workflow, instruction, {
        thread,
        attachments: [],
        requestOrigin: "user",
        userInstructionText: instruction,
        useDomiPlugin: domiPluginEnabled,
        model,
        reasoningEffort,
        serviceTier
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setThreadAttachmentError(threadId, `Skill 创建引导未能启动：${message}`);
      workbench.reportRendererIssue({
        kind: "codex-run",
        message: `Skill 创建引导未能启动：${message}`
      });
    }
  }

  async function refreshSkillsAfterCreatorRun(threadId: string) {
    const baselinePromise = skillCreatorBaselinesRef.current.get(threadId);
    if (!baselinePromise) {
      const current = await workbench.scanSkillHub();
      if (current.ok) {
        setSkillHubSkills(current.imported);
        setSkillHubLoadError("");
        setSkillHubReady(true);
      }
      return;
    }
    const baseline = await baselinePromise;
    const scanned = await workbench.scanSkillHub();
    if (!scanned.ok) return;
    setSkillHubLoadError("");
    setSkillHubReady(true);
    setSkillHubSkills(scanned.imported);
    const reviewCandidateIds = newSkillHubCandidatesForReview(scanned.candidates, baseline);
    if (!reviewCandidateIds.length) {
      // skill-creator often asks one or more questions before writing files.
      // Retain the baseline so a later turn in this same task can detect them.
      return;
    }
    // A new directory is not proof that this conversation created it. Keep
    // every candidate unchecked and let the user choose what to import.
    skillCreatorBaselinesRef.current.set(threadId, Promise.resolve(
      new Set(scanned.candidates.map((candidate) => candidate.id))
    ));
    setSkillHubReviewCandidateIds(reviewCandidateIds);
    setSkillHubOpen(true);
  }

  async function stopRun() {
    if (!activeRunId) {
      return;
    }
    const stopResult = await workbench.stopCodex(activeRunId);
    if (!stopResult.ok) {
      addTimeline(activeThread.id, {
        runId: activeRunId,
        title: "正在确认停止请求",
        detail: stopResult.error || "运行状态尚未确认，确认后会自动停止。",
        kind: "event",
        status: "running"
      });
      return;
    }
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

  function activateThreadNow(threadId: string, expectedSelectionIntent?: number) {
    if (expectedSelectionIntent === undefined) {
      // Any direct activation (new task, PLAUD, suggestion, entity opening or
      // deletion fallback) supersedes an older async sidebar selection.
      threadSelectionIntentRef.current += 1;
    } else if (expectedSelectionIntent !== threadSelectionIntentRef.current) {
      return false;
    }
    if (!threadsRef.current.some((thread) => thread.id === threadId)) return false;
    activeThreadIdRef.current = threadId;
    setActiveThreadId(threadId);
    return true;
  }

  async function selectThread(threadId: string) {
    const selectionIntent = ++threadSelectionIntentRef.current;
    const selectionIsCurrent = () =>
      selectionIntent === threadSelectionIntentRef.current
      && threadsRef.current.some((thread) => thread.id === threadId);
    if (!selectionIsCurrent()) return false;
    if (threadId !== activeThreadIdRef.current && documentPreviewOriginRef.current) {
      if (markdownDocumentRef.current || markdownRequestLabel) {
        await closeMarkdown({ restoreOrigin: false });
        if (!selectionIsCurrent()) return false;
        if (markdownDocumentRef.current) return false;
      }
      if (pdfDocumentRef.current || pdfRequestLabel) closePdf({ restoreOrigin: false });
      documentPreviewOriginRef.current = null;
    }
    if (!selectionIsCurrent()) return false;
    rememberActiveChatScrollPosition();
    if (!await navigateWorkspace("conversation")) return false;
    if (!selectionIsCurrent()) return false;
    if (!activateThreadNow(threadId, selectionIntent)) return false;
    setDocumentLibrarySidebarExpanded(false);
    setThreadMenuId(null);
    setComposerDragActive(false);
    return true;
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

  async function deleteThread(thread: Thread) {
    const threadId = thread.id;
    const initialTarget = threadsRef.current.find((candidate) => candidate.id === threadId);
    if (!initialTarget || threadsRef.current.length <= 1 || threadDeletionIsBusy(threadId)) {
      return;
    }
    const confirmed = await requestConfirmation({
      title: "删除这段对话？",
      message: `“${initialTarget.title}”将从最近对话中移除。`,
      detail: "项目目录、研究文档和其他材料不会被删除。",
      confirmLabel: "删除对话",
      tone: "danger"
    });
    if (!confirmed) {
      return;
    }
    // The confirmation dialog yields to the event loop. A send preflight or
    // queue pump may have claimed this task while it was open, so re-check the
    // guards before removing its conversation, draft or staged attachments.
    const latestThreads = threadsRef.current;
    const latestTarget = latestThreads.find((candidate) => candidate.id === threadId);
    if (!latestTarget || latestThreads.length <= 1 || threadDeletionIsBusy(threadId)) {
      return;
    }
    const latestDraft = composerDraftsByThreadRef.current[threadId];
    const latestQueue = queuedSubmissionsByThreadRef.current[threadId] || [];
    const queuedIds = new Set(latestQueue.map((item) => item.id));
    const stagedPaths = [...new Set([
      ...(latestDraft?.attachments || []),
      ...latestQueue.flatMap((item) => item.attachments)
    ].map((attachment) => attachment.path))];
    void Promise.allSettled(
      stagedPaths.map((filePath) => workbench.discardStagedAttachment(filePath))
    );
    const remainingAfterDeletion = latestThreads.filter((item) => item.id !== threadId);
    threadsRef.current = remainingAfterDeletion;
    setThreads(remainingAfterDeletion);
    if (activeThreadIdRef.current === threadId) {
      const fallbackThreadId = remainingAfterDeletion[0]?.id;
      if (fallbackThreadId) activateThreadNow(fallbackThreadId);
    }
    setQueuedSubmissionsByThread((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      queuedSubmissionsByThreadRef.current = next;
      return next;
    });
    setPausedQueuedSubmissionIds((current) => {
      if (![...queuedIds].some((id) => current.has(id))) return current;
      return new Set([...current].filter((id) => !queuedIds.has(id)));
    });
    setComposerDraftsByThread((current) => {
      if (!current[threadId]) return current;
      const next = { ...current };
      delete next[threadId];
      composerDraftsByThreadRef.current = next;
      return next;
    });
    setThreadMenuId(null);
  }

  function toggleSection(section: keyof typeof openSections) {
    const opening = !openSections[section];
    setOpenSections((current) => ({ ...current, [section]: !current[section] }));
    if (section === "domi" && opening && plaudEnabled && !plaudSnapshot) {
      void refreshPlaudQueue();
    }
  }

  async function refreshDocumentLibrary(options: { silent?: boolean; force?: boolean } = {}) {
    const requestId = ++documentLibraryRequestRef.current;
    if (!options.silent) setDocumentLibraryLoading(true);
    setDocumentLibraryError("");
    try {
      const snapshot = await workbench.listDocumentLibrary({ force: options.force === true });
      if (requestId !== documentLibraryRequestRef.current) return null;
      if (!snapshot.ok) {
        setDocumentLibraryError(snapshot.error || "无法读取文档中心。");
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
      const message = describeOperationError(error, "无法读取文档中心。");
      setDocumentLibraryError(message);
      return null;
    } finally {
      if (requestId === documentLibraryRequestRef.current) setDocumentLibraryLoading(false);
    }
  }

  async function openDocumentLibrary() {
    const shouldExpand = workspaceViewRef.current === "documents"
      ? !documentLibrarySidebarExpanded
      : true;
    if (!await navigateWorkspace("documents")) return;
    setDocumentLibrarySidebarExpanded(shouldExpand);
    setThreadMenuId(null);
    setRightPanelOpen(false);
    if (!documentLibraryLoading) {
      void refreshDocumentLibrary({ silent: Boolean(documentLibrary) });
    }
  }

  async function openPrimaryWorkspace(view: "tasks" | "news" | "data") {
    if (!await navigateWorkspace(view)) return;
    setDocumentLibrarySidebarExpanded(false);
    setThreadMenuId(null);
    if (view !== "data") return;
    setRightPanelOpen(false);
    void refreshDatabase({ preserveSelection: true });
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
      selected?.scrollIntoView({ block: "nearest", inline: "nearest" });
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
    cancelPendingDomiEntityOpen();
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
      cancelPendingDomiEntityOpen();
      toggleDocumentLibraryFolder(node.path);
      return;
    }
    setDocumentLibrarySelectedFolder(parentPath);
    if (node.kind === "pdf") void openPdf(node.path);
    else void openMarkdown(node.path);
  }

  function rememberDocumentPreviewOrigin() {
    if (documentPreviewOriginRef.current) return;
    documentPreviewOriginRef.current = {
      workspaceView: workspaceViewRef.current,
      threadId: activeThreadIdRef.current,
      previousRightPanelOpen: rightPanelOpenRef.current
    };
  }

  function restoreDocumentPreviewOrigin() {
    const origin = documentPreviewOriginRef.current;
    documentPreviewOriginRef.current = null;
    if (!origin || workspaceViewRef.current !== origin.workspaceView) return;
    workspaceUiStateRef.current[origin.workspaceView].rightPanelOpen = origin.previousRightPanelOpen;
    setRightPanelOpen(origin.previousRightPanelOpen);
  }

  async function openMarkdown(
    resource: string,
    basePath?: string,
    entityOpenRequestId?: number,
    initialSearchQuery = ""
  ) {
    if (entityOpenRequestId === undefined) {
      cancelPendingDomiEntityOpen();
    } else if (entityOpenRequestId !== domiEntityOpenRequestRef.current) {
      return;
    }
    rememberDocumentPreviewOrigin();
    const currentDocument = markdownDocumentRef.current;
    if (currentDocument && markdownDraftRef.current !== currentDocument.content) {
      const saved = await saveOpenMarkdown();
      if (!saved) return;
    }
    if (
      entityOpenRequestId !== undefined
      && entityOpenRequestId !== domiEntityOpenRequestRef.current
    ) return;

    const requestId = ++markdownOpenRequestRef.current;
    pdfOpenRequestRef.current += 1;
    markdownSaveRequestRef.current += 1;
    markdownRenameRequestRef.current += 1;
    setMarkdownSaving(false);
    setMarkdownRenaming(false);
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
    if (workspaceViewRef.current !== "documents") setRightPanelOpen(true);
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
    setMarkdownInitialSearchQuery(initialSearchQuery);
    setMarkdownLoading(true);
    setMarkdownError("");
    try {
      const result = await workbench.readMarkdown({ resource, basePath });
      if (
        requestId !== markdownOpenRequestRef.current
        || (
          entityOpenRequestId !== undefined
          && entityOpenRequestId !== domiEntityOpenRequestRef.current
        )
      ) return;
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
      if (
        requestId !== markdownOpenRequestRef.current
        || (
          entityOpenRequestId !== undefined
          && entityOpenRequestId !== domiEntityOpenRequestRef.current
        )
      ) return;
      reportDocumentOperation("读取 Markdown", error);
      setMarkdownError(describeOperationError(error, "无法读取 Markdown 文件。"));
    } finally {
      if (requestId === markdownOpenRequestRef.current) setMarkdownLoading(false);
    }
  }

  async function openPdf(
    resource: string,
    basePath?: string,
    ignoreDirty = false,
    entityOpenRequestId?: number
  ) {
    if (entityOpenRequestId === undefined) {
      cancelPendingDomiEntityOpen();
    } else if (entityOpenRequestId !== domiEntityOpenRequestRef.current) {
      return;
    }
    rememberDocumentPreviewOrigin();
    const currentDocument = markdownDocumentRef.current;
    if (
      !ignoreDirty
      && currentDocument
      && markdownDraftRef.current !== currentDocument.content
    ) {
      const saved = await saveOpenMarkdown();
      if (!saved) return;
    }
    if (
      entityOpenRequestId !== undefined
      && entityOpenRequestId !== domiEntityOpenRequestRef.current
    ) return;

    const requestId = ++pdfOpenRequestRef.current;
    markdownOpenRequestRef.current += 1;
    markdownSaveRequestRef.current += 1;
    markdownRenameRequestRef.current += 1;
    setMarkdownSaving(false);
    setMarkdownRenaming(false);
    setMarkdownTitleEditing(false);
    setMarkdownTitleDraft("");
    if (workspaceViewRef.current !== "documents") setRightPanelOpen(true);
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
      if (
        requestId !== pdfOpenRequestRef.current
        || (
          entityOpenRequestId !== undefined
          && entityOpenRequestId !== domiEntityOpenRequestRef.current
        )
      ) return;
      if (!result.ok || !result.document) {
        setPdfError(result.error || "无法读取 PDF 文件。");
        return;
      }
      setPdfDocument(result.document);
      setPdfRequestLabel(result.document.path);
      setPdfFrameLoading(true);
    } catch (error) {
      if (
        requestId !== pdfOpenRequestRef.current
        || (
          entityOpenRequestId !== undefined
          && entityOpenRequestId !== domiEntityOpenRequestRef.current
        )
      ) return;
      reportDocumentOperation("读取 PDF", error);
      setPdfError(describeOperationError(error, "无法读取 PDF 文件。"));
    } finally {
      if (requestId === pdfOpenRequestRef.current) setPdfLoading(false);
    }
  }

  function openDocument(resource: string, initialSearchQuery = "") {
    if (isLocalPdfResource(resource)) {
      void openPdf(resource);
      return;
    }
    void openMarkdown(resource, undefined, undefined, initialSearchQuery);
  }

  function clearMarkdownAutoSaveTimer() {
    if (markdownAutoSaveTimerRef.current === null) return;
    window.clearTimeout(markdownAutoSaveTimerRef.current);
    markdownAutoSaveTimerRef.current = null;
  }

  function scheduleMarkdownAutoSave(delayMs = MARKDOWN_AUTO_SAVE_DELAY_MS) {
    clearMarkdownAutoSaveTimer();
    const document = markdownDocumentRef.current;
    if (
      !document
      || markdownDraftRef.current === document.content
      || markdownRenameInFlightRef.current
    ) return;
    const contentLength = markdownDraftRef.current.length;
    const adaptiveDelayMs = contentLength >= 2 * 1024 * 1024
      ? 1_000
      : contentLength >= 512 * 1024
        ? 650
        : MARKDOWN_AUTO_SAVE_DELAY_MS;
    markdownAutoSaveTimerRef.current = window.setTimeout(() => {
      markdownAutoSaveTimerRef.current = null;
      void saveOpenMarkdown();
    }, Math.max(delayMs, adaptiveDelayMs));
  }

  function scheduleMarkdownAutoSaveRetry() {
    const retryIndex = markdownAutoSaveRetryRef.current;
    if (retryIndex >= MARKDOWN_AUTO_SAVE_RETRY_DELAYS_MS.length) return;
    markdownAutoSaveRetryRef.current += 1;
    scheduleMarkdownAutoSave(MARKDOWN_AUTO_SAVE_RETRY_DELAYS_MS[retryIndex]);
  }

  async function saveOpenMarkdown(): Promise<boolean> {
    clearMarkdownAutoSaveTimer();

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const activeSave = markdownSaveInFlightRef.current;
      if (activeSave) {
        if (!await activeSave) return false;
        continue;
      }

      const document = markdownDocumentRef.current;
      const content = markdownDraftRef.current;
      if (!document || content === document.content) return true;
      if (markdownRenameInFlightRef.current) {
        scheduleMarkdownAutoSave(180);
        return false;
      }

      const requestId = ++markdownSaveRequestRef.current;
      setMarkdownSaving(true);
      setMarkdownError("");
      const pendingSave = (async () => {
        try {
          const result = await workbench.saveMarkdown({
            path: document.path,
            content,
            expectedMtimeMs: document.mtimeMs
          });
          if (
            requestId !== markdownSaveRequestRef.current
            || markdownDocumentRef.current?.path !== document.path
          ) return false;
          if (!result.ok || !result.document) {
            const message = result.error || "自动保存 Markdown 文件失败。";
            setMarkdownError(result.conflict
              ? message
              : `${message} domi 将在后台重试。`);
            if (!result.conflict) scheduleMarkdownAutoSaveRetry();
            return false;
          }
          markdownAutoSaveRetryRef.current = 0;
          markdownDocumentRef.current = result.document;
          setMarkdownDocument(result.document);
          if (markdownDraftRef.current === content) {
            markdownDraftRef.current = result.document.content;
            setMarkdownDraft(result.document.content);
          }
          return true;
        } catch (error) {
          if (requestId !== markdownSaveRequestRef.current) return false;
          reportDocumentOperation("自动保存 Markdown", error);
          setMarkdownError(
            `${describeOperationError(error, "自动保存 Markdown 文件失败。")} domi 将在后台重试。`
          );
          scheduleMarkdownAutoSaveRetry();
          return false;
        }
      })();

      markdownSaveInFlightRef.current = pendingSave;
      let saved = false;
      try {
        saved = await pendingSave;
      } finally {
        if (markdownSaveInFlightRef.current === pendingSave) {
          markdownSaveInFlightRef.current = null;
        }
        if (requestId === markdownSaveRequestRef.current) setMarkdownSaving(false);
      }
      if (!saved) return false;
    }

    setMarkdownError("内容仍在快速变化，domi 会继续自动保存。");
    scheduleMarkdownAutoSave(180);
    return false;
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
    if (!markdownDocument || markdownRenameInFlightRef.current || markdownRenaming) return;
    const contentSaved = await saveOpenMarkdown();
    if (!contentSaved) return;
    const document = markdownDocumentRef.current;
    if (!document) return;
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

  async function closeMarkdown(options: { restoreOrigin?: boolean } = {}) {
    cancelPendingDomiEntityOpen();
    const currentDocument = markdownDocumentRef.current;
    if (currentDocument && markdownDraftRef.current !== currentDocument.content) {
      const saved = await saveOpenMarkdown();
      if (!saved) return;
    }
    clearMarkdownAutoSaveTimer();
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
    if (options.restoreOrigin !== false) restoreDocumentPreviewOrigin();
  }

  async function openMarkdownInExternalEditor() {
    if (markdownExternalOpenInFlightRef.current) return;
    const initialDocument = markdownDocumentRef.current;
    if (!initialDocument) return;

    markdownExternalOpenInFlightRef.current = true;
    setMarkdownExternalOpening(true);
    setMarkdownError("");
    let releasedDocumentPath = "";
    try {
      if (!await saveOpenMarkdown()) return;
      const document = markdownDocumentRef.current;
      if (!document) return;
      releasedDocumentPath = document.path;

      // Release the internal editor before another application receives the
      // file. This prevents two editors and their file watchers from owning the
      // same Markdown save lifecycle at the same time.
      await closeMarkdown();
      const result = await workbench.openMarkdownExternal(releasedDocumentPath);
      if (!result.ok) {
        await openMarkdown(releasedDocumentPath);
        setMarkdownError(result.error || "无法用系统文本编辑器打开 Markdown 文件。");
      }
    } catch (error) {
      reportDocumentOperation("外部打开 Markdown", error);
      if (releasedDocumentPath) await openMarkdown(releasedDocumentPath);
      setMarkdownError(describeOperationError(error, "无法用系统文本编辑器打开 Markdown 文件。"));
    } finally {
      markdownExternalOpenInFlightRef.current = false;
      setMarkdownExternalOpening(false);
    }
  }

  async function reloadOpenPdf() {
    if (!pdfDocument) return;
    await openPdf(pdfDocument.path, undefined, true);
  }

  function closePdf(options: { restoreOrigin?: boolean } = {}) {
    cancelPendingDomiEntityOpen();
    pdfOpenRequestRef.current += 1;
    setPdfDocument(null);
    setPdfError("");
    setPdfRequestLabel("");
    setPdfLoading(false);
    setPdfFrameLoading(false);
    if (options.restoreOrigin !== false) restoreDocumentPreviewOrigin();
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
                  <span
                    className={`markdown-save-state ${markdownDirty ? "dirty" : ""}`}
                    aria-live="polite"
                  >
                    {markdownSaving
                      ? "自动保存中"
                      : markdownRenaming
                        ? "正在重命名"
                        : markdownDirty
                          ? "等待自动保存"
                          : "已自动保存"}
                  </span>
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
                  onClick={() => void openMarkdownInExternalEditor()}
                  disabled={markdownExternalOpening || markdownRenaming || markdownTitleEditing}
                  title="用系统文本编辑器打开"
                  aria-label="用系统文本编辑器打开"
                >
                  {markdownExternalOpening
                    ? <RefreshCw className="spinning" size={16} />
                    : <ExternalLink size={16} />}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void closeMarkdown()}
              title="关闭文档"
              aria-label="关闭文档"
            >
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
              documentKey={`${markdownDocument.path}:${markdownOpenRequestRef.current}`}
            >
              <Suspense fallback={<div className="markdown-panel-state"><RefreshCw className="spinning" size={18} />正在加载编辑器</div>}>
                <RichMarkdownEditor
                  key={`${markdownDocument.path}:${markdownOpenRequestRef.current}`}
                  documentPath={markdownDocument.path}
                  markdown={markdownDraft}
                  initialSearchQuery={markdownInitialSearchQuery}
                  onCopyDocument={() => void copyOpenMarkdown()}
                  onBlur={() => void saveOpenMarkdown()}
                  onOpenDocument={openDocument}
                  onChange={(content) => {
                    markdownAutoSaveRetryRef.current = 0;
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
            <button type="button" onClick={() => closePdf()} title="关闭文档" aria-label="关闭 PDF">
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
      ? "文档中心根目录"
      : documentLibrarySelectedFolder.split(/[\\/]/).filter(Boolean).pop() || "文档中心根目录";
    return (
      <div className="sidebar-document-library" aria-label="文档中心目录">
        <div className="sidebar-document-toolbar">
          <span title={documentLibrary?.rootName || "本地工作区"}>
            {documentLibrary?.rootName || "本地工作区"}
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
              title="在访达中打开文档中心"
              aria-label="在访达中打开文档中心"
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
              cancelPendingDomiEntityOpen();
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
                cancelPendingDomiEntityOpen();
                setDocumentLibraryQuery("");
                setDocumentLibrarySearchActivePath("");
              }
            }}
            placeholder="搜索文档和文件夹"
            aria-label="搜索文档中心"
          />
          {documentLibraryQuery && (
            <button
              type="button"
              onClick={() => {
                cancelPendingDomiEntityOpen();
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
            if (rootPath) {
              cancelPendingDomiEntityOpen();
              setDocumentLibrarySelectedFolder(rootPath);
            }
          }}
          disabled={!rootPath}
          title={rootPath}
        >
          <FolderOpen size={15} />
          <span>全部文档</span>
        </button>

        <div className="document-library-tree" role="tree" ref={documentLibraryTreeRef}>
          {documentLibraryNotice && (
            <div className="document-library-notice" role="status">
              <FileText size={14} aria-hidden="true" />
              <span>{documentLibraryNotice}</span>
            </div>
          )}
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
              {documentLibraryQuery ? "没有匹配的文档" : "文档中心还是空的"}
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
              <p>在左侧“文档中心”中展开目录，即可查看并编辑本地 Markdown。</p>
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
              disabled={Boolean(executingSuggestionId || domiTaskSyncQueued)
                || !domiTaskBoard?.configured}
              title={`运行 Todo Skill，更新 ${todoDocumentLabel} 后刷新看板`}
            >
              <RefreshCw
                className={executingSuggestionId === "managed-refresh"
                  ? "spinning"
                  : ""}
                size={14}
              />
              {executingSuggestionId === "managed-refresh"
                ? "同步中"
                : domiTaskSyncQueued
                  ? "等待中"
                  : "同步"}
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
                {queuedTaskItems.map(({ submission, thread }) => {
                  const repositoryMismatch = Boolean(
                    appSettings
                    && (!submission.repositoryIdentity
                      || submission.repositoryIdentity !== queueRepositoryIdentity(appSettings))
                  );
                  return (
                  <article className="task-card queued" key={submission.id}>
                    <div className="task-card-topline">
                      <span className="task-card-kind">
                        {!thread
                          ? "原对话已删除"
                          : repositoryMismatch
                            ? "资料库已变更"
                          : pausedQueuedSubmissionIds.has(submission.id)
                            ? "等待重试"
                            : "已排队"}
                      </span>
                      <time>{formatTaskTimestamp(submission.createdAt)}</time>
                    </div>
                    <button
                      className="task-card-open"
                      type="button"
                      onClick={() => thread && selectThread(thread.id)}
                      disabled={!thread}
                    >
                      <strong className="task-card-title">{submission.input}</strong>
                      <p>{thread?.title || "任务不会自动执行，可从队列安全移除"}</p>
                    </button>
                    <div className="task-card-actions end-aligned">
                      {thread && pausedQueuedSubmissionIds.has(submission.id) && (
                        <button type="button" onClick={() => void retryQueuedSubmission(submission.id)} title="重试">
                          <RefreshCw size={14} />
                        </button>
                      )}
                      {thread && (
                        <button type="button" onClick={() => selectThread(thread.id)} title="打开对话">
                          <ChevronRight size={14} />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeQueuedSubmission(submission.threadId, submission.id)}
                        disabled={queuedSubmissionRemovalIsBusy(submission.threadId, submission.id)}
                        title="从队列移除"
                        aria-label={`从队列移除 ${submission.input}`}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                  );
                })}
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
            <div className="weekly-news-domain-manager-wrap">
              <button
                className="weekly-news-source weekly-news-domain-manager-button"
                type="button"
                onClick={openRadarDomainManager}
                aria-expanded={radarDomainManagerOpen}
                aria-haspopup="dialog"
              >
                <Target size={13} />关注领域 {weeklyNewsDomains.length}/{RADAR_DOMAIN_ORDER.length}
              </button>
              {radarDomainManagerOpen && (
                <div className="weekly-news-domain-manager" role="dialog" aria-label="Radar 关注领域">
                  <div className="weekly-news-domain-manager-heading">
                    <div><strong>Radar 关注领域</strong><small>仅搜集已选择领域的新动态</small></div>
                    <button type="button" aria-label="关闭关注领域设置" onClick={() => setRadarDomainManagerOpen(false)}><X size={15} /></button>
                  </div>
                  <div className="weekly-news-domain-options">
                    {RADAR_DOMAIN_ORDER.map((domain) => (
                      <label key={domain}>
                        <input
                          type="checkbox"
                          checked={radarDomainDraft.includes(domain)}
                          onChange={() => toggleRadarDomainDraft(domain)}
                        />
                        <span>{domain}</span>
                      </label>
                    ))}
                  </div>
                  <p>未选择领域将停止后续搜集，历史动态仍保留。</p>
                  <div className="weekly-news-domain-manager-actions">
                    <button type="button" onClick={() => setRadarDomainDraft([...RADAR_DOMAIN_ORDER])}>全选</button>
                    <button type="button" className="primary" disabled={radarDomainSaving} onClick={() => void saveRadarDomainPreferences()}>
                      {radarDomainSaving ? "保存中" : "应用，下轮生效"}
                    </button>
                  </div>
                </div>
              )}
            </div>
            <button
              className="weekly-news-source weekly-news-source-manager"
              type="button"
              onClick={() => setRadarSourceManagerOpen(true)}
              title="添加新闻源、重点公众号或播客"
              aria-haspopup="dialog"
              aria-controls="radar-source-panel"
            >
              <Settings size={13} />信源管理
            </button>
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

        <div className="weekly-news-followed-summary">
          {weeklyNewsDomains.length
            ? <>当前搜集：{weeklyNewsDomains.join("、")}</>
            : <>行业雷达已暂停，历史动态仍保留</>}
        </div>

        {weeklyNewsDomains.length > 0 && (
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
                      (item) => followedDomainsForNews(item, weeklyNewsDomains).includes(weeklyNewsDomain)
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
              const itemFollowedDomains = followedDomainsForNews(item, weeklyNewsDomains);
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
    const classificationReviews = databaseSnapshot?.classificationReviews || [];
    const selectedClassificationReview = classificationReviews.find((item) =>
      item.project.recordId === classificationSelectedId
    ) || classificationReviews[0];
    const taxonomyDomains = databaseSnapshot?.taxonomy?.domains
      || Object.entries(PROJECT_DOMAIN_SUBDOMAINS).map(([name, subdomains]) => ({
        name,
        subdomains: [...subdomains]
      }));
    const selectableTaxonomyDomains = taxonomyDomains.filter((item) => item.name !== "消费科技");
    const selectedTaxonomyDomain = taxonomyDomains.find((item) => item.name === classificationDomain);
    const classificationSubdomainValues = splitDatabaseList(classificationSubdomains);
    const unknownClassificationSubdomain = classificationSubdomainValues.find((item) =>
      !(selectedTaxonomyDomain?.subdomains || []).some((candidate) =>
        candidate.localeCompare(item, "zh-CN", { sensitivity: "base" }) === 0
      )
    );
    const query = deferredDatabaseQuery.trim().toLocaleLowerCase("zh-CN");
    const filterOptions = DATABASE_FILTER_OPTIONS[databaseEntityType];
    const filterValueOptions = databaseFilterValueOptions(
      databaseEntityType,
      records,
      databaseFilterKey
    );
    const sortOptions = DATABASE_SORT_OPTIONS[databaseEntityType];
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
              (record as DomiPerson).status,
              ...((record as DomiPerson).documents
                || (record as DomiPerson).interactionDocuments
                || []).flatMap((document) => [document.kind, document.title])
            ].join(" ")
          : [
              (record as DomiNewsItem).title,
              ...(record as DomiNewsItem).domains,
              ...(record as DomiNewsItem).subdomains,
              (record as DomiNewsItem).source,
              (record as DomiNewsItem).summary
            ].join(" ");
      const matchesQuery = !query || searchText.toLocaleLowerCase("zh-CN").includes(query);
      const filterValues = databaseFilterValues(databaseEntityType, record, databaseFilterKey);
      const matchesFilter = databaseFilterKey === "none"
        || databaseFilterValue === "全部"
        || (databaseFilterValue === DATABASE_EMPTY_FILTER_VALUE
          ? filterValues.length === 0
          : filterValues.includes(databaseFilterValue));
      return matchesQuery && matchesFilter;
    }).sort((left, right) => {
      const direction = databaseSortDirection === "asc" ? 1 : -1;
      const leftValue = databaseSortValue(databaseEntityType, left, databaseSortKey);
      const rightValue = databaseSortValue(databaseEntityType, right, databaseSortKey);
      if (leftValue === null && rightValue === null) {
        return databaseRecordTitle(databaseEntityType, left)
          .localeCompare(databaseRecordTitle(databaseEntityType, right), "zh-CN", { numeric: true });
      }
      if (leftValue === null) return 1;
      if (rightValue === null) return -1;
      const comparison = typeof leftValue === "number" && typeof rightValue === "number"
        ? leftValue - rightValue
        : String(leftValue).localeCompare(String(rightValue), "zh-CN", {
            numeric: true,
            sensitivity: "base"
          });
      return direction * comparison
        || databaseRecordTitle(databaseEntityType, left)
          .localeCompare(databaseRecordTitle(databaseEntityType, right), "zh-CN", { numeric: true });
    });
    const visibleRecords = filtered.slice(0, databaseVisibleLimit);
    const stopGridEvent = (event: SyntheticEvent) => event.stopPropagation();
    const resourceLink = (
      entityType: DatabaseEntityType,
      record: DomiProject | DomiPerson | DomiNewsItem
    ) => {
      const resource = entityType === "news"
        ? (record as DomiNewsItem).url
        : entityType === "person"
          ? (record as DomiPerson).link
          : "internal-preview";
      if (!resource) return <span className="database-grid-empty-value">—</span>;
      return (
        <button
          type="button"
          className="database-grid-link"
          title={entityType === "news"
            ? "打开原文"
            : entityType === "person"
              ? "在右侧打开人物主页"
              : "在右侧预览项目中最有信息量的文档"}
          onClick={(event) => {
            event.stopPropagation();
            if (entityType === "person") openDocument(resource);
            else void previewDatabaseRecord(entityType, record);
          }}
        >
          <FileText size={14} />
          <span>{entityType === "news" ? "原文" : entityType === "person" ? "主页" : "预览"}</span>
        </button>
      );
    };
    const personDocumentLink = (person: DomiPerson) => {
      const documents = person.documents || person.interactionDocuments || [];
      const latest = documents[0];
      if (!latest?.link) return <span className="database-grid-empty-value">—</span>;
      if (documents.length > 1) {
        return (
          <select
            className="database-grid-document-select"
            value=""
            title={`查看 ${documents.length} 篇人物相关文档`}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => {
              event.stopPropagation();
              const resource = event.target.value;
              if (resource) openDocument(resource);
            }}
          >
            <option value="" disabled>查看 {documents.length} 篇</option>
            {documents.map((document) => (
              <option key={document.link} value={document.link}>
                {document.kind ? `${document.kind} · ` : ""}{document.title}
              </option>
            ))}
          </select>
        );
      }
      return (
        <button
          type="button"
          className="database-grid-link"
          title={`在右侧查看：${latest.title}`}
          onClick={(event) => {
            event.stopPropagation();
            openDocument(latest.link);
          }}
        >
          <FileText size={14} />
          <span>{latest.kind ? `${latest.kind} · ` : ""}{latest.title}</span>
        </button>
      );
    };

    const projectStatusOptions = databaseGridOptions([
      "待交流", "已交流", "深度跟踪", "已投", "Miss", "放弃",
      ...(databaseSnapshot?.projects || []).map((project) => project.status)
    ]);
    const ratingOptions = databaseGridOptions(["S", "A", "B", "C"]);
    const domainOptions = databaseGridOptions([
      ...selectableTaxonomyDomains.map((item) => item.name),
      ...(databaseSnapshot?.projects || [])
        .map((project) => project.domain)
        .filter((domain) => domain === "消费科技")
    ]);
    const subdomainOptions = databaseGridOptions(taxonomyDomains.flatMap((item) => item.subdomains));
    const cityOptions = databaseGridOptions([
      ...(databaseSnapshot?.projects || []).flatMap((project) => project.cities || []),
      ...(databaseSnapshot?.people || []).flatMap((person) => person.cities || [])
    ]);
    const trackedInvestorOptions = databaseGridOptions([
      "红杉", "高瓴", "IDG", "锦秋", "Monolith/励思资本", "五源", "蓝驰", "经纬"
    ]);
    const personTypeOptions = databaseGridOptions(
      (databaseSnapshot?.people || []).flatMap((person) => person.types || [])
    );
    const personStatusOptions = databaseGridOptions(
      (databaseSnapshot?.people || []).map((person) => person.status)
    );
    const newsDomainOptions = databaseGridOptions([
      ...selectableTaxonomyDomains.map((item) => item.name),
      ...(databaseSnapshot?.news || []).flatMap((item) => item.domains || [])
    ]);
    const newsSubdomainOptions = databaseGridOptions([
      ...taxonomyDomains.flatMap((item) => item.subdomains),
      ...(databaseSnapshot?.news || []).flatMap((item) => item.subdomains || [])
    ]);
    const newsTypeOptions = databaseGridOptions(
      (databaseSnapshot?.news || []).flatMap((item) => item.types || [])
    );
    const evidenceOptions = databaseGridOptions([
      "官方确认", "多源核验", "单一来源", "待核验",
      ...(databaseSnapshot?.news || []).map((item) => item.evidenceStatus)
    ]);

    const projectGridColumns: DatabaseGridColumn<DomiProject>[] = [
      { key: "name", label: "公司名称", kind: "text", width: 220, minWidth: 150, required: true },
      { key: "notes", label: "Notes", kind: "longtext", width: 320, minWidth: 220 },
      {
        key: "preview",
        label: "链接",
        kind: "link",
        width: 96,
        minWidth: 82,
        editable: false,
        getValue: () => "预览"
      },
      {
        key: "lastFollowup",
        label: "最后更新",
        kind: "date",
        width: 126,
        editable: false,
        getValue: (project) => project.lastFollowup || project.updatedAt || null
      },
      { key: "domain", label: "领域", kind: "single", width: 128, options: domainOptions },
      {
        key: "subdomains",
        label: "子领域",
        kind: "multi",
        width: 220,
        options: subdomainOptions,
        allowCustomOptions: true
      },
      { key: "status", label: "进展状态", kind: "single", width: 128, options: projectStatusOptions },
      { key: "rating", label: "项目评级", kind: "single", width: 104, options: ratingOptions },
      {
        key: "latestValuationUsd100m",
        label: "最新估值",
        kind: "number",
        width: 120,
        align: "right",
        formatValue: (value) => value === null || value === undefined || value === ""
          ? "—"
          : `${value} 亿美元`
      },
      {
        key: "investors",
        label: "投资机构",
        kind: "multi",
        width: 220,
        options: trackedInvestorOptions
      },
      {
        key: "cities",
        label: "城市",
        kind: "multi",
        width: 150,
        options: cityOptions,
        allowCustomOptions: true
      },
      { key: "createdAt", label: "入库时间", kind: "date", width: 126, editable: false },
      { key: "financingHistory", label: "历史融资", kind: "longtext", width: 360, minWidth: 240 }
    ];

    const personGridColumns: DatabaseGridColumn<DomiPerson>[] = [
      { key: "name", label: "姓名", kind: "text", width: 180, minWidth: 130, required: true },
      { key: "organization", label: "所属组织与身份", kind: "longtext", width: 320, minWidth: 220 },
      {
        key: "types",
        label: "类型",
        kind: "multi",
        width: 190,
        options: personTypeOptions,
        allowCustomOptions: true
      },
      {
        key: "status",
        label: "进展状态",
        kind: "single",
        width: 128,
        options: personStatusOptions,
        allowCustomOptions: true
      },
      { key: "rating", label: "评级", kind: "single", width: 92, options: ratingOptions },
      { key: "lastContact", label: "最后联系", kind: "date", width: 126 },
      {
        key: "cities",
        label: "城市",
        kind: "multi",
        width: 150,
        options: cityOptions,
        allowCustomOptions: true
      },
      { key: "createdAt", label: "入库时间", kind: "date", width: 126, editable: false },
      {
        key: "documents",
        label: "相关文档",
        kind: "link",
        width: 190,
        editable: false,
        getValue: (person) => {
          const documents = person.documents || person.interactionDocuments || [];
          return documents.length ? `${documents.length} 篇纪要` : "";
        }
      },
      {
        key: "link",
        label: "人物主页",
        kind: "link",
        width: 110,
        editable: false,
        getValue: (person) => person.link ? "主页" : ""
      }
    ];

    const newsGridColumns: DatabaseGridColumn<DomiNewsItem>[] = [
      { key: "title", label: "新闻标题", kind: "longtext", width: 300, minWidth: 200, required: true },
      { key: "summary", label: "核心事实", kind: "longtext", width: 360, minWidth: 240 },
      { key: "publishedAt", label: "发布时间", kind: "date", width: 126 },
      {
        key: "domains",
        label: "领域",
        kind: "multi",
        width: 180,
        options: newsDomainOptions,
        allowCustomOptions: true
      },
      {
        key: "subdomains",
        label: "子领域",
        kind: "multi",
        width: 220,
        options: newsSubdomainOptions,
        allowCustomOptions: true
      },
      {
        key: "types",
        label: "信息类型",
        kind: "multi",
        width: 180,
        options: newsTypeOptions,
        allowCustomOptions: true
      },
      { key: "source", label: "来源", kind: "text", width: 150 },
      { key: "importance", label: "重要性", kind: "number", width: 100, align: "right" },
      { key: "confidence", label: "置信度", kind: "number", width: 100, align: "right" },
      {
        key: "evidenceStatus",
        label: "证据状态",
        kind: "single",
        width: 140,
        options: evidenceOptions,
        allowCustomOptions: true
      },
      { key: "action", label: "建议动作", kind: "longtext", width: 300, minWidth: 220 },
      { key: "worthFollowing", label: "继续展示", kind: "boolean", width: 104, align: "center" },
      {
        key: "url",
        label: "原文",
        kind: "link",
        width: 100,
        editable: false,
        getValue: (item) => item.url ? "原文" : ""
      }
    ];

    const requestDatabaseGridDelete = (
      entityType: DatabaseEntityType,
      record: DomiProject | DomiPerson | DomiNewsItem
    ) => {
      setDatabaseDeleteTarget({
        entityType,
        recordId: record.recordId,
        expectedUpdatedAt: Number(record.updatedAt) || 0,
        title: databaseRecordTitle(entityType, record)
      });
      setDatabaseError("");
    };

    return (
      <div className="database-stage">
        <div className="database-toolbar">
          <div className="database-tabs" role="tablist" aria-label="投资档案类型">
            {([
              ["project", "项目库", databaseSnapshot?.projects?.length || 0],
              ["person", "人脉库", databaseSnapshot?.people?.length || 0],
              ["news", "行业信息库", databaseSnapshot?.news?.length || 0],
              ["classification", "分类审核", classificationReviews.length]
            ] as Array<[DatabaseWorkspaceTab, string, number]>).map(([type, label, count]) => (
              <button
                key={type}
                type="button"
                className={databaseWorkspaceTab === type ? "active" : ""}
                onClick={() => type === "classification"
                  ? switchDatabaseClassification()
                  : switchDatabaseEntity(type)}
                role="tab"
                aria-selected={databaseWorkspaceTab === type}
              >
                {label}<span>{count}</span>
              </button>
            ))}
          </div>
          <div className="database-backend-badge">
            <Database size={15} />
            {databaseSnapshot?.backend === "local" ? "本地 SQLite · 自动保存到 Markdown" : "投资档案"}
          </div>
        </div>

        {databaseError && (
          <div className="database-message error"><AlertCircle size={15} />{databaseError}</div>
        )}
        {databaseNotice && (
          <div className="database-message success">
            <CheckCircle2 size={15} />
            <span>{databaseNotice}</span>
            {classificationUndo && (
              <button
                type="button"
                className="database-message-action"
                onClick={() => void mutateProjectClassification("undo")}
                disabled={classificationSaving}
              >
                撤销“{classificationUndo.projectName}”分类
              </button>
            )}
          </div>
        )}
        {databaseLoading && !databaseSnapshot && (
          <div className="database-empty"><RefreshCw className="spinning" size={18} />正在读取投资档案</div>
        )}
        {databaseSnapshot && !databaseSnapshot.editable && (
          <div className="database-empty">
            <AlertCircle size={18} />
            {databaseSnapshot.error || "当前投资档案暂不支持在客户端内直接编辑。"}
          </div>
        )}

        {databaseSnapshot?.editable && databaseWorkspaceTab === "classification" && (
          <div className="classification-review-layout">
            <aside className="classification-review-list" aria-label="待分类项目">
              <header>
                <div>
                  <strong>待审核项目</strong>
                  <span>{classificationReviews.length} 个</span>
                </div>
                <small>先看项目自身材料，再决定正式分类</small>
              </header>
              {classificationReviews.length === 0 ? (
                <div className="classification-review-empty">
                  <CheckCircle2 size={22} />
                  <strong>当前没有待审核项目</strong>
                  <span>新入库的未分类项目会自动出现在这里。</span>
                </div>
              ) : (
                <div className="classification-review-items">
                  {classificationReviews.map((review) => (
                    <button
                      key={review.project.recordId}
                      type="button"
                      className={selectedClassificationReview?.project.recordId === review.project.recordId ? "active" : ""}
                      onClick={() => {
                        setClassificationDraftFromReview(review);
                        setDatabaseError("");
                        setDatabaseNotice("");
                      }}
                    >
                      <span className="classification-review-item-title">
                        <strong>{review.project.name}</strong>
                        <em className={review.status}>{review.status === "deferred" ? "已暂缓" : "待审核"}</em>
                      </span>
                      <span className="classification-review-current">
                        当前：{review.project.domain || "未分类"}
                        {review.project.subdomains.length ? ` / ${review.project.subdomains.join("、")}` : ""}
                      </span>
                      <span className="classification-review-suggestion">
                        建议：{review.suggestedDomain || "待人工判断"}
                        {review.suggestedSubdomains.length ? ` / ${review.suggestedSubdomains.join("、")}` : ""}
                      </span>
                      <span className="classification-review-confidence">
                        <i style={{ width: `${Math.round(review.confidence * 100)}%` }} />
                        {review.confidence > 0 ? `${Math.round(review.confidence * 100)}%` : "未自动判断"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </aside>

            <section className="classification-review-detail">
              {!selectedClassificationReview ? (
                <div className="classification-review-empty">
                  <Sparkles size={24} />
                  <strong>分类审核已完成</strong>
                  <span>以后出现未分类项目时，可在这里查看证据并确认。</span>
                </div>
              ) : (
                <>
                  <header className="classification-detail-header">
                    <div>
                      <span className="classification-kicker">分类审核</span>
                      <h2>{selectedClassificationReview.project.name}</h2>
                      <p>{selectedClassificationReview.reason}</p>
                    </div>
                    <button
                      type="button"
                      className="classification-preview-button"
                      onClick={() => void previewDatabaseRecord("project", selectedClassificationReview.project)}
                    >
                      <FileText size={14} />预览核心文档
                    </button>
                  </header>

                  <div className="classification-form-card">
                    <label>
                      <span>正式一级领域</span>
                      <select
                        value={classificationDomain}
                        onChange={(event) => {
                          const nextDomain = event.target.value;
                          setClassificationDomain(nextDomain);
                          const suggested = selectedClassificationReview.suggestedDomain === nextDomain
                            ? selectedClassificationReview.suggestedSubdomains
                            : [];
                          setClassificationSubdomains(suggested.join("、"));
                          setDatabaseError("");
                        }}
                      >
                        <option value="">请选择</option>
                        {selectableTaxonomyDomains.map((item) => <option key={item.name}>{item.name}</option>)}
                      </select>
                    </label>
                    <label className="classification-subdomain-field">
                      <span>正式子领域</span>
                      <input
                        list="classification-subdomain-options"
                        value={classificationSubdomains}
                        placeholder="选择已有子领域，或直接输入新名称"
                        onChange={(event) => {
                          setClassificationSubdomains(event.target.value);
                          setDatabaseError("");
                        }}
                      />
                      <datalist id="classification-subdomain-options">
                        {(selectedTaxonomyDomain?.subdomains || []).map((item) => (
                          <option key={item} value={item} />
                        ))}
                      </datalist>
                      <small>多个子领域用顿号、逗号或换行分隔；第一个将作为主子领域和目录层级。</small>
                    </label>
                    {unknownClassificationSubdomain && classificationDomain && (
                      <button
                        type="button"
                        className="classification-create-option"
                        onClick={() => setClassificationCreateDialog({
                          recordId: selectedClassificationReview.project.recordId,
                          name: unknownClassificationSubdomain,
                          parentDomain: classificationDomain
                        })}
                      >
                        <Plus size={14} />
                        将“{unknownClassificationSubdomain}”新建为正式子领域
                      </button>
                    )}
                  </div>

                  <div className="classification-evidence-groups">
                    {([
                      ["project", "项目自身材料", "可作为项目事实与分类依据"],
                      ["comparable", "可比公司 / 相关公司", "仅用于理解相似性，不写成项目事实"],
                      ["industry", "行业与赛道材料", "仅用于判断行业边界与命名"]
                    ] as const).map(([role, label, hint]) => {
                      const evidence = selectedClassificationReview.evidence.filter((item) => item.role === role);
                      return (
                        <section key={role} className={`classification-evidence-group ${role}`}>
                          <header>
                            <div><strong>{label}</strong><span>{evidence.length}</span></div>
                            <small>{hint}</small>
                          </header>
                          {evidence.length === 0 ? (
                            <div className="classification-evidence-empty">暂无此类材料</div>
                          ) : evidence.map((item) => (
                            <button
                              key={item.resource || item.relativePath}
                              type="button"
                              onClick={() => item.resource && openDocument(item.resource)}
                            >
                              <FileText size={14} />
                              <span>
                                <strong>{item.title}</strong>
                                <small>{item.snippet || item.relativePath}</small>
                              </span>
                              <ChevronRight size={14} />
                            </button>
                          ))}
                        </section>
                      );
                    })}
                  </div>

                  <footer className="classification-review-actions">
                    <button
                      type="button"
                      onClick={() => void mutateProjectClassification("defer")}
                      disabled={classificationSaving}
                    >
                      稍后处理
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void mutateProjectClassification("apply")}
                      disabled={classificationSaving || !classificationDomain || !classificationSubdomainValues.length}
                    >
                      {classificationSaving
                        ? <><RefreshCw className="spinning" size={14} />正在同步</>
                        : <><Check size={14} />确认并同步分类</>}
                    </button>
                  </footer>
                </>
              )}
            </section>
          </div>
        )}

        {databaseSnapshot?.editable && databaseWorkspaceTab !== "classification" && (
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
                  value={databaseFilterKey}
                  onChange={(event) => {
                    setDatabaseFilterKey(event.target.value as DatabaseFilterKey);
                    setDatabaseFilterValue("全部");
                    setDatabaseVisibleLimit(100);
                  }}
                >
                  {filterOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </label>
              {databaseFilterKey !== "none" && (
                <label className="database-grid-filter database-grid-filter-value">
                  <span>条件</span>
                  <select
                    value={databaseFilterValue}
                    onChange={(event) => {
                      setDatabaseFilterValue(event.target.value);
                      setDatabaseVisibleLimit(100);
                    }}
                  >
                    {filterValueOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}
              <label className="database-grid-filter">
                <span>排序</span>
                <select
                  value={databaseSortKey}
                  onChange={(event) => {
                    setDatabaseSortKey(event.target.value as DatabaseSortKey);
                    setDatabaseVisibleLimit(100);
                  }}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
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

            {databaseEntityType === "project" ? (
              <DatabaseGrid
                records={filtered as DomiProject[]}
                columns={projectGridColumns}
                persistenceKey="domi-project-database-grid"
                ariaLabel="项目库"
                emptyMessage="没有匹配的项目"
                height="min(68vh, 760px)"
                onPatch={(record, patch, context) =>
                  patchDatabaseGridRecord("project", record, patch, context)}
                onPreview={(record) => void previewDatabaseRecord("project", record)}
                onDelete={(record) => requestDatabaseGridDelete("project", record)}
              />
            ) : databaseEntityType === "person" ? (
              <DatabaseGrid
                records={filtered as DomiPerson[]}
                columns={personGridColumns}
                persistenceKey="domi-person-database-grid"
                ariaLabel="人脉库"
                emptyMessage="没有匹配的人脉"
                height="min(68vh, 760px)"
                onPatch={(record, patch, context) =>
                  patchDatabaseGridRecord("person", record, patch, context)}
                onPreview={(record, column) => {
                  if (column.key === "documents") {
                    const documents = record.documents || record.interactionDocuments || [];
                    if (documents[0]?.link) openDocument(documents[0].link);
                    else setDatabaseError("这个人物还没有可预览的交流文档。");
                    return;
                  }
                  if (record.link) openDocument(record.link);
                  else void previewDatabaseRecord("person", record);
                }}
                onDelete={(record) => requestDatabaseGridDelete("person", record)}
              />
            ) : (
              <DatabaseGrid
                records={filtered as DomiNewsItem[]}
                columns={newsGridColumns}
                persistenceKey="domi-news-database-grid"
                ariaLabel="行业信息库"
                emptyMessage="没有匹配的行业信息"
                height="min(68vh, 760px)"
                onPatch={(record, patch, context) =>
                  patchDatabaseGridRecord("news", record, patch, context)}
                onPreview={(record) => void previewDatabaseRecord("news", record)}
                onDelete={(record) => requestDatabaseGridDelete("news", record)}
              />
            )}

            {false && <>
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
                      <th className="notes-column">相关文档</th>
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
                          <td className="notes-column">{personDocumentLink(person)}</td>
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
            </>}
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
                <h3 id="database-delete-title">从投资档案移除这条记录？</h3>
                <p id="database-delete-description">
                  “{databaseDeleteTarget.title}”会从投资档案列表和后续索引中移除；本地项目目录、文档和附件会完整保留。
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
                    : <><Trash2 size={14} />移出投资档案</>}
                </button>
              </div>
            </div>
          </div>
        )}
        {classificationCreateDialog && (
          <div
            className="database-delete-backdrop classification-create-backdrop"
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !classificationSaving) {
                setClassificationCreateDialog(null);
              }
            }}
          >
            <div
              className="classification-create-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="classification-create-title"
            >
              <header>
                <div className="classification-create-icon"><Plus size={18} /></div>
                <div>
                  <span>本地正式分类</span>
                  <h3 id="classification-create-title">新建正式子领域</h3>
                  <p>新分类只保存在这台 Mac 的 domi 资料库中，更新应用后仍会保留，不会上传 GitHub。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setClassificationCreateDialog(null)}
                  aria-label="关闭"
                  disabled={classificationSaving}
                >
                  <X size={16} />
                </button>
              </header>
              <div className="classification-create-fields">
                <label>
                  <span>子领域名称</span>
                  <input
                    autoFocus
                    value={classificationCreateDialog.name}
                    onChange={(event) => setClassificationCreateDialog((current) =>
                      current ? { ...current, name: event.target.value } : current
                    )}
                  />
                </label>
                <label>
                  <span>所属一级领域</span>
                  <select
                    value={classificationCreateDialog.parentDomain}
                    onChange={(event) => {
                      const parentDomain = event.target.value;
                      setClassificationCreateDialog((current) =>
                        current ? { ...current, parentDomain } : current
                      );
                      setClassificationDomain(parentDomain);
                    }}
                  >
                    {selectableTaxonomyDomains.map((item) => <option key={item.name}>{item.name}</option>)}
                  </select>
                </label>
                <label className="classification-create-main">
                  <input type="checkbox" checked readOnly />
                  <span>
                    <strong>设为主子领域</strong>
                    <small>该分类将成为项目目录的一级分类路径。</small>
                  </span>
                </label>
                <div className="classification-directory-preview">
                  <span>目录预览</span>
                  <code>
                    3.项目库 / {classificationCreateDialog.parentDomain} / {classificationCreateDialog.name || "新子领域"} / {selectedClassificationReview?.project.name || "项目"}
                  </code>
                </div>
              </div>
              <footer>
                <button
                  type="button"
                  onClick={() => setClassificationCreateDialog(null)}
                  disabled={classificationSaving}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={classificationSaving || !classificationCreateDialog.name.trim()}
                  onClick={() => {
                    const nextName = classificationCreateDialog.name.trim();
                    const nextSubdomains = [
                      nextName,
                      ...splitDatabaseList(classificationSubdomains)
                        .filter((item) => item !== unknownClassificationSubdomain && item !== nextName)
                    ];
                    setClassificationSubdomains(nextSubdomains.join("、"));
                    void mutateProjectClassification("apply", {
                      name: nextName,
                      parentDomain: classificationCreateDialog.parentDomain,
                      subdomains: nextSubdomains
                    });
                  }}
                >
                  {classificationSaving
                    ? <><RefreshCw className="spinning" size={14} />正在创建</>
                    : <><Check size={14} />创建并应用</>}
                </button>
              </footer>
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
              const workflow = indexBy(allWorkflows, "id").get(queued.workflowId || "");
              const repositoryMismatch = Boolean(
                appSettings
                && (!queued.repositoryIdentity
                  || queued.repositoryIdentity !== queueRepositoryIdentity(appSettings))
              );
              return (
                <div className="queued-submission" key={queued.id}>
                  <Clock3 size={15} aria-hidden="true" />
                  <div className="queued-submission-copy">
                    <strong>{workflow ? `启动「${workflow.title}」：${queued.input}` : queued.input}</strong>
                    <span>
                      {repositoryMismatch
                        ? "资料库配置已变更 · 确认后重试"
                        : pausedQueuedSubmissionIds.has(queued.id)
                          ? "上次未启动或执行中断 · 点击重试"
                          : `排队中 · 第 ${index + 1} 项`}
                      {queued.attachments.length > 0 ? ` · ${queued.attachments.length} 个附件` : ""}
                    </span>
                  </div>
                  {pausedQueuedSubmissionIds.has(queued.id) && (
                    <button
                      type="button"
                      onClick={() => void retryQueuedSubmission(queued.id)}
                      title="重试这条消息"
                      aria-label="重试这条消息"
                    >
                      <RefreshCw size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => removeQueuedSubmission(activeThread.id, queued.id)}
                    disabled={queuedSubmissionRemovalIsBusy(activeThread.id, queued.id)}
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
          {attachmentImportCount > 0 && (
            <div className="attachment-error" role="status">正在安全导入附件，完成后即可发送…</div>
          )}
          {attachmentError && <div className="attachment-error">{attachmentError}</div>}

          <div className="composer-toolbar">
            <div className="composer-tools-left">
              <button
                className="composer-icon-button"
                type="button"
                onClick={chooseAttachments}
                disabled={attachmentImportCount > 0}
                title={attachmentImportCount > 0 ? "正在导入附件" : "选择本地文件"}
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
              <button
                className="send-button"
                type="submit"
                title={isRunning ? "加入当前对话的待执行队列" : "发送给 Codex"}
                disabled={
                  attachmentImportCount > 0
                  || !codexStatus?.ok
                  || (!input.trim() && attachments.length === 0)
                }
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

  const visibleUpdateEntry = sidebarUpdateEntry(updateStatus);

  async function handleSidebarUpdate() {
    if (!updateStatus || sidebarUpdateBusy || updateStatus.state === "downloading") return;
    setSidebarUpdateBusy(true);
    try {
      let status = updateStatus;
      if (status.state === "error") {
        status = await workbench.checkForUpdates();
        setUpdateStatus(status);
      }
      if (status.state === "available") {
        status = await workbench.downloadUpdate();
        setUpdateStatus(status);
        return;
      }
      if (status.state === "downloaded") {
        const result = await workbench.installUpdate();
        setUpdateStatus(result.status);
      }
    } catch (error) {
      setUpdateStatus((current) => current ? {
        ...current,
        error: error instanceof Error ? error.message : String(error)
      } : current);
    } finally {
      setSidebarUpdateBusy(false);
    }
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

        <button className="new-thread" type="button" onClick={() => void createThread()}>
          <span><Plus size={17} /></span>
          <strong>新建任务</strong>
        </button>

        <div className="sidebar-entity-search" role="search">
          <div className="domi-entity-search">
            <Search size={14} aria-hidden="true" />
            <input
              value={domiQuery}
              onChange={(event) => {
                cancelPendingDomiEntityOpen();
                setDomiSearchError("");
                setDomiQuery(event.target.value);
              }}
              onFocus={refreshLocalIndexForSearch}
              onKeyDown={handleDomiSearchKeyDown}
              onCompositionStart={() => {
                domiSearchComposingRef.current = true;
              }}
              onCompositionEnd={() => {
                domiSearchComposingRef.current = false;
              }}
              placeholder="搜索项目、人脉或文档"
              aria-label="搜索 domi 项目、人脉或文档"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={Boolean(domiQuery.trim())}
              aria-controls="sidebar-domi-search-results"
              aria-activedescendant={domiSearchResolvedActiveKey
                ? `sidebar-domi-search-option-${domiSearchOptionKeys.indexOf(domiSearchResolvedActiveKey)}`
                : undefined}
            />
            {domiQuery && (
              <button
                type="button"
                onClick={() => clearDomiEntitySearch()}
                title="清除搜索"
                aria-label="清除项目、人脉或文档搜索"
              >
                <X size={13} />
              </button>
            )}
          </div>

          {domiQuery.trim() && (
            <div
              className="domi-search-results sidebar-domi-search-results"
              id="sidebar-domi-search-results"
              role="listbox"
              aria-label="项目、人脉和文档搜索结果"
            >
              {domiSearchResults.projects.length > 0 && (
                <div
                  className="domi-result-group"
                  role="group"
                  aria-labelledby="domi-project-results-label"
                >
                  <span id="domi-project-results-label">项目</span>
                  {domiSearchResults.projects.map((project, index) => {
                    const optionKey = `project:${project.recordId}`;
                    return (
                      <button
                        type="button"
                        key={project.recordId}
                        id={`sidebar-domi-search-option-${index}`}
                        role="option"
                        aria-selected={domiSearchResolvedActiveKey === optionKey}
                        tabIndex={-1}
                        ref={(element) => {
                          if (element) domiSearchOptionRefs.current.set(optionKey, element);
                          else domiSearchOptionRefs.current.delete(optionKey);
                        }}
                        onPointerEnter={() => setDomiSearchActiveKey(optionKey)}
                        onClick={() => openDomiProject(project)}
                      >
                        <strong>{project.name}</strong>
                        <small>{[project.domain, project.status, project.rating].filter(Boolean).join(" · ")}</small>
                      </button>
                    );
                  })}
                </div>
              )}
              {domiSearchResults.people.length > 0 && (
                <div
                  className="domi-result-group"
                  role="group"
                  aria-labelledby="domi-people-results-label"
                >
                  <span id="domi-people-results-label">人脉</span>
                  {domiSearchResults.people.map((person, index) => {
                    const optionIndex = domiSearchResults.projects.length + index;
                    const optionKey = `person:${person.recordId}`;
                    return (
                      <button
                        type="button"
                        key={person.recordId}
                        id={`sidebar-domi-search-option-${optionIndex}`}
                        role="option"
                        aria-selected={domiSearchResolvedActiveKey === optionKey}
                        tabIndex={-1}
                        ref={(element) => {
                          if (element) domiSearchOptionRefs.current.set(optionKey, element);
                          else domiSearchOptionRefs.current.delete(optionKey);
                        }}
                        onPointerEnter={() => setDomiSearchActiveKey(optionKey)}
                        onClick={() => openDomiPerson(person)}
                      >
                        <strong>{person.name}</strong>
                        <small>{[person.organization, person.rating].filter(Boolean).join(" · ")}</small>
                      </button>
                    );
                  })}
                </div>
              )}
              {domiDocumentSearch.results.length > 0 && (
                <div
                  className="domi-result-group domi-document-result-group"
                  role="group"
                  aria-labelledby="domi-document-results-label"
                >
                  <span id="domi-document-results-label">文档提及</span>
                  {domiDocumentSearch.results.map((document, index) => {
                    const optionIndex = domiSearchResults.projects.length
                      + domiSearchResults.people.length
                      + index;
                    const optionKey = `document:${document.path}`;
                    return (
                      <button
                        type="button"
                        key={document.path}
                        id={`sidebar-domi-search-option-${optionIndex}`}
                        role="option"
                        aria-selected={domiSearchResolvedActiveKey === optionKey}
                        tabIndex={-1}
                        ref={(element) => {
                          if (element) domiSearchOptionRefs.current.set(optionKey, element);
                          else domiSearchOptionRefs.current.delete(optionKey);
                        }}
                        onPointerEnter={() => setDomiSearchActiveKey(optionKey)}
                        onClick={() => void openDomiDocumentSearchResult(document)}
                        title={document.relativePath}
                      >
                        <strong>{document.name}</strong>
                        <small className="domi-document-result-snippet">{document.snippet}</small>
                        <small className="domi-document-result-path">
                          {[document.kind === "pdf" ? "PDF" : "Markdown", document.line ? `第 ${document.line} 行` : "", document.relativePath]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      </button>
                    );
                  })}
                </div>
              )}
              {domiDocumentSearch.indexing && (
                <div className="domi-search-indexing" role="status">
                  正在后台建立文档索引，当前结果会自动补充
                </div>
              )}
              {domiSearchResults.projects.length === 0
                && domiSearchResults.people.length === 0
                && domiDocumentSearch.results.length === 0
                && !domiDocumentSearch.indexing && (
                <div className="empty-state">没有匹配的项目、人脉或文档内容</div>
              )}
              {!domiDocumentSearch.ok && domiDocumentSearch.error && (
                <div className="domi-search-error" role="alert">{domiDocumentSearch.error}</div>
              )}
              {domiSearchError && (
                <div className="domi-search-error" role="alert">{domiSearchError}</div>
              )}
            </div>
          )}
        </div>

        <nav className={`sidebar-primary-nav ${documentLibrarySidebarExpanded ? "documents-open" : ""}`} aria-label="工作台导航">
          <button
            className={`sidebar-nav-item ${workspaceView === "tasks" ? "active" : ""}`}
            type="button"
            onClick={() => {
              void openPrimaryWorkspace("tasks");
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
              void openPrimaryWorkspace("news");
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
              void openPrimaryWorkspace("data");
            }}
          >
            <Database className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
            <strong>投资档案</strong>
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
              <strong>文档中心</strong>
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
          <div className="sidebar-skill-hub-header">
            <button
              className="sidebar-section-toggle"
              type="button"
              onClick={() => setSkillsExpanded((current) => !current)}
              aria-expanded={skillsExpanded}
            >
              <Atom className="sidebar-nav-icon" size={19} strokeWidth={1.9} />
              <strong>Skill Hub</strong>
              <span className="sidebar-nav-meta">
                <span className="sidebar-nav-disclosure" aria-hidden="true">
                  <ChevronRight size={14} strokeWidth={2} />
                </span>
              </span>
            </button>
          </div>
          {skillsExpanded && (
            <div className="sidebar-skill-hub-content">
              <div className="sidebar-workflows">
                {[...workflows.filter((workflow) => !workflow.hidden), ...userSkillWorkflows].map((workflow) => {
                  const Icon = workflow.source === "user"
                    ? Sparkles
                    : workflowIconMap[workflow.id] || FileText;
                  return (
                    <button
                      key={workflow.id}
                      type="button"
                      className={`workflow-mini ${selectedWorkflowId === workflow.id ? "selected" : ""}`}
                      aria-pressed={selectedWorkflowId === workflow.id}
                      ref={selectedWorkflowId === workflow.id ? selectedSkillButtonRef : undefined}
                      onClick={() => chooseWorkflow(workflow)}
                      title={workflow.description}
                    >
                      <Icon size={15} />
                      {workflow.title}
                    </button>
                  );
                })}
              </div>
              <button
                className="sidebar-skill-hub-manage"
                type="button"
                onClick={() => setSkillHubOpen(true)}
                title="管理技能"
                aria-label="管理技能"
              >
                管理技能…
              </button>
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
                        {thread.hasUnreadCompletion && (
                          <i
                            className="thread-state-indicator unread"
                            role="status"
                            aria-label="任务有未读结果"
                            title="任务有未读结果"
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
                      onClick={() => void deleteThread(thread)}
                      disabled={threads.length <= 1 || threadDeletionIsBusy(thread.id)}
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

        {visibleUpdateEntry && (
          <button
            className={`sidebar-update-card ${visibleUpdateEntry.state}`}
            type="button"
            onClick={() => void handleSidebarUpdate()}
            disabled={sidebarUpdateBusy || visibleUpdateEntry.state === "downloading"}
            title={visibleUpdateEntry.detail}
            aria-label={`${visibleUpdateEntry.label}，${visibleUpdateEntry.detail}`}
          >
            <span className="sidebar-update-icon" aria-hidden="true">
              {visibleUpdateEntry.state === "downloading" || sidebarUpdateBusy
                ? <RefreshCw className="spinning" size={15} />
                : visibleUpdateEntry.state === "downloaded"
                  ? <CheckCircle2 size={15} />
                  : <Download size={15} />}
            </span>
            <span className="sidebar-update-copy">
              <strong>{visibleUpdateEntry.label}</strong>
              <small>{visibleUpdateEntry.detail}</small>
            </span>
            {visibleUpdateEntry.state !== "downloading" && <ChevronRight size={15} aria-hidden="true" />}
          </button>
        )}

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
                  ? "投资档案"
                : workspaceView === "documents"
                  ? "文档中心"
                : activeThread.title}</strong>
            <span>{workspaceView === "tasks"
              ? `${taskNavigationCount} 个待办事项`
              : workspaceView === "news"
                ? "domi 行业雷达"
                : workspaceView === "data"
                  ? `${databaseSnapshot?.projects?.length || 0} 项目 / ${databaseSnapshot?.people?.length || 0} 人脉 / ${databaseSnapshot?.news?.length || 0} 行业信息`
                : workspaceView === "documents"
                  ? documentLibrary?.rootName
                    ? `本地工作区 · ${documentLibrary.rootName}`
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
                    ? "刷新投资档案"
                  : workspaceView === "documents"
                    ? "刷新文档中心"
                  : domiError ? `重新同步 domi：${domiError}` : "同步 domi 项目与人脉"}
              aria-label={workspaceView === "tasks"
                ? "刷新任务来源"
                : workspaceView === "news"
                  ? "运行 domi 行业雷达"
                  : workspaceView === "data"
                    ? "刷新投资档案"
                  : workspaceView === "documents"
                    ? "刷新文档中心"
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
                      const workflow = indexBy(allWorkflows, "id").get(message.workflowId || "");
                      const isLatestAssistant = message.role === "assistant"
                        && message.id === latestVisibleAssistantId;
                      const fullRunTimeline = message.runId
                        ? conversationIndex.timelineByRunId.get(message.runId) || []
                        : isLatestAssistant
                          ? conversationIndex.chronologicalTimeline
                          : [];
                      const runTimeline = fullRunTimeline.slice(-5);
                      const runDuration = formatMessageRunDuration(
                        message.runStartedAt,
                        message.runCompletedAt
                      );
                      const showRunSummary = message.role === "assistant"
                        && message.status !== "running"
                        && Boolean(message.content);
                      const messageInteractions = message.role === "assistant"
                        ? conversationIndex.interactionsByMessageId.get(message.id) || []
                        : [];
                      const hasPendingInteraction = conversationIndex.pendingMessageIds.has(message.id);
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
                                    {hasPendingInteraction ? "等待你选择" : "正在执行"}
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
                                  <span>{hasPendingInteraction
                                    ? "选择后将在当前任务中继续"
                                    : message.content
                                      ? "Codex 仍在执行"
                                      : workflow
                                        ? `正在运行 ${workflow.title}`
                                        : "正在处理任务"}</span>
                                  {!hasPendingInteraction && <i><b /><b /><b /></i>}
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
                            {messageInteractions.map((interaction) => (
                              <AssistantChoiceCard
                                key={interaction.key}
                                request={interaction.request}
                                resolved={interaction.status === "resolved"}
                                onSubmit={(answers) => answerAssistantInteraction(interaction, answers)}
                              />
                            ))}
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
                    ? `${domiSnapshot.sources.projects.total} 项目 / ${domiSnapshot.sources.people.total} 人脉${domiSnapshot.sources.projects.needsNameReview ? ` · ${domiSnapshot.sources.projects.needsNameReview} 个项目名待确认` : ""}`
                    : domiSyncing ? "正在连接 domi" : "等待 domi 数据"}
                </span>
              </div>
              <button type="button" onClick={() => setRightPanelOpen(false)} title="收起今日工作">
                <PanelRightClose size={18} />
              </button>
            </div>

            <section className={`panel-section ${openSections.domi ? "open" : ""}`}>
              <button className="panel-title" type="button" onClick={() => toggleSection("domi")}>
                <span><Mic size={17} />录音交流</span>
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
                    {plaudError && (
                      <div className="domi-inline-error actionable" role="status">
                        <AlertCircle size={14} />
                        <span>{plaudError}</span>
                        <button
                          type="button"
                          onClick={() => {
                            if (plaudSnapshot?.remoteStatus === "auth_required") {
                              setSettingsInitialTab("plaud");
                              setSettingsOpen(true);
                              return;
                            }
                            void refreshPlaudQueue({ fresh: true });
                          }}
                          disabled={plaudLoading || plaudLoadingMore || plaudSyncing}
                        >
                          {plaudSnapshot?.remoteStatus === "auth_required" ? "重新登录" : "重试"}
                        </button>
                      </div>
                    )}
                    {plaudNotice && <div className="plaud-inline-notice">{plaudNotice}</div>}
                    <div className="plaud-queue-header">
                      <strong>最近录音</strong>
                      <span>
                        <small>
                          {plaudLoading
                            ? "正在读取"
                            : plaudSnapshot?.syncedAt
                              ? new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(plaudSnapshot.syncedAt)
                              : "按刷新读取"}
                        </small>
                        <button
                          type="button"
                          title="刷新 PLAUD 最近录音"
                          aria-label="刷新 PLAUD 最近录音"
                          disabled={plaudLoading || plaudLoadingMore || plaudSyncing}
                          onClick={() => void refreshPlaudQueue({ fresh: true })}
                        >
                          <RefreshCw className={plaudLoading ? "spinning" : ""} size={13} />
                        </button>
                      </span>
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
                    const notesThread = indexBy(threads, "projectId").get(`plaud-${item.fileId}`);
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
                  <div
                    className="usage-row"
                    title="本轮可观测用量；新增输入 = Input - Cached。Cached 已包含在 Input 内；失败、取消或旧记录可能不完整。"
                  >
                    <span>
                      本轮可观测用量{lastUsage.usage_complete === false ? "（可能不完整）" : ""}
                    </span>
                    <span>新增输入 {lastUncachedInputTokens.toLocaleString("zh-CN")}</span>
                    <span>缓存读取 {lastCachedInputTokens.toLocaleString("zh-CN")}（{lastCacheHitRate}%）</span>
                    <span>缓存写入 {lastCacheWriteInputTokens.toLocaleString("zh-CN")}</span>
                    <span>输出 {lastOutputTokens.toLocaleString("zh-CN")}</span>
                    <span>推理 {lastReasoningOutputTokens.toLocaleString("zh-CN")}</span>
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
    {globalPersistenceError && (
      <div className="global-persistence-alert" role="alert" aria-live="assertive">
        <AlertCircle size={15} />
        <span>{globalPersistenceError}</span>
        <button
          type="button"
          onClick={() => {
            if (databaseAutoSaveQueuedRef.current) void flushDatabaseAutoSave();
            void persistWorkbenchStateNow();
          }}
        >
          立即重试
        </button>
      </div>
    )}
    {settingsOpen && appSettings && (
      <Suspense fallback={<div className="lazy-overlay"><RefreshCw className="spinning" size={20} />正在加载设置</div>}>
        <SetupCenter
          initialTab={settingsInitialTab}
          settings={appSettings}
          codexStatus={codexStatus}
          required={!appSettings.onboardingComplete}
          onClose={() => setSettingsOpen(false)}
          onDirtyChange={(dirty) => {
            settingsDirtyRef.current = dirty;
          }}
          onSave={saveAppSettings}
          onLogin={startChatGPTLogin}
          onRefresh={refreshCodex}
        />
      </Suspense>
    )}
    {skillHubOpen && (
      <Suspense fallback={<div className="lazy-overlay"><RefreshCw className="spinning" size={20} />正在加载 Skill Hub</div>}>
        <SkillHubManager
          onClose={() => {
            setSkillHubOpen(false);
            setSkillHubReviewCandidateIds([]);
          }}
          onCreateSkill={() => void openNewSkillConversation()}
          onEditSkill={(skill) => void openNewSkillConversation(skill)}
          reviewCandidateIds={skillHubReviewCandidateIds}
          onImported={(skills) => {
            setSkillHubSkills(skills);
            setSkillHubLoadError("");
            setSkillHubReady(true);
          }}
        />
      </Suspense>
    )}
    {radarSourceManagerOpen && (
      <Suspense fallback={<div className="lazy-overlay"><RefreshCw className="spinning" size={20} />正在加载信源管理</div>}>
        <RadarSourceManager
          open
          onClose={() => setRadarSourceManagerOpen(false)}
          onSnapshot={setRadarSourceSnapshot}
          onPodcastTranscript={archivePodcastTranscript}
        />
      </Suspense>
    )}
    {appConfirmDialog}
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
