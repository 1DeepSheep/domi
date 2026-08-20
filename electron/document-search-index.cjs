const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const SEARCHABLE_EXTENSIONS = new Set([".md", ".markdown", ".pdf"]);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;
const TRANSCRIPT_PATTERN = /(?:PLAUD\s*)?文字稿|transcript/i;

function pathInsideRoot(rootPath, candidatePath) {
  const root = path.resolve(rootPath);
  const candidate = path.resolve(candidatePath);
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function initializeDocumentSearchIndex(database) {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    CREATE TABLE IF NOT EXISTS search_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS search_documents (
      path TEXT PRIMARY KEY,
      root_path TEXT NOT NULL,
      name TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      kind TEXT NOT NULL CHECK(kind IN ('markdown', 'pdf')),
      size INTEGER NOT NULL,
      mtime_ms REAL NOT NULL,
      content TEXT NOT NULL,
      is_transcript INTEGER NOT NULL DEFAULT 0,
      scan_generation TEXT NOT NULL,
      indexed_at INTEGER NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS search_documents_fts USING fts5(
      path UNINDEXED,
      name,
      relative_path,
      content,
      tokenize='trigram'
    );
  `);
}

function openDocumentSearchIndex(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  let database;
  try {
    database = new DatabaseSync(databasePath);
    initializeDocumentSearchIndex(database);
    return database;
  } catch (error) {
    try {
      database?.close();
    } catch {
      // The cache may be too damaged to close cleanly.
    }
    for (const suffix of ["", "-wal", "-shm"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
    database = new DatabaseSync(databasePath);
    initializeDocumentSearchIndex(database);
    return database;
  }
}

function currentRoot(database) {
  return database.prepare("SELECT value FROM search_meta WHERE key = 'root_path'").get()?.value || "";
}

function configureRoot(database, rootPath) {
  const resolvedRoot = path.resolve(rootPath);
  if (currentRoot(database) === resolvedRoot) return resolvedRoot;
  database.exec("BEGIN IMMEDIATE");
  try {
    database.exec("DELETE FROM search_documents_fts; DELETE FROM search_documents;");
    database.prepare(`
      INSERT INTO search_meta(key, value) VALUES ('root_path', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(resolvedRoot);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return resolvedRoot;
}

function shouldIndexFile(name) {
  return SEARCHABLE_EXTENSIONS.has(path.extname(name).toLocaleLowerCase("en-US"));
}

function isTranscript(relativePath) {
  return TRANSCRIPT_PATTERN.test(relativePath);
}

function isCloudPlaceholder(stat) {
  return stat.size > 0 && Number.isFinite(stat.blocks) && stat.blocks === 0;
}

function readMarkdownContent(filePath, stat) {
  if (stat.size > MAX_MARKDOWN_BYTES || isCloudPlaceholder(stat)) return "";
  return fs.readFileSync(filePath, "utf8").replace(/\u0000/g, "");
}

function upsertIndexedDocument(database, rootPath, filePath, stat, generation) {
  const resolvedPath = path.resolve(filePath);
  if (!pathInsideRoot(rootPath, resolvedPath)) return false;
  const relativePath = path.relative(rootPath, resolvedPath);
  const extension = path.extname(resolvedPath).toLocaleLowerCase("en-US");
  const kind = extension === ".pdf" ? "pdf" : "markdown";
  const existing = database.prepare(`
    SELECT size, mtime_ms FROM search_documents WHERE path = ?
  `).get(resolvedPath);
  if (existing && existing.size === stat.size && existing.mtime_ms === stat.mtimeMs) {
    database.prepare(`
      UPDATE search_documents SET scan_generation = ? WHERE path = ?
    `).run(generation, resolvedPath);
    return false;
  }
  const transcript = isTranscript(relativePath);
  const content = kind === "markdown" && !transcript
    ? readMarkdownContent(resolvedPath, stat)
    : "";
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("DELETE FROM search_documents_fts WHERE path = ?").run(resolvedPath);
    database.prepare(`
      INSERT INTO search_documents(
        path, root_path, name, relative_path, kind, size, mtime_ms,
        content, is_transcript, scan_generation, indexed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        root_path = excluded.root_path,
        name = excluded.name,
        relative_path = excluded.relative_path,
        kind = excluded.kind,
        size = excluded.size,
        mtime_ms = excluded.mtime_ms,
        content = excluded.content,
        is_transcript = excluded.is_transcript,
        scan_generation = excluded.scan_generation,
        indexed_at = excluded.indexed_at
    `).run(
      resolvedPath,
      rootPath,
      path.basename(resolvedPath),
      relativePath,
      kind,
      stat.size,
      stat.mtimeMs,
      content,
      transcript ? 1 : 0,
      generation,
      Date.now()
    );
    database.prepare(`
      INSERT INTO search_documents_fts(path, name, relative_path, content)
      VALUES (?, ?, ?, ?)
    `).run(resolvedPath, path.basename(resolvedPath), relativePath, content);
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return true;
}

function removeStaleDocuments(database, generation) {
  const stale = database.prepare(`
    SELECT path FROM search_documents WHERE scan_generation <> ?
  `).all(generation);
  if (!stale.length) return 0;
  database.exec("BEGIN IMMEDIATE");
  try {
    const deleteFts = database.prepare("DELETE FROM search_documents_fts WHERE path = ?");
    const deleteDocument = database.prepare("DELETE FROM search_documents WHERE path = ?");
    for (const row of stale) {
      deleteFts.run(row.path);
      deleteDocument.run(row.path);
    }
    database.exec("COMMIT");
  } catch (error) {
    database.exec("ROLLBACK");
    throw error;
  }
  return stale.length;
}

function compactWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function resultSnippet(row, query) {
  const content = String(row.content || "");
  const normalizedQuery = query.toLocaleLowerCase("zh-CN");
  const contentIndex = content.toLocaleLowerCase("zh-CN").indexOf(normalizedQuery);
  if (contentIndex < 0) {
    return {
      snippet: row.kind === "pdf" ? "PDF 文件名匹配" : compactWhitespace(row.relative_path),
      line: undefined
    };
  }
  const before = content.slice(0, contentIndex);
  const line = before.split(/\r?\n/).length;
  const start = Math.max(0, contentIndex - 70);
  const end = Math.min(content.length, contentIndex + query.length + 110);
  return {
    snippet: `${start > 0 ? "…" : ""}${compactWhitespace(content.slice(start, end))}${end < content.length ? "…" : ""}`,
    line
  };
}

function searchIndexedDocuments(database, request = {}) {
  const query = String(request.query || "").trim();
  if (!query) return [];
  const limit = Math.max(1, Math.min(Number(request.limit) || 8, 20));
  const includeTranscripts = request.includeTranscripts === true;
  let rows;
  if ([...query].length >= 3) {
    const phrase = `"${query.replace(/"/g, '""')}"`;
    rows = database.prepare(`
      SELECT d.*, bm25(search_documents_fts, 0.0, 9.0, 4.0, 1.0) AS rank
      FROM search_documents_fts
      JOIN search_documents d ON d.path = search_documents_fts.path
      WHERE search_documents_fts MATCH ?
        AND (? = 1 OR d.is_transcript = 0)
      ORDER BY rank ASC, d.mtime_ms DESC
      LIMIT ?
    `).all(phrase, includeTranscripts ? 1 : 0, limit);
  } else {
    const pattern = `%${query.toLocaleLowerCase("zh-CN")}%`;
    rows = database.prepare(`
      SELECT d.*, 0 AS rank
      FROM search_documents d
      WHERE (? = 1 OR d.is_transcript = 0)
        AND (
          lower(d.name) LIKE ?
          OR lower(d.relative_path) LIKE ?
        )
      ORDER BY d.mtime_ms DESC
      LIMIT ?
    `).all(includeTranscripts ? 1 : 0, pattern, pattern, limit);
  }
  return rows.map((row) => ({
    path: row.path,
    name: row.name,
    relativePath: row.relative_path,
    kind: row.kind,
    size: row.size,
    mtimeMs: row.mtime_ms,
    ...resultSnippet(row, query)
  }));
}

module.exports = {
  MAX_MARKDOWN_BYTES,
  configureRoot,
  openDocumentSearchIndex,
  pathInsideRoot,
  removeStaleDocuments,
  searchIndexedDocuments,
  shouldIndexFile,
  upsertIndexedDocument
};
