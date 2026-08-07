const { spawn } = require("node:child_process");

const DEFAULT_REQUEST_TIMEOUT_MS = 90_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 40_000;

function sanitizedBrokerError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message
    .replace(/\b(?:authorization|cookie|x-pld-user|x-device-id)\s*[:=]\s*[^\r\n]+/gi, "[REDACTED]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "[REDACTED]")
    .slice(0, 1000);
}

class PlaudSessionBroker {
  constructor({
    executable,
    workerPath,
    envProvider = () => ({}),
    spawnImpl = spawn,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
    shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS
  }) {
    this.executable = executable;
    this.workerPath = workerPath;
    this.envProvider = envProvider;
    this.spawnImpl = spawnImpl;
    this.requestTimeoutMs = requestTimeoutMs;
    this.shutdownTimeoutMs = shutdownTimeoutMs;
    this.child = null;
    this.pluginRoot = "";
    this.sessionKey = "";
    this.stdoutBuffer = "";
    this.pending = new Map();
    this.sequence = 0;
    this.stopPromise = null;
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode == null && this.child.signalCode == null);
  }

  start(pluginRoot, sessionKey = pluginRoot) {
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
    this.stdoutBuffer = "";
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => this.consumeStdout(chunk));
    // Do not surface browser stderr: it may include local ports or page details.
    child.stderr?.resume();
    child.once("error", (error) => this.handleExit(error));
    child.once("close", (code, signal) => {
      if (this.child !== child) return;
      const suffix = signal ? `（${signal}）` : Number.isInteger(code) ? `（${code}）` : "";
      this.handleExit(new Error(`PLAUD 后台会话已结束${suffix}。`));
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
      this.pending.delete(String(message.id));
      clearTimeout(request.timer);
      if (message.ok === false) {
        request.reject(new Error(sanitizedBrokerError(message.error || "PLAUD 后台操作失败。")));
      } else {
        request.resolve(message.result);
      }
    }
  }

  handleExit(error) {
    const child = this.child;
    this.child = null;
    this.pluginRoot = "";
    this.sessionKey = "";
    this.stdoutBuffer = "";
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(sanitizedBrokerError(error)));
    }
    this.pending.clear();
    return child;
  }

  async request(command, args, pluginRoot, options = {}) {
    if (this.stopPromise) await this.stopPromise;
    const sessionKey = String(options.sessionKey || pluginRoot || "");
    if (this.isRunning() && (
      this.pluginRoot !== String(pluginRoot || "").trim()
      || this.sessionKey !== sessionKey
    )) {
      await this.stop("plugin-changed");
    }
    if (!this.isRunning()) this.start(pluginRoot, sessionKey);
    const child = this.child;
    if (!child?.stdin?.writable) throw new Error("PLAUD 后台会话尚未就绪。");
    const id = String(++this.sequence);
    const timeoutMs = Math.max(1_000, Number(options.timeoutMs) || this.requestTimeoutMs);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("PLAUD_NETWORK_TIMEOUT: PLAUD 后台操作超时；已保留上次成功数据。"));
        void this.stop("request-timeout");
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, command, args })}\n`, (error) => {
        if (!error) return;
        const request = this.pending.get(id);
        if (!request) return;
        this.pending.delete(id);
        clearTimeout(request.timer);
        request.reject(new Error(sanitizedBrokerError(error)));
      });
    });
  }

  async stop(reason = "shutdown") {
    if (this.stopPromise) return this.stopPromise;
    const child = this.child;
    if (!child || child.exitCode != null || child.signalCode != null) {
      this.handleExit(new Error("PLAUD 后台会话已关闭。"));
      return;
    }
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
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_TIMEOUT_MS,
  PlaudSessionBroker,
  sanitizedBrokerError
};
