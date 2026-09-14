const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { readPlaudWorkflowCompletion } = require("../electron/plaud-workflow-completion.cjs");

function fixture(t, stage = "context_pending") {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-completion-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const fileId = "synthetic-recording";
  const stateFile = path.join(directory, "state.json");
  const transcriptPath = path.join(directory, "transcript.md");
  const notesPath = path.join(directory, "notes.md");
  fs.writeFileSync(transcriptPath, "Synthetic discussion transcript.");
  fs.writeFileSync(notesPath, "Synthetic reviewed notes.");
  const record = { fileId, stage, transcriptPath, notesPath, updatedAt: "2026-01-01T00:00:00Z" };
  const state = { version: 1, records: { [fileId]: record } };
  const write = () => fs.writeFileSync(stateFile, JSON.stringify(state));
  write();
  const before = fs.readFileSync(stateFile);
  const verifyNotes = async id => ({ ok: true, fileId: id, stage: "notes_non_project", checks: { notesAudit: "passed" } });
  return { directory, fileId, stateFile, record, state, write, before, verifyNotes };
}

test("context questions are waiting for input without requiring an entity or invoking a verifier", async t => {
  const f = fixture(t);
  const result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: () => { throw new Error("must not run"); } });
  assert.deepEqual(result, { ok: true, fileId: f.fileId, stage: "context_pending", outcome: "waiting-input" });
  assert.ok(fs.readFileSync(f.stateFile).equals(f.before), "classification must never mutate the queue");
});

test("non-project completion requires the exact file's passed local notes quality verification", async t => {
  const f = fixture(t, "notes_non_project");
  const calls = [];
  const result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: async id => {
    calls.push(id); return f.verifyNotes(id);
  } });
  assert.deepEqual(calls, [f.fileId]);
  assert.deepEqual(result, { ok: true, fileId: f.fileId, stage: "notes_non_project", outcome: "completed" });
  assert.ok(fs.readFileSync(f.stateFile).equals(f.before));
});

test("project, in-progress and unknown stages keep the existing entity receipt guard", async t => {
  const f = fixture(t);
  for (const stage of ["context_ready", "notes_project", "reviewed", "documented", "managed", "discussion_complete", "failed", "future_stage", ""]) {
    f.record.stage = stage; f.write();
    const result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: () => { throw new Error("must not run"); } });
    assert.equal(result.ok, false, stage);
    assert.equal(result.errorCode, "PLAUD_WORKFLOW_ENTITY_RECEIPT_REQUIRED", stage);
    assert.equal(result.outcome, undefined);
  }
});

test("missing, mismatched or malformed local records cannot be inferred from other recordings", async t => {
  const f = fixture(t);
  for (const fileId of ["", "../record", "unknown-record", "__proto__"]) {
    assert.equal((await readPlaudWorkflowCompletion({ ...f, fileId })).ok, false);
  }
  f.record.fileId = "another-record"; f.write();
  assert.equal((await readPlaudWorkflowCompletion(f)).errorCode, "PLAUD_WORKFLOW_RECORD_MISSING");
  fs.writeFileSync(f.stateFile, "not json");
  assert.equal((await readPlaudWorkflowCompletion(f)).errorCode, "PLAUD_WORKFLOW_STATE_UNAVAILABLE");
});

test("missing or empty local artifacts never release the guard", async t => {
  const f = fixture(t);
  fs.writeFileSync(f.record.transcriptPath, "");
  assert.equal((await readPlaudWorkflowCompletion(f)).errorCode, "PLAUD_WORKFLOW_TRANSCRIPT_MISSING");
  fs.writeFileSync(f.record.transcriptPath, "Transcript");
  f.record.stage = "notes_non_project"; f.write();
  fs.rmSync(f.record.notesPath);
  assert.equal((await readPlaudWorkflowCompletion(f)).errorCode, "PLAUD_WORKFLOW_NOTES_UNVERIFIED");
});

test("legacy, failed, foreign, or wrong-stage verification cannot certify non-project completion", async t => {
  const f = fixture(t, "notes_non_project");
  const valid = await f.verifyNotes(f.fileId);
  for (const verification of [
    { ...valid, ok: false }, { ...valid, ok: "true" }, { ...valid, fileId: "another-record" },
    { ...valid, stage: "notes_project" }, { ...valid, checks: { notesAudit: "legacy-unverified" } },
    { ...valid, checks: {} }, {}, null
  ]) {
    const result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: async () => verification });
    assert.equal(result.ok, false);
    assert.equal(result.errorCode, "PLAUD_WORKFLOW_NOTES_UNVERIFIED");
  }
  const result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: async () => { throw new Error("private verifier detail"); } });
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /private verifier detail/);
});

test("a target record changing during verification is rejected while unrelated progress is allowed", async t => {
  const f = fixture(t, "notes_non_project");
  let result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: async id => {
    f.state.records.unrelated = { fileId: "unrelated", stage: "managed" }; f.write();
    return f.verifyNotes(id);
  } });
  assert.equal(result.ok, true);
  result = await readPlaudWorkflowCompletion({ ...f, verifyNotes: async id => {
    f.record.stage = "notes_project"; f.write();
    return f.verifyNotes(id);
  } });
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, "PLAUD_WORKFLOW_STATE_CHANGED");
});
