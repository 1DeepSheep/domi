import type { SourcingContextResult, SourcingSnapshot, SourcingSource } from "./sourcing-types";

export interface SourcingUpdateStatus {
  savedAt?: number;
  savedThisRun: boolean;
  partial: boolean;
  sourceChecked: number;
  sourceFailed: number;
  sourcePending: number;
  scopePending: number;
  scopeFailed: number;
  contextPending: number;
  archivedCount: number;
}

const timestamp = (value?: number) => typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
const count = (value?: number) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;

function contextNeedsCheck(result: SourcingContextResult<unknown> | undefined, attemptedAt?: number) {
  const checkedAt = timestamp(result?.checkedAt);
  return !result || result.status === "pending" || !checkedAt || (attemptedAt !== undefined && checkedAt < attemptedAt);
}

/** Result freshness is independent of whether every branch of a search succeeded. */
export function sourcingUpdateStatus(snapshot: SourcingSnapshot | null): SourcingUpdateStatus {
  if (!snapshot) return { savedThisRun: false, partial: false, sourceChecked: 0, sourceFailed: 0, sourcePending: 0,
    scopePending: 0, scopeFailed: 0, contextPending: 0, archivedCount: 0 };

  const attemptedAt = timestamp(snapshot.run.lastAttemptAt);
  // lastAttemptAt only bounds the current run. Starting a run (or failing to fetch a
  // source) must never advance the displayed result-update time.
  const persistedTimes = [snapshot.run.lastSuccessAt,
    ...snapshot.candidates.map(candidate => candidate.lastSeenAt),
    ...snapshot.sources.filter(source => source.status === "checked").map(source => source.lastCheckedAt)
  ].map(timestamp).filter((value): value is number => value !== undefined);
  const savedAt = persistedTimes.length ? Math.max(...persistedTimes) : undefined;
  const visibleCandidates = snapshot.candidates.filter(candidate => candidate.stage !== "excluded");
  const excludedUrls = new Set(snapshot.excludedSourceUrls || []);
  const activeSources = snapshot.sources.filter(source => source.enabled && source.inScope !== false && !excludedUrls.has(source.url));
  const sourceState = (source: SourcingSource) => {
    const checkedAt = timestamp(source.lastCheckedAt);
    if (!checkedAt || (attemptedAt !== undefined && checkedAt < attemptedAt)) return "pending";
    return source.status || "pending";
  };
  const sourceCoverage = snapshot.run.coverage;
  const focusCoverage = snapshot.run.focusCoverage;
  const focusResults = snapshot.run.focusResults || [];
  const activeFocuses = snapshot.focuses?.filter(focus => focus.enabled) || [];

  return {
    ...(savedAt === undefined ? {} : { savedAt }),
    savedThisRun: savedAt !== undefined && attemptedAt !== undefined && savedAt >= attemptedAt,
    partial: snapshot.run.status === "partial",
    sourceChecked: sourceCoverage ? count(sourceCoverage.checked) : activeSources.filter(source => sourceState(source) === "checked").length,
    sourceFailed: sourceCoverage ? count(sourceCoverage.failed) : activeSources.filter(source => sourceState(source) === "failed").length,
    sourcePending: sourceCoverage ? count(sourceCoverage.pending) : activeSources.filter(source => sourceState(source) === "pending").length,
    scopePending: focusCoverage ? count(focusCoverage.pending) : activeFocuses.filter(focus => !focusResults.some(result => result.focusId === focus.id && result.status !== "pending")).length,
    scopeFailed: focusCoverage ? count(focusCoverage.failed) : focusResults.filter(result => result.status === "failed" && activeFocuses.some(focus => focus.id === result.focusId)).length,
    // One candidate may need both analyses. Count the candidate once, matching the list.
    contextPending: visibleCandidates.filter(candidate => contextNeedsCheck(candidate.contactPaths, attemptedAt) || contextNeedsCheck(candidate.researchLinks, attemptedAt)).length,
    archivedCount: visibleCandidates.filter(candidate => ["created", "matched"].includes(candidate.intake.status)).length
  };
}

/** Partial coverage is rendered as progress, not as a transport/run failure. */
export function sourcingSnapshotError(snapshot: SourcingSnapshot | null): string {
  return snapshot?.error || (snapshot?.run.status === "failed" ? snapshot.run.error || "" : "");
}
