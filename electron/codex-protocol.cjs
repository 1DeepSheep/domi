const DEFAULT_CODEX_CLIENT_CAPABILITIES = Object.freeze({
  experimentalApi: true
});

function codexClientCapabilities(overrides = {}) {
  return {
    ...DEFAULT_CODEX_CLIENT_CAPABILITIES,
    ...overrides
  };
}

function usesExperimentalApi(capabilities = DEFAULT_CODEX_CLIENT_CAPABILITIES) {
  return capabilities?.experimentalApi === true;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || "");
}

function isExperimentalApiInitializationError(error) {
  const message = errorMessage(error);
  return /experimentalApi/i.test(message)
    && /(capabilit|invalid|unknown|unrecognized|unsupported|unexpected)/i.test(message);
}

function isAdditionalContextCompatibilityError(error) {
  const message = errorMessage(error);
  return /additionalContext/i.test(message)
    && /(experimentalApi|capabilit|invalid|unknown|unrecognized|unsupported|unexpected)/i.test(message);
}

module.exports = {
  DEFAULT_CODEX_CLIENT_CAPABILITIES,
  codexClientCapabilities,
  isAdditionalContextCompatibilityError,
  isExperimentalApiInitializationError,
  usesExperimentalApi
};
