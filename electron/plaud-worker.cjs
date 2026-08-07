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

function safeError(error) {
  const homeDirectory = os.homedir();
  const message = (error instanceof Error ? error.message : String(error))
    .split(homeDirectory)
    .join("~");
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
  if (/PLAUD_NETWORK_TIMEOUT|PLAUD (?:API|接口).*timed?\s*out|接口读取超时|ERR_(?:NETWORK_CHANGED|TIMED_OUT|NAME_NOT_RESOLVED)|ENOTFOUND|ENETUNREACH|fetch failed|socket hang up/i.test(message)) {
    return "网络或 PLAUD 服务响应超时。domi 未修改任何录音，已保留上次成功列表，请稍后重新同步。";
  }
  return message
    .replace(/\b(?:authorization|cookie|x-pld-user|x-device-id)\s*[:=]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .slice(0, 1000);
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
  return /page\.(?:goto|reload)|connectOverCDP|WebSocket error|Protocol error.*(?:Page|Target)|Not attached to an active page|Target page, context or browser has been closed|Execution context was destroyed|ECONNREFUSED|ECONNRESET|ERR_CONNECTION_(?:CLOSED|RESET|REFUSED)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|socket hang up/i
    .test(error instanceof Error ? error.message : String(error));
}

function isRetryableReadError(error) {
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
  return isTransientNavigationError(error)
    || /PLAUD_SESSION_PROBE_INCOMPLETE|authorization request was not observed|PLAUD (?:API|接口).*timed?\s*out|接口读取超时|ENOTFOUND|ENETUNREACH|fetch failed|(?:HTTP|status)\s*5\d\d|service unavailable|bad gateway|gateway timeout/i.test(message);
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

async function listWithClient(client, requestedLimit, requestedOffset) {
  const visibleLimit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
  const offset = Math.min(Math.max(Number(requestedOffset) || 0, 0), 10_000);
  // The first page keeps the old 100-record pending-count coverage while
  // exposing only one 50-record screen. Later pages fetch one look-ahead
  // record so the renderer can stop precisely at the end of the account.
  const fetchLimit = offset === 0
    ? Math.max(100, visibleLimit + 1)
    : visibleLimit + 1;
  const files = await client.listFiles({ limit: fetchLimit, skip: offset });
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

async function ensureServerClient(pluginRoot) {
  const normalizedRoot = path.resolve(String(pluginRoot || ""));
  if (serverClient && serverPluginRoot === normalizedRoot) return serverClient;
  await closeServerClient();
  const PlaudClient = resolveClient(normalizedRoot);
  const candidate = new PlaudClient({ headless: true });
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

async function runServerCommand(pluginRoot, command, args = []) {
  const execute = async () => {
    const client = await ensureServerClient(pluginRoot);
    if (command === "connection") {
      await client.listFiles({ limit: 1, skip: 0 });
      return {
        ok: true,
        connected: true,
        browserLabel: client.browserLabel || "PLAUD 专用浏览器"
      };
    }
    if (command === "list") return listWithClient(client, args[0], args[1]);
    if (command === "rename") return renameWithClient(client, args[0], args[1]);
    if (command === "trash") return moveToTrashWithClient(client, args[0]);
    throw new Error(`未知的 PLAUD worker 命令：${command || "(空)"}`);
  };

  try {
    return await execute();
  } catch (error) {
    // Recreate only detached/transient browser sessions. Authentication,
    // access denial and rate limits remain single-attempt and actionable.
    if (!isRetryableReadError(error)) throw error;
    await closeServerClient();
    await wait(500);
    return execute();
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
          const result = await runServerCommand(pluginRoot, request.command, request.args || []);
          print({ id: String(request.id || ""), ok: true, result });
        } catch (error) {
          print({
            id: String(request?.id || ""),
            ok: false,
            error: safeError(error)
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
  isRetryableReadError,
  isTransientNavigationError,
  list,
  listWithClient,
  runServerCommand,
  safeError
};
