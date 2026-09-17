const { spawn } = require("node:child_process");
const { plaudErrorDetails } = require("./plaud-worker.cjs");

const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 40_000;
const DEFAULT_IDLE_TIMEOUT_MS = 60_000;

function sanitizedBrokerError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message
    .replace(/\b(?:authorization|cookie|x-pld-user|x-device-id)\s*[:=]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .slice(0, 1000);
}

function brokerFailure(message, diagnostic = {}) {
  const error = new Error(sanitizedBrokerError(message));
  Object.assign(error, plaudErrorDetails({ ...diagnostic, message: error.message }, diagnostic.stage));
  return error;
}

class PlaudSessionBroker {
  constructor({
    executable,
    workerPath,
    envProvider = () => ({}),
    spawnImpl = spawn,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    onDiagnostic = () => {}
  }) {
    this.executable = executable;
    this.workerPath = workerPath;
    this.envProvider = envProvider;
    this.spawnImpl = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.idleTimeoutMs = Math.max(1_000, Number(idleTimeoutMs) || DEFAULT_IDLE_TIMEOUT_MS);
    this.child = null;
    this.pluginRoot = "";
    this.sessionKey = "";
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.sequence = 0;
    this.stopPromise = null;
    this.idleTimer = null;
    this.onDiagnostic = onDiagnostic;
    this.stopReason = "";
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode == null && this.child.signalCode == null);
  }

  clearIdleTimer() {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  armIdleStop() {
    this.clearIdleTimer();
    if (!this.isRunning() || this.pending.size > 0 || this.stopPromise) return;
    const child = this.child;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      if (this.child !== child || this.pending.size > 0 || !this.isRunning()) return;
      void this.stop("idle-timeout");
    }, this.idleTimeoutMs);
    this.idleTimer.unref?.();
  }

  start(pluginRoot, sessionKey = pluginRoot) {
    this.clearIdleTimer();
    const normalizedRoot = String(pluginRoot || "").trim();
    if (!normalizedRoot) throw new Error("PLAUD 插件目录不可用。");
    if (this.isRunning() && this.pluginRoot === normalizedRoot && this.sessionKey === sessionKey) return;
    if (this.isRunning()) {
      throw new Error("PLAUD 后台会话正在切换插件版本，请稍后重试。");
    }

    const child = this.spawnImpl(this.executable, [this.workerPath, "serve", normalizedRoot], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      env: {
        ...process.env,
        ...this.envProvider()
      }
    });
    this.child = child;
    this.pluginRoot = normalizedRoot;
    this.sessionKey = String(sessionKey || normalizedRoot);
    this.stopReason = "";
    this.stdoutBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.consumeStdout(chunk));
    // Do not surface browser stderr: it may include local ports or page details.
    child.stderr?.resume();
    child.once("error", (error) => this.handleExit(error));
    child.once("close", (code, signal) => {
      if (this.child !== child) return;
      const suffix = signal ? `（${signal}）` : Number.isInteger(code) ? `（${code}）` : "";
      try {
        this.onDiagnostic({ operation: "worker-exit", reason: this.stopReason || "unexpected-exit",
          code: signal || String(code ?? "unknown"), pendingCount: this.pending.size });
      } catch { /* Diagnostics must not delay reader cleanup. */ }
      this.handleExit(new Error(`PLAUD_WORKER_EXITED: PLAUD 后台会话已结束${suffix}。`));
    });
  }

  consumeStdout(chunk) {
    this.stdoutBuffer += String(chunk || "");
    while (true) {
      const newline = this.stdoutBuffer.indexOf("\n");
      if (newline < 0) break;
      const line = this.stdoutBuffer.slice(0, newline).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const request = this.pending.get(String(message?.id || ""));
      if (!request) continue;
      if (message.type === "diagnostic") {
        const details = plaudErrorDetails(message.diagnostic || {}, message.diagnostic?.stage);
        request.lastDiagnostic = { ...request.lastDiagnostic, ...(message.diagnostic?.code ? details : { stage: details.stage }) };
        continue;
      }
      this.pending.delete(String(message.id));
      clearTimeout(request.timer);
      if (message.ok === false) {
        const error = brokerFailure(message.error || "PLAUD 后台操作失败。", message.diagnostic);
        try { this.onDiagnostic({ operation: request.command, outcome: "failed", ...plaudErrorDetails(error) }); } catch { /* diagnostic only */ }
        request.reject(error);
      } else {
        request.resolve(message.result);
      }
      this.armIdleStop();
    }
  }

  handleExit(error) {
    this.clearIdleTimer();
    const child = this.child;
    this.child = null;
    this.pluginRoot = "";
    this.sessionKey = "";
    this.stdoutBuffer = "";
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(brokerFailure(error.message || error, { ...request.lastDiagnostic, ...plaudErrorDetails(error) }));
    }
    this.pending.clear();
    return child;
  }

  async request(command, args, pluginRoot, options = {}) {
    const startedAt = Date.now();
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || this.requestTimeoutMs);
    const deadlineAt = Math.min(startedAt + timeoutMs, Number.isFinite(options.deadlineAt) ? options.deadlineAt : Infinity);
    this.clearIdleTimer();
    if (this.stopPromise) await this.stopPromise;
    const sessionKey = String(options.sessionKey || pluginRoot || "");
    if (this.isRunning() && (
      this.pluginRoot !== String(pluginRoot || "").trim()
      || this.sessionKey !== sessionKey
    )) {
      await this.stop("plugin-changed");
    }
    if (Date.now() >= deadlineAt) throw brokerFailure("PLAUD_NETWORK_TIMEOUT: 等待 PLAUD 后台会话释放已超时。", { code: "PLAUD_NETWORK_TIMEOUT", stage: "init" });
    if (!this.isRunning()) this.start(pluginRoot, sessionKey);
    const child = this.child;
    if (!child?.stdin?.writable) throw new Error("PLAUD 后台会话尚未就绪。");
    const id = String(++this.sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(id);
        this.pending.delete(id);
        const error = brokerFailure("PLAUD_NETWORK_TIMEOUT: PLAUD 后台操作超时；已保留上次成功数据。", { ...pending?.lastDiagnostic, code: "PLAUD_NETWORK_TIMEOUT" });
        try { this.onDiagnostic({ operation: command, outcome: "timeout", ...plaudErrorDetails(error),
          ...(pending?.lastDiagnostic?.code ? { lastErrorCode: pending.lastDiagnostic.code } : {}) }); } catch { /* diagnostic only */ }
        reject(error);
        void this.stop("request-timeout");
      }, Math.max(1, deadlineAt - Date.now()));
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, command, lastDiagnostic: { stage: "init" } });
      child.stdin.write(`${JSON.stringify({ id, command, args, deadlineAt })}\n`, (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        request.reject(new Error(sanitizedBrokerError(error)));
        this.armIdleStop();
      });
    });
  }

  async stop(reason = "shutdown") {
    this.clearIdleTimer();
    if (this.stopPromise) return this.stopPromise;
    const child = this.child;
    if (!child || child.exitCode != null || child.signalCode != null) {
      this.handleExit(new Error("PLAUD 后台会话已关闭。"));
      return;
    }
    this.stopReason = String(reason || "shutdown");
    this.stopPromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(forceTimer);
        resolve();
      };
      const forceTimer = setTimeout(() => {
        if (child.exitCode == null && child.signalCode == null) child.kill("SIGKILL");
        finish();
      }, this.shutdownTimeoutMs);
      forceTimer.unref?.();
      child.once("close", finish);
      // SIGTERM invokes the worker's graceful PlaudClient.close() path. It has
      // enough time to flush the private Profile before the bounded fallback.
      child.kill("SIGTERM");
    }).finally(() => {
      this.stopPromise = null;
      if (this.child === child) {
        this.handleExit(new Error(`PLAUD 后台会话已停止（${reason}）。`));
      }
    });
    return this.stopPromise;
  }
}

module.exports = {
  DEFAULT_IDLE_TIMEOUT_MS,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  PlaudSessionBroker,
  sanitizedBrokerError
};
