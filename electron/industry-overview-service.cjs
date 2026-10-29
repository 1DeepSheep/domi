const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Worker } = require("node:worker_threads");
const { runRepositoryWorker } = require("./repository-worker.cjs");
const { LocalDomiRepository } = require("./local-domi-repository.cjs");
const taxonomy = require("../shared/investment-taxonomy.json");

const hash = value => crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
// A changed generator or taxonomy must not reuse a previous application's derived data.
const CACHE_VERSION = hash([fs.readFileSync(path.join(__dirname, "industry-overview.cjs"), "utf8"), taxonomy]);
const usable = value => value?.ok === true || (Array.isArray(value?.entries) && value.entries.length > 0);
const inside = (root, target) => { const relative = path.relative(root, target); return !relative || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative)); };

function sourceIdentity(source) {
  if (source?.backend !== "local" || !source.localDatabasePath || !source.localLibraryDir) throw new Error("行业速览需要本地资料库；当前资料库保持不变。");
  return { databasePath: path.resolve(source.localDatabasePath), libraryDir: path.resolve(source.localLibraryDir) };
}

function identity(filePath) {
  try {
    const realPath = fs.realpathSync(filePath), stat = fs.statSync(realPath);
    return [realPath, String(stat.dev), String(stat.ino)];
  } catch (error) { return [filePath, error.code || "unavailable"]; }
}

function fileVersions(libraryDir, files) {
  const root = fs.realpathSync(libraryDir);
  return [...new Set(files.filter(Boolean).map(file => path.resolve(file)))].sort().map(file => {
    // Only stat files the generator is allowed to read. No workspace crawl or contents read.
    if (!inside(libraryDir, file)) return [file, "outside-library"];
    try {
      const realPath = fs.realpathSync(file);
      if (!inside(root, realPath)) return [file, "outside-library"];
      const stat = fs.statSync(realPath, { bigint: true });
      return [file, realPath, stat.dev.toString(), stat.ino.toString(), stat.size.toString(), stat.mtimeNs.toString(), stat.ctimeNs.toString()];
    } catch (error) { return [file, error.code || "unavailable"]; }
  });
}

function sourceSnapshot(source) {
  const database = new DatabaseSync(source.databasePath, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 1000; BEGIN");
    // Hash relevant row values, not database/WAL mtimes: chat persistence, cache writes,
    // and SQLite checkpoints must not trigger hundreds of generated Markdown pages.
    const projects = database.prepare("SELECT * FROM projects ORDER BY id").all();
    const documents = database.prepare("SELECT * FROM documents WHERE owner_type IN ('project','industry') ORDER BY id").all()
      // Generated pages are outputs, even when the document index refreshes their metadata.
      // User edits to these pages are separately checked by outputFingerprint.
      .filter(document => !(document.owner_type === "industry" && path.basename(document.path || "") === "行业速览.md"));
    const custom = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='custom_taxonomy'").get()
      ? database.prepare("SELECT * FROM custom_taxonomy ORDER BY id").all() : [];
    const news = LocalDomiRepository.prototype.listAllNews.call({ database });
    const files = [...projects.map(project => project.document_path), ...documents
      .filter(document => !(document.owner_type === "industry" && path.basename(document.path || "") === "行业速览.md"))
      .map(document => document.path)].filter(file => file && /\.(md|markdown)$/i.test(file));
    return {
      fingerprint: hash([CACHE_VERSION, identity(source.libraryDir), identity(source.databasePath), projects, documents, custom, fileVersions(source.libraryDir, files)]),
      news,
      newsFingerprint: hash(news)
    };
  } finally { database.close(); }
}

function outputFingerprint(source, result) {
  return hash(fileVersions(source.libraryDir, [result.indexPath, ...(result.entries || []).map(entry => entry.path),
    ...(result.conflicts || []).flatMap(conflict => [conflict.path, conflict.candidatePath])]));
}

class IndustryOverviewCache {
  constructor({ stateStore, refresh, snapshot = sourceSnapshot } = {}) {
    this.stateStore = stateStore;
    this.refresh = refresh;
    this.snapshot = snapshot;
    this.entries = new Map();
  }

  read(requestedSource, { force = false } = {}) {
    // Capture the source once. A settings switch must never redirect a queued request
    // or save another library's result under the previous library's cache identity.
    const source = sourceIdentity(requestedSource);
    const key = `industry-overview-v1:${hash([source.databasePath, source.libraryDir])}`;
    let previous = this.entries.get(key);
    if (!previous) {
      try { previous = this.stateStore?.loadCache?.(key)?.value; } catch {}
    }
    if (previous?.version !== CACHE_VERSION || !usable(previous?.result)) previous = null;
    let before;
    try { before = this.snapshot(source); } catch {}
    let outputsUnchanged = false;
    if (!force && before && previous?.fingerprint === before.fingerprint) {
      try { outputsUnchanged = previous.outputFingerprint === outputFingerprint(source, previous.result); } catch {}
    }
    if (outputsUnchanged) {
      const current = { ...previous, result: { ...previous.result, news: before.news }, newsFingerprint: before.newsFingerprint };
      this.entries.set(key, current);
      if (previous.newsFingerprint !== before.newsFingerprint) this.persist(key, current);
      return { ...current.result, cached: true };
    }

    const result = this.refresh({ ...requestedSource, localDatabasePath: source.databasePath, localLibraryDir: source.libraryDir });
    if (!usable(result)) return result;
    let after;
    try { after = this.snapshot(source); } catch {}
    const value = { ...result, news: after?.news || before?.news || [] };
    // If an external writer changes source data while generation runs, do not bless
    // that mixed revision as fresh. The next read will retry from the current source.
    this.entries.delete(key);
    if (after && (!before || before.fingerprint === after.fingerprint)) {
      try {
        const current = { version: CACHE_VERSION, fingerprint: after.fingerprint, outputFingerprint: outputFingerprint(source, result),
          newsFingerprint: after.newsFingerprint, result: value };
        this.entries.set(key, current);
        this.persist(key, current);
      } catch {} // Cache bookkeeping cannot turn successfully generated content into an error.
    }
    return { ...value, cached: false };
  }

  persist(key, value) {
    try { this.stateStore?.saveCache?.(key, value); } catch {}
  }
}

async function loadIndustryOverviews(refresh) {
  try { return await refresh(); }
  catch (error) { return { ok: false, entries: [], error: error instanceof Error ? error.message : String(error) }; }
}

function cacheKey(source) {
  return `industry-overview-v1:${hash([source.databasePath, source.libraryDir])}`;
}

// The synchronous cache engine runs only inside a worker in production. Even a cache hit
// validates hundreds of cloud-backed file metadata entries; doing that in Electron's
// main thread stalls navigation, input and unrelated IPC requests.
class IndustryOverviewService {
  constructor({ stateStore, workerPath = path.join(__dirname, "industry-overview-worker.cjs"), WorkerClass = Worker,
    timeoutMs = 180_000 } = {}) {
    this.stateStore = stateStore;
    this.workerPath = workerPath;
    this.WorkerClass = WorkerClass;
    this.timeoutMs = timeoutMs;
    this.entries = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
    this.active = null;
    this.closed = false;
    this.closedEvent = new Promise(resolve => { this.notifyClosed = resolve; });
  }

  previous(key, { allowStale = false } = {}) {
    let value = this.entries.get(key);
    // A news reconciliation may repair the persisted snapshot while this service
    // is alive. Never let its older in-memory copy undo that correction.
    if (typeof this.stateStore?.loadCache === "function") {
      try { value = this.stateStore.loadCache(key)?.value; } catch { value = null; }
      if (!value) this.entries.delete(key);
    }
    if ((!allowStale && value?.version !== CACHE_VERSION) || !usable(value?.result) || !Array.isArray(value?.result?.entries)) return null;
    this.entries.set(key, value);
    return value;
  }

  read(requestedSource, { force = false, cachedOnly = false } = {}) {
    const source = sourceIdentity(requestedSource);
    const key = cacheKey(source);
    const captured = { backend: "local", localDatabasePath: source.databasePath, localLibraryDir: source.libraryDir };
    if (this.closed) return Promise.reject(new Error("行业看板后台服务已停止。"));
    if (cachedOnly) {
      const previous = this.previous(key, { allowStale: true });
      return Promise.resolve(previous ? { ...previous.result, cached: true } : { ok: true, entries: [], cached: false });
    }
    const active = this.pending.get(key);
    if (active) {
      if (!force || active.force || active.run?.abortError) return active.promise;
      // One manual refresh requested while validation is pending must still force a
      // fresh generation, but repeated clicks share that one queued operation.
      if (!active.forced) active.forced = Promise.race([
        // A timed-out worker may remain alive in native IO. Propagate its
        // request failure immediately; only a successful validation can queue
        // a forced generation after the worker has finished.
        active.promise.then(() => active.completion).then(() => this.read(captured, { force: true })),
        this.closedEvent.then(() => { throw new Error("行业看板后台服务已停止。"); })
      ]);
      return active.forced;
    }
    let resolve, reject;
    const promise = new Promise((accept, decline) => { resolve = accept; reject = decline; });
    const item = { promise, force, resolve, reject };
    const completion = this.queue.then(() => {
      if (this.closed) throw new Error("行业看板后台服务已停止。");
      const run = this.run(captured, key, force);
      item.run = run;
      this.active = run;
      void run.result.then(
        async value => { await item.completion; resolve(value); },
        async error => {
          if (!run.abortError) await item.completion;
          reject(error);
        }
      );
      return run.completion;
    }).catch(reject).finally(() => {
      if (this.pending.get(key) === item) this.pending.delete(key);
      if (this.active === item.run) this.active = null;
    });
    item.completion = completion;
    this.queue = completion;
    this.pending.set(key, item);
    return promise;
  }

  run(source, key, force) {
    const previous = this.previous(key);
    const run = runRepositoryWorker({
      workerPath: this.workerPath, WorkerClass: this.WorkerClass,
      workerData: { source, previous, force },
      resourceLimits: { maxOldGenerationSizeMb: 256 }, timeoutMs: this.timeoutMs,
      timeoutError: () => new Error("行业看板后台刷新超时，已保留上次成功结果。"),
      exitError: code => new Error(`行业看板后台服务意外退出（${code}）。`)
    });
    const result = run.result.then(message => {
      if (!message?.ok) throw new Error(message?.error || "行业看板后台刷新失败。");
      let value = message.cache;
      let result = message.result;
      const latest = this.previous(key, { allowStale: true });
      // An older worker may finish after the date was corrected. Keep the
      // reconciled news for this response; the next worker can refresh it again.
      if (latest?.newsRevision && latest.newsRevision !== previous?.newsRevision) {
        const news = latest.result.news;
        result = { ...result, news };
        if (value?.result) value = { ...value, result: { ...value.result, news }, newsFingerprint: hash(news) };
      }
      if (value && latest?.newsRevision) value = { ...value, newsRevision: latest.newsRevision };
      if (value?.version === CACHE_VERSION && usable(value?.result)) {
        this.entries.set(key, value);
        try { this.stateStore?.saveCache?.(key, value); } catch {}
      }
      return result;
    });
    return { result, completion: run.completion, cancel: run.cancel, get abortError() { return run.abortError; } };
  }

  async close() {
    this.closed = true;
    this.notifyClosed();
    const error = new Error("行业看板后台服务已停止。");
    for (const item of this.pending.values()) item.reject(error);
    void this.active?.cancel(error);
    // Native IO may delay worker termination. Closing the UI must not hang on
    // that IO; the retained completion handler still cleans up after real exit.
    await new Promise(resolve => {
      const timer = setTimeout(resolve, 250);
      void this.queue.then(() => { clearTimeout(timer); resolve(); });
    });
  }
}

module.exports = { IndustryOverviewCache, IndustryOverviewService, loadIndustryOverviews, sourceSnapshot };
