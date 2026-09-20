const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { CodexAppServer } = require("./codex-app-server.cjs");
const requirements = require("../shared/model-requirements.json");

function workflowCapabilities(models = []) {
  const checks = Object.entries(requirements).map(([id, required]) => {
    const model = models.find(item => item.id === required.model);
    const ok = Boolean(model?.supportedReasoningEfforts?.some(item => item.id === required.effort));
    return { id, ...required, ok };
  });
  return { ok: checks.every(item => item.ok), checks };
}

function verifyWorkspace(directory) {
  if (!directory || !path.isAbsolute(directory)) throw new Error("请选择保存资料的文件夹。");
  fs.mkdirSync(directory, { recursive: true });
  const probe = path.join(directory, `.domi-check-${crypto.randomUUID()}`);
  const contents = crypto.randomBytes(16).toString("hex");
  try {
    fs.writeFileSync(probe, contents, { flag: "wx", mode: 0o600 });
    if (fs.readFileSync(probe, "utf8") !== contents) throw new Error("资料保存后未能正确读取。");
  } finally {
    fs.rmSync(probe, { force: true });
  }
}

// Use the same app-server protocol, runtime, model policy and tool events as
// real work. The dedicated ephemeral process cannot consume a user's turn or
// mutate their history. Local save/read validation is deterministic, not AI.
async function verifyCodexWorkflow({ runtime, models, version, workspacePath,
  signal, timeoutMs = 90_000, createClient = options => new CodexAppServer(options),
  setStage = () => {} }) {
  const capabilities = workflowCapabilities(models);
  if (!capabilities.ok) {
    const missing = capabilities.checks.filter(item => !item.ok).map(item => `${item.label}（${item.model} / ${item.effort}）`).join("、");
    return { ok: false, modelOk: false, toolOk: false, capabilities,
      diagnosticCode: "DOMI_WORKFLOW_MODELS_UNAVAILABLE",
      error: `当前连接缺少 ${missing}。请使用支持这些能力的 Codex 连接；已保留现有设置。` };
  }
  setStage("workspace");
  verifyWorkspace(workspacePath);
  signal?.throwIfAborted();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workflow-check-"));
  const marker = `DOMI_CHECK_${crypto.randomBytes(8).toString("hex")}`;
  let stopped = false;
  let client, threadId = "", turnId = "", toolOk = false, modelOk = false, timer;
  let resolveDone, rejectDone;
  const completed = new Promise((resolve, reject) => { resolveDone = resolve; rejectDone = reject; });
  // Attach the rejection handler before any await to avoid unhandled failures
  // while a thread/start request is in flight.
  void completed.catch(() => {});
  const fail = error => { stopped = true; rejectDone(error instanceof Error ? error : new Error(String(error))); };
  const abort = () => { fail(signal.reason || new Error("连接测试已取消。")); client?.close(); };
  const buffered = [];
  const receive = (method, params) => {
    if (!threadId) { if (buffered.length < 100) buffered.push([method, params]); return; }
    if (params.threadId !== threadId) return;
    const candidateTurn = params.turnId || params.turn?.id;
    if (turnId && candidateTurn && candidateTurn !== turnId) return;
    if (candidateTurn) turnId ||= candidateTurn;
    if (method === "item/completed") {
      const item = params.item || {};
      if (item.type === "commandExecution" && item.exitCode === 0
        && String(item.aggregatedOutput || "").trim() === marker) toolOk = true;
      if (item.type === "agentMessage" && String(item.text || "").trim() === marker) modelOk = true;
    }
    if (method === "turn/completed") {
      if (params.turn?.status !== "completed") fail(new Error("示例任务未完成，请检查连接后重试。"));
      else if (!toolOk || !modelOk) fail(new Error("已连接，但尚未验证完整的任务执行能力。请重新检查。"));
      else resolveDone({ ok: true, modelOk, toolOk, workspaceOk: true, capabilities,
        detail: "已通过正式任务通道验证模型、工具和本地文件保存。" });
    }
  };
  try {
    signal?.throwIfAborted();
    client = createClient({ cwd: directory, version, runtimeProvider: () => runtime,
      requestTimeoutMs: Math.max(1, timeoutMs), onNotification: receive,
      onUserInputRequest: () => fail(new Error("连接验证不应要求额外输入。")),
      onExit: ({ intentional }) => { if (!intentional) fail(new Error("任务连接意外关闭，请重新检查。")); } });
    signal?.addEventListener("abort", abort, { once: true });
    timer = setTimeout(() => { fail(new Error("示例任务验证超时，请检查网络连接。")); client.close(); }, Math.max(1, timeoutMs));
    setStage("model-tool");
    const run = (async () => {
      const result = await client.request("thread/start", {
        cwd: directory, model: requirements.premium.model, serviceTier: null,
        ephemeral: true, approvalPolicy: "never", sandbox: "read-only", allowProviderModelFallback: false,
        serviceName: "domi", config: { web_search: "disabled", model_reasoning_effort: requirements.premium.effort },
        baseInstructions: "这是安装验证。仅执行请求中的一次只读命令，不访问其他文件或网络。",
        developerInstructions: "只验证 shell 输出并回复指定标记。"
      });
      if (result?.model !== requirements.premium.model
        || (result.reasoningEffort && result.reasoningEffort !== requirements.premium.effort)) {
        throw new Error("当前服务返回的模型能力与所需配置不一致，请检查 Codex 连接。");
      }
      signal?.throwIfAborted();
      if (stopped) throw new Error("连接验证已停止。");
      threadId = result?.thread?.id;
      if (!threadId) throw new Error("Codex 未创建验证任务。");
      for (const event of buffered.splice(0)) receive(...event);
      const response = await client.request("turn/start", {
        threadId, model: requirements.premium.model, effort: requirements.premium.effort, serviceTier: null,
        input: [{ type: "text", text: `请使用 shell 工具恰好执行一次 printf '${marker}'，确认输出后，最终只回复 ${marker}。` }]
      });
      const acceptedTurn = response?.turn?.id;
      if (turnId && acceptedTurn && turnId !== acceptedTurn) throw new Error("验证任务标识不一致。");
      turnId ||= acceptedTurn || "";
      return completed;
    })();
    void run.catch(fail);
    const interrupted = completed.then(() => new Promise(() => {}));
    return await Promise.race([run, interrupted]);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    client?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

module.exports = { workflowCapabilities, verifyWorkspace, verifyCodexWorkflow };
