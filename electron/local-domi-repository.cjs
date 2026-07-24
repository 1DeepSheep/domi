const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");

const LOCAL_REPOSITORY_SCHEMA = 1;

function resolveHomePath(value) {
  const raw = String(value || "").trim();
  return raw.startsWith("~/") ? path.join(os.homedir(), raw.slice(2)) : raw;
}

function parseList(value) {
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function localDocumentUrl(value) {
  const documentPath = String(value || "").trim();
  return documentPath && path.isAbsolute(documentPath) ? pathToFileURL(documentPath).href : "";
}

class LocalDomiRepository {
  constructor({ databasePath, libraryDir }) {
    this.databasePath = path.resolve(resolveHomePath(databasePath));
    this.libraryDir = path.resolve(resolveHomePath(libraryDir));
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true, mode: 0o700 });
    for (const directory of ["1.行业研究", "2.行业动态", "3.项目库", "4.人脉库"]) {
      fs.mkdirSync(path.join(this.libraryDir, directory), { recursive: true });
    }
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS repository_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        domain TEXT NOT NULL DEFAULT '',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        status TEXT NOT NULL DEFAULT '待交流',
        rating TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        cities_json TEXT NOT NULL DEFAULT '[]',
        investors_json TEXT NOT NULL DEFAULT '[]',
        last_updated_at INTEGER,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_projects_updated
        ON projects(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS people (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        normalized_name TEXT NOT NULL UNIQUE,
        types_json TEXT NOT NULL DEFAULT '[]',
        organization TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        rating TEXT NOT NULL DEFAULT '',
        last_contact_at INTEGER,
        cities_json TEXT NOT NULL DEFAULT '[]',
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_people_updated
        ON people(updated_at DESC, id);
      CREATE TABLE IF NOT EXISTS news_events (
        event_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        domains_json TEXT NOT NULL DEFAULT '[]',
        subdomains_json TEXT NOT NULL DEFAULT '[]',
        types_json TEXT NOT NULL DEFAULT '[]',
        published_at INTEGER NOT NULL,
        summary TEXT NOT NULL DEFAULT '',
        investment_meaning TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        source TEXT NOT NULL DEFAULT '',
        companies TEXT NOT NULL DEFAULT '',
        institutions TEXT NOT NULL DEFAULT '',
        importance REAL NOT NULL DEFAULT 0,
        confidence REAL NOT NULL DEFAULT 0,
        evidence_status TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL DEFAULT '',
        worth_following INTEGER NOT NULL DEFAULT 1,
        document_path TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_news_events_published
        ON news_events(published_at DESC, event_id);
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        path TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_documents_owner
        ON documents(owner_type, owner_id, kind);
      CREATE TABLE IF NOT EXISTS document_migrations (
        source_path TEXT NOT NULL,
        target_space_id TEXT NOT NULL,
        source_sha256 TEXT NOT NULL DEFAULT '',
        target_document_id TEXT NOT NULL DEFAULT '',
        target_node_token TEXT NOT NULL DEFAULT '',
        target_url TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT NOT NULL DEFAULT '',
        migrated_at INTEGER NOT NULL,
        PRIMARY KEY (source_path, target_space_id)
      );
      INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('schema_version', '${LOCAL_REPOSITORY_SCHEMA}', unixepoch('now') * 1000)
        ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at;
    `);
  }

  close() {
    this.database.close();
  }

  health() {
    const schema = this.database.prepare(
      "SELECT value FROM repository_meta WHERE key = 'schema_version'"
    ).get();
    return {
      ok: Number(schema?.value || 0) === LOCAL_REPOSITORY_SCHEMA,
      backend: "local",
      databasePath: this.databasePath,
      localLibraryDir: this.libraryDir,
      schemaVersion: Number(schema?.value || 0)
    };
  }

  listProjects() {
    return this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, last_updated_at, document_path
      FROM projects
      ORDER BY updated_at DESC, name
    `).all().map((row) => ({
      recordId: row.id,
      name: row.name,
      domain: row.domain,
      subdomains: parseList(row.subdomains_json),
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      cities: parseList(row.cities_json),
      investors: parseList(row.investors_json),
      lastFollowup: row.last_updated_at || null,
      link: localDocumentUrl(row.document_path)
    }));
  }

  listPeople() {
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path
      FROM people
      ORDER BY updated_at DESC, name
    `).all().map((row) => ({
      recordId: row.id,
      name: row.name,
      types: parseList(row.types_json),
      organization: row.organization,
      status: row.status,
      rating: row.rating,
      lastContact: row.last_contact_at || null,
      cities: parseList(row.cities_json),
      link: localDocumentUrl(row.document_path)
    }));
  }

  listNews({ rangeStart, rangeEnd, limit = 500 }) {
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action
      FROM news_events
      WHERE published_at >= ? AND published_at < ? AND worth_following = 1
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(rangeStart, rangeEnd, limit).map((row) => ({
      recordId: row.event_id,
      title: row.title,
      domains: parseList(row.domains_json),
      subdomains: parseList(row.subdomains_json),
      types: parseList(row.types_json),
      publishedAt: row.published_at,
      summary: row.summary,
      investmentMeaning: row.investment_meaning,
      url: row.url,
      source: row.source,
      companies: row.companies,
      institutions: row.institutions,
      importance: Number(row.importance) || 0,
      confidence: Number(row.confidence) || 0,
      evidenceStatus: row.evidence_status,
      action: row.action
    }));
  }

  listMigrationProjects() {
    const documentRows = this.database.prepare(`
      SELECT owner_id, kind, title, path
      FROM documents
      WHERE owner_type = 'project'
      ORDER BY updated_at ASC, path ASC
    `).all();
    const documentsByProject = new Map();
    for (const row of documentRows) {
      const documents = documentsByProject.get(row.owner_id) || [];
      documents.push({
        kind: row.kind,
        title: row.title,
        path: row.path
      });
      documentsByProject.set(row.owner_id, documents);
    }
    return this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, last_updated_at, document_path
      FROM projects
      ORDER BY updated_at ASC, name ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      domain: row.domain,
      subdomains: parseList(row.subdomains_json),
      status: row.status,
      rating: row.rating,
      notes: row.notes,
      cities: parseList(row.cities_json),
      investors: parseList(row.investors_json),
      lastUpdatedAt: row.last_updated_at || null,
      documentPath: row.document_path,
      documents: documentsByProject.get(row.id) || []
    }));
  }

  getDocumentMigration(sourcePath, targetSpaceId) {
    return this.database.prepare(`
      SELECT source_path, target_space_id, source_sha256, target_document_id,
        target_node_token, target_url, status, error, migrated_at
      FROM document_migrations
      WHERE source_path = ? AND target_space_id = ?
    `).get(path.resolve(sourcePath), String(targetSpaceId || ""));
  }

  saveDocumentMigration(record) {
    const sourcePath = path.resolve(record.sourcePath);
    const targetSpaceId = String(record.targetSpaceId || "");
    const migratedAt = Number(record.migratedAt) || Date.now();
    this.database.prepare(`
      INSERT INTO document_migrations (
        source_path, target_space_id, source_sha256, target_document_id,
        target_node_token, target_url, status, error, migrated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_path, target_space_id) DO UPDATE SET
        source_sha256 = excluded.source_sha256,
        target_document_id = excluded.target_document_id,
        target_node_token = excluded.target_node_token,
        target_url = excluded.target_url,
        status = excluded.status,
        error = excluded.error,
        migrated_at = excluded.migrated_at
    `).run(
      sourcePath,
      targetSpaceId,
      String(record.sourceSha256 || ""),
      String(record.targetDocumentId || ""),
      String(record.targetNodeToken || ""),
      String(record.targetUrl || ""),
      String(record.status || "pending"),
      String(record.error || ""),
      migratedAt
    );
    return this.getDocumentMigration(sourcePath, targetSpaceId);
  }
}

module.exports = {
  LOCAL_REPOSITORY_SCHEMA,
  LocalDomiRepository,
  resolveHomePath
};
