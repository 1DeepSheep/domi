const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { Worker } = require("node:worker_threads");
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
  }

  previous(key, { allowStale = false } = {}) {
    let value = this.entries.get(key);
    if (!value) { try { value = this.stateStore?.loadCache?.(key)?.value; } catch {} }
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
      if (!force || active.force) return active.promise;
      // One manual refresh requested while validation is pending must still force a
      // fresh generation, but repeated clicks share that one queued operation.
      if (!active.forced) active.forced = active.promise.catch(() => undefined).then(() => this.read(captured, { force: true }));
      return active.forced;
    }
    const promise = this.queue.then(() => {
      if (this.closed) throw new Error("行业看板后台服务已停止。");
      return this.run(captured, key, force);
    });
    this.queue = promise.catch(() => undefined);
    const item = { promise, force };
    this.pending.set(key, item);
    const finish = () => { if (this.pending.get(key) === item) this.pending.delete(key); };
    promise.then(finish, finish);
    return promise;
  }

  run(source, key, force) {
    return new Promise((resolve, reject) => {
      const lockToken = JSON.stringify({ pid: process.pid, token: crypto.randomUUID() });
      const lockPath = path.join(path.dirname(source.localDatabasePath), `.domi-industry-${hash(source.localLibraryDir).slice(0, 16)}.lock`);
      const worker = new this.WorkerClass(this.workerPath, {
        workerData: { source, previous: this.previous(key), force, lockToken },
        resourceLimits: { maxOldGenerationSizeMb: 256 }
      });
      let settled = false;
      let termination, cleanupPromise, abortError;
      const cleanupLock = () => cleanupPromise ||= (async () => {
        // Terminated threads have the main process PID. Only our unique token can
        // distinguish an abandoned lock from another healthy thread's lock.
        try { if (await fs.promises.readFile(lockPath, "utf8") === lockToken) await fs.promises.unlink(lockPath); } catch {}
      })();
      const terminate = () => termination ||= Promise.resolve(worker.terminate()).catch(() => undefined).then(cleanupLock);
      const finish = (error, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (this.active?.worker === worker) this.active = null;
        if (error) { reject(error); return; }
        const value = message.cache;
        if (value?.version === CACHE_VERSION && usable(value?.result)) {
          this.entries.set(key, value);
          try { this.stateStore?.saveCache?.(key, value); } catch {}
        }
        resolve(message.result);
      };
      const cancel = error => {
        abortError ||= error;
        return terminate().then(() => finish(abortError));
      };
      const timer = setTimeout(() => {
        void cancel(new Error("行业看板后台刷新超时，已保留上次成功结果。"));
      }, this.timeoutMs);
      this.active = { worker, cancel };
      worker.once("message", message => {
        if (message?.ok) finish(null, message);
        else void cleanupLock().then(() => finish(new Error(message?.error || "行业看板后台刷新失败。")));
      });
      worker.once("error", error => { void cancel(error); });
      worker.once("exit", code => {
        if (!settled) void cleanupLock().then(() => finish(abortError || new Error(`行业看板后台服务意外退出（${code}）。`)));
      });
    });
  }

  async close() {
    this.closed = true;
    await this.active?.cancel(new Error("行业看板后台服务已停止。"));
    await this.queue;
  }
}

module.exports = { IndustryOverviewCache, IndustryOverviewService, loadIndustryOverviews, sourceSnapshot };
