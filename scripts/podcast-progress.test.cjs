const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { PodcastProgress, fileHash, verifyStorageReceipt } = require("../electron/podcast-progress.cjs");

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-progress-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, data) => { const file = path.join(root, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof data === "string" ? data : JSON.stringify(data)); return file; };
  const transcriptPath = write("transcript.md", "公司本季度收入为 100 万元。\n来源访谈。\n");
  const notesPath = write("library/notes.md", "# 访谈纪要\n公司本季度收入为 100 万元。\n");
  const hash = async (file) => ({ path: file, sha256: await fileHash(file), bytes: fs.statSync(file).size });
  const workflowRunId = "podcast:job-1";
  const indexPath = write("evidence.json", { schema: "asr.evidence-index.v1", workflowRunId, transcript: await hash(transcriptPath), sources: [{ sourceId: "asr", role: "transcript", ...await hash(transcriptPath) }], claims: [{ claimId: "c1", statement: "季度收入 100 万元", sourceRefs: [{ sourceId: "asr", lines: [1, 1] }] }] });
  const checks = Object.fromEntries(["source_manifest", "transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "education", "career_model_work", "material_verification", "pending_items", "markdown_rendering"].map((key) => [key, "passed"]));
  const qa = { schema: "asr.qa-receipt.v1", workflowRunId, notes: await hash(notesPath), evidenceIndex: await hash(indexPath), overall: "passed", checks, materialConflicts: [] };
  const qaReceiptPath = write("qa.json", qa);
  let job = { id: "job-1", sourceId: "source-1", sourceFormat: "rss", transcriptPath, status: "transcript_ready" };
  const service = { cacheDir: root, getJob: () => structuredClone(job), loadSources: () => ({ sources: [{ id: "source-1" }] }), updateJob: (_, patch) => ({ job: (job = { ...job, ...patch }) }) };
  const databasePath = path.join(root, "repository.sqlite");
  const db = new DatabaseSync(databasePath);
  db.exec("CREATE TABLE documents(id TEXT, owner_type TEXT, owner_id TEXT, path TEXT); CREATE TABLE projects(id TEXT, document_path TEXT, revision INTEGER); CREATE TABLE people(id TEXT, document_path TEXT, revision INTEGER)");
  db.prepare("INSERT INTO documents VALUES(?,?,?,?)").run("podcast:rss:job-1", "industry", "industry-1", notesPath); db.close();
  let now = 100000;
  const options = { service, transcriptRoot: root, now: () => now, configProvider: () => ({ storageBackend: "local", localRepositoryDir: root, localDatabasePath: databasePath }) };
  const progress = new PodcastProgress(options);
  const receipt = { schema: "domi.storage-receipt.v1", workflowRunId, executionRunId: "run-1", canonicalDocumentId: "podcast:rss:job-1", backend: "local", entityType: "industry", industryId: "industry-1", documentPath: notesPath, artifacts: [{ role: "notes", ...await hash(notesPath) }], verifiedAt: "2026-09-07T00:00:00Z", status: "managed", recordVerified: true, documentVerified: true, filesVerified: true };
  receipt.quality = { schema: "domi.podcast-quality.v1", notes: await hash(notesPath), transcript: await hash(transcriptPath), qaReceipt: await hash(qaReceiptPath), evidenceIndex: await hash(indexPath) };
  const receiptPath = write("archive/job-1/archive-receipt.json", receipt);
  return { root, write, hash, progress, options, service, notesPath, qaReceiptPath, qa, transcriptPath, receipt, receiptPath, databasePath, tick: (ms) => { now += ms; } };
}

test("concurrent claims serialize; live runs remain owned across restart", async (t) => {
  const f = await fixture(t);
  const results = await Promise.all(["run-1", "run-2"].map((runId) => f.progress.update({ action: "claim", jobId: "job-1", runId })));
  assert.deepEqual(results.map((r) => r.claimed), [true, false]);
  assert.equal((await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-1" })).job.archive.attempt, 1);
  f.tick(60000);
  const restarted = new PodcastProgress(f.options);
  assert.equal((await restarted.update({ action: "claim", jobId: "job-1", runId: "run-2" }, { activeRunIds: new Set(["run-1"]) })).claimed, false);
  assert.equal((await restarted.update({ action: "claim", jobId: "job-1", runId: "run-2" })).claimed, true);
  await assert.rejects(f.progress.update({ action: "fail", jobId: "job-1", runId: "run-1" }), /迟到/);
});

test("notes resume after archive failure only while QA, evidence and transcript still match", async (t) => {
  const f = await fixture(t);
  await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-1" });
  await f.progress.update({ action: "checkpoint", jobId: "job-1", runId: "run-1", notesPath: f.notesPath, qaReceiptPath: f.qaReceiptPath });
  await f.progress.update({ action: "fail", jobId: "job-1", runId: "run-1", error: "temporary archive failure" });
  const retry = await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-2" });
  assert.equal(retry.job.archive.stage, "notes_ready");
  await f.progress.update({ action: "fail", jobId: "job-1", runId: "run-2" });
  fs.appendFileSync(f.transcriptPath, "更正：收入是 200 万元。\n");
  const changed = await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-3" });
  assert.equal(changed.job.archive.stage, "transcript_ready");
  assert.equal(changed.job.archive.notesPath, "");
});

test("blocked semantic QA cannot become a reusable checkpoint", async (t) => {
  const f = await fixture(t);
  await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-1" });
  f.write("qa.json", { ...f.qa, checks: { ...f.qa.checks, completeness: "blocked" } });
  await assert.rejects(f.progress.update({ action: "checkpoint", jobId: "job-1", runId: "run-1", notesPath: f.notesPath, qaReceiptPath: f.qaReceiptPath }), /未通过/);
  assert.equal(f.service.getJob().archive.stage, "transcript_ready");
});

test("completion uses only the job receipt, verifies database and every file, and is idempotent", async (t) => {
  const f = await fixture(t);
  await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-1" });
  const done = await f.progress.update({ action: "complete", jobId: "job-1", runId: "run-1" });
  assert.equal(done.verified, true);
  assert.equal(done.job.archive.status, "archived");
  const duplicate = await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-2" });
  assert.equal(duplicate.claimed, false);
  assert.equal(duplicate.verified, true);
  fs.appendFileSync(f.notesPath, "修改内容\n");
  const invalidated = await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-2" });
  assert.equal(invalidated.claimed, true);
  await assert.rejects(f.progress.update({ action: "complete", jobId: "job-1", runId: "run-2" }), /不匹配/);
});

test("receipts reject wrong owner, missing index, changed artifacts and escaped symlinks", async (t) => {
  const f = await fixture(t);
  const verify = () => verifyStorageReceipt({ receiptPath: f.receiptPath, roots: [f.root], databasePath: f.databasePath, canonicalDocumentId: "podcast:rss:job-1", workflowRunId: "podcast:job-1", runId: "run-1" });
  f.write("archive/job-1/archive-receipt.json", { ...f.receipt, industryId: "wrong" });
  await assert.rejects(verify(), /实体不一致/);
  f.write("archive/job-1/archive-receipt.json", f.receipt);
  fs.appendFileSync(f.notesPath, "changed");
  await assert.rejects(verify(), /已变化/);
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "domi-outside-")); t.after(() => fs.rmSync(outside, { force: true, recursive: true }));
  fs.writeFileSync(path.join(outside, "note.md"), "outside");
  fs.unlinkSync(f.notesPath); fs.symlinkSync(path.join(outside, "note.md"), f.notesPath);
  await assert.rejects(verify(), /不属于/);
});

test("completion cannot bypass absent or blocked semantic QA even without progress markers", async (t) => {
  const f = await fixture(t);
  await f.progress.update({ action: "claim", jobId: "job-1", runId: "run-1" });
  f.write("archive/job-1/archive-receipt.json", { ...f.receipt, quality: undefined });
  await assert.rejects(f.progress.update({ action: "complete", jobId: "job-1", runId: "run-1" }), /质量核验/);
  f.write("qa.json", { ...f.qa, overall: "blocked" });
  f.write("archive/job-1/archive-receipt.json", { ...f.receipt, quality: { ...f.receipt.quality, qaReceipt: await f.hash(f.qaReceiptPath) } });
  await assert.rejects(f.progress.update({ action: "complete", jobId: "job-1", runId: "run-1" }), /未通过/);
  assert.equal(f.service.getJob().archive.status, "running");
});

test("legacy backends explicitly preserve the existing workflow", async (t) => {
  const f = await fixture(t);
  const legacy = new PodcastProgress({ ...f.options, configProvider: () => ({ storageBackend: "legacy_feishu_primary" }) });
  assert.equal((await legacy.update({ action: "claim", jobId: "job-1", runId: "run-1" })).unsupported, true);
  assert.equal(f.service.getJob().archive, undefined);
});
