import assert from "node:assert/strict";
import test from "node:test";
import { indexBy, indexConversation, latestAssistant } from "../src/render-indexes.ts";
import {
  canSkipTodoSync, fingerprint, nextTodoEvaluationAt, parseTodoReceipt,
  todoInputFingerprint, TODO_RULE_VERSION, verifiedTodoReceipt
} from "../src/todo-sync-policy.ts";
import { podcastAutomationJob, podcastCanResume, podcastProgressRequests } from "../src/podcast-progress.ts";
import { newsDiscoveryContext } from "../src/news-discovery-context.ts";

const now = new Date(2026, 8, 8, 12).getTime();
const day = 86_400_000;
const hash = "a".repeat(64);
const project = { recordId: "p1", name: "合成项目", createdAt: now - day, lastFollowup: now - 44 * day,
  rating: "A", status: "关注", notes: "证据".repeat(180), updatedAt: 10 };
const snapshot = { backend: "local", projects: [project], people: [], syncedAt: 10 };
const task = { id: "task1", status: "open", dueAt: null, updatedAt: new Date(now).toISOString() };
const board = { ok: true, configured: true, stale: false, tasks: [task], documentSha256: hash };
const news = { ok: true, contentUpdatedAt: 200 };

test("indexes preserve first-match, chronological timeline and pending interaction behavior", () => {
  const items = [{ id: "x", value: "first" }, { id: "x", value: "second" }];
  assert.equal(indexBy(items, "id").get("x"), items[0]);
  assert.equal(indexBy(items, "id"), indexBy(items, "id"));
  const timeline = [{ runId: "b", id: 3 }, { runId: "a", id: 2 }, { runId: "a", id: 1 }];
  const interactions = [{ messageId: "m", status: "resolved" }, { messageId: "m", status: "pending" }];
  const indexed = indexConversation(timeline, interactions);
  assert.deepEqual(indexed.timelineByRunId.get("a").map(x => x.id), [1, 2]);
  assert.deepEqual(indexed.chronologicalTimeline.map(x => x.id), [1, 2, 3]);
  assert.equal(indexed.interactionsByMessageId.get("m")[1], interactions[1]);
  assert.equal(indexed.pendingMessageIds.has("m"), true);
  assert.deepEqual(timeline.map(x => x.id), [3, 2, 1]);
});

test("streamed immutable messages invalidate indexes and copy reads their complete live text", () => {
  const before = [{ id: "a", role: "assistant", content: "first" }, { id: "u", role: "user", content: "next" }];
  assert.equal(latestAssistant(before), before[0]);
  const after = [{ ...before[0], content: "first and streamed tail" }, before[1]];
  assert.equal(indexBy(after, "id").get("a").content, "first and streamed tail");
  assert.equal(latestAssistant(after), after[0]);
  assert.equal(indexBy(before, "id").get("a").content, "first");
  assert.equal(latestAssistant([before[1]]), undefined);
});

test("Todo fingerprint includes full evidence, records, ledger and news, excluding refresh clock", async () => {
  const baseline = await todoInputFingerprint(snapshot, board, news, "repo");
  assert.equal(baseline, await todoInputFingerprint({ ...snapshot, syncedAt: 99 }, board, news, "repo"));
  assert.notEqual(baseline, await todoInputFingerprint({ ...snapshot, projects: [{ ...project, notes: project.notes + "新增截止日" }] }, board, news, "repo"));
  assert.notEqual(baseline, await todoInputFingerprint(snapshot, board, { ...news, contentUpdatedAt: 201 }, "repo"));
  assert.notEqual(baseline, await todoInputFingerprint(snapshot, { ...board, tasks: [{ ...task, status: "ignored" }] }, news, "repo"));
  assert.notEqual(baseline, await todoInputFingerprint(snapshot, board, news, "other-repo"));
  assert.equal(await fingerprint({ b: 2, a: 1 }), await fingerprint({ a: 1, b: 2 }));
});

test("Todo skip requires verified unchanged content, rule version and fresh complete inputs", async () => {
  const inputHash = await todoInputFingerprint(snapshot, board, news, "repo");
  const checkpoint = { fingerprint: inputHash, ruleVersion: TODO_RULE_VERSION, repositoryIdentity: "repo",
    verifiedAt: now - 1, nextEvaluationAt: now + 1_000, ledgerFingerprint: hash };
  const input = { fingerprint: inputHash, repositoryIdentity: "repo", now, snapshotFresh: true, board, news };
  assert.equal(canSkipTodoSync(checkpoint, input), true);
  for (const patch of [{ now: now + 1_000 }, { snapshotFresh: false }, { board: { ...board, stale: true } },
    { board: { ...board, documentSha256: "b".repeat(64) } }, { news: { ok: true } },
    { news: { ...news, stale: true } }, { news: { ok: false, contentUpdatedAt: 200 } }]) {
    assert.equal(canSkipTodoSync(checkpoint, { ...input, ...patch }), false);
  }
  assert.equal(canSkipTodoSync({ ...checkpoint, ruleVersion: "old" }, input), false);
  assert.equal(canSkipTodoSync({ ...checkpoint, verifiedAt: now + 1_100 }, { ...input, now: now + 1_200 }), false,
    "a result finished after the previous date/cooldown deadline cannot cache the newly eligible state");
  assert.equal(canSkipTodoSync(null, input), false);
});

test("Todo reevaluates at day, ignored cooldown, followup and new-entry expiry boundaries", () => {
  const at = now + 60_000;
  assert.equal(nextTodoEvaluationAt(snapshot, [{ ...task, status: "ignored", ignoredAt: new Date(at - 30 * day).toISOString() }], now), at);
  assert.equal(nextTodoEvaluationAt({ ...snapshot, projects: [{ ...project, lastFollowup: at - 45 * day }] }, [], now), at);
  assert.equal(nextTodoEvaluationAt({ ...snapshot, projects: [{ ...project, createdAt: at - 28 * day }] }, [], now), at + 1);
  assert.equal(nextTodoEvaluationAt(snapshot, [{ ...task, dueAt: new Date(at + 7 * day).toISOString() }], now), at);
  const tomorrow = new Date(now); tomorrow.setHours(24, 0, 0, 0);
  assert.equal(nextTodoEvaluationAt({ ...snapshot, projects: [] }, [], now), tomorrow.getTime());
});

test("Todo touched timestamps and unrelated or malformed receipts never prove completion", () => {
  const receipt = { schema: "domi.todo-result.v1", runId: "run-1", verified: true,
    ledgerSha256: hash, documentSha256: hash, taskIds: ["task1"] };
  assert.equal(verifiedTodoReceipt(receipt, "run-1", board), true);
  assert.equal(verifiedTodoReceipt(receipt, "run-2", board), false);
  assert.equal(verifiedTodoReceipt(receipt, "run-1", { ...board, documentSha256: "b".repeat(64) }), false);
  assert.equal(verifiedTodoReceipt({ ...receipt, taskIds: [] }, "run-1", board), false);
  assert.equal(verifiedTodoReceipt({ updatedAt: new Date().toISOString() }, "run-1", board), false);
  const marker = `<!-- DOMI_TODO_RESULT_V1 ${JSON.stringify(receipt)} -->`;
  assert.deepEqual(parseTodoReceipt(marker), receipt);
  assert.equal(parseTodoReceipt(marker + marker), null);
  assert.equal(parseTodoReceipt("<!-- DOMI_TODO_RESULT_V1 {bad} -->"), null);
});

test("podcast retries resume existing transcript and preserve archived/cooldown guards", () => {
  const source = { enabled: true, autoProcess: true, keywords: ["AI"] };
  const job = { status: "transcript_ready", transcriptPath: "/synthetic/transcript.md", title: "podcast", description: "", archive: { status: "failed", stage: "notes_ready", nextRetryAt: now - 1 } };
  assert.equal(podcastCanResume(job, source, now), true);
  assert.equal(podcastCanResume(job, source, now, false), false, "legacy archives have no durable receipt and must not repeat every polling tick");
  assert.equal(podcastCanResume({ ...job, archive: { ...job.archive, nextRetryAt: now + 1 } }, source, now), false);
  assert.equal(podcastCanResume({ ...job, archive: { status: "archived" } }, source, now), false);
  assert.equal(podcastCanResume(job, { ...source, autoProcess: false }, now), false);
  assert.equal(podcastCanResume({ ...job, status: "discovered", transcriptPath: "", archive: undefined }, source, now), false);
});

test("podcast streamed checkpoints bind job/run and defer partial or invalid markers", () => {
  const marker = { jobId: "job", runId: "run", stage: "notes_ready", notesPath: "/synthetic/notes.md", qaReceiptPath: "/synthetic/qa.json" };
  const output = `<!-- DOMI_PODCAST_PROGRESS_V1 ${JSON.stringify(marker)} -->`;
  assert.equal(podcastProgressRequests(output, "job", "run")[0].action, "checkpoint");
  assert.deepEqual(podcastProgressRequests(output, "another", "run"), []);
  assert.deepEqual(podcastProgressRequests(output.slice(0, -8), "job", "run"), []);
  assert.deepEqual(podcastProgressRequests("<!-- DOMI_PODCAST_PROGRESS_V1 {bad} -->", "job", "run"), []);
});

test("failed RSS refresh still resumes saved transcripts, while blocking unreliable new downloads", () => {
  const source = { id: "source", enabled: true, autoProcess: true, keywords: [], error: "synthetic RSS unavailable" };
  const pending = { id: "new", sourceId: "source", status: "discovered", title: "new", description: "", discoveredAt: now + 100 };
  const resumable = { id: "saved", sourceId: "source", status: "transcript_ready", transcriptPath: "/synthetic/transcript.md",
    title: "saved", description: "", discoveredAt: now, archive: { status: "failed", stage: "notes_ready", nextRetryAt: 0 } };
  const cached = { ok: false, sources: [source], jobs: [pending, resumable], error: source.error };
  assert.equal(podcastAutomationJob(cached, now, true, false)?.id, "saved");
  assert.equal(podcastAutomationJob({ ...cached, jobs: [pending] }, now, true, false), undefined);
  assert.equal(podcastAutomationJob({ ...cached, jobs: [pending] }, now, true, true), undefined);
  assert.equal(podcastAutomationJob(cached, now, false, false), undefined);
  assert.equal(podcastAutomationJob({ ...cached, sources: [{ ...source, error: "" }] }, now, true, true)?.id, "new");
});

test("news candidates stay bounded and disclose omitted/failed source coverage", () => {
  const sources = Array.from({ length: 12 }, (_, i) => ({ sourceId: `s${i}`, name: `合成信源${i}`, url: "https://example.test/feed",
    status: i === 11 ? "failed" : "fetched", checkedAt: now, totalCount: 12, omittedCount: 2,
    candidates: Array.from({ length: 10 }, (_, j) => ({ id: `${i}-${j}`, title: "合成新闻", url: "https://example.test/story", publishedAt: now, summary: "摘要" })) }));
  const output = newsDiscoveryContext({ schema: "domi.news-discovery.v1", sources });
  const payload = JSON.parse(output.split("\n")[1]);
  assert.ok(payload.sources.every(s => s.candidates.length <= 5));
  assert.ok(payload.sources.reduce((n, s) => n + s.candidates.length, 0) <= 40);
  assert.equal(payload.sources[11].status, "failed");
  assert.equal(payload.sources[11].omittedCount, 12);
  assert.match(output, /必须打开原文/);
  assert.match(output, /不得用程序候选替代/);
});
