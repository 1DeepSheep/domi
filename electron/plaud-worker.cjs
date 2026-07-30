const path = require("node:path");
const os = require("node:os");

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
  return /page\.goto|connectOverCDP|WebSocket error|ECONNREFUSED|ERR_CONNECTION_(?:CLOSED|RESET|REFUSED)|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|socket hang up/i
    .test(error instanceof Error ? error.message : String(error));
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function withClient(pluginRoot, callback) {
  const PlaudClient = resolveClient(pluginRoot);
  let client;
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const candidate = new PlaudClient();
    try {
      client = await candidate.init();
      break;
    } catch (error) {
      lastError = error;
      await candidate.close().catch(() => {});
      if (!isTransientNavigationError(error) || attempt === 2) throw error;
      await wait(500 * (attempt + 1));
    }
  }
  if (!client) throw lastError || new Error("PLAUD 会话初始化失败。 ");
  try {
    return await callback(client);
  } finally {
    await client.close();
  }
}

async function list(pluginRoot, requestedLimit, requestedOffset) {
  const visibleLimit = Math.min(Math.max(Number(requestedLimit) || 50, 1), 100);
  const offset = Math.min(Math.max(Number(requestedOffset) || 0, 0), 10_000);
  return withClient(pluginRoot, async (client) => {
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
  });
}

async function rename(pluginRoot, fileId, requestedTitle) {
  const id = String(fileId || "").trim();
  const title = String(requestedTitle || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error("无效的 PLAUD 文件标识。 ");
  if (!title) throw new Error("录音标题不能为空。 ");
  if (title.length > 255) throw new Error("录音标题不能超过 255 个字符。 ");

  return withClient(pluginRoot, async (client) => {
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
  });
}

async function moveToTrash(pluginRoot, fileId) {
  const id = String(fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{12,80}$/.test(id)) throw new Error("无效的 PLAUD 文件标识。 ");

  return withClient(pluginRoot, async (client) => {
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
  });
}

async function main() {
  const [, , command, pluginRoot, ...args] = process.argv;
  if (command === "list") return list(pluginRoot, args[0], args[1]);
  if (command === "rename") return rename(pluginRoot, args[0], args[1]);
  if (command === "trash") return moveToTrash(pluginRoot, args[0]);
  throw new Error(`未知的 PLAUD worker 命令：${command || "(空)"}`);
}

if (require.main === module) {
  main()
    .then(print)
    .catch((error) => {
      print({ ok: false, error: safeError(error) });
    });
}

module.exports = {
  isTransientNavigationError,
  list,
  safeError
};
