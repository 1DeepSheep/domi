const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

function containedPath(file, roots) {
  if (!file || !path.isAbsolute(file)) throw new Error("缺少绝对产物路径。");
  const resolved = fs.realpathSync(file);
  if (!roots.some((root) => {
    const realRoot = fs.realpathSync(root);
    const relative = path.relative(realRoot, resolved);
    return !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
  })) throw new Error("产物不属于当前资料库或当前处理队列。");
  const stat = fs.statSync(resolved);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 256 * 1024 * 1024) throw new Error("产物为空或超过核验大小限制。");
  return { path: resolved, bytes: stat.size };
}

async function fileHash(file) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

async function verifyNotesCheckpoint({ notesPath, qaReceiptPath, roots, workflowRunId, transcriptPath }) {
  const notes = containedPath(notesPath, roots);
  const qa = readJson(qaReceiptPath, roots);
  const notesSha256 = await fileHash(notes.path);
  const required = ["transcript_traceability", "entity_verification", "number_audit", "completeness", "attribution", "markdown_rendering"];
  const optional = ["source_manifest", "education", "career_model_work", "material_verification", "pending_items"];
  if (qa.schema !== "asr.qa-receipt.v1" || qa.workflowRunId !== workflowRunId
    || qa.overall !== "passed" || !required.every((key) => qa.checks?.[key] === "passed")
    || !optional.every((key) => ["passed", "not_applicable"].includes(qa.checks?.[key]))
    || qa.materialConflicts?.length || qa.notes?.sha256 !== notesSha256
    || containedPath(qa.notes?.path, roots).path !== notes.path) {
    throw new Error("纪要检查回执未通过或对应旧版本。");
  }
  const evidenceFile = containedPath(qa.evidenceIndex?.path, roots);
  if (await fileHash(evidenceFile.path) !== qa.evidenceIndex?.sha256) throw new Error("纪要证据索引已变化。");
  const evidence = readJson(evidenceFile.path, roots);
  if (evidence.schema !== "asr.evidence-index.v1" || evidence.workflowRunId !== workflowRunId
    || !Array.isArray(evidence.claims) || !evidence.claims.length
    || containedPath(evidence.transcript?.path, roots).path !== containedPath(transcriptPath, roots).path
    || await fileHash(transcriptPath) !== evidence.transcript?.sha256) {
    throw new Error("纪要证据索引与当前文字稿不一致。");
  }
  if (!Array.isArray(evidence.sources) || !evidence.sources.length || evidence.sources.length > 256) throw new Error("纪要证据来源清单缺失。");
  const sourceIds = new Set();
  let sourceBytes = 0;
  for (const source of evidence.sources) {
    const file = containedPath(source.path, roots);
    sourceBytes += file.bytes;
    if (!source.sourceId || sourceIds.has(source.sourceId) || sourceBytes > 256 * 1024 * 1024
      || await fileHash(file.path) !== source.sha256) throw new Error("纪要证据来源已变化或清单不完整。");
    sourceIds.add(source.sourceId);
  }
  if (evidence.claims.some((claim) => !claim.statement || !Array.isArray(claim.sourceRefs) || !claim.sourceRefs.length
    || claim.sourceRefs.some((ref) => !sourceIds.has(ref.sourceId) || !ref.locator && !Array.isArray(ref.lines)))) {
    throw new Error("纪要判断缺少真实来源定位。");
  }
  return { notesPath: notes.path, notesSha256, qaReceiptPath: fs.realpathSync(qaReceiptPath) };
}

function readJson(file, roots) {
  const verified = containedPath(file, roots);
  if (verified.bytes > 2 * 1024 * 1024) throw new Error("回执过大。");
  return JSON.parse(fs.readFileSync(verified.path, "utf8"));
}

async function verifyStorageReceipt({ receiptPath, roots, databasePath, canonicalDocumentId, workflowRunId, runId, transcriptPath }) {
  const receipt = readJson(receiptPath, roots);
  const verifiedTime = typeof receipt.verifiedAt === "number" ? receipt.verifiedAt : Date.parse(receipt.verifiedAt);
  if (receipt.schema !== "domi.storage-receipt.v1" || receipt.backend !== "local"
    || receipt.status !== "managed" || receipt.recordVerified !== true
    || receipt.documentVerified !== true || receipt.filesVerified !== true
    || !Number.isFinite(verifiedTime) || verifiedTime <= 0
    || workflowRunId && receipt.workflowRunId !== workflowRunId
    || runId && receipt.executionRunId !== runId
    || receipt.canonicalDocumentId !== canonicalDocumentId) {
    throw new Error("归档回执与当前任务、后端或规范文档不匹配。");
  }
  if (!Array.isArray(receipt.artifacts) || !receipt.artifacts.length || receipt.artifacts.length > 256) {
    throw new Error("归档回执缺少完整产物清单。");
  }
  const document = containedPath(receipt.documentPath, roots);
  let documentCovered = false;
  for (const artifact of receipt.artifacts) {
    const actual = containedPath(artifact.path, roots);
    if (!/^[a-f0-9]{64}$/.test(artifact.sha256) || await fileHash(actual.path) !== artifact.sha256
      || artifact.bytes !== undefined && Number(artifact.bytes) !== actual.bytes) {
      throw new Error(`归档产物已变化，需重新核验：${path.basename(actual.path)}`);
    }
    if (actual.path === document.path) documentCovered = true;
  }
  if (!documentCovered) throw new Error("规范文档没有对应的内容哈希。");
  const entityField = { project: "projectId", person: "personId", industry: "industryId" }[receipt.entityType];
  if (!entityField || !receipt[entityField]) throw new Error("归档回执缺少明确的实体类型和 ID。");
  if (canonicalDocumentId.startsWith("podcast:")) {
    const quality = receipt.quality;
    if (quality?.schema !== "domi.podcast-quality.v1") throw new Error("归档回执缺少纪要质量核验绑定。");
    for (const artifact of [quality.qaReceipt, quality.evidenceIndex, quality.notes, quality.transcript]) {
      const actual = containedPath(artifact?.path, roots);
      if (await fileHash(actual.path) !== artifact?.sha256) throw new Error("归档质量产物已变化。");
    }
    const qa = readJson(quality.qaReceipt.path, roots);
    if (qa.evidenceIndex?.sha256 !== quality.evidenceIndex.sha256
      || containedPath(qa.evidenceIndex?.path, roots).path !== containedPath(quality.evidenceIndex.path, roots).path) {
      throw new Error("归档质量回执与证据索引不一致。");
    }
    const checked = await verifyNotesCheckpoint({ notesPath: quality.notes.path, qaReceiptPath: quality.qaReceipt.path,
      roots, workflowRunId: receipt.workflowRunId, transcriptPath: transcriptPath || quality.transcript.path });
    if (checked.notesSha256 !== await fileHash(document.path)) throw new Error("归档文档不是已通过审核的完整纪要。");
  }
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const rows = db.prepare("SELECT id, owner_type, owner_id, path FROM documents WHERE id = ?").all(canonicalDocumentId);
    if (rows.length !== 1 || fs.realpathSync(rows[0].path) !== document.path) throw new Error("规范文档索引未唯一对应实际归档文件。");
    const entityId = receipt[entityField];
    if (rows[0].owner_type !== receipt.entityType || String(rows[0].owner_id) !== String(entityId)) throw new Error("归档文档与目标实体不一致。");
    if (["project", "person"].includes(rows[0].owner_type)) {
      const table = rows[0].owner_type === "project" ? "projects" : "people";
      const entity = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(rows[0].owner_id);
      if (!entity || !entity.document_path) throw new Error("归档对应的实体记录或主页缺失。");
      containedPath(entity.document_path, roots);
      if (receipt.recordRevision !== undefined && Number(entity.revision) !== Number(receipt.recordRevision)) {
        throw new Error("归档后记录版本已变化，需重新回读。");
      }
    }
  } finally {
    db.close();
  }
  return { receipt, receiptPath: fs.realpathSync(receiptPath), receiptSha256: await fileHash(receiptPath), documentPath: document.path };
}

function normalizeArchive(value) {
  if (!value || typeof value !== "object") return undefined;
  const status = ["pending", "running", "notes_ready", "archived", "failed"].includes(value.status) ? value.status : "pending";
  return {
    status, stage: ["transcript_ready", "notes_ready", "archived"].includes(value.stage) ? value.stage : "transcript_ready",
    runId: String(value.runId || ""), ownerSession: String(value.ownerSession || ""),
    claimedAt: Number(value.claimedAt) || 0, attempt: Number(value.attempt) || 0,
    nextRetryAt: Number(value.nextRetryAt) || 0, verifiedAt: Number(value.verifiedAt) || 0,
    manifestPath: String(value.manifestPath || ""), notesPath: String(value.notesPath || ""),
    notesSha256: String(value.notesSha256 || ""), qaReceiptPath: String(value.qaReceiptPath || ""),
    archiveReceiptPath: String(value.archiveReceiptPath || ""), error: String(value.error || "").slice(0, 1000)
  };
}

class PodcastProgress {
  constructor({ service, configProvider, transcriptRoot, now = Date.now }) {
    this.service = service;
    this.configProvider = configProvider;
    this.transcriptRoot = transcriptRoot;
    this.now = now;
    this.ownerSession = crypto.randomUUID();
    this.queues = new Map();
  }

  update(request, options = {}) {
    const id = String(request.jobId || "");
    const previous = this.queues.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.updateOnce(request, options));
    this.queues.set(id, next);
    next.finally(() => { if (this.queues.get(id) === next) this.queues.delete(id); }).catch(() => {});
    return next;
  }

  async updateOnce(request, { activeRunIds = new Set() } = {}) {
    const settings = this.configProvider();
    if (settings.storageBackend !== "local") return { ok: false, unsupported: true, error: "旧飞书主库继续使用原归档验证流程。" };
    const job = this.service.getJob(request.jobId);
    const source = this.service.loadSources().sources.find((item) => item.id === job.sourceId);
    if (!source) throw new Error("播客来源已移除。");
    const now = this.now();
    const runId = String(request.runId || "");
    if (!runId || runId.length > 160) throw new Error("缺少有效的处理任务 ID。");
    const workflowDir = path.join(this.service.cacheDir, "archive", job.id);
    fs.mkdirSync(workflowDir, { recursive: true, mode: 0o700 });
    const roots = [settings.localRepositoryDir, workflowDir, this.transcriptRoot].filter((root) => root && fs.existsSync(root));
    const previous = normalizeArchive(job.archive) || normalizeArchive({});
    const canonicalDocumentId = `podcast:${job.sourceFormat || "public"}:${job.id}`;
    const verify = (receiptPath, expectedRunId) => verifyStorageReceipt({ receiptPath, roots,
      databasePath: settings.localDatabasePath, canonicalDocumentId, workflowRunId: `podcast:${job.id}`, runId: expectedRunId, transcriptPath: job.transcriptPath });
    const save = (archive) => ({ ok: true, job: this.service.updateJob(job.id, { archive }).job });
    if (request.action === "claim") {
      if (previous.status === "archived" && previous.archiveReceiptPath) {
        try {
          await verify(previous.archiveReceiptPath);
          return { ok: true, claimed: false, verified: true, job };
        } catch { /* Reconcile changed/missing artifacts in the next run. */ }
      }
      if (previous.status === "running" && previous.runId === runId) return { ok: true, claimed: true, job };
      if (previous.status === "running" && previous.runId !== runId
        && (activeRunIds.has(previous.runId)
          || previous.ownerSession === this.ownerSession && now - previous.claimedAt < 30000)) {
        return { ok: true, claimed: false, job };
      }
      if (!job.transcriptPath || !fs.existsSync(job.transcriptPath)) throw new Error("文字稿尚未就绪，不能开始整理。");
      let stage = previous.stage === "notes_ready" ? "notes_ready" : "transcript_ready";
      if (stage === "notes_ready") {
        try {
          const checked = await verifyNotesCheckpoint({ ...previous, roots,
            workflowRunId: `podcast:${job.id}`, transcriptPath: job.transcriptPath });
          if (checked.notesSha256 !== previous.notesSha256) stage = "transcript_ready";
        } catch { stage = "transcript_ready"; }
      }
      return { ...save({ ...previous, status: "running", stage, runId, ownerSession: this.ownerSession,
        claimedAt: now, attempt: previous.attempt + 1, nextRetryAt: 0, error: "",
        notesPath: stage === "notes_ready" ? previous.notesPath : "",
        notesSha256: stage === "notes_ready" ? previous.notesSha256 : "",
        qaReceiptPath: stage === "notes_ready" ? previous.qaReceiptPath : "",
        manifestPath: path.join(workflowDir, "manifest.json") }), claimed: true };
    }
    if (previous.runId !== runId || previous.status === "archived") throw new Error("迟到的处理结果不能覆盖当前归档进度。");
    if (request.action === "fail") {
      return save({ ...previous, status: "failed", error: String(request.error || "处理未完成"),
        nextRetryAt: now + Math.min(5 * 60000, 30000 * 2 ** Math.min(previous.attempt, 4)) });
    }
    if (request.action === "checkpoint") {
      const checked = await verifyNotesCheckpoint({ ...request, roots,
        workflowRunId: `podcast:${job.id}`, transcriptPath: job.transcriptPath });
      return { ...save({ ...previous, stage: "notes_ready", ...checked }), verified: true };
    }
    if (request.action === "complete") {
      const receiptPath = request.receiptPath || path.join(workflowDir, "archive-receipt.json");
      const verified = await verify(receiptPath, runId);
      return { ...save({ ...previous, status: "archived", stage: "archived", verifiedAt: now,
        archiveReceiptPath: verified.receiptPath, error: "", nextRetryAt: 0 }), verified: true };
    }
    throw new Error("不支持的播客进度操作。");
  }
}

module.exports = { PodcastProgress, containedPath, fileHash, normalizeArchive, verifyStorageReceipt, verifyNotesCheckpoint };
