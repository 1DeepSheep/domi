const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const {
  ensureDocumentLibraryStructure,
  LOCAL_TODO_DOCUMENT_NAME
} = require("./document-library.cjs");
const { LocalDomiRepository, resolveHomePath } = require("./local-domi-repository.cjs");
const { LocalToFeishuMigration } = require("./local-to-feishu-migration.cjs");
const { resolveMediaRuntime } = require("./media-runtime.cjs");
const { normalizeWebResource } = require("./resource-target.cjs");
const { TaskQueue } = require("./service-coordinator.cjs");

const execFileAsync = promisify(execFile);
const CACHE_KEY = "snapshot-v1";
const WEEKLY_NEWS_CACHE_KEY = "weekly-news-v1";
const WEEKLY_NEWS_RADAR_CHECKPOINT_KEY = "weekly-news-radar-checkpoint-v1";
const TASK_BOARD_CACHE_KEY_PREFIX = "task-board-v1";
const TASK_BOARD_MARKER = "domi-task-board-v1";
const TASK_DOCUMENT_TITLE = "1.待办事项";
const LEGACY_TASK_DOCUMENT_TITLES = ["1.Task"];
const MAX_TASK_WIKI_NODES = 5000;
const MAX_TASK_WIKI_LIST_CALLS = 500;
const MAX_TASK_WIKI_DEPTH = 8;
const TASK_BOARD_CATEGORIES = new Set([
  "key-milestone",
  "new-entry",
  "relationship-follow-up",
  "project-follow-up"
]);
const LEGACY_TASK_BOARD_CATEGORIES = new Map([
  ["relationship-milestone", "key-milestone"],
  ["new-project-meeting", "new-entry"],
  ["new-person-meeting", "new-entry"],
  ["person-update", "relationship-follow-up"],
  ["stale-relationship", "relationship-follow-up"],
  ["project-update", "project-follow-up"],
  ["stale-project", "project-follow-up"]
]);
const FEISHU_RECORD_PAGE_SIZE = 200;
const FEISHU_RECORD_MAX_PAGES = 25;
const FEISHU_READ_RETRY_DELAYS_MS = [350, 900, 1800];
const PLAUD_FINAL_WORKFLOW_STAGES = new Set([
  "notes_non_project",
  "managed",
  "discussion_complete"
]);
const WEEKLY_NEWS_FIELDS = [
  "新闻标题",
  "领域",
  "子领域",
  "信息类型",
  "信息发布时间",
  "新闻核心内容",
  "投资含义",
  "原文链接",
  "来源名称",
  "涉及公司",
  "涉及机构",
  "重要性评分",
  "可信度",
  "证据状态",
  "是否值得关注",
  "建议动作"
];
const SKIPPED_MATERIAL_DIRECTORIES = new Set([
  ".git",
  ".obsidian",
  "node_modules",
  "$RECYCLE.BIN"
]);

function plaudBrowserLabel(browser) {
  return browser === "tabbit" ? "Tabbit" : "Google Chrome";
}

function classifyPlaudConnectionFailure(error, browser) {
  const message = error instanceof Error ? error.message : String(error || "");
  const normalized = message.toLocaleLowerCase("en-US");
  let status = "unknown";
  let guidance = "请重新检测；如果仍然失败，可以让 Codex 连接助手继续诊断。";
  if (/音频运行时|ffmpeg|ffprobe/.test(normalized)) {
    status = "runtime_unavailable";
    guidance = "domi 内置音频运行时不完整，请重新安装最新版 domi。";
  } else if (/singleton|profile.*(?:lock|use)|already in use|ebusy|process.*running/.test(normalized)) {
    status = "profile_locked";
    guidance = "PLAUD 专用浏览器 Profile 正被另一个 domi 实例占用，请关闭重复实例后重试。";
  } else if (/401|403|unauthori|login|登录|not completed|未完成/.test(normalized)) {
    status = "auth_required";
    guidance = `请点击“登录并验证”，在 domi 专用 ${plaudBrowserLabel(browser)} 窗口中登录自己的 PLAUD 账号。`;
  } else if (/econnrefused|devtools|browser.*(?:closed|launch)|executable|找不到.*浏览器/.test(normalized)) {
    status = "browser_unavailable";
    guidance = `${plaudBrowserLabel(browser)} 未能启动或调试连接已关闭，请重新打开登录流程。`;
  } else if (/enotfound|enetunreach|network|fetch failed|etimedout|timeout|超时|网络/.test(normalized)) {
    status = "network_error";
    guidance = "网络暂时不可用或 PLAUD 服务响应超时，请确认网络后重试。";
  } else if (/selector|unexpected response|parse|json|页面结构/.test(normalized)) {
    status = "service_changed";
    guidance = "PLAUD 页面或接口可能已更新，请使用 Codex 连接助手诊断并检查插件更新。";
  }
  return {
    ok: false,
    connected: false,
    browser,
    browserLabel: plaudBrowserLabel(browser),
    status,
    checkedAt: Date.now(),
    error: guidance
  };
}

function normalizedMaterialText(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function entitySearchKeys(name) {
  const raw = String(name || "").trim();
  const base = raw.split(/[（(\/，,&]/)[0].trim();
  const stripped = base.replace(/(?:科技|技术)?(?:股份)?(?:有限(?:责任)?)?公司$|集团$/g, "");
  return [...new Set([raw, base, stripped].map(normalizedMaterialText))]
    .filter((item) => item.length >= 2)
    .sort((left, right) => right.length - left.length);
}

function materialKind(filePath) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  if (extension === ".pdf") return "PDF";
  if ([".md", ".markdown"].includes(extension)) return "Markdown";
  if ([".xlsx", ".xls", ".csv"].includes(extension)) return "表格";
  if ([".docx", ".doc", ".rtf"].includes(extension)) return "文档";
  if ([".pptx", ".ppt", ".key"].includes(extension)) return "演示文稿";
  if ([".m4a", ".mp3", ".wav", ".aac"].includes(extension)) return "录音";
  if ([".png", ".jpg", ".jpeg", ".webp", ".heic"].includes(extension)) return "图片";
  return extension ? extension.slice(1).toUpperCase() : "文件";
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string" || typeof item === "number") return String(item);
        return item?.text || item?.name || "";
      })
      .filter(Boolean)
      .join("");
  }
  return value.text || value.name || "";
}

function boundedTaskText(value, limit = 800) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, limit);
}

function taskIsoTime(value, fallback = null) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function decodeTaskXml(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function encodeTaskXml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function taskXmlAttributes(value) {
  const attributes = {};
  for (const match of String(value || "").matchAll(/([A-Za-z0-9_-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    attributes[match[1]] = decodeTaskXml(match[3]);
  }
  return attributes;
}

function taskDocumentStrings(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => taskDocumentStrings(item, output));
  else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => taskDocumentStrings(item, output));
  }
  return output;
}

function normalizeTaskBoardItem(value = {}, now = new Date().toISOString()) {
  const statuses = new Set(["open", "in_progress", "done", "ignored"]);
  const priorities = new Set(["P1", "P2", "P3"]);
  const sourceKinds = new Set(["project", "person", "news", "manual"]);
  const actionKinds = new Set(["schedule", "research", "contact", "review", "custom"]);
  const id = boundedTaskText(value.id, 120);
  const title = boundedTaskText(value.title, 160);
  if (!id || !title) return null;
  const status = statuses.has(value.status) ? value.status : "open";
  const sourceKind = sourceKinds.has(value.source?.kind) ? value.source.kind : "manual";
  const dueAt = taskIsoTime(value.dueAt);
  const legacyCategory = LEGACY_TASK_BOARD_CATEGORIES.get(value.category);
  const category = TASK_BOARD_CATEGORIES.has(value.category)
    ? value.category
    : legacyCategory
      || (dueAt
        ? "key-milestone"
        : sourceKind === "person"
          ? "relationship-follow-up"
          : "project-follow-up");
  const item = {
    id,
    title,
    summary: boundedTaskText(value.summary, 500),
    reason: boundedTaskText(value.reason, 800),
    priority: priorities.has(value.priority) ? value.priority : "P3",
    category,
    status,
    signalKey: boundedTaskText(value.signalKey, 160),
    source: {
      kind: sourceKind,
      recordId: boundedTaskText(value.source?.recordId, 160),
      displayName: boundedTaskText(value.source?.displayName, 160)
    },
    dueAt,
    suggestedAction: {
      kind: actionKinds.has(value.suggestedAction?.kind) ? value.suggestedAction.kind : "custom",
      label: boundedTaskText(value.suggestedAction?.label, 80) || "执行",
      prompt: String(value.suggestedAction?.prompt || "").trim().slice(0, 4000)
    },
    createdAt: taskIsoTime(value.createdAt, now),
    updatedAt: taskIsoTime(value.updatedAt, now)
  };
  if (status === "ignored") item.ignoredAt = taskIsoTime(value.ignoredAt, item.updatedAt);
  if (status === "done") item.completedAt = taskIsoTime(value.completedAt, item.updatedAt);
  return item;
}

function normalizeTaskLedger(value = {}, now = new Date().toISOString()) {
  const seen = new Set();
  return {
    schemaVersion: 1,
    updatedAt: taskIsoTime(value.updatedAt, now),
    tasks: (Array.isArray(value.tasks) ? value.tasks : [])
      .map((task) => normalizeTaskBoardItem(task, now))
      .filter((task) => task && !seen.has(task.id) && seen.add(task.id))
  };
}

function parseTaskLedger(value) {
  for (const candidate of taskDocumentStrings(value)) {
    if (!candidate.includes(TASK_BOARD_MARKER)) continue;
    for (const match of candidate.matchAll(/<pre\b([^>]*)>\s*<code>([\s\S]*?)<\/code>\s*<\/pre>/gi)) {
      const attributes = taskXmlAttributes(match[1]);
      if (String(attributes.caption || "").trim() !== TASK_BOARD_MARKER) continue;
      const blockId = boundedTaskText(attributes.id || attributes["block-id"], 200);
      try {
        const renderedCode = match[2].replace(/<br\s*\/?>/gi, "\n");
        return {
          found: true,
          blockId,
          ledger: normalizeTaskLedger(JSON.parse(decodeTaskXml(renderedCode)))
        };
      } catch (error) {
        return {
          found: false,
          blockId,
          ledger: normalizeTaskLedger(),
          error: `${TASK_DOCUMENT_TITLE} 数据块无法解析：${error.message}`
        };
      }
    }
  }
  return { found: false, blockId: "", ledger: normalizeTaskLedger() };
}

function renderTaskLedger(value) {
  const ledger = normalizeTaskLedger(value);
  return `<pre lang="json" caption="${TASK_BOARD_MARKER}"><code>${encodeTaskXml(JSON.stringify(ledger, null, 2))}</code></pre>`;
}

function replaceTaskLedgerDocumentContent(content, ledger) {
  let replaced = false;
  const next = String(content || "").replace(
    /<pre\b([^>]*)>\s*<code>[\s\S]*?<\/code>\s*<\/pre>/gi,
    (block, attributesText) => {
      if (replaced || taskXmlAttributes(attributesText).caption !== TASK_BOARD_MARKER) return block;
      replaced = true;
      return renderTaskLedger(ledger);
    }
  );
  if (!replaced) {
    throw new Error(`${LOCAL_TODO_DOCUMENT_NAME} 缺少 ${TASK_BOARD_MARKER} 数据块，无法安全更新。`);
  }
  return next;
}

function taskBoardCacheKey(document) {
  const fingerprint = crypto
    .createHash("sha256")
    .update(String(document || "").trim())
    .digest("hex")
    .slice(0, 20);
  return `${TASK_BOARD_CACHE_KEY_PREFIX}:${fingerprint}`;
}

function larkResponseData(response) {
  const first = response?.data ?? response ?? {};
  return first?.data ?? first;
}

function larkResponseItems(response) {
  const data = larkResponseData(response);
  if (Array.isArray(data)) return data;
  return data?.nodes || data?.items || data?.records || [];
}

function taskWikiNodeToken(node) {
  return String(node?.node_token || node?.nodeToken || node?.token || "");
}

function taskWikiDocumentToken(node) {
  const value = node?.node || node;
  return String(
    value?.obj_token
    || value?.objToken
    || value?.document_id
    || value?.documentId
    || ""
  );
}

function taskWikiNodeTitle(node) {
  return textValue(node?.title || node?.name)
    .normalize("NFKC")
    .trim();
}

function taskDocumentTitleKey(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/\s+/g, "");
}

function isTaskDocumentTitle(value) {
  const key = taskDocumentTitleKey(value);
  return [TASK_DOCUMENT_TITLE, ...LEGACY_TASK_DOCUMENT_TITLES]
    .some((title) => taskDocumentTitleKey(title) === key);
}

function isLegacyTaskDocumentTitle(value) {
  const key = taskDocumentTitleKey(value);
  return LEGACY_TASK_DOCUMENT_TITLES
    .some((title) => taskDocumentTitleKey(title) === key);
}

function taskSearchResultTitle(result) {
  return decodeTaskXml(result?.title_highlighted || result?.titleHighlighted || result?.title || "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

function taskSearchResultLocator(result) {
  const rawToken = String(
    result?.result_meta?.token
    || result?.resultMeta?.token
    || result?.node_token
    || result?.nodeToken
    || ""
  );
  const resourceUrl = String(
    result?.result_meta?.url
    || result?.resultMeta?.url
    || result?.url
    || ""
  );
  const entityType = String(
    result?.entity_type
    || result?.entityType
    || result?.result_meta?.type
    || result?.resultMeta?.type
    || ""
  ).toLocaleLowerCase("en-US");
  const docTypes = stringList(
    result?.result_meta?.doc_types
    || result?.resultMeta?.docTypes
  ).map((value) => value.toLocaleLowerCase("en-US"));
  const supportedObjTypes = new Set(["doc", "docx", "sheet", "bitable", "mindnote", "slides", "file"]);
  const objType = supportedObjTypes.has(entityType)
    ? entityType
    : docTypes.find((value) => supportedObjTypes.has(value)) || "";
  const wikiUrl = entityType === "wiki" && /\/wiki\//i.test(resourceUrl)
    ? resourceUrl
    : "";
  return {
    token: wikiUrl || rawToken,
    objType: wikiUrl || rawToken.startsWith("wik") ? "" : objType
  };
}

function stringList(value) {
  if (!value) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.map(textValue).filter(Boolean);
}

function weeklyNewsContentSignature(items = []) {
  return [...items]
    .sort((left, right) => String(left.recordId || "").localeCompare(String(right.recordId || "")))
    .map((item) => [
      item.recordId,
      item.title,
      item.publishedAt,
      item.summary,
      item.investmentMeaning,
      item.url,
      item.source,
      item.companies,
      item.institutions,
      item.importance,
      item.confidence,
      item.evidenceStatus,
      item.action,
      ...(item.domains || []),
      ...(item.subdomains || []),
      ...(item.types || [])
    ].map((value) => String(value ?? "")).join("\u001f"))
    .join("\u001e");
}

function weeklyNewsHasSubstantiveChange(previousItems = [], items = []) {
  const previousSignatures = new Map(
    previousItems.map((item) => [String(item.recordId || ""), weeklyNewsContentSignature([item])])
  );
  return items.some((item) => {
    const recordId = String(item.recordId || "");
    return !previousSignatures.has(recordId)
      || previousSignatures.get(recordId) !== weeklyNewsContentSignature([item]);
  });
}

function resolveWeeklyNewsTimestamps(cachedPage, items, checkedAt = Date.now()) {
  const previousItems = cachedPage?.items || [];
  const changed = weeklyNewsHasSubstantiveChange(previousItems, items);
  const legacyContentTime = previousItems.reduce(
    (latest, item) => Math.max(latest, Number(item.publishedAt) || 0),
    0
  );
  const previousContentUpdatedAt = Number(
    cachedPage?.contentUpdatedAt
      || (cachedPage?.checkedAt ? cachedPage?.syncedAt : legacyContentTime)
      || cachedPage?.syncedAt
      || cachedPage?.cachedAt
      || 0
  );
  const contentUpdatedAt = !cachedPage || changed
    ? checkedAt
    : previousContentUpdatedAt || checkedAt;
  return { checkedAt, contentUpdatedAt, changed };
}

function timestampValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedEpochMs(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return numeric < 1e12 ? numeric * 1000 : numeric;
}

function comparePlaudItems(left, right) {
  const leftTime = normalizedEpochMs(left?.createdAt) || normalizedEpochMs(left?.editedAt);
  const rightTime = normalizedEpochMs(right?.createdAt) || normalizedEpochMs(right?.editedAt);
  return rightTime - leftTime
    || String(left?.fileName || "").localeCompare(String(right?.fileName || ""), "zh-CN");
}

function versionParts(version) {
  return String(version || "0").match(/\d+/g)?.map(Number) || [0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function commandErrorMessage(error, binary, options = {}) {
  const label = options.label || path.basename(binary) || "domi 命令";
  if (error?.killed || error?.code === "ETIMEDOUT") {
    return `${label}执行超时（${Math.round((options.timeout || 60000) / 1000)} 秒）。`;
  }

  const clean = (value) => String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[远程接口]")
    .trim();
  const rawDetail = clean(error?.stderr) || clean(error?.stdout);
  if (/Cannot find module ['"]playwright['"]/i.test(rawDetail)) {
    return `${label}缺少浏览器运行组件。请重启 domi；如果仍然失败，请重新安装最新版 domi。`;
  }
  if (/(?:\/usr\/bin\/)?env:\s*node:.*No such file|\/usr\/bin\/env\b.*\bnode\b.*No such file/i.test(rawDetail)) {
    return `${label}使用了需要系统 Node.js 的旧版启动器。请更新 domi 后重试；客户端会自动使用飞书 CLI 自带的运行时。`;
  }
  let detail = rawDetail;
  if (rawDetail) {
    try {
      const parsed = JSON.parse(rawDetail);
      detail = parsed?.error?.message || parsed?.error || parsed?.message || parsed?.msg || rawDetail;
    } catch {
      // Keep the original stderr when the command does not return JSON.
    }
  }
  const code = error?.code && error.code !== 1 ? `（${error.code}）` : "";
  return `${label}执行失败${code}：${String(detail || "未返回错误详情").slice(0, 800)}`;
}

function isRetryableFeishuReadError(error) {
  const detail = [
    error?.code,
    error?.message,
    error?.stderr,
    error?.stdout
  ].filter(Boolean).join(" ");
  if (/need_user_authorization|unauthori[sz]ed|forbidden|invalid[_\s-]*token|access[_\s-]*token/i.test(detail)) {
    return false;
  }
  return /\b(?:EOF|ECONNRESET|ECONNREFUSED|EPIPE|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ENOTFOUND)\b|unexpected end of (?:json|input)|unterminated json|socket hang up|network(?: is)? unreachable|timed?\s*out|执行超时|temporar(?:y|ily)|too many requests|\b429\b|\b50[234]\b/i.test(detail);
}

function describeFeishuSyncError(error, { hasCache = false } = {}) {
  const detail = String(error?.message || error || "").trim();
  const cacheNote = hasCache ? "已继续使用上次同步的数据。" : "请稍后重新同步。";
  if (/need_user_authorization|unauthori[sz]ed|forbidden|invalid[_\s-]*token|access[_\s-]*token/i.test(detail)) {
    return `飞书授权已失效，请在“资料连接”中重新授权。${hasCache ? "当前仍显示上次同步的数据。" : ""}`;
  }
  if (isRetryableFeishuReadError(error)) {
    return `飞书连接暂时不稳定，自动重试后仍未恢复。${cacheNote}`;
  }
  const safeDetail = detail
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[远程接口]")
    .replace(/\/open-apis\/[^\s"'<>]+/gi, "[飞书接口]")
    .replace(/[。.!！]+$/u, "")
    .slice(0, 180);
  return `飞书数据同步暂时失败${safeDetail ? `：${safeDetail}` : ""}。${cacheNote}`;
}

function resolvePlaywrightNodeModules() {
  try {
    return path.dirname(path.dirname(require.resolve("playwright/package.json")));
  } catch {
    const codexRuntime = path.join(
      os.homedir(),
      ".cache",
      "codex-runtimes",
      "codex-primary-runtime",
      "dependencies",
      "node",
      "node_modules"
    );
    return fs.existsSync(path.join(codexRuntime, "playwright")) ? codexRuntime : "";
  }
}

function executableFromPath(command, environmentPath = process.env.PATH) {
  for (const directory of String(environmentPath || "").split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(directory, command);
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Keep searching the remaining PATH entries.
    }
  }
  return "";
}

function resolveLarkCliExecutable(candidate) {
  const requested = String(candidate || "").trim();
  if (!requested) return "";
  const located = path.isAbsolute(requested)
    ? requested
    : executableFromPath(requested);
  if (!located || !fs.existsSync(located)) return "";

  let resolved = located;
  try {
    resolved = fs.realpathSync(located);
  } catch {
    // Keep the located path when the filesystem cannot canonicalize it.
  }

  // The npm launcher is a `#!/usr/bin/env node` script. Finder-launched apps
  // do not inherit the user's terminal PATH, but the package also ships a
  // self-contained native CLI next to that launcher. Prefer it so Feishu
  // synchronization never depends on a separately discoverable Node binary.
  if (path.basename(resolved) === "run.js") {
    const nativeExecutable = path.resolve(
      path.dirname(resolved),
      "..",
      "bin",
      `lark-cli${process.platform === "win32" ? ".exe" : ""}`
    );
    try {
      fs.accessSync(nativeExecutable, fs.constants.X_OK);
      return nativeExecutable;
    } catch {
      // Fall back to the launcher; commandErrorMessage provides a clear
      // recovery message if that legacy installation still needs Node.
    }
  }
  return resolved;
}

class DomiIntegration {
  constructor({
    stateStore,
    plaudOutputDir,
    plaudStateDir,
    configProvider,
    domiConfigPath,
    playwrightNodeModules,
    mediaRuntime,
    sleep
  }) {
    this.stateStore = stateStore;
    this.configProvider = configProvider || (() => ({}));
    this.sleep = sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.larkCli = this.resolveLarkCli();
    this.materialIndexCache = new Map();
    this.larkCommandQueue = new TaskQueue(2);
    this.larkStatusCache = {
      value: null,
      expiresAt: 0,
      inFlight: null
    };
    this.intakeFieldsReadyKey = "";
    this.intakeFieldsPromise = null;
    this.intakeFieldsPromiseKey = "";
    this.plaudCommandQueue = new TaskQueue(1);
    this.plaudRemoteHealth = null;
    this.taskDocumentSources = new Map();
    this.plaudOutputDir = path.resolve(plaudOutputDir || path.join(os.homedir(), "Documents", "domi", "work", "domi", "plaud"));
    this.plaudStateFile = path.join(
      path.resolve(plaudStateDir || process.env.DOMI_PLAUD_STATE_DIR || path.join(os.homedir(), ".domi")),
      "plaud-workflow.json"
    );
    this.plaudWorker = path.join(__dirname, "plaud-worker.cjs");
    this.domiConfigPath = String(domiConfigPath || process.env.DOMI_CONFIG_PATH || "").trim();
    this.playwrightNodeModules = playwrightNodeModules || resolvePlaywrightNodeModules();
    this.mediaRuntime = mediaRuntime || resolveMediaRuntime();
  }

  async buildMaterialIndex(rootPath) {
    const resolvedRoot = path.resolve(rootPath);
    if (this.materialIndexCache.has(resolvedRoot)) {
      return this.materialIndexCache.get(resolvedRoot);
    }

    const pending = (async () => {
      const entries = [];
      const directories = [resolvedRoot];
      while (directories.length && entries.length < 60000) {
        const current = directories.pop();
        let children;
        try {
          children = await fs.promises.readdir(current, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const child of children) {
          if (child.name.startsWith(".") || SKIPPED_MATERIAL_DIRECTORIES.has(child.name)) continue;
          const fullPath = path.join(current, child.name);
          const relativePath = path.relative(resolvedRoot, fullPath);
          if (child.isDirectory()) {
            entries.push({ path: fullPath, relativePath, name: child.name, isDirectory: true });
            directories.push(fullPath);
          } else if (child.isFile()) {
            entries.push({ path: fullPath, relativePath, name: child.name, isDirectory: false });
          }
          if (entries.length >= 60000) break;
        }
      }
      return entries;
    })();

    this.materialIndexCache.set(resolvedRoot, pending);
    try {
      return await pending;
    } catch (error) {
      this.materialIndexCache.delete(resolvedRoot);
      throw error;
    }
  }

  async findEntityFiles(rootPath, entityName) {
    if (!rootPath || !fs.existsSync(rootPath)) return [];
    const keys = entitySearchKeys(entityName);
    if (!keys.length) return [];
    const entries = await this.buildMaterialIndex(rootPath);
    const matchingDirectories = entries
      .filter((entry) => entry.isDirectory)
      .filter((entry) => keys.some((key) => normalizedMaterialText(entry.name).includes(key)))
      .map((entry) => `${entry.path}${path.sep}`);

    const scored = entries
      .filter((entry) => !entry.isDirectory)
      .map((entry) => {
        const normalizedName = normalizedMaterialText(entry.name);
        const normalizedRelative = normalizedMaterialText(entry.relativePath);
        const directKey = keys.find((key) => normalizedName.includes(key));
        const pathKey = keys.find((key) => normalizedRelative.includes(key));
        const inMatchingDirectory = matchingDirectories.some((directory) => entry.path.startsWith(directory));
        const score = (directKey ? 120 + directKey.length : 0)
          + (pathKey ? 55 + pathKey.length : 0)
          + (inMatchingDirectory ? 90 : 0);
        return { entry, score };
      })
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score || left.entry.relativePath.localeCompare(right.entry.relativePath, "zh-CN"))
      .slice(0, 24);

    return Promise.all(scored.map(async ({ entry }) => {
      let size = 0;
      let mtimeMs = 0;
      try {
        const stat = await fs.promises.stat(entry.path);
        size = stat.size;
        mtimeMs = stat.mtimeMs;
      } catch {
        // Cloud placeholders can still be opened even when metadata is temporarily unavailable.
      }
      return {
        name: entry.name,
        path: entry.path,
        relativePath: entry.relativePath,
        kind: materialKind(entry.path),
        size,
        mtimeMs
      };
    }));
  }

  async entityMaterials(request) {
    const entityType = request?.entityType === "person" ? "person" : "project";
    const recordId = String(request?.recordId || "");
    const cached = this.stateStore.loadCache(CACHE_KEY)?.value;
    if (!cached) throw new Error("domi 项目与人脉缓存尚未同步。");
    const collection = entityType === "project" ? cached.projects : cached.people;
    const entity = collection?.find((item) => item.recordId === recordId);
    if (!entity) throw new Error("没有在 domi 缓存中找到该项目或人脉。");

    const projectConfig = this.readProjectConfig();
    const searchRoot = entityType === "project"
      ? projectConfig.localLibraryDir
      : path.dirname(projectConfig.localLibraryDir);
    const files = await this.findEntityFiles(searchRoot, entity.name);
    return {
      entityType,
      recordId,
      searchRoot,
      files,
      generatedAt: Date.now()
    };
  }

  resolveLarkCli() {
    const candidates = [
      process.env.LARK_CLI_PATH,
      path.join(os.homedir(), ".npm-global", "bin", "lark-cli"),
      "/opt/homebrew/bin/lark-cli",
      "/usr/local/bin/lark-cli",
      executableFromPath("lark-cli")
    ].filter(Boolean);
    for (const candidate of candidates) {
      const executable = resolveLarkCliExecutable(candidate);
      if (executable) return executable;
    }
    return "lark-cli";
  }

  findPlugin() {
    const cacheRoot = path.join(
      process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
      "plugins",
      "cache"
    );
    if (!fs.existsSync(cacheRoot)) {
      throw new Error("未找到已安装的 domi 插件。请先在 Codex 中安装 domi。 ");
    }
    const candidates = fs.readdirSync(cacheRoot, { withFileTypes: true })
      .filter((marketplace) => marketplace.isDirectory())
      .flatMap((marketplace) => {
        const baseDir = path.join(cacheRoot, marketplace.name, "domi");
        if (!fs.existsSync(baseDir)) return [];
        return fs.readdirSync(baseDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => {
            const root = path.join(baseDir, entry.name);
            const manifestPath = path.join(root, ".codex-plugin", "plugin.json");
            if (!fs.existsSync(manifestPath)) return null;
            try {
              const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
              return {
                root,
                manifest,
                marketplace: marketplace.name,
                version: manifest.version || entry.name
              };
            } catch {
              return null;
            }
          });
      })
      .filter(Boolean)
      .sort((left, right) => compareVersions(right.version, left.version)
        || Number(right.marketplace === "domi-managed") - Number(left.marketplace === "domi-managed"));
    if (!candidates.length) {
      throw new Error("domi 插件目录存在，但没有可读取的 plugin.json。 ");
    }
    return candidates[0];
  }

  readProjectConfig() {
    const settings = this.configProvider();
    const backend = settings.storageBackend === "local" ? "local" : "feishu";
    const appToken = String(settings.projectBaseToken || "").trim();
    const tableId = String(settings.projectTableId || "").trim();
    const wikiSpaceId = String(settings.wikiSpaceId || "").trim();
    const localLibraryRaw = String(settings.localLibraryDir || settings.oneDriveProjectDir || "").trim();
    const localRepositoryRaw = String(settings.localRepositoryDir || "").trim();
    const localDatabaseRaw = String(settings.localDatabasePath || "").trim();
    if (backend === "local") {
      if (!localRepositoryRaw || !localDatabaseRaw) {
        throw new Error("domi 本地资料库尚未配置。请在 domi 设置的“资料连接”中选择本地资料库目录。 ");
      }
      return {
        backend,
        appToken: "",
        tableId: "",
        wikiSpaceId: "",
        localLibraryDir: resolveHomePath(localRepositoryRaw),
        localDatabasePath: resolveHomePath(localDatabaseRaw)
      };
    }
    if (!appToken || !tableId || !wikiSpaceId || !localLibraryRaw) {
      throw new Error("domi 项目库连接尚未配置。请在 domi 设置的“资料连接”中填写项目 Base、Wiki 和本地资料库目录。 ");
    }
    return {
      backend,
      appToken,
      tableId,
      wikiSpaceId,
      localLibraryDir: resolveHomePath(localLibraryRaw),
      localDatabasePath: localDatabaseRaw ? resolveHomePath(localDatabaseRaw) : ""
    };
  }

  readRadarConfig() {
    const settings = this.configProvider();
    if (settings.storageBackend === "local") {
      const localLibraryDir = resolveHomePath(settings.localRepositoryDir);
      const localDatabasePath = resolveHomePath(settings.localDatabasePath);
      if (!localLibraryDir || !localDatabasePath) {
        throw new Error("domi 本地行业动态库尚未配置。请在 domi 设置的“资料连接”中选择本地资料库目录。 ");
      }
      return {
        backend: "local",
        appToken: "",
        tableId: "",
        baseUrl: "",
        localLibraryDir,
        localDatabasePath
      };
    }
    const appToken = String(settings.radarBaseToken || "").trim();
    const tableId = String(settings.radarTableId || "").trim();
    if (!appToken || !tableId) {
      throw new Error("domi 行业动态连接尚未配置。请在 domi 设置的“资料连接”中填写行业动态 Base。 ");
    }
    return { backend: "feishu", appToken, tableId, baseUrl: "" };
  }

  withLocalRepository(source, callback) {
    const repository = new LocalDomiRepository({
      databasePath: source.localDatabasePath,
      libraryDir: source.localLibraryDir
    });
    try {
      const result = callback(repository);
      if (result && typeof result.then === "function") {
        return result.finally(() => repository.close());
      }
      repository.close();
      return result;
    } catch (error) {
      repository.close();
      throw error;
    }
  }

  async runJson(binary, args, options = {}) {
    const execute = async () => {
      let stdout;
      try {
        ({ stdout } = await execFileAsync(binary, args, {
        cwd: options.cwd || os.homedir(),
        timeout: options.timeout || 60000,
        maxBuffer: 24 * 1024 * 1024,
        env: {
          ...process.env,
          LARKSUITE_CLI_NO_UPDATE_NOTIFIER: "1",
          LARKSUITE_CLI_NO_SKILLS_NOTIFIER: "1",
          ...(options.env || {})
        }
        }));
      } catch (error) {
        throw new Error(commandErrorMessage(error, binary, options));
      }
      const value = JSON.parse(stdout.trim());
      if (value?.ok === false) {
        const message = typeof value.error === "string" ? value.error : value.error?.message;
        throw new Error(message || "domi 命令执行失败。 ");
      }
      return value;
    };
    if (options.queue === "lark") return this.larkCommandQueue.run(execute);
    if (options.queue === "plaud") return this.plaudCommandQueue.run(execute);
    return execute();
  }

  plaudPaths(pluginInput) {
    const plugin = pluginInput || this.findPlugin();
    return {
      plugin,
      script: path.join(plugin.root, "skills", "plaud", "scripts", "plaud.js")
    };
  }

  plaudRuntimeEnv() {
    const nodePaths = [
      this.playwrightNodeModules,
      ...String(process.env.NODE_PATH || "").split(path.delimiter)
    ].filter(Boolean);
    return {
      ELECTRON_RUN_AS_NODE: "1",
      ...(this.domiConfigPath ? { DOMI_CONFIG_PATH: this.domiConfigPath } : {}),
      ...(this.mediaRuntime.ffmpegPath
        ? { DOMI_FFMPEG_PATH: this.mediaRuntime.ffmpegPath }
        : {}),
      ...(this.mediaRuntime.ffprobePath
        ? { DOMI_FFPROBE_PATH: this.mediaRuntime.ffprobePath }
        : {}),
      ...(nodePaths.length ? { NODE_PATH: [...new Set(nodePaths)].join(path.delimiter) } : {})
    };
  }

  plaudEnabled() {
    return this.configProvider().plaudConnectionMode !== "disabled";
  }

  async runPlaudWorker(command, args = [], pluginInput) {
    if (!this.plaudEnabled()) {
      throw new Error("PLAUD 未启用。请先在 domi 设置的“录音转写”中开启。");
    }
    const { plugin } = this.plaudPaths(pluginInput);
    return this.runJson(process.execPath, [this.plaudWorker, command, plugin.root, ...args], {
      timeout: command === "list" ? 180000 : 120000,
      label: command === "list" ? "PLAUD 最近录音读取" : "PLAUD 操作",
      queue: "plaud",
      env: this.plaudRuntimeEnv()
    });
  }

  async ensureIntakeTimeFields(pluginInput) {
    const plugin = pluginInput || this.findPlugin();
    const settings = this.configProvider();
    const readinessKey = [
      plugin.version || plugin.manifest?.version || "",
      settings.projectBaseToken || "",
      settings.projectTableId || "",
      settings.peopleBaseToken || "",
      settings.peopleTableId || ""
    ].join("\u0000");
    if (this.intakeFieldsReadyKey === readinessKey) {
      return { ok: true, cached: true };
    }
    if (this.intakeFieldsPromise && this.intakeFieldsPromiseKey === readinessKey) {
      return this.intakeFieldsPromise;
    }
    const script = path.join(
      plugin.root,
      "skills",
      "investment-mgmt",
      "scripts",
      "ensure-intake-time-fields.js"
    );
    if (!fs.existsSync(script)) {
      throw new Error("当前 domi 插件缺少入库时间迁移组件，请先更新插件。");
    }
    this.intakeFieldsPromiseKey = readinessKey;
    this.intakeFieldsPromise = this.runJson(process.execPath, [script, "ensure"], {
        label: "项目与人脉入库时间字段初始化",
        queue: "lark",
        timeout: 180000,
        env: {
          ELECTRON_RUN_AS_NODE: "1",
          LARK_CLI_PATH: this.larkCli,
          ...(this.domiConfigPath ? { DOMI_CONFIG_PATH: this.domiConfigPath } : {})
        }
      })
      .then((result) => {
        this.intakeFieldsReadyKey = readinessKey;
        return result;
      })
      .finally(() => {
        if (this.intakeFieldsPromiseKey === readinessKey) {
          this.intakeFieldsPromise = null;
          this.intakeFieldsPromiseKey = "";
        }
      });
    return this.intakeFieldsPromise;
  }

  normalizePlaudBrowser(value) {
    return value === "tabbit" ? "tabbit" : "chrome";
  }

  async runPlaudConnectionCommand(command, requestedBrowser) {
    if (!this.plaudEnabled() && command !== "logout") {
      throw new Error("PLAUD 未启用。请先在 domi 设置的“录音转写”中开启。");
    }
    const { script } = this.plaudPaths();
    const browser = this.normalizePlaudBrowser(
      requestedBrowser || this.configProvider().plaudBrowser
    );
    return this.runJson(process.execPath, [script, command, browser], {
      timeout: command === "login" ? 11 * 60 * 1000 : 180000,
      label: command === "login"
        ? "PLAUD 浏览器登录"
        : command === "doctor"
          ? "PLAUD 环境检查"
        : command === "logout"
          ? "PLAUD 本地登录清理"
          : "PLAUD 登录验证",
      queue: "plaud",
      env: this.plaudRuntimeEnv()
    });
  }

  async loginPlaud(request = {}) {
    const browser = this.normalizePlaudBrowser(
      request.browser || this.configProvider().plaudBrowser
    );
    let result;
    try {
      await this.plaudDoctor({ ...request, browser });
      result = await this.runPlaudConnectionCommand("login", browser);
    } catch (error) {
      result = classifyPlaudConnectionFailure(error, browser);
    }
    result = {
      ...result,
      browser,
      browserLabel: result?.browserLabel || plaudBrowserLabel(browser),
      status: result?.connected ? "connected" : result?.status || "auth_required",
      checkedAt: result?.checkedAt || Date.now()
    };
    this.plaudRemoteHealth = {
      ok: Boolean(result?.connected),
      error: result?.connected ? "" : String(result?.error || ""),
      checkedAt: result.checkedAt
    };
    return result;
  }

  async plaudConnection(request = {}) {
    const browser = this.normalizePlaudBrowser(
      request.browser || this.configProvider().plaudBrowser
    );
    try {
      await this.plaudDoctor({ ...request, browser });
      const response = await this.runPlaudConnectionCommand("connection", browser);
      const result = {
        ...response,
        browser,
        browserLabel: response?.browserLabel || plaudBrowserLabel(browser),
        status: response?.connected ? "connected" : response?.status || "auth_required",
        checkedAt: response?.checkedAt || Date.now()
      };
      this.plaudRemoteHealth = {
        ok: Boolean(result?.connected),
        error: result?.connected ? "" : String(result?.error || ""),
        checkedAt: result.checkedAt
      };
      return result;
    } catch (error) {
      const result = classifyPlaudConnectionFailure(error, browser);
      this.plaudRemoteHealth = {
        ok: false,
        error: result.error,
        checkedAt: result.checkedAt
      };
      return result;
    }
  }

  async plaudDoctor(request = {}) {
    return this.runPlaudConnectionCommand("doctor", request.browser);
  }

  async disconnectPlaud(request = {}) {
    const result = await this.runPlaudConnectionCommand("logout", request.browser);
    this.plaudRemoteHealth = null;
    return result;
  }

  normalizePlaudQueueItem(item) {
    return {
      fileId: String(item?.fileId || ""),
      fileName: String(item?.fileName || "未命名录音"),
      duration: Number(item?.duration) || null,
      createdAt: Number(item?.createdAt) || null,
      editedAt: Number(item?.editedAt) || null,
      hasTranscript: Boolean(item?.transcriptPath),
      hasSummary: false,
      processing: ["generation_submitting", "generating"].includes(item?.stage),
      queueStage: String(item?.stage || ""),
      transcriptPath: String(item?.transcriptPath || ""),
      error: String(item?.error || "")
    };
  }

  loadPlaudWorkflowRecords() {
    try {
      const state = JSON.parse(fs.readFileSync(this.plaudStateFile, "utf8"));
      if (!state?.records || typeof state.records !== "object") return [];
      return Object.values(state.records).filter((item) => item && String(item.fileId || ""));
    } catch {
      return [];
    }
  }

  loadActivePlaudWorkflowRecords() {
    return this.loadPlaudWorkflowRecords()
      .filter((item) => !PLAUD_FINAL_WORKFLOW_STAGES.has(String(item.stage || "")))
      .sort((left, right) => String(left.updatedAt || "").localeCompare(String(right.updatedAt || "")));
  }

  async plaudQueue(limit = 50) {
    if (!this.plaudEnabled()) {
      return {
        ok: false,
        disabled: true,
        syncedAt: Date.now(),
        pendingCount: 0,
        queueCount: 0,
        items: [],
        error: ""
      };
    }
    const { plugin } = this.plaudPaths();
    const [remoteResult] = await Promise.allSettled([
      this.runPlaudWorker("list", [String(limit)], plugin)
    ]);
    const queueItems = this.loadActivePlaudWorkflowRecords();
    const workflowById = new Map(
      this.loadPlaudWorkflowRecords().map((item) => [String(item.fileId), item])
    );
    for (const item of queueItems) workflowById.set(String(item.fileId), item);
    const activeQueueById = new Map(queueItems.map((item) => [String(item.fileId), item]));
    const remoteItems = remoteResult.status === "fulfilled" ? remoteResult.value.items || [] : [];
    this.plaudRemoteHealth = {
      ok: remoteResult.status === "fulfilled",
      error: remoteResult.status === "rejected" ? remoteResult.reason.message : "",
      checkedAt: Date.now()
    };
    const items = remoteItems.map((item) => {
      const fileId = String(item.fileId);
      const queued = workflowById.get(fileId);
      activeQueueById.delete(fileId);
      return {
        ...item,
        queueStage: String(queued?.stage || ""),
        transcriptPath: String(queued?.transcriptPath || ""),
        error: String(queued?.error || "")
      };
    });
    for (const queued of activeQueueById.values()) {
      items.push(this.normalizePlaudQueueItem(queued));
    }
    items.sort(comparePlaudItems);
    const errors = [
      remoteResult.status === "rejected" ? remoteResult.reason.message : ""
    ].filter(Boolean);
    return {
      ok: remoteResult.status === "fulfilled",
      syncedAt: Date.now(),
      pendingCount: remoteResult.status === "fulfilled" ? remoteResult.value.pendingCount || 0 : 0,
      queueCount: queueItems.length,
      items,
      error: errors.join("；")
    };
  }

  async syncPlaud(request = {}) {
    const current = await this.plaudQueue();
    if (!current.ok) return current;
    if (current.pendingCount > 10 && !request.confirmed) {
      return { ok: false, requiresConfirmation: true, pendingCount: current.pendingCount, snapshot: current };
    }

    const { script } = this.plaudPaths();
    const runName = new Date().toISOString().replace(/[:.]/g, "-");
    const outputDir = path.join(this.plaudOutputDir, runName);
    const recoverableItems = (current.items || []).filter((item) =>
      item.hasTranscript
      && item.queueStage
      && !item.transcriptPath
    );
    const recoveryResults = [];
    for (const item of recoverableItems) {
      try {
        await this.runJson(process.execPath, [script, "download", item.fileId, outputDir], {
          timeout: 180000,
          queue: "plaud",
          env: this.plaudRuntimeEnv()
        });
        recoveryResults.push({ ok: true, fileId: item.fileId });
      } catch (error) {
        recoveryResults.push({
          ok: false,
          fileId: item.fileId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    let generationResult = { results: [], manifestPath: "" };
    if (current.pendingCount > 0) {
      generationResult = await this.runJson(process.execPath, [
        script,
        "sync-pending",
        String(current.pendingCount),
        outputDir,
        "900",
        "8"
      ], {
        timeout: 930000,
        queue: "plaud",
        env: this.plaudRuntimeEnv()
      });
    }
    const snapshot = await this.plaudQueue();
    const generationResults = generationResult.results || [];
    return {
      ok: snapshot.ok,
      recoveredCount: recoveryResults.filter((item) => item.ok).length,
      generatedCount: generationResults.filter((item) => item.ok).length,
      failedCount:
        recoveryResults.filter((item) => !item.ok).length
        + generationResults.filter((item) => !item.ok).length,
      manifestPath: generationResult.manifestPath || "",
      snapshot,
      error: snapshot.error || ""
    };
  }

  async mutatePlaudQueue(mutator) {
    const stateDir = path.join(os.homedir(), ".domi");
    const statePath = path.join(stateDir, "plaud-workflow.json");
    const lockPath = path.join(stateDir, "plaud-workflow.lock");
    if (!fs.existsSync(statePath)) return false;
    fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    let lockHandle;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        lockHandle = fs.openSync(lockPath, "wx", 0o600);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        try {
          if (Date.now() - fs.statSync(lockPath).mtimeMs > 120000) fs.rmSync(lockPath, { force: true });
        } catch {}
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
    if (lockHandle === undefined) throw new Error("等待 PLAUD 队列写入锁超时。 ");
    try {
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      if (!mutator(state)) return false;
      const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, statePath);
      return true;
    } finally {
      try { fs.closeSync(lockHandle); } catch {}
      fs.rmSync(lockPath, { force: true });
    }
  }

  async updatePlaudQueueTitle(fileId, fileName) {
    return this.mutatePlaudQueue((state) => {
      if (!state.records?.[fileId]) return false;
      state.records[fileId] = {
        ...state.records[fileId],
        fileName,
        updatedAt: new Date().toISOString()
      };
      return true;
    });
  }

  async removePlaudQueueItem(fileId) {
    return this.mutatePlaudQueue((state) => {
      if (!state.records?.[fileId]) return false;
      delete state.records[fileId];
      return true;
    });
  }

  async renamePlaud(request = {}) {
    if (!this.plaudEnabled()) {
      return { ok: false, error: "PLAUD 未启用。请先在 domi 设置的“录音转写”中开启。" };
    }
    const fileId = String(request.fileId || "").trim();
    const fileName = String(request.fileName || "").trim();
    const result = await this.runPlaudWorker("rename", [fileId, fileName]);
    await this.updatePlaudQueueTitle(fileId, result.fileName);
    return { ok: true, fileId, fileName: result.fileName };
  }

  async deletePlaud(request = {}) {
    if (!this.plaudEnabled()) {
      return { ok: false, error: "PLAUD 未启用。请先在 domi 设置的“录音转写”中开启。" };
    }
    const fileId = String(request.fileId || "").trim();
    const result = await this.runPlaudWorker("trash", [fileId]);
    await this.removePlaudQueueItem(fileId);
    return { ok: true, fileId: result.fileId || fileId, trashed: true };
  }

  async lark(args, options = {}) {
    return this.runJson(this.larkCli, [...args, "--as", "user"], {
      label: options.label || "飞书数据读取",
      queue: "lark",
      ...options
    });
  }

  async withFeishuReadRetry(operation) {
    let lastError;
    for (let attempt = 0; attempt <= FEISHU_READ_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (
          attempt >= FEISHU_READ_RETRY_DELAYS_MS.length
          || !isRetryableFeishuReadError(error)
        ) {
          throw error;
        }
        await this.sleep(FEISHU_READ_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  async larkStatus({ force = false } = {}) {
    const now = Date.now();
    if (!force && this.larkStatusCache.value && this.larkStatusCache.expiresAt > now) {
      return this.larkStatusCache.value;
    }
    if (this.larkStatusCache.inFlight) return this.larkStatusCache.inFlight;

    this.larkStatusCache.inFlight = (async () => {
      let result;
      try {
        const auth = await this.withFeishuReadRetry(() =>
          this.runJson(
            this.larkCli,
            ["auth", "status", "--json", "--verify"],
            { label: "飞书登录检查", queue: "lark" }
          )
        );
        result = {
          ok: Boolean(auth?.verified),
          cliPath: this.larkCli,
          userName: auth?.identities?.user?.userName || "",
          appName: auth?.identities?.bot?.appName || "",
          tokenStatus: auth?.identities?.user?.tokenStatus || "",
          error: ""
        };
      } catch (error) {
        result = {
          ok: false,
          cliPath: this.larkCli,
          userName: "",
          appName: "",
          tokenStatus: "",
          error: error instanceof Error ? error.message : String(error)
        };
      }
      this.larkStatusCache.value = result;
      this.larkStatusCache.expiresAt = Date.now() + (result.ok ? 60_000 : 10_000);
      return result;
    })().finally(() => {
      this.larkStatusCache.inFlight = null;
    });

    return this.larkStatusCache.inFlight;
  }

  resolvePeopleBase() {
    const settings = this.configProvider();
    const appToken = String(settings.peopleBaseToken || "").trim();
    const tableId = String(settings.peopleTableId || "").trim();
    if (!appToken || !tableId) {
      throw new Error("domi 人脉库连接尚未配置。请在 domi 设置的“资料连接”中填写人脉 Base。 ");
    }
    return { appToken, tableId };
  }

  async fetchRecords({ appToken, tableId, fieldNames }) {
    const items = [];
    let pageToken = "";
    for (let page = 0; page < FEISHU_RECORD_MAX_PAGES; page += 1) {
      const params = { page_size: FEISHU_RECORD_PAGE_SIZE };
      if (pageToken) params.page_token = pageToken;
      const response = await this.withFeishuReadRetry(() =>
        this.lark([
          "api",
          "POST",
          `/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/search`,
          "--params",
          JSON.stringify(params),
          "--data",
          JSON.stringify({ field_names: fieldNames })
        ])
      );
      const data = response.data || {};
      items.push(...(data.items || []));
      if (!data.has_more) return { items, total: data.total ?? items.length };
      pageToken = data.page_token || "";
      if (!pageToken) break;
    }
    throw new Error("domi Base 记录超过同步上限或分页信息缺失。 ");
  }

  weeklyNewsCacheKey(days, page) {
    return `${WEEKLY_NEWS_CACHE_KEY}:${days}:${page}`;
  }

  loadWeeklyNewsCache(days, page) {
    const cached = this.stateStore.loadCache(this.weeklyNewsCacheKey(days, page));
    if (!cached?.value?.items) return null;
    this.stateStore.upsertNews(cached.value.items);
    return {
      ...cached.value,
      radarCheckedThrough: this.loadWeeklyNewsRadarCheckpoint(),
      ok: true,
      fromCache: true,
      cachedAt: cached.updatedAt
    };
  }

  loadWeeklyNewsRadarCheckpoint() {
    const cached = this.stateStore.loadCache(WEEKLY_NEWS_RADAR_CHECKPOINT_KEY);
    return normalizedEpochMs(cached?.value?.checkedThrough);
  }

  recordWeeklyNewsRadarCheckpoint(request = {}) {
    const checkedThrough = normalizedEpochMs(request.checkedThrough);
    if (!checkedThrough) {
      return { ok: false, error: "行业雷达没有返回有效的检查水位。" };
    }
    if (checkedThrough > Date.now() + 5 * 60 * 1000) {
      return { ok: false, error: "行业雷达返回的检查水位晚于当前时间。" };
    }
    const previous = this.loadWeeklyNewsRadarCheckpoint();
    const radarCheckedThrough = Math.max(previous, checkedThrough);
    this.stateStore.saveCache(WEEKLY_NEWS_RADAR_CHECKPOINT_KEY, {
      checkedThrough: radarCheckedThrough
    });
    return { ok: true, radarCheckedThrough };
  }

  async weeklyNews(request = {}) {
    const days = Math.min(Math.max(Number(request.days) || 7, 1), 30);
    const limit = Math.min(Math.max(Number(request.limit) || 100, 1), 100);
    const page = Math.min(Math.max(Math.floor(Number(request.page) || 0), 0), 51);
    const now = new Date();
    const rangeEnd = new Date(now.getTime() - page * days * 24 * 60 * 60 * 1000);
    const rangeStart = new Date(rangeEnd.getTime() - days * 24 * 60 * 60 * 1000);
    const cachedPage = this.loadWeeklyNewsCache(days, page);
    const radarCheckedThrough = this.loadWeeklyNewsRadarCheckpoint();
    const localSnapshot = (error = "") => {
      const items = this.stateStore.listNews({
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        limit: 500
      });
      const olderItems = this.stateStore.listNews({
        rangeStart: 0,
        rangeEnd: rangeStart.getTime(),
        limit: 1
      });
      return {
        ok: items.length > 0,
        fromCache: true,
        stale: Boolean(error),
        error,
        checkedAt: cachedPage?.checkedAt || 0,
        contentUpdatedAt: cachedPage?.contentUpdatedAt || cachedPage?.syncedAt || cachedPage?.cachedAt || 0,
        radarCheckedThrough,
        syncedAt: cachedPage?.contentUpdatedAt || cachedPage?.syncedAt || cachedPage?.cachedAt || 0,
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        page,
        total: items.length,
        hasMore: false,
        hasNewer: page > 0,
        hasOlder: olderItems.length > 0,
        sourceUrl: cachedPage?.sourceUrl || "",
        items
      };
    };
    if (request.cacheOnly) {
      if (cachedPage) return cachedPage;
      const local = localSnapshot();
      return local.items.length > 0 ? local : { ...local, ok: false, cacheMiss: true };
    }
    let source;
    try {
      source = this.readRadarConfig();
      if (source.backend === "local") {
        const items = this.withLocalRepository(source, (repository) => repository.listNews({
          rangeStart: rangeStart.getTime(),
          rangeEnd: rangeEnd.getTime(),
          limit: 500
        }));
        this.stateStore.upsertNews(items);
        const olderItems = this.withLocalRepository(source, (repository) => repository.listNews({
          rangeStart: 0,
          rangeEnd: rangeStart.getTime(),
          limit: 1
        }));
        const timestamps = resolveWeeklyNewsTimestamps(cachedPage, items);
        const snapshot = {
          ok: true,
          backend: "local",
          checkedAt: timestamps.checkedAt,
          contentUpdatedAt: timestamps.contentUpdatedAt,
          radarCheckedThrough,
          syncedAt: timestamps.contentUpdatedAt,
          contentChanged: timestamps.changed,
          rangeStart: rangeStart.getTime(),
          rangeEnd: rangeEnd.getTime(),
          page,
          total: items.length,
          hasMore: false,
          hasNewer: page > 0,
          hasOlder: page < 51 && olderItems.length > 0,
          sourceUrl: "",
          items
        };
        this.stateStore.saveCache(this.weeklyNewsCacheKey(days, page), snapshot);
        return snapshot;
      }
    } catch (error) {
      const fallback = localSnapshot(error instanceof Error ? error.message : String(error));
      if (fallback.items.length > 0) return fallback;
      throw error;
    }
    const exactDate = (date) => {
      const datePart = [
        date.getFullYear(),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0")
      ].join("-");
      const timePart = [
        String(date.getHours()).padStart(2, "0"),
        String(date.getMinutes()).padStart(2, "0")
      ].join(":");
      return `ExactDate(${datePart} ${timePart})`;
    };
    try {
      const conditions = [
        ["信息发布时间", ">", exactDate(rangeStart)],
        ["是否值得关注", "==", true]
      ];
      if (page > 0) conditions.splice(1, 0, ["信息发布时间", "<", exactDate(rangeEnd)]);
      const filter = { logic: "and", conditions };
      const sort = [
        { field: "信息发布时间", desc: true },
        { field: "重要性评分", desc: true }
      ];
      const args = [
        "base",
        "+record-list",
        "--base-token",
        source.appToken,
        "--table-id",
        source.tableId,
        "--filter-json",
        JSON.stringify(filter),
        "--sort-json",
        JSON.stringify(sort),
        "--limit",
        String(limit),
        "--format",
        "json"
      ];
      for (const fieldName of WEEKLY_NEWS_FIELDS) args.push("--field-id", fieldName);
      const result = await this.lark(args);
      const data = result.data || {};
      const fields = data.fields || [];
      const rows = data.data || [];
      const recordIds = data.record_id_list || [];
      const items = rows.map((row, index) => {
        const values = Object.fromEntries(fields.map((field, fieldIndex) => [field, row[fieldIndex]]));
        return {
          recordId: String(recordIds[index] || ""),
          title: textValue(values["新闻标题"]).trim(),
          domains: stringList(values["领域"]),
          subdomains: stringList(values["子领域"]),
          types: stringList(values["信息类型"]),
          publishedAt: timestampValue(values["信息发布时间"]),
          summary: textValue(values["新闻核心内容"]).trim(),
          investmentMeaning: textValue(values["投资含义"]).trim(),
          url: normalizeWebResource(values["原文链接"]),
          source: textValue(values["来源名称"]).trim(),
          companies: textValue(values["涉及公司"]).trim(),
          institutions: textValue(values["涉及机构"]).trim(),
          importance: Number(values["重要性评分"]) || 0,
          confidence: Number(values["可信度"]) || 0,
          evidenceStatus: textValue(values["证据状态"]).trim(),
          action: textValue(values["建议动作"]).trim()
        };
      }).filter((item) => item.recordId && item.title && item.publishedAt);

      this.stateStore.upsertNews(items);
      const preservedItems = this.stateStore.listNews({
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        limit: 500
      });
      const olderItems = this.stateStore.listNews({
        rangeStart: 0,
        rangeEnd: rangeStart.getTime(),
        limit: 1
      });
      const timestamps = resolveWeeklyNewsTimestamps(cachedPage, preservedItems);
      const snapshot = {
        ok: true,
        checkedAt: timestamps.checkedAt,
        contentUpdatedAt: timestamps.contentUpdatedAt,
        radarCheckedThrough,
        syncedAt: timestamps.contentUpdatedAt,
        contentChanged: timestamps.changed,
        rangeStart: rangeStart.getTime(),
        rangeEnd: rangeEnd.getTime(),
        page,
        total: preservedItems.length,
        hasMore: Boolean(data.has_more),
        hasNewer: page > 0,
        hasOlder: page < 51 && (Boolean(data.has_more) || items.length >= limit || olderItems.length > 0),
        sourceUrl: source.baseUrl,
        items: preservedItems
      };
      this.stateStore.saveCache(this.weeklyNewsCacheKey(days, page), snapshot);
      return snapshot;
    } catch (error) {
      const fallback = localSnapshot(error instanceof Error ? error.message : String(error));
      if (fallback.items.length > 0) return fallback;
      throw error;
    }
  }

  taskBoardCacheIdentity(settings = this.configProvider()) {
    if (settings.storageBackend === "local") {
      const localRepositoryDir = resolveHomePath(settings.localRepositoryDir);
      return localRepositoryDir
        ? `local:${path.resolve(localRepositoryDir, LOCAL_TODO_DOCUMENT_NAME)}`
        : "";
    }
    const legacyDocument = String(settings.taskDocumentUrl || "").trim();
    if (legacyDocument) return legacyDocument;
    const wikiSpaceId = String(settings.wikiSpaceId || "").trim();
    return wikiSpaceId ? `wiki:${wikiSpaceId}` : "";
  }

  async taskWikiChildren(wikiSpaceId, parentNodeToken = "") {
    const args = [
      "wiki",
      "+node-list",
      "--space-id",
      wikiSpaceId,
      "--page-all",
      "--page-limit",
      "0",
      "--format",
      "json"
    ];
    if (parentNodeToken) args.push("--parent-node-token", parentNodeToken);
    const response = await this.withFeishuReadRetry(() => this.lark(args, {
      label: `${TASK_DOCUMENT_TITLE} 文档定位`,
      timeout: 120000
    }));
    return larkResponseItems(response);
  }

  async findTaskDocumentBySearch(wikiSpaceId) {
    const results = [];
    for (const title of [TASK_DOCUMENT_TITLE, ...LEGACY_TASK_DOCUMENT_TITLES]) {
      let pageToken = "";
      for (let page = 0; page < 5; page += 1) {
        const args = [
          "drive",
          "+search",
          "--query",
          `intitle:${title}`,
          "--only-title",
          "--space-ids",
          wikiSpaceId,
          "--page-size",
          "20",
          "--format",
          "json"
        ];
        if (pageToken) args.push("--page-token", pageToken);
        const response = await this.withFeishuReadRetry(() => this.lark(args, {
          label: `${TASK_DOCUMENT_TITLE} 文档搜索`,
          timeout: 90000
        }));
        const data = larkResponseData(response);
        results.push(...(data?.results || data?.items || []));
        if (!data?.has_more || !data?.page_token) break;
        pageToken = String(data.page_token);
      }
    }

    const matchingLocators = [...new Map(results
      .filter((result) => isTaskDocumentTitle(taskSearchResultTitle(result)))
      .map(taskSearchResultLocator)
      .filter((locator) => locator.token)
      .map((locator) => [`${locator.token}:${locator.objType}`, locator])).values()];
    const matches = [];
    for (const locator of matchingLocators) {
      const args = [
        "wiki",
        "+node-get",
        "--node-token",
        locator.token,
        "--space-id",
        wikiSpaceId,
        "--format",
        "json"
      ];
      if (locator.objType) args.push("--obj-type", locator.objType);
      const response = await this.withFeishuReadRetry(() => this.lark(args, {
        label: `${TASK_DOCUMENT_TITLE} 文档解析`,
        timeout: 90000
      }));
      const data = larkResponseData(response);
      const node = data?.node || data;
      if (isTaskDocumentTitle(taskWikiNodeTitle(node))) {
        matches.push(node);
      }
    }
    return matches;
  }

  async findTaskDocumentByTraversal(wikiSpaceId) {
    const roots = await this.taskWikiChildren(wikiSpaceId);
    const queue = roots.map((node) => ({ node, depth: 0 }));
    const seen = new Set();
    const matches = [];
    let calls = 1;
    let truncated = false;

    while (queue.length) {
      if (seen.size >= MAX_TASK_WIKI_NODES) {
        truncated = true;
        break;
      }
      const { node, depth } = queue.shift();
      const nodeToken = taskWikiNodeToken(node);
      const dedupeKey = nodeToken || `${depth}:${taskWikiNodeTitle(node)}:${seen.size}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      if (isTaskDocumentTitle(taskWikiNodeTitle(node))) {
        matches.push(node);
      }

      const hasChild = node?.has_child ?? node?.hasChild;
      if (hasChild === false) continue;
      if (depth >= MAX_TASK_WIKI_DEPTH || calls >= MAX_TASK_WIKI_LIST_CALLS) {
        truncated = true;
        continue;
      }
      if (!nodeToken) continue;
      const children = await this.taskWikiChildren(wikiSpaceId, nodeToken);
      calls += 1;
      queue.push(...children.map((child) => ({ node: child, depth: depth + 1 })));
    }

    if (!matches.length && truncated) {
      throw new Error(`飞书文档库层级过深或内容过多，未能安全定位“${TASK_DOCUMENT_TITLE}”；为避免重复创建，本次没有写入。`);
    }
    return matches;
  }

  taskDocumentCandidate(match) {
    const objType = String(match?.obj_type || match?.objType || "docx");
    return {
      document: taskWikiDocumentToken(match),
      nodeToken: taskWikiNodeToken(match),
      title: taskWikiNodeTitle(match),
      objType,
      created: false
    };
  }

  async inspectTaskDocumentCandidate(candidate) {
    try {
      const response = await this.withFeishuReadRetry(() => this.lark([
        "docs",
        "+fetch",
        "--doc",
        candidate.document,
        "--detail",
        "with-ids"
      ], {
        label: `${TASK_DOCUMENT_TITLE} 重复文档核验`,
        timeout: 90000
      }));
      const parsed = parseTaskLedger(response);
      return {
        candidate,
        inspected: true,
        parsed,
        taskCount: parsed.found ? parsed.ledger.tasks.length : 0
      };
    } catch (error) {
      return {
        candidate,
        inspected: false,
        parsed: null,
        taskCount: 0,
        error
      };
    }
  }

  async selectTaskDocumentCandidate(matches) {
    const candidates = [...new Map(matches
      .map((match) => this.taskDocumentCandidate(match))
      .map((candidate) => [
        candidate.document || `${candidate.nodeToken}:${candidate.title}`,
        candidate
      ])).values()];
    const documentCandidates = candidates.filter((candidate) =>
      candidate.objType === "docx" && candidate.document
    );
    if (!documentCandidates.length) {
      if (candidates.some((candidate) => candidate.objType !== "docx")) {
        throw new Error(`飞书文档库中的“${TASK_DOCUMENT_TITLE}”不是文档类型，无法作为待办事项看板数据源。`);
      }
      throw new Error(`已找到“${TASK_DOCUMENT_TITLE}”，但飞书没有返回对应文档标识。`);
    }
    if (documentCandidates.length === 1) return documentCandidates[0];

    const inspected = await Promise.all(
      documentCandidates.map((candidate) => this.inspectTaskDocumentCandidate(candidate))
    );
    const inspectionComplete = inspected.every((item) =>
      item.inspected && !item.parsed?.error
    );
    if (inspectionComplete) {
      const taskful = inspected.filter((item) => item.taskCount > 0);
      if (taskful.length === 1) {
        const selected = taskful[0].candidate;
        return {
          ...selected,
          skipTitleMigration: isLegacyTaskDocumentTitle(selected.title)
            && documentCandidates.some((candidate) =>
              taskDocumentTitleKey(candidate.title) === taskDocumentTitleKey(TASK_DOCUMENT_TITLE)
            )
        };
      }

      if (!taskful.length) {
        const canonical = inspected.filter((item) =>
          taskDocumentTitleKey(item.candidate.title) === taskDocumentTitleKey(TASK_DOCUMENT_TITLE)
        );
        if (canonical.length === 1) return canonical[0].candidate;

        const initialized = inspected.filter((item) => item.parsed?.found);
        if (initialized.length === 1) return initialized[0].candidate;
      }
    }

    throw new Error(
      `当前飞书文档库中存在多个含有效数据的“${TASK_DOCUMENT_TITLE}”或旧版“1.Task”文档，`
      + "为避免遗漏待办事项，本次没有自动选择。"
    );
  }

  async findTaskDocument(wikiSpaceId) {
    let matches;
    try {
      matches = await this.findTaskDocumentBySearch(wikiSpaceId);
    } catch {
      matches = await this.findTaskDocumentByTraversal(wikiSpaceId);
    }
    if (!matches.length) {
      return null;
    }
    return this.selectTaskDocumentCandidate(matches);
  }

  async migrateTaskDocumentTitle(wikiSpaceId, source) {
    if (!isLegacyTaskDocumentTitle(source.title) || source.skipTitleMigration) return source;
    if (!source.nodeToken) {
      throw new Error(`已找到旧版“${source.title}”，但飞书没有返回可用于改名的节点标识。`);
    }
    await this.lark([
      "drive",
      "files",
      "patch",
      "--file-token",
      source.nodeToken,
      "--type",
      "wiki",
      "--data",
      JSON.stringify({ new_title: TASK_DOCUMENT_TITLE }),
      "--format",
      "json"
    ], {
      label: `${TASK_DOCUMENT_TITLE} 文档改名`,
      timeout: 90000
    });
    const response = await this.withFeishuReadRetry(() => this.lark([
      "wiki",
      "+node-get",
      "--node-token",
      source.nodeToken,
      "--space-id",
      wikiSpaceId,
      "--format",
      "json"
    ], {
      label: `${TASK_DOCUMENT_TITLE} 改名验证`,
      timeout: 90000
    }));
    const node = larkResponseData(response)?.node || larkResponseData(response);
    if (taskDocumentTitleKey(taskWikiNodeTitle(node)) !== taskDocumentTitleKey(TASK_DOCUMENT_TITLE)) {
      throw new Error(`旧版“${source.title}”已提交改名，但回读仍不是“${TASK_DOCUMENT_TITLE}”。`);
    }
    return { ...source, title: TASK_DOCUMENT_TITLE, migrated: true };
  }

  async initializeTaskDocument(document) {
    const emptyLedger = normalizeTaskLedger();
    await this.lark([
      "docs",
      "+update",
      "--doc",
      document,
      "--command",
      "append",
      "--content",
      renderTaskLedger(emptyLedger)
    ], {
      label: `${TASK_DOCUMENT_TITLE} 初始化`,
      timeout: 90000
    });
    const verified = await this.withFeishuReadRetry(() => this.lark([
      "docs",
      "+fetch",
      "--doc",
      document,
      "--detail",
      "with-ids"
    ], {
      label: `${TASK_DOCUMENT_TITLE} 初始化验证`,
      timeout: 90000
    }));
    const parsed = parseTaskLedger(verified);
    if (!parsed.found || !parsed.blockId) {
      throw new Error(`${TASK_DOCUMENT_TITLE} 已创建，但待办事项数据块初始化后回读验证失败。`);
    }
    return parsed.ledger;
  }

  async createTaskDocument(wikiSpaceId) {
    const response = await this.lark([
      "wiki",
      "+node-create",
      "--space-id",
      wikiSpaceId,
      "--title",
      TASK_DOCUMENT_TITLE,
      "--obj-type",
      "docx",
      "--format",
      "json"
    ], {
      label: `${TASK_DOCUMENT_TITLE} 文档创建`,
      timeout: 120000
    });
    const document = taskWikiDocumentToken(larkResponseData(response));
    if (!document) {
      throw new Error(`飞书已执行“${TASK_DOCUMENT_TITLE}”创建请求，但没有返回可用的文档标识。`);
    }
    await this.initializeTaskDocument(document);
    return { document, created: true };
  }

  async taskDocumentSource(options = {}) {
    const settings = options.settings || this.configProvider();
    if (settings.storageBackend === "local") {
      const localRepositoryDir = resolveHomePath(settings.localRepositoryDir);
      if (!localRepositoryDir) {
        throw new Error(`本地资料库尚未配置，无法定位 ${LOCAL_TODO_DOCUMENT_NAME}。`);
      }
      const rootPath = path.resolve(localRepositoryDir);
      if (options.createIfMissing) ensureDocumentLibraryStructure(rootPath);
      const document = path.join(rootPath, LOCAL_TODO_DOCUMENT_NAME);
      if (!fs.existsSync(document)) {
        throw new Error(`当前本地资料库中未找到“${LOCAL_TODO_DOCUMENT_NAME}”。`);
      }
      return {
        backend: "local",
        document,
        cacheIdentity: `local:${document}`,
        created: false,
        source: "library"
      };
    }
    if (settings.storageBackend !== "feishu") {
      throw new Error("当前资料库模式不支持待办事项看板。");
    }
    const wikiSpaceId = String(settings.wikiSpaceId || "").trim();
    const legacyDocument = String(settings.taskDocumentUrl || "").trim();
    const cacheIdentity = this.taskBoardCacheIdentity(settings);
    if (legacyDocument) {
      return { document: legacyDocument, cacheIdentity, created: false, source: "legacy" };
    }
    if (!wikiSpaceId) {
      throw new Error("飞书文档库尚未配置。请先完成项目库、人脉库和 Wiki 的资料连接。");
    }
    const cached = this.taskDocumentSources.get(wikiSpaceId);
    if (cached) return { ...cached, cacheIdentity, source: "library" };

    const found = await this.findTaskDocument(wikiSpaceId);
    if (found) {
      const migrated = await this.migrateTaskDocumentTitle(wikiSpaceId, found);
      this.taskDocumentSources.set(wikiSpaceId, migrated);
      return { ...migrated, cacheIdentity, source: "library" };
    }
    if (!options.createIfMissing) {
      throw new Error(`当前飞书文档库中未找到“${TASK_DOCUMENT_TITLE}”。`);
    }
    const created = await this.createTaskDocument(wikiSpaceId);
    this.taskDocumentSources.set(wikiSpaceId, created);
    return { ...created, cacheIdentity, source: "library" };
  }

  async ensureTaskDocument(options = {}) {
    const source = await this.taskDocumentSource({ ...options, createIfMissing: true });
    return { ok: true, created: source.created };
  }

  loadTaskBoardCache(document) {
    if (!String(document || "").trim()) return null;
    const cached = this.stateStore.loadCache(taskBoardCacheKey(document));
    return cached?.value || null;
  }

  saveTaskBoardCache(ledger, document, options = {}) {
    const snapshot = {
      ok: true,
      configured: true,
      stale: Boolean(options.stale),
      syncedAt: Date.now(),
      updatedAt: ledger.updatedAt,
      tasks: ledger.tasks
    };
    this.stateStore.saveCache(taskBoardCacheKey(document), snapshot);
    return snapshot;
  }

  async fetchTaskLedger(options = {}) {
    const source = options.source || await this.taskDocumentSource(options);
    if (source.backend === "local") {
      const content = fs.readFileSync(source.document, "utf8");
      const parsed = parseTaskLedger(content);
      if (!parsed.found) {
        throw new Error(parsed.error || `${LOCAL_TODO_DOCUMENT_NAME} 尚未初始化待办事项数据块。`);
      }
      return { ...parsed, source, content };
    }
    const result = await this.withFeishuReadRetry(() => this.lark([
      "docs",
      "+fetch",
      "--doc",
      source.document,
      "--detail",
      "with-ids"
    ], {
      label: `${TASK_DOCUMENT_TITLE} 待办事项读取`,
      timeout: 90000
    }));
    const parsed = parseTaskLedger(result);
    if (!parsed.found) {
      throw new Error(parsed.error || `${TASK_DOCUMENT_TITLE} 尚未初始化待办事项数据块。请在待办事项看板点击“同步”。`);
    }
    if (!parsed.blockId) {
      throw new Error(`${TASK_DOCUMENT_TITLE} 数据块缺少 block ID，无法进行安全的局部更新。`);
    }
    return { ...parsed, source };
  }

  async taskBoard(request = {}) {
    const settings = this.configProvider();
    const localMode = settings.storageBackend === "local";
    const configured = localMode
      ? Boolean(String(settings.localRepositoryDir || "").trim())
      : Boolean(
        String(settings.taskDocumentUrl || "").trim()
        || String(settings.wikiSpaceId || "").trim()
      );
    const cacheIdentity = this.taskBoardCacheIdentity(settings);
    const cached = this.loadTaskBoardCache(cacheIdentity);
    if (!configured) {
      return {
        ok: false,
        configured: false,
        stale: false,
        syncedAt: cached?.syncedAt || 0,
        updatedAt: cached?.updatedAt || null,
        tasks: [],
        error: localMode
          ? `本地资料库尚未配置，无法定位 ${LOCAL_TODO_DOCUMENT_NAME}。`
          : `飞书资料库尚未配置，无法定位 ${TASK_DOCUMENT_TITLE}。`
      };
    }
    if (request.cacheOnly) {
      return cached || {
        ok: true,
        configured: true,
        stale: false,
        syncedAt: 0,
        updatedAt: null,
        tasks: []
      };
    }
    try {
      const source = await this.taskDocumentSource({ createIfMissing: true });
      const { ledger } = await this.fetchTaskLedger({ source });
      return this.saveTaskBoardCache(ledger, source.cacheIdentity);
    } catch (error) {
      if (cached) {
        return {
          ...cached,
          ok: false,
          stale: true,
          error: localMode
            ? error instanceof Error ? error.message : String(error)
            : describeFeishuSyncError(error, { hasCache: true })
        };
      }
      return {
        ok: false,
        configured: true,
        stale: false,
        syncedAt: 0,
        updatedAt: null,
        tasks: [],
        error: localMode
          ? error instanceof Error ? error.message : String(error)
          : describeFeishuSyncError(error)
      };
    }
  }

  async updateTask(request = {}) {
    const taskId = boundedTaskText(request.taskId, 120);
    const status = String(request.status || "");
    if (!taskId) throw new Error("缺少任务 ID。");
    if (!["open", "in_progress", "done", "ignored"].includes(status)) {
      throw new Error("不支持的任务状态。");
    }

    const current = await this.fetchTaskLedger();
    const task = current.ledger.tasks.find((item) => item.id === taskId);
    if (!task) throw new Error(`${TASK_DOCUMENT_TITLE} 中没有找到该待办事项，可能已被其他设备更新。`);
    const now = new Date().toISOString();
    task.status = status;
    task.updatedAt = now;
    if (status === "ignored") task.ignoredAt = now;
    else delete task.ignoredAt;
    if (status === "done") task.completedAt = now;
    else delete task.completedAt;
    current.ledger.updatedAt = now;

    if (current.source.backend === "local") {
      const nextContent = replaceTaskLedgerDocumentContent(current.content, current.ledger);
      const temporaryPath = `${current.source.document}.tmp-${process.pid}-${Date.now()}`;
      fs.writeFileSync(temporaryPath, nextContent, { encoding: "utf8", mode: 0o600 });
      fs.renameSync(temporaryPath, current.source.document);
      fs.chmodSync(current.source.document, 0o600);
    } else {
      await this.lark([
        "docs",
        "+update",
        "--doc",
        current.source.document,
        "--command",
        "block_replace",
        "--block-id",
        current.blockId,
        "--content",
        renderTaskLedger(current.ledger)
      ], {
        label: `${TASK_DOCUMENT_TITLE} 状态更新`,
        timeout: 90000
      });
    }

    const verified = await this.fetchTaskLedger({ source: current.source });
    const verifiedTask = verified.ledger.tasks.find((item) => item.id === taskId);
    if (!verifiedTask || verifiedTask.status !== status) {
      const title = current.source.backend === "local"
        ? LOCAL_TODO_DOCUMENT_NAME
        : TASK_DOCUMENT_TITLE;
      throw new Error(`${title} 状态写入后回读验证失败。`);
    }
    return {
      ok: true,
      task: verifiedTask,
      snapshot: this.saveTaskBoardCache(verified.ledger, verified.source.cacheIdentity)
    };
  }

  normalizeProjects(records) {
    return records.items
      .map((record) => {
        const fields = record.fields || {};
        return {
          recordId: record.record_id,
          name: textValue(fields["公司名称"]).trim(),
          domain: textValue(fields["领域"]),
          subdomains: stringList(fields["子领域"]),
          status: textValue(fields["进展状态"]),
          rating: textValue(fields["项目评级"]),
          notes: textValue(fields["Notes"]),
          cities: stringList(fields["城市"]),
          investors: stringList(fields["投资机构"]),
          createdAt: normalizedEpochMs(timestampValue(fields["入库时间"]))
            || normalizedEpochMs(timestampValue(record.created_time ?? record.createdTime))
            || null,
          lastFollowup: timestampValue(fields["最后更新时间"] ?? fields["最近跟进时间"]),
          link: textValue(fields["链接"])
        };
      })
      .filter((item) => item.recordId && item.name);
  }

  normalizePeople(records) {
    return records.items
      .map((record) => {
        const fields = record.fields || {};
        return {
          recordId: record.record_id,
          name: textValue(fields["人名"]).trim(),
          types: stringList(fields["类型"]),
          organization: textValue(fields["所属组织&身份"]),
          status: textValue(fields["进展状态"]),
          rating: textValue(fields["评级"]),
          createdAt: normalizedEpochMs(timestampValue(fields["入库时间"]))
            || normalizedEpochMs(timestampValue(record.created_time ?? record.createdTime))
            || null,
          lastContact: timestampValue(fields["最后联系日期"]),
          cities: stringList(fields["城市"]),
          link: textValue(fields["链接"])
        };
      })
      .filter((item) => item.recordId && item.name);
  }

  async status(pluginInput) {
    const plugin = pluginInput || this.findPlugin();
    const settings = this.configProvider();
    const localMode = settings.storageBackend === "local";
    const plaudDisabled = settings.plaudConnectionMode === "disabled";
    const activePlaudQueue = plaudDisabled ? [] : this.loadActivePlaudWorkflowRecords();
    const queue = plaudDisabled
      ? { count: 0, items: [], disabled: true }
      : {
          count: activePlaudQueue.length,
          items: activePlaudQueue
        };
    const [larkResult] = await Promise.allSettled([
      localMode
        ? Promise.resolve({
            ok: true,
            disabled: true,
            cliPath: "",
            userName: "",
            appName: "本地资料库",
            tokenStatus: "",
            error: ""
          })
        : this.larkStatus()
    ]);
    const lark = larkResult.status === "fulfilled" ? larkResult.value : null;
    const queueStages = {};
    for (const item of queue?.items || []) {
      queueStages[item.stage || "unknown"] = (queueStages[item.stage || "unknown"] || 0) + 1;
    }
    return {
      plugin: {
        ok: true,
        version: plugin.version,
        displayName: plugin.manifest?.interface?.displayName || "domi",
        root: plugin.root
      },
      lark: {
        ok: larkResult.status === "fulfilled" && Boolean(lark?.ok),
        disabled: Boolean(lark?.disabled),
        userName: lark?.userName || "",
        appName: lark?.appName || "",
        error: larkResult.status === "rejected" ? larkResult.reason.message : lark?.error || ""
      },
      plaud: {
        ok: !plaudDisabled
          && Boolean(this.plaudRemoteHealth?.ok),
        disabled: plaudDisabled,
        queueCount: queue?.count || 0,
        queueStages,
        error: plaudDisabled
          ? ""
          : this.plaudRemoteHealth?.error
            || ""
      }
    };
  }

  loadCache() {
    const cached = this.stateStore.loadCache(CACHE_KEY);
    return cached ? { ok: true, snapshot: cached.value, updatedAt: cached.updatedAt } : { ok: true };
  }

  localMigrationSource(settingsInput) {
    const settings = settingsInput || this.configProvider();
    const localLibraryDir = resolveHomePath(settings.localRepositoryDir);
    const localDatabasePath = resolveHomePath(settings.localDatabasePath);
    if (!localLibraryDir || !localDatabasePath) {
      throw new Error("本地资料库尚未配置，无法生成迁移计划。");
    }
    return {
      backend: "local",
      localLibraryDir,
      localDatabasePath
    };
  }

  previewLocalToFeishu(settingsInput) {
    const source = this.localMigrationSource(settingsInput);
    const plugin = this.findPlugin();
    return this.withLocalRepository(source, (repository) => {
      const migration = new LocalToFeishuMigration({
        repository,
        pluginRoot: plugin.root,
        libraryRoot: source.localLibraryDir,
        runLark: (args, options) => this.lark(args, options)
      });
      return migration.preview();
    });
  }

  async migrateLocalToFeishu({ sourceSettings, targetSettings }) {
    const source = this.localMigrationSource(sourceSettings);
    const plugin = this.findPlugin();
    const health = await this.larkStatus();
    if (!health.ok) {
      return {
        ok: false,
        projectCount: 0,
        migratedProjectCount: 0,
        peopleCount: 0,
        migratedPeopleCount: 0,
        newsCount: 0,
        migratedNewsCount: 0,
        documentCount: 0,
        assetCount: 0,
        migrated: [],
        migratedProjects: [],
        migratedPeople: [],
        migratedNews: [],
        failed: [],
        error: health.error || "飞书用户身份未就绪，请先重新授权。"
      };
    }
    return this.withLocalRepository(source, (repository) => {
      const migration = new LocalToFeishuMigration({
        repository,
        pluginRoot: plugin.root,
        libraryRoot: source.localLibraryDir,
        runLark: (args, options) => this.lark(args, {
          label: "本地资料迁移到飞书",
          ...options
        })
      });
      return migration.run(targetSettings);
    });
  }

  async sync() {
    const plugin = this.findPlugin();
    const projectSource = this.readProjectConfig();
    const health = await this.status(plugin);
    if (projectSource.backend === "local") {
      const local = this.withLocalRepository(projectSource, (repository) => {
        const workspaceIndex = repository.reindexWorkspace();
        return {
          repositoryHealth: repository.health(),
          workspaceIndex,
          projects: repository.listProjects(),
          people: repository.listPeople()
        };
      });
      const snapshot = {
        version: 1,
        backend: "local",
        syncedAt: Date.now(),
        health,
        sources: {
          projects: {
            name: "本地项目库",
            total: local.projects.length,
            localLibraryDir: projectSource.localLibraryDir,
            localDatabasePath: projectSource.localDatabasePath
          },
          people: {
            name: "本地人脉库",
            total: local.people.length
          }
        },
        projects: local.projects,
        people: local.people
      };
      this.stateStore.saveCache(CACHE_KEY, snapshot);
      return { ok: true, snapshot, updatedAt: snapshot.syncedAt };
    }
    const cached = this.loadCache();
    if (!health.lark.ok) {
      return {
        ok: false,
        stale: Boolean(cached.snapshot),
        snapshot: cached.snapshot,
        updatedAt: cached.updatedAt,
        error: describeFeishuSyncError(
          new Error(health.lark.error || "飞书用户身份未就绪。"),
          { hasCache: Boolean(cached.snapshot) }
        )
      };
    }
    let peopleSource;
    let projectRecords;
    let peopleRecords;
    try {
      peopleSource = this.resolvePeopleBase();
      await this.ensureIntakeTimeFields(plugin);
      projectRecords = await this.fetchRecords({
        ...projectSource,
        fieldNames: ["公司名称", "Notes", "领域", "子领域", "进展状态", "项目评级", "城市", "投资机构", "入库时间", "最后更新时间", "链接"]
      });
      peopleRecords = await this.fetchRecords({
        ...peopleSource,
        fieldNames: ["人名", "类型", "所属组织&身份", "进展状态", "评级", "入库时间", "最后联系日期", "城市", "链接"]
      });
    } catch (error) {
      return {
        ok: false,
        stale: Boolean(cached.snapshot),
        snapshot: cached.snapshot,
        updatedAt: cached.updatedAt,
        error: describeFeishuSyncError(error, { hasCache: Boolean(cached.snapshot) })
      };
    }
    const snapshot = {
      version: 1,
      backend: "feishu",
      syncedAt: Date.now(),
      health,
      sources: {
        projects: {
          name: "1.0 项目Watching List",
          total: projectRecords.total,
          localLibraryDir: projectSource.localLibraryDir
        },
        people: {
          name: "1.1 People人际关系管理",
          total: peopleRecords.total
        }
      },
      projects: this.normalizeProjects(projectRecords),
      people: this.normalizePeople(peopleRecords)
    };
    this.stateStore.saveCache(CACHE_KEY, snapshot);
    return { ok: true, snapshot, updatedAt: snapshot.syncedAt };
  }
}

module.exports = {
  DomiIntegration,
  describeFeishuSyncError,
  resolveLarkCliExecutable,
  isRetryableFeishuReadError,
  normalizeTaskLedger,
  parseTaskLedger,
  renderTaskLedger,
  resolveWeeklyNewsTimestamps,
  weeklyNewsContentSignature,
  weeklyNewsHasSubstantiveChange
};
