const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { parseTaskLedger } = require("../electron/domi-integration.cjs");
const { localTaskReceipt } = require("../electron/task-receipt.cjs");
const { verifyStorageReceipt } = require("../electron/podcast-progress.cjs");

// This is deliberately a mandatory cross-repository contract suite. CI must
// supply the exact plugin checkout being shipped, never an installed profile.
assert.ok(process.env.DOMI_PLUGIN_CONTRACT_ROOT,
  "Set DOMI_PLUGIN_CONTRACT_ROOT to the plugin checkout; contract tests must not silently skip.");
const pluginRoot = path.resolve(process.env.DOMI_PLUGIN_CONTRACT_ROOT);
for (const file of ["scripts/domi-workflow.cjs", "scripts/domi-repo.cjs", "skills/todo/scripts/todo-ledger.js"]) {
  assert.ok(fs.statSync(path.join(pluginRoot, file)).isFile(), `Missing plugin contract implementation: ${file}`);
}
const { DomiRepository } = require(path.join(pluginRoot, "scripts/domi-repo.cjs"));
const { artifact, contextBundle, saveManifest } = require(path.join(pluginRoot, "scripts/domi-workflow.cjs"));
const { renderLedger } = require(path.join(pluginRoot, "skills/todo/scripts/todo-ledger.js"));
// 7.0.0 remains a supported contract target; newer plugins add source coverage
// without changing the storage receipt's owner/hash contract.
const coverageModule = path.join(pluginRoot, "scripts/notes-coverage.cjs");
const prepareNotesCoverage = fs.existsSync(coverageModule) ? require(coverageModule).prepareNotesCoverage : null;
const NOW = "2026-09-07T00:00:00.000Z";

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === "string" ? value : `${JSON.stringify(value)}\n`);
    return file;
  };
  const libraryDir = path.join(root, "library");
  const databasePath = path.join(root, "repo.sqlite");
  const configPath = write("config.json", {
    storageBackend: "local", localRepositoryDir: libraryDir, localDatabasePath: databasePath
  });
  const cli = (script, args, input, { fails = false } = {}) => {
    const result = spawnSync(process.execPath, [path.join(pluginRoot, script), ...args], {
      cwd: root, encoding: "utf8", timeout: 15000, maxBuffer: 4 * 1024 * 1024,
      // Explicit synthetic config prevents fallback to any user configuration.
      env: { PATH: process.env.PATH, DOMI_CONFIG_PATH: configPath },
      input: input === undefined ? "" : JSON.stringify(input)
    });
    assert.ifError(result.error);
    if (fails) {
      assert.notEqual(result.status, 0, "CLI unexpectedly certified a failing contract");
      return result;
    }
    assert.equal(result.status, 0, `${script} failed: ${result.stderr}`);
    return JSON.parse(result.stdout);
  };
  return { root, write, libraryDir, databasePath, cli };
}

function todoFixture(t) {
  const f = fixture(t);
  const seed = { schemaVersion: 1, updatedAt: NOW, tasks: [
    { id: "working", title: "进行中 & 项目", status: "in_progress", signalKey: "same-signal",
      category: "project-follow-up", source: { kind: "project", recordId: "p1", displayName: "虚构项目" },
      suggestedAction: { kind: "research", label: "继续", prompt: "第一步\n第二步" },
      createdAt: "2026-08-01T00:00:00Z", updatedAt: NOW },
    { id: "ignored", title: "保留冷却期", status: "ignored", ignoredAt: "2026-09-01T00:00:00Z",
      category: "relationship-follow-up", source: { kind: "person", recordId: "person1" },
      createdAt: NOW, updatedAt: NOW },
    { id: "done", title: "保留已完成", status: "done", completedAt: "2026-09-01T00:00:00Z",
      createdAt: NOW, updatedAt: NOW }
  ] };
  const document = f.write("library/0.待办事项.md", `# 虚构待办\n${renderLedger(seed)}\n用户原文 <保留>\n`);
  const read = f.cli("skills/todo/scripts/todo-ledger.js", ["local-read", document]);
  const input = { runId: "todo-contract-run", now: NOW, expectedLedgerHash: read.ledgerSha256,
    candidates: [{ task: { id: "new", title: "核验新线索", reason: "来源显示存在待核验变化", signalKey: "signal-new",
      priority: "P2", category: "project-follow-up", source: { kind: "project", recordId: "project-new" },
      suggestedAction: { kind: "research", prompt: "阅读原始资料并核验变化" } },
    review: { status: "passed", sourceRefs: ["synthetic-source:L1-L2"] } }] };
  return { ...f, document, input };
}

test("real plugin local-merge receipt and normalized ledger match client fields and hashes", t => {
  const f = todoFixture(t);
  const merged = f.cli("skills/todo/scripts/todo-ledger.js", ["local-merge", f.document], f.input);
  const readback = f.cli("skills/todo/scripts/todo-ledger.js", ["local-read", f.document, "--run-id", f.input.runId]);
  const content = fs.readFileSync(f.document, "utf8");
  const parsed = parseTaskLedger(content);
  assert.equal(parsed.found, true);
  assert.deepEqual(parsed.ledger, merged.ledger, "client and plugin normalization drifted");
  const integrity = localTaskReceipt(f.document, content, parsed.ledger);
  assert.equal(integrity.documentSha256, merged.receipt.documentSha256);
  assert.equal(integrity.ledgerSha256, merged.receipt.ledgerSha256);
  assert.deepEqual(integrity.syncReceipt, merged.receipt);
  assert.deepEqual(readback.receipt, merged.receipt);
  assert.deepEqual(parsed.ledger.tasks.map(task => task.status), ["in_progress", "ignored", "done", "open"]);
  assert.match(content, /用户原文 <保留>/);
  assert.equal(fs.existsSync(path.join(f.libraryDir, ".domi-todo-last-run.json")), true);
});

test("stale plugin merge and edited document cannot become successful client receipts", t => {
  const f = todoFixture(t);
  f.cli("skills/todo/scripts/todo-ledger.js", ["local-merge", f.document], f.input);
  const stale = f.cli("skills/todo/scripts/todo-ledger.js", ["local-merge", f.document], f.input, { fails: true });
  assert.match(stale.stderr, /changed/);
  fs.appendFileSync(f.document, "用户在运行后补充内容\n");
  const content = fs.readFileSync(f.document, "utf8"), parsed = parseTaskLedger(content);
  assert.equal(localTaskReceipt(f.document, content, parsed.ledger).syncReceipt, undefined);
  const read = f.cli("skills/todo/scripts/todo-ledger.js", ["local-read", f.document, "--run-id", f.input.runId], undefined, { fails: true });
  assert.match(read.stderr, /does not match/);
});

function podcastFixture(t, ownerType) {
  const f = fixture(t), workflowRunId = `podcast:contract-${ownerType}`, runId = `run-${ownerType}`;
  const canonicalDocumentId = `podcast:rss:contract-${ownerType}`;
  const transcript = artifact({ role: "transcript", stage: "notes", path: f.write("workflow/transcript.md", "嘉宾：公司仍在研发阶段。\n公司尚未产生收入。\n") });
  const notes = artifact({ role: "notes", stage: "notes", path: f.write("workflow/notes.md", "#### 虚构访谈纪要\n\n公司仍在研发，尚未产生收入。\n") });
  const index = { schema: "asr.evidence-index.v1", workflowRunId, notesScope: "current_session", mode: "B", transcript,
    sources: [{ ...transcript, role: "current_transcript", sourceId: "source-1" }],
    claims: [{ claimId: "claim-1", statement: "公司仍在研发，尚无收入", sourceRefs: [{ sourceId: "source-1", lines: [1, 2], quote: "尚未产生收入" }],
      ...(prepareNotesCoverage ? { notesRefs: [{ lines: [3, 3], quote: "公司仍在研发，尚未产生收入。" }] } : {}) }] };
  if (prepareNotesCoverage) {
    const coverage = prepareNotesCoverage({ workflowRunId, sources: index.sources });
    for (const source of coverage.sources) for (const segment of source.segments) segment.review = {
      status: "reviewed", reviewer: "model", claimIds: ["claim-1"], exclusions: []
    };
    index.coverage = artifact({ path: f.write("workflow/coverage.json", coverage) });
  }
  const evidence = artifact({ role: "evidence_index", stage: "notes", path: f.write("workflow/evidence.json", index) });
  const checks = Object.fromEntries(["source_manifest", "transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "education", "career_model_work", "material_verification", "pending_items", "markdown_rendering"].map(key => [key, "passed"]));
  const qa = { schema: "asr.qa-receipt.v1", workflowRunId, mode: "B", notes, evidenceIndex: evidence,
    ...(prepareNotesCoverage ? { reviewer: "model" } : {}),
    checks: { ...checks, ...(prepareNotesCoverage ? { editorial: "passed" } : {}) }, overall: "passed", materialConflicts: [], checkedAt: NOW };
  const qaReceipt = artifact({ role: "qa_receipt", stage: "notes", path: f.write("workflow/qa.json", qa) });
  const repository = new DomiRepository({ libraryDir: f.libraryDir, databasePath: f.databasePath });
  let entity, document;
  try {
    const record = ownerType === "project" ? repository.upsertProject({ name: "合成契约科技", domain: "半导体", subdomains: ["芯片设计"] }).project
      : ownerType === "person" ? repository.upsertPerson({ name: "合成人物", organization: "合成组织" }).person
        : { id: "industry-contract" };
    const input = { ownerType, ownerId: record.id, canonicalDocumentId, domain: "半导体", subdomain: "芯片设计",
      program: "合成节目", kind: "播客纪要", title: "合成单集", contentFile: notes.path };
    document = repository.createDocument(input).document;
    const duplicate = repository.createDocument({ ...input, title: "更改展示标题" }).document;
    assert.equal(duplicate.id, document.id);
    assert.equal(duplicate.path, document.path);
    assert.equal(repository.database.prepare("SELECT COUNT(*) AS n FROM documents WHERE id=?").get(canonicalDocumentId).n, 1);
    const latest = ownerType === "project" ? repository.getProject(record.id) : record;
    entity = { type: ownerType, fingerprint: `synthetic-${ownerType}`, canonicalDocumentId,
      [{ project: "projectId", person: "personId", industry: "industryId" }[ownerType]]: record.id,
      ...(ownerType === "project" ? { recordRevision: latest.recordRevision, recordHash: latest.recordHash } : {}) };
  } finally { repository.close(); }
  const manifest = { schema: "domi.handoff.v1", workflowRunId, executionRunId: runId, workflow: "podcast-ingestion", mode: "intake", entity,
    authorization: { sourceTurnId: "synthetic-authorized-turn", internalWrite: true, externalWrite: false, externalTargets: [] },
    repository: { backend: "local", lockedAt: NOW }, currentStage: "archive", nextStage: null, completedStages: ["notes"],
    artifacts: [transcript, notes, evidence, qaReceipt], archiveArtifacts: [artifact({ role: "notes", path: document.path })],
    stagePlan: [
      { name: "notes", skill: "asr-notes", requiredRoles: ["transcript", "notes", "evidence_index"], ruleBundleSha256: contextBundle({ skill: "asr-notes", workflow: "podcast-ingestion" }).bundleSha256 },
      { name: "archive", skill: "investment-mgmt", requiredRoles: ["notes"], ruleBundleSha256: contextBundle({ skill: "investment-mgmt", workflow: "podcast-ingestion" }).bundleSha256 }
    ] };
  const manifestPath = path.join(f.root, "workflow/manifest.json"), receiptPath = path.join(f.root, "workflow/archive-receipt.json");
  saveManifest(manifestPath, { expectedHash: null, manifest });
  const verify = () => verifyStorageReceipt({ receiptPath, roots: [f.root], databasePath: f.databasePath, canonicalDocumentId, workflowRunId, runId });
  return { ...f, manifestPath, receiptPath, verify, runId, workflowRunId, entity, document, qa, qaReceipt, notes, evidence, transcript };
}

for (const ownerType of ["project", "person", "industry"]) {
  test(`real plugin finalize for ${ownerType} produces a client-verifiable, owner-bound quality receipt`, async t => {
    const f = podcastFixture(t, ownerType);
    const result = f.cli("scripts/domi-workflow.cjs", ["finalize", "--manifest", f.manifestPath, "--receipt", f.receiptPath]);
    assert.equal(result.ok, true);
    const receipt = result.storageReceipt;
    assert.equal(receipt.entityType, ownerType);
    assert.equal(receipt.executionRunId, f.runId);
    assert.equal(receipt.workflowRunId, f.workflowRunId);
    assert.equal(receipt.canonicalDocumentId, f.entity.canonicalDocumentId);
    assert.equal(receipt.quality?.schema, "domi.podcast-quality.v1", "podcast completion must bind the semantic QA artifacts");
    if (prepareNotesCoverage) assert.equal(receipt.quality.qualityStatus, "verified", "new notes must satisfy source coverage and actual notes bindings");
    for (const [key, expected] of Object.entries({ qaReceipt: f.qaReceipt, evidenceIndex: f.evidence, notes: f.notes, transcript: f.transcript })) {
      assert.equal(receipt.quality[key].path, expected.path);
      assert.equal(receipt.quality[key].sha256, expected.sha256);
      assert.equal(receipt.quality[key].bytes, expected.bytes);
    }
    assert.equal((await f.verify()).documentPath, fs.realpathSync(f.document.path));
    const completed = f.cli("scripts/domi-workflow.cjs", ["inspect", "--manifest", f.manifestPath]);
    assert.equal(completed.ok, true);
    assert.deepEqual(completed.manifest.completedStages, ["notes", "archive"]);

    const ownerKey = { project: "projectId", person: "personId", industry: "industryId" }[ownerType];
    for (const bad of [{ ...receipt, [ownerKey]: undefined }, { ...receipt, [ownerKey]: "wrong-owner" },
      { ...receipt, entityType: "unknown" }, { ...receipt, quality: undefined }]) {
      f.write("workflow/archive-receipt.json", bad);
      await assert.rejects(f.verify(), "client must reject a missing owner, mismatched owner or missing QA");
    }
    // Rehashing a failed QA file cannot turn its semantic checks into a pass.
    f.write("workflow/qa.json", { ...f.qa, checks: { ...f.qa.checks, completeness: "blocked" } });
    f.write("workflow/archive-receipt.json", { ...receipt, quality: { ...receipt.quality,
      qaReceipt: artifact({ ...f.qaReceipt }) } });
    await assert.rejects(f.verify(), "client must inspect semantic QA, not just its self-reported hash");
    f.write("workflow/qa.json", f.qa);
    f.write("workflow/archive-receipt.json", receipt);
    fs.appendFileSync(f.transcript.path, "来源更正：已经产生收入。\n");
    await assert.rejects(f.verify(), "a changed transcript invalidates prior completion");
  });
}
