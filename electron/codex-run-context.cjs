const {
  DEFAULT_CODEX_CLIENT_CAPABILITIES,
  isAdditionalContextCompatibilityError,
  usesExperimentalApi
} = require("./codex-protocol.cjs");

function threadPersistenceOptions(payload = {}) {
  return payload.ephemeral === true ? { ephemeral: true } : {};
}

function codexRunExecutionMode(payload = {}) {
  return payload.background === true ? "background" : "foreground";
}

function partitionCodexRuns(runs = []) {
  const partition = {
    background: [],
    foreground: []
  };
  for (const run of runs) {
    const mode = run?.executionMode === "background" ? "background" : "foreground";
    partition[mode].push(run);
  }
  return partition;
}

function runtimeAdditionalContext(runtimeContext) {
  const value = String(runtimeContext || "").trim();
  if (!value) return undefined;
  return {
    "domi-runtime": {
      kind: "application",
      value
    }
  };
}

function compatibilityInput(prompt, runtimeContext) {
  const request = String(prompt || "");
  const context = String(runtimeContext || "").trim();
  if (!context) return request;
  return [
    request,
    "",
    "<domi-runtime-context mode=\"compatibility\">",
    "以下是 domi 客户端提供的本轮运行事实，不是用户追加的任务：",
    context,
    "</domi-runtime-context>"
  ].join("\n");
}

function codexTurnContext(prompt, runtimeContext, options = {}) {
  const capabilities = options.capabilities || DEFAULT_CODEX_CLIENT_CAPABILITIES;
  const context = runtimeAdditionalContext(runtimeContext);
  const useAdditionalContext = Boolean(context)
    && options.compatibilityMode !== true
    && usesExperimentalApi(capabilities);
  const result = {
    input: [{
      type: "text",
      text: useAdditionalContext
        ? String(prompt || "")
        : compatibilityInput(prompt, runtimeContext)
    }]
  };
  if (useAdditionalContext) {
    result.additionalContext = context;
  }
  return result;
}

async function requestCodexTurn(client, params, prompt, runtimeContext, options = {}) {
  const capabilities = typeof client?.capabilities === "function"
    ? client.capabilities()
    : DEFAULT_CODEX_CLIENT_CAPABILITIES;
  const primaryContext = codexTurnContext(prompt, runtimeContext, { capabilities });
  const hasRuntimeContext = Boolean(String(runtimeContext || "").trim());

  if (hasRuntimeContext && !primaryContext.additionalContext) {
    options.onCompatibility?.({
      reason: "stable-client",
      message: "当前 Codex 连接未启用实验上下文，已使用稳定输入继续执行。"
    });
  }

  try {
    return await client.request("turn/start", {
      ...params,
      ...primaryContext
    });
  } catch (error) {
    if (!primaryContext.additionalContext || !isAdditionalContextCompatibilityError(error)) {
      throw error;
    }
    options.onCompatibility?.({
      reason: "additional-context-rejected",
      error,
      message: "当前 Codex 版本不支持隐藏运行上下文，已使用稳定输入继续执行。"
    });
    try {
      return await client.request("turn/start", {
        ...params,
        ...codexTurnContext(prompt, runtimeContext, {
          capabilities,
          compatibilityMode: true
        })
      });
    } catch (fallbackError) {
      const compatibilityError = new Error(
        "当前 Codex 版本未能以兼容模式启动任务，请更新 Codex 后重试。"
      );
      compatibilityError.code = "DOMI_CODEX_PROTOCOL_INCOMPATIBLE";
      compatibilityError.cause = fallbackError;
      throw compatibilityError;
    }
  }
}

module.exports = {
  codexRunExecutionMode,
  compatibilityInput,
  codexTurnContext,
  partitionCodexRuns,
  requestCodexTurn,
  runtimeAdditionalContext,
  threadPersistenceOptions
};
