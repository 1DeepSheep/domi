const path = require("node:path");
const os = require("node:os");
let activeClient = null;
let signalShutdown = null;
let serverClient = null;
let serverPluginRoot = "";
let serverCommandTail = Promise.resolve();

function print(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function isPageCompactionFailure(error) {
  const message = typeof error?.message === "string" ? error.message : String(error || "");
  return /^PLAUD browser restored \d+ tabs and could not be compacted safely\.$/.test(message);
}

function safeError(error) {
  const homeDirectory = os.homedir();
  const message = (error instanceof Error ? error.message : String(error))
    .split(homeDirectory)
    .join("~");
  if (error?.code === "PLAUD_BROWSER_UNAVAILABLE" || isPageCompactionFailure(error)) {
    return "PLAUD 后台浏览器本轮未能准备好读取页面。domi 已保留现有录音，请稍后重试；无需重新登录。";
  }
  if (/Cannot find module ['"]playwright['"]/i.test(message)) {
    return "PLAUD 缺少浏览器运行组件。请重启 domi；如果仍然失败，请重新安装最新版 domi。";
  }
  if (/browserType\.connectOverCDP|WebSocket error:[\s\S]*ECONNREFUSED|connect ECONNREFUSED 127\.0\.0\.1/i.test(message)) {
    return "PLAUD 专用浏览器未能建立本机连接。请重新同步；domi 会清理旧连接后自动重试。";
  }
  if (/Not attached to an active page|Target page, context or browser has been closed|Execution context was destroyed|Protocol error.*(?:Page|Target)/i.test(message)) {
    return "PLAUD 后台页面本轮意外中断。domi 已关闭故障进程；重新同步时会自动建立新会话，无需重新登录。";
  }
  if (/PLAUD_SESSION_PROBE_INCOMPLETE|authorization request was not observed|会话验证未完成/i.test(message)) {
    return "PLAUD 登录数据仍在，但本轮未及时完成会话验证。请重新同步，domi 会自动重建后台会话。";
  }
  if (/PLAUD_AUTH_REQUIRED|account sign-in is required/i.test(message)) {
    return "PLAUD 登录已失效，请在设置中重新登录并验证。";
  }
  if (error?.code === "PLAUD_AUTH_CONTEXT_MISMATCH" || Number(error?.apiStatus) === -3901) {
    return "PLAUD 录音接口的会话尚未完成验证，已保留本地录音。";
  }
  if (/PLAUD_RATE_LIMITED|(?:HTTP|status)\s*429|too many requests|rate.?limit|请求过于频繁/i.test(message)) {
    return "PLAUD 服务暂时限流。domi 未修改任何录音，请稍后重新同步，无需重新登录。";
  }
  if (/PLAUD_ACCESS_DENIED|(?:HTTP|status)\s*403/i.test(message)) {
    return "PLAUD_ACCESS_DENIED: PLAUD 暂时拒绝本次访问。domi 未修改任何录音，请稍后重试；只有确认进入登录页时才需要重新登录。";
  }
  if (/PLAUD_UNAUTHORIZED|(?:HTTP|status)\s*401|unauthori/i.test(message)) {
    return "PLAUD_UNAUTHORIZED: PLAUD 本轮授权未完成自动续期。domi 未修改任何录音，请重试；只有确认进入登录页时才需要重新登录。";
  }
  if (/(?:HTTP|status)\s*5\d\d|service unavailable|bad gateway|gateway timeout/i.test(message)) {
    return "PLAUD 服务暂时不可用。domi 未修改任何录音，请稍后重新同步。";
  }
  if (/PLAUD_NETWORK_TIMEOUT|PLAUD (?:API|接口).*timed?\s*out|接口读取超时|ERR_(?:CONNECTION_(?:CLOSED|RESET|REFUSED|ABORTED)|NETWORK_CHANGED|TIMED_OUT|NAME_NOT_RESOLVED)|ECONNRESET|ECONNABORTED|ETIMEDOUT|ENOTFOUND|ENETUNREACH|fetch failed|Failed to fetch|socket hang up/i.test(message)) {
    return "网络或 PLAUD 服务响应超时。domi 未修改任何录音，已保留上次成功列表，请稍后重新同步。";
  }
  return message
    .replace(/\b(?:authorization|cookie|x-pld-user|x-device-id)\s*[:=]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .slice(0, 1000);
}

// Only machine-readable, bounded fields cross the process boundary. Browser
// errors can contain recording names, authenticated URLs or local Profile paths.
function plaudErrorDetails(error, stage = "") {
  const message = typeof error?.message === "string" ? error.message : String(error || "");
  const status = Number(error?.httpStatus || error?.status || message.match(/(?:HTTP|status)\s*(\d{3})/i)?.[1]);
  const apiStatus = typeof error?.apiStatus === "number" ? error.apiStatus : undefined;
  let code = String(error?.code || message.match(/\bPLAUD_[A-Z_]+\b/)?.[0] || "");
  if (!/^PLAUD_[A-Z_]{1,70}$/.test(code)) code = "";
  if (!code) {
    if (apiStatus === -3901) code = "PLAUD_AUTH_CONTEXT_MISMATCH";
    else if (/account sign-in is required|登录已失效/i.test(message)) code = "PLAUD_AUTH_REQUIRED";
    else if (status === 401 || /unauthori/i.test(message)) code = "PLAUD_UNAUTHORIZED";
    else if (status === 403) code = "PLAUD_ACCESS_DENIED";
    else if (status === 429 || /too many requests|rate.?limit/i.test(message)) code = "PLAUD_RATE_LIMITED";
    else if (/singleton|profile.*(?:lock|use)|already in use|EBUSY|专用浏览器.*(?:另一个任务使用|被占用)/i.test(message)) code = "PLAUD_PROFILE_LOCKED";
    else if (/authorization request was not observed|会话验证未完成/i.test(message)) code = "PLAUD_SESSION_PROBE_INCOMPLETE";
    else if (isPageCompactionFailure(error) || /connectOverCDP|Not attached to an active page|Target page, context or browser has been closed|Execution context was destroyed|Protocol error.*(?:Page|Target)/i.test(message)) code = "PLAUD_BROWSER_UNAVAILABLE";
    else if (status >= 500 && status <= 599) code = "PLAUD_SERVICE_UNAVAILABLE";
    else if (isRetryableReadError(error) || /timeout|超时/i.test(message)) code = "PLAUD_NETWORK_TIMEOUT";
    else code = "PLAUD_READ_FAILED";
  }
  const retryAfterMs = Number(error?.retryAfterMs);
  const errorStage = ["init", "connection", "list", "download", "rename", "trash", "cleanup"].includes(error?.stage)
    ? error.stage : ["init", "connection", "list", "download", "rename", "trash", "cleanup"].includes(stage) ? stage : "";
  return { code, ...(errorStage ? { stage: errorStage } : {}),
    ...(Number.isInteger(status) && status >= 100 && status <= 599 ? { httpStatus: status } : {}),
    ...(Number.isSafeInteger(apiStatus) ? { apiStatus } : {}),
    ...(Number.isFinite(retryAfterMs) && retryAfterMs >= 0 ? { retryAfterMs: Math.min(retryAfterMs, Number.MAX_SAFE_INTEGER) } : {}) };
}

function resolveClient(pluginRoot) {
  const root = path.resolve(String(pluginRoot || ""));
  const clientPath = path.join(root, "skills", "plaud", "vendor", "plaud-cli", "src", "plaud.js");
  return require(clientPath).PlaudClient;
}

function safeRemoteFile(file) {
  return {
    fileId: String(file?.id || file?.file_id || ""),
    fileName: String(file?.filename || file?.file_name || "未命名录音"),
    duration: Number(file?.duration) || null,
    createdAt: Number(file?.start_time || file?.create_time) || null,
    editedAt: Number(file?.edit_time) || null,
    hasTranscript: Boolean(file?.is_trans),
    hasSummary: Boolean(file?.is_summary),
    processing: Boolean(file?.wait_pull)
  };
}

function isTransientNavigationError(error) {
  return /page\.(?:goto|reload)|connectOverCDP|WebSocket error|Protocol error.*(?:Page|Target)|Not attached to an active page|Target page, context or browser has been closed|Execution context was destroyed|ECONNREFUSED|ECONNRESET|ECONNABORTED|ETIMEDOUT|ERR_CONNECTION_(?:CLOSED|RESET|REFUSED|ABORTED)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|socket hang up/i
    .test(error instanceof Error ? error.message : String(error));
}

function isRetryableReadError(error) {
  if (["PLAUD_AUTH_REQUIRED", "PLAUD_AUTH_CONTEXT_MISMATCH", "PLAUD_UNAUTHORIZED", "PLAUD_ACCESS_DENIED", "PLAUD_RATE_LIMITED", "PLAUD_PROFILE_LOCKED"].includes(error?.code) || Number(error?.apiStatus) === -3901) return false;
  if (["PLAUD_NETWORK_TIMEOUT", "PLAUD_READ_TRANSIENT", "PLAUD_BROWSER_UNAVAILABLE", "PLAUD_SESSION_PROBE_INCOMPLETE", "PLAUD_SERVICE_UNAVAILABLE"].includes(error?.code)) return true;
  const message = error instanceof Error ? error.message : String(error);
  if (/PLAUD_AUTH_REQUIRED|PLAUD_UNAUTHORIZED|PLAUD_ACCESS_DENIED|(?:HTTP|status)\s*(?:401|403)|unauthori|account sign-in is required/i.test(message)) {
    return false;
  }
  // A rapid retry makes vendor rate limits last longer. Keep 429 actionable in
  // the UI, but wait for the user (or Retry-After in a future API response)
  // before opening another private browser session.
  if (/(?:HTTP|status)\s*429|too many requests|rate.?limit|请求过于频繁/i.test(message)) {
    return false;
  }
  return isPageCompactionFailure(error) || isTransientNavigationError(error)
    || /PLAUD_SESSION_PROBE_INCOMPLETE|authorization request was not observed|PLAUD (?:API|接口).*timed?\s*out|接口读取超时|ENOTFOUND|ENETUNREACH|fetch failed|Failed to fetch|(?:HTTP|status)\s*5\d\d|service unavailable|bad gateway|gateway timeout/i.test(message);
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function withClient(pluginRoot, callback, options = {}) {
  const PlaudClient = resolveClient(pluginRoot);
  let lastError;
  const attempts = Math.min(Math.max(Number(options.attempts) || 2, 1), 3);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = new PlaudClient({ headless: true });
    activeClient = candidate;
    let initialized = false;
    try {
      await candidate.init();
      initialized = true;
      return await callback(candidate);
    } catch (error) {
      lastError = error;
      const retryable = initialized
        ? Boolean(options.retryOperation) && isRetryableReadError(error)
        : isRetryableReadError(error);
      if (!retryable || attempt + 1 >= attempts) throw error;
    } finally {
      if (signalShutdown) {
        await signalShutdown;
      } else {
        await candidate.close().catch(() => {});
      }
      if (activeClient === candidate) activeClient = null;
    }
    await wait(attempt === 0 ? 400 : 1200);
  }
  throw lastError || new Error("PLAUD 会话初始化失败。 ");
}

function installSignalCleanup() {
  const stop = (signal) => {
    if (signalShutdown) return;
    const exitCode = signal === "SIGINT" ? 130 : 143;
    signalShutdown = (async () => {
      const timer = setTimeout(() => process.exit(exitCode), 35_000);
      try {
        await (serverClient || activeClient)?.close();
      } catch {
        // A later exact-profile launch also cleans any process that survives.
      } finally {
        clearTimeout(timer);
        process.exit(exitCode);
      }
    })();
  };
  process.once("SIGTERM", () => stop("SIGTERM"));
  process.once("SIGINT", () => stop("SIGINT"));
}

async function listWithClient(client, requestedLimit, requestedOffset, options = {}) {
  const visibleLimit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
  const offset = Math.min(Math.max(Number(requestedOffset) || 0, 0), 10_000);
  // The first page keeps the old 100-record pending-count coverage while
  // exposing only one 50-record screen. Later pages fetch one look-ahead
  // record so the renderer can stop precisely at the end of the account.
  const fetchLimit = offset === 0
    ? Math.max(100, visibleLimit + 1)
    : visibleLimit + 1;
  const files = await client.listFiles({ limit: fetchLimit, skip: offset, ...(Number.isFinite(options.deadlineAt) ? { deadlineAt: options.deadlineAt } : {}) });
  // Preserve the server's edit_time ordering. Re-sorting the first 100-item
  // pending-count window before slicing made items from server page two leak
  // into page one, which then produced duplicates on the next request.
  const normalized = files
    .map(safeRemoteFile)
    .filter((item) => item.fileId);
  return {
    ok: true,
    pendingCount: normalized.filter((item) => !item.hasTranscript && !item.hasSummary).length,
    offset,
    limit: visibleLimit,
    hasMore: normalized.length > visibleLimit,
    nextOffset: offset + Math.min(normalized.length, visibleLimit),
    items: normalized.slice(0, visibleLimit)
  };
}

async function list(pluginRoot, requestedLimit, requestedOffset) {
  return withClient(
    pluginRoot,
    (client) => listWithClient(client, requestedLimit, requestedOffset),
    { attempts: 3, retryOperation: true }
  );
}

async function downloadWithClient(client, fileId, outputDir, options = {}) {
  const id = String(fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error("无效的 PLAUD 文件标识。");
  if (!path.isAbsolute(String(outputDir || ""))) throw new Error("PLAUD 下载目录必须是绝对路径。");
  // The vendor download method only reads an exact file ID and writes local
  // transcript artifacts. Queue transitions belong to the caller's fresh lock.
  const transcript = await client.downloadTranscript(id, outputDir, options);
  return {
    ok: true,
    fileId: id,
    fileName: String(transcript.fileName || ""),
    transcriptPath: String(transcript.mdPath || ""),
    transcriptRawPath: String(transcript.rawPath || "")
  };
}

async function renameWithClient(client, fileId, requestedTitle) {
  const id = String(fileId || "").trim();
  const title = String(requestedTitle || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error("无效的 PLAUD 文件标识。 ");
  if (!title) throw new Error("录音标题不能为空。 ");
  if (title.length > 255) throw new Error("录音标题不能超过 255 个字符。 ");

  const response = await client.api(`/file/${id}`, {
    method: "PATCH",
    data: {
      filename: title,
      extra_data: { actionData: { hasTitleEdit: true } }
    }
  });
  if (response.status < 200 || response.status >= 300 || response.body?.status !== 0) {
    throw new Error(`PLAUD 修改标题失败（HTTP ${response.status}）。`);
  }
  const detail = await client.getFileDetail(id);
  const remoteTitle = String(detail?.file_name || detail?.filename || "").trim();
  if (remoteTitle !== title) throw new Error("PLAUD 未确认新的录音标题。 ");
  return { ok: true, fileId: id, fileName: remoteTitle };
}

async function rename(pluginRoot, fileId, requestedTitle) {
  return withClient(pluginRoot, (client) => renameWithClient(client, fileId, requestedTitle));
}

async function moveToTrashWithClient(client, fileId) {
  const id = String(fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error("无效的 PLAUD 文件标识。 ");

  const response = await client.api("/file/trash/", {
    method: "POST",
    data: [id]
  });
  if (response.status < 200 || response.status >= 300 || response.body?.status !== 0) {
    throw new Error(`PLAUD 删除录音失败（HTTP ${response.status}）。`);
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const activeFiles = await client.listFiles({ limit: 100 });
    if (!activeFiles.some((file) => String(file?.id || file?.file_id || "") === id)) {
      return { ok: true, fileId: id, trashed: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error("PLAUD 尚未确认录音已移入回收站。 ");
}

async function moveToTrash(pluginRoot, fileId) {
  return withClient(pluginRoot, (client) => moveToTrashWithClient(client, fileId));
}

async function closeServerClient() {
  const candidate = serverClient;
  serverClient = null;
  activeClient = null;
  if (candidate) await candidate.close().catch(() => {});
}

async function ensureServerClient(pluginRoot, options = {}) {
  const normalizedRoot = path.resolve(String(pluginRoot || ""));
  if (serverClient && serverPluginRoot === normalizedRoot) {
    serverClient.operationDeadlineAt = options.deadlineAt;
    return serverClient;
  }
  await closeServerClient();
  const PlaudClient = resolveClient(normalizedRoot);
  const candidate = new PlaudClient({ headless: true, operationDeadlineAt: options.deadlineAt });
  activeClient = candidate;
  try {
    await candidate.init();
    serverClient = candidate;
    serverPluginRoot = normalizedRoot;
    return candidate;
  } catch (error) {
    await candidate.close().catch(() => {});
    if (activeClient === candidate) activeClient = null;
    throw error;
  }
}

async function runServerCommand(pluginRoot, command, args = [], options = {}) {
  let operationStarted = false;
  let stage = "init";
  const now = options.now || Date.now;
  const remaining = () => Number.isFinite(options.deadlineAt) ? options.deadlineAt - now() : Infinity;
  const emitDiagnostic = (error) => options.onDiagnostic?.(error ? plaudErrorDetails(error, stage) : { stage });
  const checkDeadline = () => {
    if (remaining() > 0) return;
    throw Object.assign(new Error("PLAUD_NETWORK_TIMEOUT: PLAUD 本轮读取已达到时间上限。"), { code: "PLAUD_NETWORK_TIMEOUT", stage });
  };
  const execute = async () => {
    stage = "init";
    checkDeadline();
    emitDiagnostic();
    const client = await ensureServerClient(pluginRoot, options);
    checkDeadline();
    stage = command;
    emitDiagnostic();
    operationStarted = true;
    if (command === "connection") {
      await client.listFiles({ limit: 1, skip: 0, ...(Number.isFinite(options.deadlineAt) ? { deadlineAt: options.deadlineAt } : {}) });
      return {
        ok: true,
        connected: true,
        browserLabel: client.browserLabel || "PLAUD 专用浏览器"
      };
    }
    if (command === "list") return listWithClient(client, args[0], args[1], options);
    if (command === "download") return downloadWithClient(client, args[0], args[1], { deadlineAt: options.deadlineAt });
    if (command === "rename") return renameWithClient(client, args[0], args[1]);
    if (command === "trash") return moveToTrashWithClient(client, args[0]);
    throw new Error(`未知的 PLAUD worker 命令：${command || "(空)"}`);
  };

  const pause = options.sleep || wait;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    operationStarted = false;
    try {
      return await execute();
    } catch (error) {
      Object.assign(error, plaudErrorDetails(error, stage));
      emitDiagnostic(error);
      const readOnly = ["connection", "list", "download"].includes(command);
      // Release even on the final failure. A later read must not reuse the
      // detached page that exhausted this request's recovery budget.
      await closeServerClient();
      // Never replay an executed PATCH/POST after an uncertain response.
      if (!isRetryableReadError(error) || (operationStarted && !readOnly) || attempt === 2) throw error;
      const delay = attempt === 0 ? 400 : 1200;
      // A new private browser needs meaningful time to initialize. The broker
      // remains the hard bound for an older plugin that ignores deadlineAt.
      if (remaining() < delay + 5_000) throw error;
      await pause(delay);
    }
  }
}

function serve(pluginRoot) {
  process.stdin.setEncoding("utf8");
  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += String(chunk || "");
    while (true) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      serverCommandTail = serverCommandTail.then(async () => {
        let request;
        try {
          request = JSON.parse(line);
          const result = await runServerCommand(pluginRoot, request.command, request.args || [], {
            deadlineAt: Number.isFinite(request.deadlineAt) ? request.deadlineAt : undefined,
            onDiagnostic: diagnostic => print({ id: String(request.id || ""), type: "diagnostic", diagnostic })
          });
          print({ id: String(request.id || ""), ok: true, result });
        } catch (error) {
          print({
            id: String(request?.id || ""),
            ok: false,
            error: safeError(error),
            diagnostic: plaudErrorDetails(error)
          });
        }
      });
    }
  });
  process.stdin.once("end", () => {
    void closeServerClient().finally(() => process.exit(0));
  });
  return new Promise(() => {});
}

async function main() {
  const [, , command, pluginRoot, ...args] = process.argv;
  if (command === "serve") return serve(pluginRoot);
  if (command === "list") return list(pluginRoot, args[0], args[1]);
  if (command === "rename") return rename(pluginRoot, args[0], args[1]);
  if (command === "trash") return moveToTrash(pluginRoot, args[0]);
  throw new Error(`未知的 PLAUD worker 命令：${command || "(空)"}`);
}

if (require.main === module) {
  installSignalCleanup();
  main()
    .then(print)
    .catch((error) => {
      print({ ok: false, error: safeError(error) });
    });
}

module.exports = {
  closeServerClient,
  downloadWithClient,
  isRetryableReadError,
  isTransientNavigationError,
  list,
  listWithClient,
  plaudErrorDetails,
  runServerCommand,
  safeError
};
