const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
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
    const documents = database.prepare("SELECT * FROM documents WHERE owner_type IN ('project','industry') ORDER BY id").all();
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

module.exports = { IndustryOverviewCache, loadIndustryOverviews };
