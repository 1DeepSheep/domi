import type { CodexSetupResult } from "./env";

export const CODEX_CONNECTION_TEST_UI_TIMEOUT_MS = 95_000;

export type BoundedCodexConnectionTestOutcome =
  | { status: "completed"; result: CodexSetupResult }
  | { status: "failed"; error: string }
  | { status: "cancelled" }
  | { status: "timed-out" };

type TimerHandle = ReturnType<typeof setTimeout>;

type BoundedCodexConnectionTestOptions = {
  requestId: string;
  signal: AbortSignal;
  invoke: (request: { requestId: string }) => Promise<CodexSetupResult>;
  cancel: (request: { requestId: string }) => Promise<unknown>;
  timeoutMs?: number;
  setTimeoutFn?: (callback: () => void, timeoutMs: number) => TimerHandle;
  clearTimeoutFn?: (handle: TimerHandle) => void;
};

type CodexConnectionFingerprintInput = {
  authMode?: string;
  apiBaseUrl?: string;
  apiModel?: string;
  relayCredentialConfigured?: boolean;
  codexPath?: string;
  relayApiKey?: string;
  runtimeAuthMode?: string;
  runtimeApiBaseUrl?: string;
  runtimeModel?: string;
  runtimePath?: string;
  runtimeAccount?: string;
};

export type CodexConnectionRuntimeSnapshot = {
  authMode: string;
  path: string;
  apiBaseUrl: string;
  configuredModel: string;
};

function normalizedRelayUrl(value?: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    // Match the URL canonicalization used by the main-process relay writer:
    // protocol/host casing, default ports and trailing slashes must not turn a
    // successful test into a false stale-result warning.
    return new URL(raw).href.replace(/\/+$/, "");
  } catch {
    return raw.replace(/\/+$/, "");
  }
}

export function codexConnectionDraftBlockReason({
  draftCodexPath,
  savedCodexPath,
  runtimePath,
  relayApiKey
}: {
  draftCodexPath?: string;
  savedCodexPath?: string;
  runtimePath?: string;
  relayApiKey?: string;
}): string {
  const draftPath = String(draftCodexPath || "").trim();
  const savedPath = String(savedCodexPath || "").trim();
  const activePath = String(runtimePath || "").trim();
  if (
    draftPath !== savedPath
    || (draftPath && activePath && draftPath !== activePath)
  ) {
    return "自定义 Codex 路径尚未应用；请先保存设置并刷新运行状态，再测试完整连接。";
  }
  if (String(relayApiKey || "").trim()) {
    return "新的中转站 API Key 尚未保存；请使用“安全保存并测试”，不能用旧密钥代替验证。";
  }
  return "";
}

export function codexConnectionRuntimeSnapshot(input: {
  authMode?: string;
  path?: string;
  apiBaseUrl?: string;
  configuredModel?: string;
}): CodexConnectionRuntimeSnapshot {
  return {
    authMode: String(input.authMode || "").trim(),
    path: String(input.path || "").trim(),
    apiBaseUrl: normalizedRelayUrl(input.apiBaseUrl),
    configuredModel: String(input.configuredModel || "").trim()
  };
}

export function codexConnectionRuntimeMatchesSnapshot(
  expected: CodexConnectionRuntimeSnapshot,
  actual: {
    authMode?: string;
    path?: string;
    apiBaseUrl?: string;
    configuredModel?: string;
  } | null | undefined
): boolean {
  if (!actual) return false;
  const normalizedActual = codexConnectionRuntimeSnapshot(actual);
  return expected.authMode === normalizedActual.authMode
    && expected.path === normalizedActual.path
    && expected.apiBaseUrl === normalizedActual.apiBaseUrl
    && expected.configuredModel === normalizedActual.configuredModel;
}

export function codexConnectionConfigFingerprint(
  input: CodexConnectionFingerprintInput
): string {
  return JSON.stringify([
    String(input.authMode || ""),
    String(input.apiBaseUrl || "").trim(),
    String(input.apiModel || "").trim(),
    Boolean(input.relayCredentialConfigured),
    String(input.codexPath || "").trim(),
    String(input.relayApiKey || ""),
    String(input.runtimeAuthMode || ""),
    String(input.runtimeApiBaseUrl || "").trim(),
    String(input.runtimeModel || "").trim(),
    String(input.runtimePath || "").trim(),
    String(input.runtimeAccount || "").trim()
  ]);
}

export function runBoundedCodexConnectionTest({
  requestId,
  signal,
  invoke,
  cancel,
  timeoutMs = CODEX_CONNECTION_TEST_UI_TIMEOUT_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}: BoundedCodexConnectionTestOptions): Promise<BoundedCodexConnectionTestOutcome> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: TimerHandle | null = null;

    const requestCancellation = () => {
      void Promise.resolve(cancel({ requestId })).catch(() => undefined);
    };
    const finish = (outcome: BoundedCodexConnectionTestOutcome) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeoutFn(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      requestCancellation();
      finish({ status: "cancelled" });
    };

    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    timer = setTimeoutFn(() => {
      requestCancellation();
      finish({ status: "timed-out" });
    }, Math.max(1, Number(timeoutMs) || CODEX_CONNECTION_TEST_UI_TIMEOUT_MS));

    void Promise.resolve().then(async () => {
      // Cancellation may happen in the same turn in which this helper is
      // created. Do not start IPC after a cancellation request that could not
      // yet find a matching main-process operation.
      if (settled || signal.aborted) return;
      try {
        const result = await invoke({ requestId });
        finish({ status: "completed", result });
      } catch (testError) {
        finish({
          status: "failed",
          error: testError instanceof Error ? testError.message : String(testError)
        });
      }
    });
  });
}
