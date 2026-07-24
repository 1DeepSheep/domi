function threadPersistenceOptions(payload = {}) {
  return payload.ephemeral === true ? { ephemeral: true } : {};
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

function codexTurnContext(prompt, runtimeContext) {
  return {
    input: [{ type: "text", text: String(prompt || "") }],
    additionalContext: runtimeAdditionalContext(runtimeContext)
  };
}

module.exports = {
  codexTurnContext,
  runtimeAdditionalContext,
  threadPersistenceOptions
};
