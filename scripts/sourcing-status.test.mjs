import assert from "node:assert/strict";
import { test } from "node:test";
import { sourcingSnapshotError, sourcingUpdateStatus } from "../src/sourcing-status.ts";

const checkedContext = checkedAt => ({ status: "not_found", checkedAt, note: "Synthetic check", items: [] });
const candidate = (overrides = {}) => ({
  id: "synthetic-candidate", name: "Synthetic company", kind: "company", founders: [], summary: "Synthetic result",
  domain: "AI", tags: [], signal: "Synthetic signal", discoveredAt: 110, lastSeenAt: 120,
  stage: "new", confidence: "medium", sources: [], discoveryPath: [], relatedEntities: [],
  contactPaths: checkedContext(120), researchLinks: checkedContext(120), intake: { status: "needs_review" }, nextAction: "Verify",
  ...overrides
});
const source = (overrides = {}) => ({ id: "synthetic-source", name: "Synthetic source", type: "other", url: "https://example.test/source", enabled: true,
  status: "checked", lastCheckedAt: 120, ...overrides });
const snapshot = (overrides = {}) => ({
  ok: true, configured: true, candidates: [], sources: [],
  settings: { enabled: true, localHour: 9, timeZone: "Asia/Shanghai", autoIntake: true },
  run: { status: "partial", lastAttemptAt: 100 }, ...overrides
});

test("first partial search reports saved candidates without claiming a fully successful run", () => {
  const input = snapshot({ candidates: [candidate({ intake: { status: "created", projectId: "synthetic-project" }, researchLinks: { status: "pending", note: "Pending", items: [] } })],
    sources: [source()], run: { status: "partial", lastAttemptAt: 100, error: "Some branches are pending", coverage: { checked: 5, failed: 2, pending: 1 }, focusCoverage: { checked: 0, failed: 0, pending: 1 } } });
  const before = structuredClone(input);
  assert.deepEqual(sourcingUpdateStatus(input), { savedAt: 120, savedThisRun: true, partial: true, sourceChecked: 5, sourceFailed: 2,
    sourcePending: 1, scopePending: 1, scopeFailed: 0, contextPending: 1, archivedCount: 1 });
  assert.equal(sourcingSnapshotError(input), "");
  assert.deepEqual(input, before, "deriving UI state never changes the saved snapshot");
});

test("a later failed attempt retains the old update time and does not call old evidence current", () => {
  const input = snapshot({ candidates: [candidate()], sources: [source(), source({ id: "failed-source", status: "failed", lastCheckedAt: 240 })],
    run: { status: "failed", lastAttemptAt: 200, lastSuccessAt: 130, error: "Network unavailable" } });
  const status = sourcingUpdateStatus(input);
  assert.equal(status.savedAt, 130);
  assert.equal(status.savedThisRun, false);
  assert.equal(status.sourceChecked, 0);
  assert.equal(status.sourceFailed, 1);
  assert.equal(status.sourcePending, 1);
  assert.equal(status.contextPending, 1);
  assert.equal(sourcingSnapshotError(input), "Network unavailable");
});

test("an empty partial attempt and failed source checks do not invent a result timestamp", () => {
  const status = sourcingUpdateStatus(snapshot({ sources: [source({ status: "failed", lastCheckedAt: 150 })],
    run: { status: "partial", lastAttemptAt: 100, coverage: { checked: 0, failed: 1, pending: 1 } } }));
  assert.equal(status.savedAt, undefined);
  assert.equal(status.savedThisRun, false);
  assert.equal(status.partial, true);
  assert.equal(status.sourceFailed, 1);
  assert.equal(status.sourcePending, 1);
});

test("a first running search before any merge has no saved result", () => {
  const status = sourcingUpdateStatus(snapshot({ sources: [source({ status: "pending", lastCheckedAt: undefined })], run: { status: "running", lastAttemptAt: 100 } }));
  assert.equal(status.savedAt, undefined);
  assert.equal(status.savedThisRun, false);
  assert.equal(status.partial, false);
  assert.equal(status.sourcePending, 1);
});

test("a running retry does not borrow old checked sources or old candidates", () => {
  const status = sourcingUpdateStatus(snapshot({ candidates: [candidate()], sources: [source()], run: { status: "running", lastAttemptAt: 200 } }));
  assert.equal(status.savedAt, 120);
  assert.equal(status.savedThisRun, false);
  assert.equal(status.sourceChecked, 0);
  assert.equal(status.sourcePending, 1);
});

test("successful source checks are persisted search results even when no candidate was found", () => {
  const status = sourcingUpdateStatus(snapshot({ sources: [source({ lastCheckedAt: 140 })], run: { status: "partial", lastAttemptAt: 100 } }));
  assert.equal(status.savedAt, 140);
  assert.equal(status.savedThisRun, true);
  assert.equal(status.sourceChecked, 1);
  assert.equal(status.archivedCount, 0);
});

test("persisted exclusion decisions count as updates but not visible intake or context work", () => {
  const status = sourcingUpdateStatus(snapshot({ candidates: [candidate({ stage: "excluded", intake: { status: "matched", projectId: "synthetic-existing" },
    contactPaths: undefined, researchLinks: undefined })] }));
  assert.equal(status.savedAt, 120);
  assert.equal(status.savedThisRun, true);
  assert.equal(status.archivedCount, 0);
  assert.equal(status.contextPending, 0);
});

test("missing snapshots return an empty, non-error state", () => {
  assert.deepEqual(sourcingUpdateStatus(null), { savedThisRun: false, partial: false, sourceChecked: 0, sourceFailed: 0,
    sourcePending: 0, scopePending: 0, scopeFailed: 0, contextPending: 0, archivedCount: 0 });
  assert.equal(sourcingSnapshotError(null), "");
});

test("context backlog counts a candidate once and distinguishes checked not-found from pending", () => {
  const status = sourcingUpdateStatus(snapshot({ candidates: [candidate(), candidate({ id: "both-pending", contactPaths: undefined, researchLinks: undefined }),
    candidate({ id: "stale", contactPaths: checkedContext(99), researchLinks: checkedContext(120), intake: { status: "matched" } })] }));
  assert.equal(status.contextPending, 2);
  assert.equal(status.archivedCount, 1);
});

test("source fallback counts only active in-scope sources and does not mutate their saved statuses", () => {
  const input = snapshot({ sources: [source(), source({ id: "paused", enabled: false, status: "failed" }),
    source({ id: "outside", inScope: false, status: "pending" }), source({ id: "removed", url: "https://example.test/removed", status: "pending" }),
    source({ id: "unattempted", status: "checked", lastCheckedAt: undefined })], excludedSourceUrls: ["https://example.test/removed"] });
  const status = sourcingUpdateStatus(input);
  assert.equal(status.sourceChecked, 1);
  assert.equal(status.sourceFailed, 0);
  assert.equal(status.sourcePending, 1);
});

test("scope fallback counts unfinished descriptions instead of pretending they are unsearched projects", () => {
  const focus = (id, enabled = true) => ({ id, name: "Synthetic mixed scope", type: "freeform", keywords: [], excludedKeywords: [], relations: [], urls: [], enabled });
  const status = sourcingUpdateStatus(snapshot({ focuses: [focus("pending"), focus("failed"), focus("checked"), focus("paused", false)],
    run: { status: "partial", lastAttemptAt: 100, focusResults: [{ focusId: "failed", status: "failed" }, { focusId: "checked", status: "checked" }, { focusId: "paused", status: "failed" }] } }));
  assert.equal(status.scopePending, 1);
  assert.equal(status.scopeFailed, 1);
});

test("only persisted valid timestamps contribute, with no attempt-time fallback", () => {
  const status = sourcingUpdateStatus(snapshot({ candidates: [candidate({ lastSeenAt: NaN }), candidate({ lastSeenAt: Infinity }), candidate({ lastSeenAt: -1 })],
    sources: [source({ lastCheckedAt: 0 })], run: { status: "partial", lastAttemptAt: 100, lastSuccessAt: NaN } }));
  assert.equal(status.savedAt, undefined);
  assert.equal(status.savedThisRun, false);
});

test("snapshot errors remain visible while only failed-run errors become failure banners", () => {
  assert.equal(sourcingSnapshotError(snapshot({ error: "Repository unavailable", run: { status: "partial", error: "Partial coverage" } })), "Repository unavailable");
  assert.equal(sourcingSnapshotError(snapshot({ run: { status: "running", error: "Stale run error" } })), "");
  assert.equal(sourcingSnapshotError(snapshot({ run: { status: "idle", error: "Stale run error" } })), "");
  assert.equal(sourcingSnapshotError(snapshot({ run: { status: "failed" } })), "");
});
