const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;
const MAX_RECALL_INPUT = 12_000;
const CONTEXT_LIMITS = { conversationType: 1_000, conversationPurpose: 8_000, projectName: 1_000,
  participants: 8_000, userContext: 32_768, extraContext: 32_768, rawAnswer: 65_536, sourceTurnId: 200 };
const STOP_WORDS = new Set("这个 那个 这些 那些 我们 你们 他们 现在 就是 然后 所以 因为 但是 如果 可能 其实 觉得 这个时候 一个 一些 一种 一下 这样 那样 还是 不是 没有 已经 可以 需要 时候 什么 怎么 多少 比较 也是 还有 比如 包括 对于 里面 外面 自己 目前 后面 前面 最后 第一 第二 今天 这边 那边 刚才 这里 那里 进行 通过 方面 相关 大家 您好 谢谢 嗯 好的 好 是的 speaker transcript recording the and that this with from have they there their would could about which into were been also just then because what when your some like does will very really".split(" "));

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function digest(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function text(value, maximum = 8_000) { return typeof value === "string" ? value.trim().slice(0, maximum) : ""; }
function validId(value) { return typeof value === "string" && /^[A-Za-z0-9:_-]{1,256}$/.test(value) && !["__proto__", "constructor", "prototype"].includes(value); }
function validHash(value) { return typeof value === "string" && /^[a-f0-9]{64}$/.test(value); }

function contextDraft(value = {}) {
  return Object.fromEntries(Object.entries(CONTEXT_LIMITS).map(([key, limit]) => {
    const field = key === "participants" && Array.isArray(value[key]) ? value[key].join("\n") : value[key] ?? "";
    if (typeof field !== "string" || field.length > limit || field.includes("\0")) {
      throw failure("PLAUD_CONTEXT_INPUT_INVALID", "背景字段过长或格式无效，填写内容已保留。");
    }
    return [key, field];
  }));
}

function contextForRenderer(value = {}) {
  return { ...contextDraft(value), contextStatus: ["provided", "skipped", "pending"].includes(value.contextStatus) ? value.contextStatus : "" };
}

function richRecall(value, summary, source) {
  const recall = { summary: text(summary, 4_000), source,
    keywords: Array.isArray(value?.keywords) ? value.keywords.filter(item => typeof item === "string").map(item => text(item, 32)).filter(Boolean).slice(0, 8) : [],
    excerpts: Array.isArray(value?.excerpts) ? value.excerpts.filter(item => typeof item === "string").map(item => text(item, 400)).filter(Boolean).slice(0, 3) : [] };
  if (["创业公司交流", "行业专家访谈", "投资同业交流", "内部讨论", "其他 / 不确定"].includes(value?.conversationType)) recall.conversationType = value.conversationType;
  return recall;
}

function transcriptSegments(source) {
  const segments = [];
  let frontmatter = false;
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index].trim();
    if (index === 0 && raw === "---") { frontmatter = true; continue; }
    if (frontmatter) { if (raw === "---") frontmatter = false; continue; }
    // Metadata and headings are not evidence of what was discussed.
    if (!raw || /^#{1,6}\s|^(?:文件\s*ID|file[_ ]?id|录音标题|标题|录音时间|创建时间|时长|来源|title|duration|created[_ ]?at)\s*[:：]/i.test(raw)) continue;
    const cleaned = raw.replace(/^\s*(?:[-*>]\s+)+/, "")
      .replace(/^\[?\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\]?\s*/, "")
      .replace(/^(?:Speaker\s*\d+|说话人\s*\d+)\s*[:：]?\s*/i, "").trim();
    if (cleaned.length < 12 || /^[\d\s\[\]:：,.，。!?！？-]+$/.test(cleaned)) continue;
    for (const sentence of cleaned.match(/[^。！？!?]+[。！？!?]?/g) || []) {
      const value = sentence.trim();
      if (value.length < 12 || /^(?:嗯|啊|对|好的|是的|谢谢|那个|这个|然后)[，,\s。]*$/.test(value)) continue;
      // Keep long unpunctuated ASR readable without changing its words.
      for (let offset = 0; offset < value.length; offset += 300) {
        const part = value.slice(offset, offset + 300).trim();
        if (part.length >= 12) segments.push({ text: part, line: index + 1 });
      }
    }
  }
  return segments;
}

function extractRecall(source) {
  const segments = transcriptSegments(source);
  const frequencies = new Map();
  const segmenter = new Intl.Segmenter("zh-CN", { granularity: "word" });
  for (const item of segments) {
    const seen = new Set();
    for (const token of segmenter.segment(item.text)) {
      const word = token.segment.trim();
      if (!token.isWordLike || word.length < 2 || word.length > 24
        || /^[\p{N}\p{P}\p{S}\s]+$/u.test(word) || STOP_WORDS.has(word.toLowerCase())) continue;
      seen.add(word);
    }
    for (const word of seen) frequencies.set(word, (frequencies.get(word) || 0) + 1);
  }
  const keywords = [...frequencies.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, 8).map(([word]) => word);
  const selected = [];
  const count = Math.min(3, segments.length);
  for (let bin = 0; bin < count; bin++) {
    const start = Math.floor(bin * segments.length / count);
    const end = Math.floor((bin + 1) * segments.length / count);
    const ranked = segments.slice(start, end).map(item => ({ ...item,
      score: keywords.reduce((score, word) => score + (item.text.includes(word) ? 1 : 0), 0)
        + (/\d/.test(item.text) ? 1 : 0) + Math.min(item.text.length / 100, 2)
    })).sort((a, b) => b.score - a.score);
    if (ranked[0] && !selected.some(item => item.text === ranked[0].text)) selected.push(ranked[0]);
  }
  selected.sort((a, b) => a.line - b.line);
  const excerpts = selected.map(item => item.text.length > 220 ? `${item.text.slice(0, 220)}…` : item.text);
  return { summary: excerpts.slice(0, 2).join("\n"), source: "extract", keywords, excerpts };
}

function distributedRecallSource(source, maximum = MAX_RECALL_INPUT) {
  const lines = transcriptSegments(source).map(item => item.text);
  const normalized = lines.join("\n");
  if (normalized.length <= maximum) return { sourceText: normalized, sourceTruncated: false };
  const windows = 6;
  const size = Math.floor((maximum - 240) / windows);
  const selected = [];
  for (let index = 0; index < windows; index++) {
    const start = Math.floor(index * (normalized.length - size) / (windows - 1));
    selected.push(`[原文片段 ${index + 1}/${windows}]\n${normalized.slice(start, start + size)}`);
  }
  return { sourceText: selected.join("\n\n").slice(0, maximum), sourceTruncated: true };
}

async function readBoundTranscript(transcript) {
  if (!transcript || !path.isAbsolute(String(transcript.path || "")) || !validHash(transcript.sha256)) {
    throw failure("PLAUD_CONTEXT_TRANSCRIPT_REQUIRED", "当前录音没有可核验的本地文字稿，请先同步已有文字稿。");
  }
  let data;
  try {
    const file = await fs.promises.open(transcript.path, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > MAX_TRANSCRIPT_BYTES) {
        throw failure("PLAUD_CONTEXT_TRANSCRIPT_INVALID", "当前文字稿为空或过大，无法安全准备背景。");
      }
      data = await file.readFile();
      if (data.length > MAX_TRANSCRIPT_BYTES) throw failure("PLAUD_CONTEXT_TRANSCRIPT_INVALID", "当前文字稿过大，无法安全准备背景。");
    } finally { await file.close(); }
  } catch (error) {
    if (error?.code?.startsWith("PLAUD_CONTEXT_")) throw error;
    throw failure("PLAUD_CONTEXT_TRANSCRIPT_REQUIRED", "本地文字稿暂不可读取，已保留填写内容。");
  }
  if (digest(data) !== transcript.sha256) throw failure("PLAUD_CONTEXT_TRANSCRIPT_CHANGED", "文字稿已更新，请重新载入背景确认；已保留填写内容。");
  const source = data.toString("utf8");
  if (source.includes("\0")) throw failure("PLAUD_CONTEXT_TRANSCRIPT_INVALID", "文字稿不是可读取的文本格式。");
  return source;
}

// Dedicated local command runner: no browser queue/lease, no argument containing
// meeting context, and no raw child stderr in diagnostics or user-facing errors.
function runPlaudContextCommand({ execFile, executable, script, command, fileId, payload, env }) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => { if (!settled) { settled = true; resolve(value); } };
    let child;
    try {
      child = execFile(executable, [script, command, fileId, "-"], {
        env, timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 512 * 1024,
        cwd: path.dirname(script)
      }, (error, stdout) => {
        let value;
        try { value = JSON.parse(String(stdout || "").trim()); } catch { /* Fixed safe failure below. */ }
        if (value && typeof value === "object" && typeof value.ok === "boolean") return finish(value);
        finish({ ok: false, fileId, errorCode: error?.killed ? "PLAUD_CONTEXT_TIMEOUT" : "PLAUD_CONTEXT_COMMAND_FAILED",
          error: "录音背景暂未准备好，已保留填写内容，请重试。" });
      });
      child.stdin?.on("error", () => {});
      if (!child.stdin) throw new Error("stdin unavailable");
      child.stdin.end(JSON.stringify(payload));
    } catch {
      child?.kill?.("SIGKILL");
      finish({ ok: false, fileId, errorCode: "PLAUD_CONTEXT_COMMAND_FAILED", error: "无法读取录音背景，已保留填写内容。" });
    }
  });
}

class PlaudContextService {
  constructor({ stateStore, currentScope, metadataForRecording, runCommand }) {
    this.stateStore = stateStore;
    this.currentScope = currentScope;
    this.metadataForRecording = metadataForRecording;
    this.runCommand = runCommand;
    this.pending = new Map();
    this.activeWrites = 0;
  }

  cacheKey(kind, scope, fileId, hash = "") { return `plaud:context:${kind}:v1:${digest([scope, fileId, hash].join("\0"))}`; }
  load(kind, scope, fileId, hash = "") { return this.stateStore?.loadCache?.(this.cacheKey(kind, scope, fileId, hash))?.value || null; }
  store(kind, scope, fileId, hash, value) { this.stateStore?.saveCache?.(this.cacheKey(kind, scope, fileId, hash), value); }
  assertScope(scope) {
    if (!scope || scope !== this.currentScope()) throw failure("PLAUD_CONTEXT_SCOPE_CHANGED", "录音账号或连接设置已变化，请重新打开当前录音。");
  }
  metadata(scope, fileId) {
    const item = this.metadataForRecording(scope, fileId) || this.load("owner", scope, fileId);
    if (!item || item.fileId !== fileId) throw failure("PLAUD_CONTEXT_RECORD_UNVERIFIED", "当前账号尚未确认这条录音，请刷新录音列表后重试。");
    return { fileId, fileName: text(item.fileName, 255), duration: Number(item.duration) || null, createdAt: Number(item.createdAt) || null };
  }
  async guard(request, operation, requireScope = true) {
    const fileId = request?.fileId;
    try {
      if (!validId(fileId)) throw failure("PLAUD_CONTEXT_ID_INVALID", "无法确定要处理的录音。");
      const scope = this.currentScope();
      this.assertScope(scope);
      if (requireScope || request.accountScope) this.assertScope(request.accountScope);
      const metadata = this.metadata(scope, fileId);
      const result = await operation(scope, metadata);
      this.assertScope(scope);
      return result;
    } catch (error) {
      return { ok: false, fileId: validId(fileId) ? fileId : "", errorCode: error?.code?.startsWith("PLAUD_CONTEXT_") ? error.code : "PLAUD_CONTEXT_UNAVAILABLE",
        error: error?.code?.startsWith("PLAUD_CONTEXT_") ? error.message : "录音背景暂不可用，已保留填写内容。" };
    }
  }
  singleFlight(key, operation) {
    if (this.pending.has(key)) return this.pending.get(key);
    const pending = Promise.resolve().then(operation).finally(() => { if (this.pending.get(key) === pending) this.pending.delete(key); });
    this.pending.set(key, pending);
    return pending;
  }
  async writing(operation) {
    this.activeWrites++;
    try { return await operation(); } finally { this.activeWrites--; }
  }
  async prepared(fileId, scope) {
    const result = await this.runCommand("context-prepare", fileId, { accountScope: scope });
    this.assertScope(scope);
    if (result?.ok !== true) return result;
    if (result.fileId !== fileId || (result.accountScope && result.accountScope !== scope)
      || !validHash(result.transcript?.sha256) || !text(result.recordRevision, 256)) {
      throw failure("PLAUD_CONTEXT_INVALID_RESULT", "录音背景校验结果不一致，请重新打开当前录音。");
    }
    return { ...result, accountScope: scope };
  }
  prepare(request = {}) {
    if (request.accountScope && request.accountScope !== this.currentScope()) return this.prepareScopeRecovery(request);
    return this.guard(request, (scope, metadata) => this.singleFlight(`prepare:${scope}:${request.fileId}`, async () => {
      const result = await this.prepared(request.fileId, scope);
      if (!result?.ok) return result;
      const source = await readBoundTranscript(result.transcript);
      this.assertScope(scope);
      let recall = extractRecall(source);
      const cached = this.load("recall", scope, request.fileId, result.transcript.sha256);
      const summary = text(cached?.recallSummary, 4_000) || (result.recallSummaryVerified === true ? text(result.recallSummary, 4_000) : "");
      if (summary) recall = { ...recall, ...richRecall(cached?.recall || recall, summary, "cache") };
      const draft = result.disposition === "needs_input" ? this.load("draft", scope, request.fileId, result.transcript.sha256)?.draft : null;
      this.store("owner", scope, request.fileId, "", metadata);
      return { ...result, ...metadata, context: contextForRenderer(result.context), recall, ...(draft ? { draft } : {}) };
    }), false);
  }
  verifiedRecoveryMetadata(scope, fileId) {
    // Recovery needs fresh proof from this connection's successful list, not
    // a persisted context-owner cache from an earlier session.
    const metadata = this.metadataForRecording(scope, fileId);
    if (!metadata || metadata.fileId !== fileId) throw failure("PLAUD_CONTEXT_RECORD_UNVERIFIED", "请先刷新当前账号的录音列表，再确认沿用这条录音的信息。");
    return metadata;
  }
  prepareScopeRecovery(request) {
    return this.guard({ ...request, accountScope: undefined }, async scope => {
      if (!validHash(request.accountScope) || !validHash(request.expectedTranscriptSha256)) {
        throw failure("PLAUD_CONTEXT_SCOPE_CHANGED", "录音连接已变化，原背景缺少文字稿绑定；已保留输入，请在原任务中核实后继续。");
      }
      this.verifiedRecoveryMetadata(scope, request.fileId);
      let prior = await this.runCommand("context-prepare", request.fileId, { accountScope: request.accountScope });
      this.assertScope(scope);
      let previousRevision;
      if (prior?.errorCode === "PLAUD_CONTEXT_SCOPE_MISMATCH") {
        // A previous explicit rebind may have committed before its IPC reply
        // was lost. Prove that exact migration before offering its replay.
        const rebound = await this.runCommand("context-prepare", request.fileId, { accountScope: scope });
        this.assertScope(scope);
        if (rebound?.ok && rebound.accountScope === scope && rebound.scopeRecoveryBinding?.previousAccountScope === request.accountScope
          && rebound.scopeRecoveryBinding.transcriptSha256 === request.expectedTranscriptSha256
          && validHash(rebound.scopeRecoveryBinding.previousRecordRevision)) {
          prior = rebound; previousRevision = rebound.scopeRecoveryBinding.previousRecordRevision;
        }
      }
      if (!prior?.ok) return prior;
      if (prior.fileId !== request.fileId || (!previousRevision && prior.accountScope !== request.accountScope) || !validHash(prior.recordRevision)
        || prior.transcript?.sha256 !== request.expectedTranscriptSha256) {
        throw failure("PLAUD_CONTEXT_TRANSCRIPT_CHANGED", "录音或文字稿与原背景不一致，不能沿用已填信息。");
      }
      await readBoundTranscript(prior.transcript);
      this.assertScope(scope);
      if (["managed", "notes_non_project", "discussion_complete"].includes(prior.stage)) {
        throw failure("PLAUD_CONTEXT_STAGE_CONFLICT", "这条录音已处理完成，请查看原任务中的结果。");
      }
      // No original answer, transcript text or recall crosses scopes before
      // an explicit user confirmation. The token contains binding data only.
      return { ok: false, fileId: request.fileId, errorCode: "PLAUD_CONTEXT_SCOPE_RECOVERY_REQUIRED",
        error: "录音连接已重新登录。已核对当前账号中的这条录音与原文字稿一致，请确认是否沿用已填信息。",
        scopeRecovery: { previousAccountScope: request.accountScope, accountScope: scope,
          transcriptSha256: prior.transcript.sha256, recordRevision: previousRevision || prior.recordRevision } };
    }, false);
  }
  recoverScope(request) {
    return this.writing(() => this.guard(request, scope => this.singleFlight(`rebind:${digest(JSON.stringify(request))}`, async () => {
      if (request.confirmed !== true || !validHash(request.previousAccountScope) || request.previousAccountScope === scope
        || !validHash(request.expectedTranscriptSha256) || !validHash(request.expectedRecordRevision)) {
        throw failure("PLAUD_CONTEXT_REQUEST_INVALID", "请明确确认沿用这条录音的已填信息。");
      }
      const metadata = this.verifiedRecoveryMetadata(scope, request.fileId);
      const result = await this.runCommand("context-rebind", request.fileId, {
        accountScope: scope, previousAccountScope: request.previousAccountScope, confirmed: true,
        expectedTranscriptSha256: request.expectedTranscriptSha256, expectedRecordRevision: request.expectedRecordRevision
      });
      this.assertScope(scope);
      if (!result?.ok) return result;
      if (result.fileId !== request.fileId || result.accountScope !== scope || result.transcript?.sha256 !== request.expectedTranscriptSha256
        || !validHash(result.recordRevision)) throw failure("PLAUD_CONTEXT_INVALID_RESULT", "会议信息恢复结果不一致，请重新读取。");
      this.store("owner", scope, request.fileId, "", metadata);
      return { ...result, context: contextForRenderer(result.context) };
    })));
  }
  save(request = {}) {
    if (request.action === "recover_scope") return this.recoverScope(request);
    return this.writing(() => this.guard(request, scope => this.singleFlight(`submit:${digest(JSON.stringify({ ...request, accountScope: scope }))}`, async () => {
      if (!validHash(request.expectedTranscriptSha256) || !text(request.expectedRecordRevision, 256)
        || !validId(request.submissionId) || !["provided", "skipped"].includes(request.contextStatus)) {
        throw failure("PLAUD_CONTEXT_REQUEST_INVALID", "录音背景提交信息不完整，已保留填写内容。");
      }
      const payload = { ...contextDraft(request), accountScope: scope, submissionId: request.submissionId,
        expectedRecordRevision: request.expectedRecordRevision, expectedTranscriptSha256: request.expectedTranscriptSha256,
        contextStatus: request.contextStatus };
      payload.participants = payload.participants.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
      this.assertScope(scope);
      const result = await this.runCommand("context-submit", request.fileId, payload);
      this.assertScope(scope);
      if (result?.ok && result.fileId !== request.fileId) throw failure("PLAUD_CONTEXT_INVALID_RESULT", "录音背景提交结果不一致，已保留填写内容。");
      if (result?.ok) this.store("draft", scope, request.fileId, request.expectedTranscriptSha256, { draft: null });
      return result?.context ? { ...result, context: contextForRenderer(result.context) } : result;
    })));
  }
  saveDraft(request = {}) {
    return this.writing(() => this.guard(request, async scope => {
      if (!validHash(request.transcriptSha256)) throw failure("PLAUD_CONTEXT_REQUEST_INVALID", "无法核验背景草稿对应的文字稿。");
      this.store("draft", scope, request.fileId, request.transcriptSha256, { draft: contextDraft(request.draft), savedAt: Date.now() });
      return { ok: true, fileId: request.fileId, accountScope: scope };
    }));
  }
  prepareRecall(request = {}) {
    return this.guard(request, async scope => {
      const prepared = await this.prepared(request.fileId, scope);
      if (!prepared?.ok) return prepared;
      if (request.transcriptSha256 !== prepared.transcript.sha256) throw failure("PLAUD_CONTEXT_TRANSCRIPT_CHANGED", "文字稿已更新，请重新准备回忆提示。");
      const source = await readBoundTranscript(prepared.transcript);
      this.assertScope(scope);
      const cached = this.load("recall", scope, request.fileId, request.transcriptSha256);
      const cachedRecallSummary = text(cached?.recallSummary, 4_000)
        || (prepared.recallSummaryVerified === true ? text(prepared.recallSummary, 4_000) : "");
      const recall = cachedRecallSummary ? richRecall(cached?.recall || extractRecall(source), cachedRecallSummary, "cache") : null;
      return { ok: true, fileId: request.fileId, accountScope: scope, transcriptSha256: prepared.transcript.sha256,
        recordRevision: prepared.recordRevision, ...distributedRecallSource(source),
        cachedRecallSummary, ...(recall ? { recall, cachedRecall: recall } : {}) };
    });
  }
  saveRecall(request = {}) {
    return this.writing(() => this.guard(request, async scope => {
      const summary = text(request.recallSummary, 4_000);
      if (!summary) throw failure("PLAUD_CONTEXT_RECALL_INVALID", "回忆提示为空，保留原文线索。");
      const prepared = await this.prepared(request.fileId, scope);
      if (!prepared?.ok) return prepared;
      if (request.transcriptSha256 !== prepared.transcript.sha256) throw failure("PLAUD_CONTEXT_TRANSCRIPT_CHANGED", "文字稿已更新，本次回忆提示未保存。");
      const source = await readBoundTranscript(prepared.transcript);
      this.assertScope(scope);
      const recall = richRecall(request.recall || extractRecall(source), summary, "model");
      const normalized = value => String(value).normalize("NFKC").replace(/\s+/g, "").toLowerCase();
      const sourceNormalized = normalized(source);
      if (request.recall && (recall.excerpts.some(value => !sourceNormalized.includes(normalized(value)))
        || recall.keywords.some(value => !sourceNormalized.includes(normalized(value))))) {
        throw failure("PLAUD_CONTEXT_RECALL_INVALID", "回忆提示未对应当前原文，保留已有线索。");
      }
      this.store("recall", scope, request.fileId, request.transcriptSha256, { recallSummary: summary, recall, savedAt: Date.now() });
      return { ok: true, fileId: request.fileId, accountScope: scope, transcriptSha256: request.transcriptSha256,
        recallSummary: summary, recall, source: "model" };
    }));
  }
}

module.exports = { PlaudContextService, runPlaudContextCommand, extractRecall, distributedRecallSource, readBoundTranscript };
