const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");
const {
  codexClientCapabilities,
  isExperimentalApiInitializationError
} = require("./codex-protocol.cjs");
const { normalizeCodexRoutingParams } = require("./codex-run-context.cjs");

function codexEnvironment(extra = {}) {
  const home = os.homedir();
  const pathEntries = [
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    process.env.PATH || ""
  ];

  return {
    ...process.env,
    PATH: [...new Set(pathEntries.filter(Boolean))].join(path.delimiter),
    ...extra
  };
}

function executableExists(candidate) {
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function canonicalCodexRuntime(candidate) {
  const requestedPath = String(candidate || "").trim();
  if (!requestedPath || !executableExists(requestedPath)) return null;
  let binaryPath;
  try {
    binaryPath = fs.realpathSync.native(requestedPath);
  } catch {
    return null;
  }
  if (!executableExists(binaryPath)) return null;
  const hostPath = path.join(path.dirname(binaryPath), "codex-code-mode-host");
  if (!executableExists(hostPath)) return null;
  return { binaryPath, hostPath, requestedPath };
}

function resolveCodexBinary(preferredPath = "") {
  const home = os.homedir();
  const candidates = [
    preferredPath,
    process.env.DOMI_CODEX_PATH,
    path.join(home, ".codex", "packages", "standalone", "current", "bin", "codex"),
    path.join(home, ".npm-global", "bin", "codex"),
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex"
  ].filter(Boolean);

  const runtime = candidates
    .map(canonicalCodexRuntime)
    .find(Boolean);

  if (!runtime) {
    throw new Error(
      "没有找到完整的 Codex Runtime（缺少命令宿主）。请在 domi 设置中修复 Codex Runtime，或重新安装 domi。"
    );
  }

  // Codex locates codex-code-mode-host relative to argv[0]. Always spawn the
  // canonical executable instead of a package-manager or app symlink.
  return runtime.binaryPath;
}

class CodexAppServer {
  constructor({
    cwd,
    version,
    runtimeProvider,
    onNotification,
    onUserInputRequest,
    onUserInputRequestClosed,
    onLog,
    onExit,
    requestTimeoutMs = 45_000
  }) {
    this.cwd = cwd;
    this.version = version;
    this.runtimeProvider = runtimeProvider;
    this.onNotification = onNotification;
    this.onUserInputRequest = onUserInputRequest;
    this.onUserInputRequestClosed = onUserInputRequestClosed;
    this.onLog = onLog;
    this.onExit = onExit;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.initialized = false;
    this.startPromise = null;
    this.pending = new Map();
    this.pendingUserInput = new Map();
    this.resolvedUserInput = new Set();
    this.nextRequestId = 1;
    this.intentionalClose = false;
    this.stderrTail = "";
    this.declaredCapabilities = codexClientCapabilities();
  }

  pendingUserInputRequests() {
    return [...this.pendingUserInput.values()].map(({ id, params }) => ({ id, params }));
  }

  answerUserInput(id, answers) {
    const key = this.#requestKey(id);
    const pending = this.pendingUserInput.get(key);
    if (!pending) {
      if (this.resolvedUserInput.has(key)) {
        return { ok: true, duplicate: true };
      }
      return { ok: false, error: "该选择请求已结束或不存在。" };
    }

    let normalized;
    try {
      normalized = this.#normalizeUserInputAnswers(pending.params, answers);
      this.#send({ id: pending.id, result: { answers: normalized } });
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }

    this.pendingUserInput.delete(key);
    this.#rememberResolvedUserInput(key);
    this.onUserInputRequestClosed?.({
      id: pending.id,
      params: pending.params,
      reason: "answered"
    });
    return { ok: true, duplicate: false };
  }

  cancelUserInput(id, reason = "该选择请求已取消。") {
    const key = this.#requestKey(id);
    const pending = this.pendingUserInput.get(key);
    if (!pending) {
      return this.resolvedUserInput.has(key)
        ? { ok: true, duplicate: true }
        : { ok: false, error: "该选择请求已结束或不存在。" };
    }
    try {
      this.#send({
        id: pending.id,
        error: {
          code: -32800,
          message: String(reason || "该选择请求已取消。").slice(0, 500)
        }
      });
    } catch {
      // The child may already be exiting. The local request must still be cleared.
    }
    this.pendingUserInput.delete(key);
    this.#rememberResolvedUserInput(key);
    this.onUserInputRequestClosed?.({
      id: pending.id,
      params: pending.params,
      reason: "cancelled"
    });
    return { ok: true, duplicate: false };
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.child && !this.child.killed && this.initialized && !this.intentionalClose) {
      return;
    }

    const pending = this.#startProcess();
    const startingChild = this.child;
    this.startPromise = pending;
    try {
      await pending;
    } catch (error) {
      // A living process is not necessarily an initialized server. Retire a
      // failed handshake before allowing another request to start a new one.
      if (this.child === startingChild) {
        this.close();
        this.child = null;
      }
      throw error;
    } finally {
      if (this.startPromise === pending) this.startPromise = null;
    }
  }

  async #startProcess() {
    if (this.child) this.close();
    const runtime = this.runtimeProvider?.() || {};
    const binary = resolveCodexBinary(runtime.codexPath);
    this.intentionalClose = false;
    this.initialized = false;
    this.stderrTail = "";
    this.pendingUserInput.clear();
    this.resolvedUserInput.clear();
    this.declaredCapabilities = codexClientCapabilities();
    const child = spawn(binary, ["app-server", "--listen", "stdio://", ...(runtime.args || [])], {
      cwd: this.cwd,
      env: codexEnvironment(runtime.env),
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;

    const processStarted = new Promise((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });

    const output = readline.createInterface({ input: child.stdout });
    output.on("line", (line) => {
      if (this.child === child) this.#handleLine(line);
    });

    child.stderr.on("data", (chunk) => {
      if (this.child !== child) return;
      const text = chunk.toString();
      this.stderrTail = `${this.stderrTail}${text}`.slice(-8000);
      this.onLog?.(text);
    });

    child.on("exit", (code, signal) => {
      output.close();
      // A late exit from a failed handshake must not clear the new child's
      // pending requests or report that its active tasks have failed.
      if (this.child !== child) return;
      const error = new Error(
        this.intentionalClose
          ? "Codex App Server 已关闭。"
          : this.stderrTail.trim() || `Codex App Server 已退出（${code ?? signal ?? "unknown"}）。`
      );
      error.code = "DOMI_CODEX_TRANSPORT_CLOSED";
      error.requestSent = true;
      this.child = null;
      this.initialized = false;
      this.startPromise = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
      this.#clearUserInputRequests("server-exit");
      this.onExit?.({ code, signal, error, intentional: this.intentionalClose });
    });

    await processStarted;
    const initializeParams = {
      clientInfo: {
        name: "domi",
        title: "domi",
        version: this.version
      }
    };
    try {
      await this.#sendRequest("initialize", {
        ...initializeParams,
        capabilities: this.declaredCapabilities
      });
    } catch (error) {
      if (!isExperimentalApiInitializationError(error)) {
        throw error;
      }
      this.declaredCapabilities = codexClientCapabilities({ experimentalApi: false });
      this.onLog?.("当前 Codex 版本不接受 experimentalApi 声明，domi 已切换稳定兼容模式。\n");
      await this.#sendRequest("initialize", initializeParams);
    }
    if (this.child !== child || this.intentionalClose) {
      throw new Error("Codex App Server 初始化已取消。");
    }
    this.#send({ method: "initialized" });
    this.initialized = true;
  }

  capabilities() {
    return { ...this.declaredCapabilities };
  }

  async request(method, params = {}, options = {}) {
    await this.start();
    return this.#sendRequest(method, params, options.timeoutMs);
  }

  close() {
    this.intentionalClose = true;
    this.initialized = false;
    this.#clearUserInputRequests("client-close", true);
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error("Codex App Server 已关闭。"));
    }
    this.pending.clear();
    const child = this.child;
    if (child && child.exitCode === null) {
      child.stdin.end();
      const terminateTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGTERM");
        }
      }, 500);
      const killTimer = setTimeout(() => {
        if (child.exitCode === null) {
          child.kill("SIGKILL");
        }
      }, 1500);
      terminateTimer.unref();
      killTimer.unref();
    }
  }

  #sendRequest(method, params, timeoutMs = this.requestTimeoutMs) {
    const id = this.nextRequestId++;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        const error = new Error(`Codex App Server 请求超时：${method}`);
        error.code = "DOMI_CODEX_REQUEST_TIMEOUT";
        error.requestSent = true;
        reject(error);
      }, timeoutMs);
      timeout.unref();
      this.pending.set(id, { resolve, reject, method, timeout });
      try {
        this.#send({ id, method, params });
      } catch (error) {
        error.requestSent = false;
        const pending = this.pending.get(id);
        if (pending) clearTimeout(pending.timeout);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  #send(message) {
    if (!this.child?.stdin?.writable) {
      throw new Error("Codex App Server 尚未连接。");
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  #handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch {
      this.onLog?.(`无法解析 App Server 消息：${trimmed}\n`);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && !message.method) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      if (message.error) {
        const error = new Error(message.error.message || `${pending.method} 请求失败。`);
        error.code = message.error.code;
        error.data = message.error.data;
        error.responseReceived = true;
        pending.reject(error);
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (Object.prototype.hasOwnProperty.call(message, "id") && message.method) {
      this.#handleServerRequest(message);
      return;
    }

    if (message.method) {
      this.onNotification?.(message.method, message.params || {});
    }
  }

  #handleServerRequest(message) {
    const approvalMethods = new Set([
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "execCommandApproval",
      "applyPatchApproval"
    ]);

    if (approvalMethods.has(message.method)) {
      this.#send({ id: message.id, result: { decision: "decline" } });
      return;
    }

    if (message.method === "item/tool/requestUserInput") {
      const params = this.#normalizeUserInputRequest(message.params);
      if (!params) {
        this.#send({
          id: message.id,
          error: { code: -32602, message: "Codex 返回了无效的用户选择请求。" }
        });
        return;
      }
      const key = this.#requestKey(message.id);
      if (this.pendingUserInput.has(key)) {
        this.#send({
          id: message.id,
          error: { code: -32600, message: "Codex 返回了重复的用户选择请求。" }
        });
        return;
      }
      if (typeof this.onUserInputRequest !== "function") {
        this.#send({
          id: message.id,
          error: { code: -32601, message: "当前客户端不能显示 Codex 用户选择。" }
        });
        return;
      }
      const pending = { id: message.id, params };
      this.pendingUserInput.set(key, pending);
      try {
        this.onUserInputRequest?.({ id: pending.id, params: pending.params });
      } catch (error) {
        this.pendingUserInput.delete(key);
        this.#send({
          id: message.id,
          error: {
            code: -32603,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }
      return;
    }

    this.#send({
      id: message.id,
      error: {
        code: -32601,
        message: `domi 暂不支持 App Server 请求：${message.method}`
      }
    });
  }

  #requestKey(id) {
    return `${typeof id}:${String(id)}`;
  }

  #rememberResolvedUserInput(key) {
    this.resolvedUserInput.add(key);
    if (this.resolvedUserInput.size <= 250) return;
    const oldest = this.resolvedUserInput.values().next().value;
    if (oldest !== undefined) this.resolvedUserInput.delete(oldest);
  }

  #normalizeUserInputRequest(params) {
    if (!params || typeof params !== "object") return null;
    const route = normalizeCodexRoutingParams(params);
    const threadId = route.threadId;
    const turnId = route.turnId;
    const itemId = String(params.itemId || params.item?.id || "").trim();
    if (!threadId || !turnId || !itemId || !Array.isArray(params.questions)) return null;
    const questionIds = new Set();
    const questions = [];
    for (const value of params.questions.slice(0, 3)) {
      if (!value || typeof value !== "object") return null;
      const id = String(value.id || "").trim().slice(0, 100);
      const question = String(value.question || "").trim().slice(0, 2_000);
      if (!id || !question || questionIds.has(id)) return null;
      questionIds.add(id);
      const options = value.options === null || value.options === undefined
        ? null
        : Array.isArray(value.options)
          ? value.options.slice(0, 20).map((option) => ({
              label: String(option?.label || "").trim().slice(0, 200),
              description: String(option?.description || "").trim().slice(0, 1_000)
            })).filter((option) => option.label)
          : null;
      questions.push({
        id,
        header: String(value.header || "").trim().slice(0, 120),
        question,
        isOther: Boolean(value.isOther),
        isSecret: Boolean(value.isSecret),
        options
      });
    }
    if (questions.length === 0) return null;
    return {
      threadId,
      turnId,
      itemId,
      questions,
      isBlocking: params.isBlocking !== false,
      autoResolutionMs: Number.isFinite(params.autoResolutionMs)
        ? Math.max(0, Number(params.autoResolutionMs))
        : null
    };
  }

  #normalizeUserInputAnswers(params, answers) {
    if (!answers || typeof answers !== "object" || Array.isArray(answers)) {
      throw new Error("请选择答案后再继续。");
    }
    const normalized = {};
    for (const question of params.questions) {
      const raw = answers[question.id];
      const values = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray(raw.answers)
          ? raw.answers
          : [];
      const selected = values
        .map((value) => String(value || "").trim().slice(0, 4_000))
        .filter(Boolean)
        .slice(0, 20);
      if (selected.length === 0) {
        throw new Error(`请回答“${question.header || question.question}”。`);
      }
      const optionLabels = new Set((question.options || []).map((option) => option.label));
      if (optionLabels.size > 0 && !question.isOther) {
        const unknown = selected.find((value) => !optionLabels.has(value));
        if (unknown) throw new Error(`“${question.header || question.question}”包含无效选项。`);
      }
      normalized[question.id] = { answers: selected };
    }
    return normalized;
  }

  #clearUserInputRequests(reason, notifyServer = false) {
    const pendingRequests = [...this.pendingUserInput.values()];
    this.pendingUserInput.clear();
    for (const pending of pendingRequests) {
      const key = this.#requestKey(pending.id);
      this.#rememberResolvedUserInput(key);
      if (notifyServer) {
        try {
          this.#send({
            id: pending.id,
            error: { code: -32800, message: "domi 已停止等待用户选择。" }
          });
        } catch {
          // Ignore a closed transport during shutdown.
        }
      }
      this.onUserInputRequestClosed?.({ id: pending.id, params: pending.params, reason });
    }
  }
}

module.exports = {
  CodexAppServer,
  canonicalCodexRuntime,
  codexEnvironment,
  resolveCodexBinary
};
