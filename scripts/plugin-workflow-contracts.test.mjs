import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canSkipTodoSync, TODO_RULE_VERSION, todoInputFingerprint, verifiedTodoReceipt } from "../src/todo-sync-policy.ts";
import { podcastWorkflowContract } from "../src/podcast-progress.ts";
import { todoRunContract } from "../src/workflows.ts";

// Explicit cross-checkout contract test. Every document/database is synthetic;
// plugin CLI commands here never load user configuration or start a model task.
const require = createRequire(import.meta.url);
const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(process.env.DOMI_PLUGIN_CONTRACT_ROOT || path.join(clientRoot, "../domi-plugin"));
const todoScript = path.join(pluginRoot, "skills/todo/scripts/todo-ledger.js");
const workflowScript = path.join(pluginRoot, "scripts/domi-workflow.cjs");
const pluginTodo = require(todoScript);
const { parseTaskLedger, resolveWeeklyNewsTimestamps } = require("../electron/domi-integration.cjs");
const { localTaskReceipt } = require("../electron/task-receipt.cjs");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");
const cli = (script, args, input) => JSON.parse(execFileSync(process.execPath, [script, ...args], {
  input: input === undefined ? undefined : JSON.stringify(input), encoding: "utf8", timeout: 15_000
}));
const temporary = (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-workflow-contract-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
};

test("client hash and purposeKey survive real Todo local-read/local-merge/recovery CLI", (t) => {
  const root = temporary(t);
  const document = path.join(root, "0.待办事项.md");
  const now = "2026-09-08T02:00:00.000Z";
  const ledger = pluginTodo.normalizeLedger({ updatedAt: now, tasks: [{
    id: "synthetic-task", title: "核验合成项目进展", category: "project-follow-up", status: "open", priority: "P2",
    signalKey: "synthetic-followup", purposeKey: "financing-progress", reason: "合成证据",
    source: { kind: "project", recordId: "synthetic-project", displayName: "合成项目" },
    suggestedAction: { kind: "contact", label: "联系", prompt: "仅使用合成数据" }, createdAt: now, updatedAt: now
  }] }, now);
  fs.writeFileSync(document, `# 合成待办\n\n${pluginTodo.renderLedger(ledger)}\n`);
  const contents = fs.readFileSync(document, "utf8");
  const clientLedger = parseTaskLedger(contents).ledger;
  assert.deepEqual(clientLedger, ledger);
  const baseline = localTaskReceipt(document, contents, clientLedger);
  const read = cli(todoScript, ["local-read", document]);
  assert.equal(baseline.ledgerSha256, read.ledgerSha256);
  const merged = cli(todoScript, ["local-merge", document], {
    schema: "domi.todo-merge.v1", runId: "contract-run", now,
    expectedLedgerHash: baseline.ledgerSha256, candidates: []
  });
  const nextContents = fs.readFileSync(document, "utf8");
  const nextLedger = parseTaskLedger(nextContents).ledger;
  const board = { ok: true, configured: true, stale: false, tasks: nextLedger.tasks,
    ...localTaskReceipt(document, nextContents, nextLedger) };
  assert.equal(board.tasks[0].purposeKey, "financing-progress");
  assert.equal(verifiedTodoReceipt(merged.receipt, "contract-run", board), true);
  assert.deepEqual(board.syncReceipt, merged.receipt);
  assert.deepEqual(cli(todoScript, ["local-read", document, "--run-id", "contract-run"]).receipt, merged.receipt);
  assert.notEqual(spawnSync(process.execPath, [todoScript, "local-read", document, "--run-id", "unrelated-run"]).status, 0);
  fs.appendFileSync(document, "\n用户的合成编辑\n");
  assert.notEqual(spawnSync(process.execPath, [todoScript, "local-read", document, "--run-id", "contract-run"]).status, 0);
  assert.match(todoRunContract("contract-run", baseline.ledgerSha256), /now.*ISO/);
  assert.match(todoRunContract("contract-run"), /\{task,review\}/);
});

test("real local reindex and refresh clocks keep unchanged Todo fingerprint eligible", async (t) => {
  const root = temporary(t);
  const libraryDir = path.join(root, "library");
  const projectDir = path.join(libraryDir, "3.项目库", "AI", "Agent", "合成芯片");
  const personDir = path.join(libraryDir, "4.人脉库", "合成人物");
  fs.mkdirSync(projectDir, { recursive: true }); fs.mkdirSync(personDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, "项目主页.md"), `---\nentity_type: "project"\nproject_id: "synthetic-project"\ncompany_name: "合成芯片"\ndomain: "AI"\nsubdomains: ["Agent"]\n---\n# 合成芯片\n`);
  fs.writeFileSync(path.join(personDir, "人物主页.md"), `---\nentity_type: "person"\nperson_id: "synthetic-person"\nname: "合成人物"\norganization: "合成公司"\n---\n# 合成人物\n`);
  const repository = new LocalDomiRepository({ databasePath: path.join(root, "test.sqlite"), libraryDir });
  try {
    repository.reindexWorkspace();
    const first = { projects: repository.listProjects(), people: repository.listPeople(), syncedAt: 100 };
    assert.equal(first.projects.length, 1); assert.equal(first.people.length, 1);
    const secondIndex = repository.reindexWorkspace();
    const second = { projects: repository.listProjects(), people: repository.listPeople(), syncedAt: 200 };
    assert.equal(secondIndex.unchanged, true);
    const newsTimes = resolveWeeklyNewsTimestamps(null, []);
    const laterNewsTimes = resolveWeeklyNewsTimestamps({ ...newsTimes, items: [] }, []);
    assert.equal(laterNewsTimes.contentUpdatedAt, newsTimes.contentUpdatedAt);
    const board = { ok: true, configured: true, stale: false, tasks: [], documentSha256: "a".repeat(64), syncedAt: 100 };
    const news = { ok: true, ...newsTimes };
    const firstHash = await todoInputFingerprint(first, board, news, libraryDir);
    const laterBoard = { ...board, syncedAt: 200 };
    const laterNews = { ok: true, ...laterNewsTimes };
    const nextHash = await todoInputFingerprint(second, laterBoard, laterNews, libraryDir);
    assert.equal(nextHash, firstHash);
    const now = Date.now();
    assert.equal(canSkipTodoSync({ fingerprint: firstHash, ruleVersion: TODO_RULE_VERSION, repositoryIdentity: libraryDir,
      verifiedAt: now - 1, nextEvaluationAt: now + 10_000, ledgerFingerprint: board.documentSha256 }, {
      fingerprint: nextHash, repositoryIdentity: libraryDir, now, snapshotFresh: true, board: laterBoard, news: laterNews
    }), true);
  } finally { repository.close(); }
});

test("podcast contract fixed paths and execution IDs match actual save/inspect/rebind CLI", (t) => {
  const root = temporary(t);
  const transcriptPath = path.join(root, "transcript.md");
  const manifestPath = path.join(root, "archive", "job-one", "manifest.json");
  fs.writeFileSync(transcriptPath, "# 合成文字稿\n仅用于接口测试。\n");
  const transcript = cli(workflowScript, ["artifact", "--role", "transcript", "--path", transcriptPath]);
  const saveInput = path.join(root, "save-input.json");
  const manifest = { schema: "domi.handoff.v1", workflowRunId: "podcast:job-one", executionRunId: "execution-one",
    workflow: "podcast-ingestion", mode: "podcast", currentStage: "notes", nextStage: "archive", completedStages: [],
    entity: { type: "industry", fingerprint: "synthetic-entity" }, repository: { backend: "local" },
    authorization: { sourceTurnId: "synthetic-turn", internalWrite: true, externalWrite: false, externalTargets: [] },
    stagePlan: [{ name: "notes", skill: "asr-notes", requiredRoles: ["transcript", "notes", "evidence_index"] },
      { name: "archive", skill: "investment-mgmt", requiredRoles: ["notes"] }],
    artifacts: [{ ...transcript, stage: "notes" }] };
  fs.writeFileSync(saveInput, JSON.stringify({ expectedHash: null, manifest }));
  assert.equal(cli(workflowScript, ["save", "--manifest", manifestPath, "--input", saveInput]).ok, true);
  const inspected = cli(workflowScript, ["inspect", "--manifest", manifestPath]);
  const rebound = cli(workflowScript, ["rebind", "--manifest", manifestPath, "--execution-run-id", "execution-two",
    "--expected-hash", inspected.manifestSha256]);
  assert.equal(rebound.manifest.executionRunId, "execution-two");
  assert.equal(rebound.manifest.workflowRunId, "podcast:job-one");
  assert.deepEqual(rebound.manifest.artifacts, inspected.manifest.artifacts);
  const prompt = podcastWorkflowContract({ id: "job-one", archive: { manifestPath, stage: "transcript_ready" } }, "execution-two");
  assert.ok(prompt.includes(`archiveReceiptPath=${path.join(path.dirname(manifestPath), "archive-receipt.json")}`));
  assert.match(prompt, /workflow=podcast-ingestion/);
  assert.match(prompt, /finalize --manifest <workflowManifestPath> --receipt <archiveReceiptPath>/);
  assert.match(prompt, /asr\.qa-receipt\.v1/);
});
