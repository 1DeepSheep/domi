import type { DomiPlaudSyncResult } from "./env";

const RETRY_DELAYS = [2_000, 5_000, 15_000];
const INTENT_LIFETIME_MS = 15 * 60_000;
const SAFE_PREFLIGHT_ERRORS = new Set([
  "PLAUD_SESSION_PROBE_INCOMPLETE", "PLAUD_UNAUTHORIZED", "PLAUD_BROWSER_UNAVAILABLE",
  "PLAUD_WORKER_EXITED", "PLAUD_NETWORK_TIMEOUT", "PLAUD_RATE_LIMITED",
  "PLAUD_SERVICE_UNAVAILABLE", "PLAUD_PROFILE_LOCKED", "PLAUD_WORKFLOW_IN_USE", "PLAUD_READ_TRANSIENT"
]);

/** Memory-only permission to continue one user-requested, never-submitted sync. */
export type PlaudSyncIntent = {
  scopeVersion: number;
  recoveryScope: string;
  attempt: number;
  retryAt: number;
  expiresAt: number;
};

export function planPlaudSyncContinuation(
  result: DomiPlaudSyncResult,
  scopeVersion: number,
  previous: PlaudSyncIntent | null = null,
  now = Date.now(),
  deadline = now + INTENT_LIFETIME_MS
): PlaudSyncIntent | null {
  const attempt = previous ? previous.attempt + 1 : 0;
  if (result.submissionStarted !== false || result.preflight !== true || result.retryable !== true
    || result.superseded || result.snapshot?.superseded || typeof result.recoveryScope !== "string" || !result.recoveryScope
    || !SAFE_PREFLIGHT_ERRORS.has(result.errorCode || "") || attempt >= RETRY_DELAYS.length
    || (previous && (previous.scopeVersion !== scopeVersion || previous.recoveryScope !== result.recoveryScope))) return null;
  const expiresAt = previous?.expiresAt ?? deadline;
  const delay = Math.max(RETRY_DELAYS[attempt], result.errorCode === "PLAUD_RATE_LIMITED" ? 30_000 : 0,
    Number.isFinite(result.retryAfterMs) ? Math.max(0, result.retryAfterMs!) : 0);
  const retryAt = Math.max(now + delay, Number.isFinite(result.retryAt) ? result.retryAt! : 0);
  if (retryAt >= expiresAt) return null;
  return { scopeVersion, recoveryScope: result.recoveryScope, attempt, retryAt, expiresAt };
}
