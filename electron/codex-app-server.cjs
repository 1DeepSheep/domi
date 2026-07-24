const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const readline = require("node:readline");

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

function resolveCodexBinary(preferredPath = "") {
  const home = os.homedir();
  const candidates = [
    preferredPath,
    process.env.DOMI_CODEX_PATH,
    path.join(home, ".npm-global", "bin", "codex"),
    path.join(home, ".local", "bin", "codex"),
    "/opt/homebrew/bin/codex",
    "/usr/local/bin/codex",
    "/usr/bin/codex"
  ].filter(Boolean);

  const binary = candidates.find((candidate) => {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });

  if (!binary) {
    throw new Error("没有找到 Codex。请先安装 Codex，或通过 DOMI_CODEX_PATH 指定可执行文件。");
  }

  return binary;
}

class CodexAppServer {
  constructor({
    cwd,
    version,
    runtimeProvider,
    onNotification,
    onLog,
    onExit,
    requestTimeoutMs = 45_000
  }) {
    this.cwd = cwd;
    this.version = version;
    this.runtimeProvider = runtimeProvider;
    this.onNotification = onNotification;
    this.onLog = onLog;
    this.onExit = onExit;
    this.requestTimeoutMs = requestTimeoutMs;
    this.child = null;
    this.startPromise = null;
    this.pending = new Map();
    this.nextRequestId = 1;
    this.intentionalClose = false;
    this.stderrTail = "";
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise;
    }

    if (this.child && !this.child.killed) {
      return;
    }

    this.startPromise = this.#startProcess().catch((error) => {
      this.startPromise = null;
      throw error;
    });
    return this.startPromise;
  }

  async #startProcess() {
    const runtime = this.runtimeProvider?.() || {};
    const binary = resolveCodexBinary(runtime.codexPath);
    this.intentionalClose = false;
    this.stderrTail = "";
    this.child = spawn(binary, ["app-server", "--listen", "stdio://", ...(runtime.args || [])], {
      cwd: this.cwd,
      env: codexEnvironment(runtime.env),
      stdio: ["pipe", "pipe", "pipe"]
    });

    const processStarted = new Promise((resolve, reject) => {
      this.child.once("spawn", resolve);
      this.child.once("error", reject);
    });

    const output = readline.createInterface({ input: this.child.stdout });
    output.on("line", (line) => this.#handleLine(line));

    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      this.stderrTail = `${this.stderrTail}${text}`.slice(-8000);
      this.onLog?.(text);
    });

    this.child.on("exit", (code, signal) => {
      const error = new Error(
        this.intentionalClose
          ? "Codex App Server 已关闭。"
          : this.stderrTail.trim() || `Codex App Server 已退出（${code ?? signal ?? "unknown"}）。`
      );
      this.child = null;
      this.startPromise = null;
      for (const request of this.pending.values()) {
        clearTimeout(request.timeout);
        request.reject(error);
      }
      this.pending.clear();
      this.onExit?.({ code, signal, error, intentional: this.intentionalClose });
    });

    await processStarted;
    await this.#sendRequest("initialize", {
      clientInfo: {
        name: "domi",
        title: "豆米",
        version: this.version
      },
      capabilities: {
        experimentalApi: false
      }
    });
    this.#send({ method: "initialized" });
  }

  async request(method, params = {}, options = {}) {
    await this.start();
    return this.#sendRequest(method, params, options.timeoutMs);
  }

  close() {
    this.intentionalClose = true;
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
        reject(error);
      }, timeoutMs);
      timeout.unref();
      this.pending.set(id, { resolve, reject, method, timeout });
      try {
        this.#send({ id, method, params });
      } catch (error) {
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
      this.#send({ id: message.id, result: { answers: {} } });
      return;
    }

    this.#send({
      id: message.id,
      error: {
        code: -32601,
        message: `豆米暂不支持 App Server 请求：${message.method}`
      }
    });
  }
}

module.exports = {
  CodexAppServer,
  codexEnvironment,
  resolveCodexBinary
};
