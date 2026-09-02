const crypto = require("node:crypto");

const DEFAULT_CODEX_CONNECTION_TEST_TIMEOUT_MS = 90_000;

function connectionTestError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function connectionTestFailure(error, { requestId, stage, timeoutMs }) {
  const code = String(error?.code || "");
  const relayOperation = String(stage || "").startsWith("relay-");
  if (code === "DOMI_CODEX_CONNECTION_TEST_CANCELLED") {
    return {
      ok: false,
      requestId,
      cancelled: true,
      timedOut: false,
      stage,
      diagnosticCode: code,
      error: relayOperation
        ? "中转站配置验证已取消。若安全保存已经完成，配置会保留但不会标记为已实测；请重新测试确认。"
        : "连接测试已取消。连接设置没有改动，可以调整后重新测试。"
    };
  }
  if (code === "DOMI_CODEX_CONNECTION_TEST_TIMEOUT") {
    const seconds = Math.max(1, Math.round(timeoutMs / 1000));
    const detail = stage === "model-tool" || stage === "relay-model-tool"
      ? "模型或 Shell 工具没有按时返回"
      : stage === "relay-config"
        ? "中转站配置或 macOS 钥匙串写入没有按时完成"
        : "Codex 启动、身份或模型检查没有按时完成";
    return {
      ok: false,
      requestId,
      cancelled: false,
      timedOut: true,
      stage,
      diagnosticCode: code,
      error: `完整连接测试已在 ${seconds} 秒后自动停止：${detail}。请检查网络或代理、确认 ChatGPT 登录仍有效后重试；如仍失败，请到“系统诊断”导出脱敏报告。`
    };
  }
  return {
    ok: false,
    requestId,
    cancelled: false,
    timedOut: false,
    stage,
    diagnosticCode: "DOMI_CODEX_CONNECTION_TEST_FAILED",
    error: error instanceof Error ? error.message : String(error || "Codex 完整连接测试失败。")
  };
}

function normalizeConnectionTestRequestId(value) {
  const requestId = String(value || "").trim();
  if (/^[A-Za-z0-9._:-]{1,160}$/.test(requestId)) return requestId;
  return `connection-test-${crypto.randomUUID()}`;
}

class CodexConnectionTestController {
  constructor({
    timeoutMs = DEFAULT_CODEX_CONNECTION_TEST_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    now = Date.now
  } = {}) {
    this.timeoutMs = Math.max(1, Number(timeoutMs) || DEFAULT_CODEX_CONNECTION_TEST_TIMEOUT_MS);
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.now = now;
    this.active = new Map();
  }

  run(request = {}, operation) {
    const requestId = normalizeConnectionTestRequestId(request?.requestId);
    if (this.active.size > 0) {
      const activeEntry = this.active.values().next().value;
      return Promise.resolve({
        ok: false,
        requestId,
        cancelled: false,
        timedOut: false,
        stage: "preflight",
        diagnosticCode: "DOMI_CODEX_CONNECTION_TEST_BUSY",
        error: activeEntry?.controller?.signal?.aborted
          ? "上一次连接测试正在安全停止，请稍候片刻后重试。"
          : "已有连接测试正在运行，请先取消或等待它结束。"
      });
    }

    const controller = new AbortController();
    const startedAt = this.now();
    const entry = {
      controller,
      stage: "preflight",
      timeoutMs: this.timeoutMs,
      deadlineAt: startedAt + this.timeoutMs,
      timer: null
    };
    this.active.set(requestId, entry);

    let rejectAborted;
    const aborted = new Promise((_resolve, reject) => {
      rejectAborted = reject;
    });
    const onAbort = () => rejectAborted(controller.signal.reason || connectionTestError(
      "DOMI_CODEX_CONNECTION_TEST_CANCELLED",
      "Codex 连接测试已取消。"
    ));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    entry.timer = this.setTimeoutFn(() => {
      controller.abort(connectionTestError(
        "DOMI_CODEX_CONNECTION_TEST_TIMEOUT",
        "Codex 完整连接测试超时。"
      ));
    }, this.timeoutMs);

    const context = {
      requestId,
      signal: controller.signal,
      deadlineAt: entry.deadlineAt,
      remainingMs: () => Math.max(1, entry.deadlineAt - this.now()),
      setStage: (stage) => {
        if (typeof stage === "string" && stage.trim()) entry.stage = stage.trim();
      }
    };

    const release = () => {
      controller.signal.removeEventListener("abort", onAbort);
      if (entry.timer !== null) {
        this.clearTimeoutFn(entry.timer);
        entry.timer = null;
      }
      if (this.active.get(requestId) === entry) this.active.delete(requestId);
    };
    const work = Promise.resolve().then(() => operation(context));
    // A cancellation settles the caller promptly, but the single-flight slot
    // remains occupied until the underlying work has really stopped. This
    // prevents a late health check from racing a newly started test and
    // resetting its shared Codex client.
    void work.then(release, release);
    return Promise.race([work, aborted])
      .then((result) => ({ ...result, requestId }))
      .catch((error) => connectionTestFailure(error, {
        requestId,
        stage: entry.stage,
        timeoutMs: entry.timeoutMs
      }))
      .finally(() => {
        controller.signal.removeEventListener("abort", onAbort);
        if (entry.timer !== null) {
          this.clearTimeoutFn(entry.timer);
          entry.timer = null;
        }
      });
  }

  cancel(requestId) {
    const normalized = String(requestId || "").trim();
    const entry = this.active.get(normalized);
    if (!entry) return { ok: true, requestId: normalized, cancelled: false };
    entry.controller.abort(connectionTestError(
      "DOMI_CODEX_CONNECTION_TEST_CANCELLED",
      "Codex 连接测试已取消。"
    ));
    return { ok: true, requestId: normalized, cancelled: true };
  }
}

module.exports = {
  DEFAULT_CODEX_CONNECTION_TEST_TIMEOUT_MS,
  CodexConnectionTestController,
  connectionTestFailure,
  normalizeConnectionTestRequestId
};
