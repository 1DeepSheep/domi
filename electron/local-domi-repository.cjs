const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { DatabaseSync } = require("node:sqlite");
const { ensureDocumentLibraryStructure } = require("./document-library.cjs");

const LOCAL_REPOSITORY_SCHEMA = 2;
const PROJECTS_DIRECTORY = "3.项目库";
const PEOPLE_DIRECTORY = "4.人脉库";
const PROJECT_PAGE_NAME = "项目主页.md";
const PERSON_PAGE_NAME = "人物主页.md";

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

function stringList(value) {
  if (Array.isArray(value)) {
    return [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))];
  }
  if (value === null || value === undefined || value === "") return [];
  return [...new Set(
    String(value)
      .split(/[，,、]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function normalizedName(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•._\-—–（）()【】[\]{}，,。.!！?？/&／]+/g, "");
}

function stableId(prefix, value) {
  return `${prefix}_${crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16)}`;
}

function toEpochMs(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric)) return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function listDirectories(directoryPath) {
  try {
    return fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  } catch {
    return [];
  }
}

function fileCreatedAt(targetPath) {
  try {
    const stat = fs.statSync(targetPath);
    return Math.round(
      Number(stat.birthtimeMs) > 0
        ? stat.birthtimeMs
        : Number(stat.ctimeMs) > 0
          ? stat.ctimeMs
          : stat.mtimeMs
    );
  } catch {
    return Date.now();
  }
}

function parseFrontmatterValue(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    return JSON.parse(raw);
  } catch {
    if (raw === "null") return null;
    if (raw === "true") return true;
    if (raw === "false") return false;
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : raw.replace(/^['"]|['"]$/g, "");
  }
}

function readManagedFrontmatter(filePath) {
  if (!fs.existsSync(filePath)) return {};
  try {
    const content = fs.readFileSync(filePath, "utf8");
    const match = content.match(/(?:^|\r?\n)---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    if (!match) return {};
    const result = {};
    for (const line of match[1].split(/\r?\n/)) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (!/^[a-zA-Z0-9_]+$/.test(key)) continue;
      result[key] = parseFrontmatterValue(line.slice(separator + 1));
    }
    return result;
  } catch {
    return {};
  }
}

function firstMarkdownFile(directoryPath) {
  try {
    const entry = fs.readdirSync(directoryPath, { withFileTypes: true })
      .filter((item) =>
        item.isFile()
        && !item.name.startsWith(".")
        && /\.(?:md|markdown)$/i.test(item.name)
      )
      .sort((left, right) => left.name.localeCompare(right.name, "zh-CN"))[0];
    return entry ? path.join(directoryPath, entry.name) : "";
  } catch {
    return "";
  }
}

function looksLikeProjectDirectory(name, hasCanonicalPage) {
  if (hasCanonicalPage) return true;
  const value = String(name || "").trim();
  if (!value) return false;
  return !/(?:行业|产业|赛道|专题|市场)研究/.test(value);
}

function scanWorkspaceEntities(libraryDir) {
  const projects = [];
  const people = [];
  const projectRoot = path.join(libraryDir, PROJECTS_DIRECTORY);
  const peopleRoot = path.join(libraryDir, PEOPLE_DIRECTORY);

  for (const domainEntry of listDirectories(projectRoot)) {
    const domainPath = path.join(projectRoot, domainEntry.name);
    for (const subdomainEntry of listDirectories(domainPath)) {
      const subdomainPath = path.join(domainPath, subdomainEntry.name);
      for (const projectEntry of listDirectories(subdomainPath)) {
        const projectPath = path.join(subdomainPath, projectEntry.name);
        const canonicalPath = path.join(projectPath, PROJECT_PAGE_NAME);
        const hasCanonicalPage = fs.existsSync(canonicalPath);
        if (!looksLikeProjectDirectory(projectEntry.name, hasCanonicalPage)) continue;
        const metadata = readManagedFrontmatter(canonicalPath);
        if (metadata.entity_type && metadata.entity_type !== "project") continue;
        const name = String(metadata.company_name || projectEntry.name || "").trim();
        const normalized = normalizedName(name);
        if (!normalized) continue;
        const metadataSubdomains = stringList(metadata.subdomains);
        const documentPath = hasCanonicalPage
          ? canonicalPath
          : firstMarkdownFile(projectPath);
        const createdAt = fileCreatedAt(projectPath);
        projects.push({
          id: String(metadata.project_id || stableId("prj", normalized)),
          name,
          normalizedName: normalized,
          domain: String(metadata.domain || domainEntry.name || "").trim(),
          subdomains: metadataSubdomains.length ? metadataSubdomains : [subdomainEntry.name],
          status: String(metadata.status || "待交流").trim(),
          rating: String(metadata.rating || "").trim(),
          lastUpdatedAt: toEpochMs(metadata.last_updated_at, null),
          documentPath,
          createdAt
        });
      }
    }
  }

  for (const personEntry of listDirectories(peopleRoot)) {
    const personPath = path.join(peopleRoot, personEntry.name);
    const canonicalPath = path.join(personPath, PERSON_PAGE_NAME);
    const metadata = readManagedFrontmatter(canonicalPath);
    if (metadata.entity_type && metadata.entity_type !== "person") continue;
    const name = String(metadata.name || personEntry.name || "").trim();
    const normalized = normalizedName(name);
    if (!normalized) continue;
    people.push({
      id: String(metadata.person_id || stableId("per", normalized)),
      name,
      normalizedName: normalized,
      types: stringList(metadata.types),
      organization: String(metadata.organization || "").trim(),
      status: String(metadata.status || "").trim(),
      rating: String(metadata.rating || "").trim(),
      documentPath: fs.existsSync(canonicalPath)
        ? canonicalPath
        : firstMarkdownFile(personPath),
      createdAt: fileCreatedAt(personPath)
    });
  }

  return { projects, people };
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
    ensureDocumentLibraryStructure(this.libraryDir);
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
        financing_history TEXT NOT NULL DEFAULT '',
        latest_valuation_usd_100m REAL,
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
    const projectColumns = new Set(
      this.database.prepare("PRAGMA table_info(projects)").all().map((column) => column.name)
    );
    if (!projectColumns.has("financing_history")) {
      this.database.exec("ALTER TABLE projects ADD COLUMN financing_history TEXT NOT NULL DEFAULT ''");
    }
    if (!projectColumns.has("latest_valuation_usd_100m")) {
      this.database.exec("ALTER TABLE projects ADD COLUMN latest_valuation_usd_100m REAL");
    }
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

  reindexWorkspace() {
    const discovered = scanWorkspaceEntities(this.libraryDir);
    const result = {
      projects: { discovered: discovered.projects.length, created: 0, linked: 0 },
      people: { discovered: discovered.people.length, created: 0, linked: 0 }
    };
    const findProject = this.database.prepare(
      `SELECT id, domain, subdomains_json, status, rating, last_updated_at, document_path
       FROM projects WHERE normalized_name = ?`
    );
    const insertProject = this.database.prepare(`
      INSERT INTO projects (
        id, name, normalized_name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '[]', '[]', '', NULL, ?, ?, ?, ?)
    `);
    const enrichProject = this.database.prepare(`
      UPDATE projects SET
        domain = CASE WHEN domain = '' THEN ? ELSE domain END,
        subdomains_json = CASE WHEN subdomains_json = '[]' THEN ? ELSE subdomains_json END,
        status = CASE WHEN status = '' THEN ? ELSE status END,
        rating = CASE WHEN rating = '' THEN ? ELSE rating END,
        last_updated_at = COALESCE(last_updated_at, ?),
        document_path = CASE WHEN document_path = '' THEN ? ELSE document_path END
      WHERE normalized_name = ?
    `);
    const findPerson = this.database.prepare(
      `SELECT id, types_json, organization, status, rating, document_path
       FROM people WHERE normalized_name = ?`
    );
    const insertPerson = this.database.prepare(`
      INSERT INTO people (
        id, name, normalized_name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '[]', ?, ?, ?)
    `);
    const enrichPerson = this.database.prepare(`
      UPDATE people SET
        types_json = CASE WHEN types_json = '[]' THEN ? ELSE types_json END,
        organization = CASE WHEN organization = '' THEN ? ELSE organization END,
        status = CASE WHEN status = '' THEN ? ELSE status END,
        rating = CASE WHEN rating = '' THEN ? ELSE rating END,
        document_path = CASE WHEN document_path = '' THEN ? ELSE document_path END
      WHERE normalized_name = ?
    `);
    const now = Date.now();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const project of discovered.projects) {
        const existing = findProject.get(project.normalizedName);
        if (existing) {
          const shouldLink = !existing.document_path && project.documentPath;
          enrichProject.run(
            project.domain,
            JSON.stringify(project.subdomains),
            project.status,
            project.rating,
            project.lastUpdatedAt,
            project.documentPath,
            project.normalizedName
          );
          if (shouldLink) result.projects.linked += 1;
          continue;
        }
        insertProject.run(
          project.id,
          project.name,
          project.normalizedName,
          project.domain,
          JSON.stringify(project.subdomains),
          project.status,
          project.rating,
          project.lastUpdatedAt,
          project.documentPath,
          project.createdAt,
          now
        );
        result.projects.created += 1;
      }

      for (const person of discovered.people) {
        const existing = findPerson.get(person.normalizedName);
        if (existing) {
          const shouldLink = !existing.document_path && person.documentPath;
          enrichPerson.run(
            JSON.stringify(person.types),
            person.organization,
            person.status,
            person.rating,
            person.documentPath,
            person.normalizedName
          );
          if (shouldLink) result.people.linked += 1;
          continue;
        }
        insertPerson.run(
          person.id,
          person.name,
          person.normalizedName,
          JSON.stringify(person.types),
          person.organization,
          person.status,
          person.rating,
          person.documentPath,
          person.createdAt,
          now
        );
        result.people.created += 1;
      }

      this.database.prepare(`
        INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('workspace_index', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(JSON.stringify(result), now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return result;
  }

  listProjects() {
    return this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, last_updated_at, document_path, created_at
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
      createdAt: row.created_at || null,
      lastFollowup: row.last_updated_at || null,
      link: localDocumentUrl(row.document_path)
    }));
  }

  listPeople() {
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at
      FROM people
      ORDER BY updated_at DESC, name
    `).all().map((row) => ({
      recordId: row.id,
      name: row.name,
      types: parseList(row.types_json),
      organization: row.organization,
      status: row.status,
      rating: row.rating,
      createdAt: row.created_at || null,
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

  listMigrationPeople() {
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at, updated_at
      FROM people
      ORDER BY updated_at ASC, name ASC
    `).all().map((row) => ({
      id: row.id,
      name: row.name,
      types: parseList(row.types_json),
      organization: row.organization,
      status: row.status,
      rating: row.rating,
      lastContactAt: row.last_contact_at || null,
      cities: parseList(row.cities_json),
      documentPath: row.document_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  listMigrationNews() {
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, document_path, created_at, updated_at
      FROM news_events
      ORDER BY published_at ASC, event_id ASC
    `).all().map((row) => ({
      eventId: row.event_id,
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
      action: row.action,
      worthFollowing: Boolean(row.worth_following),
      documentPath: row.document_path,
      createdAt: row.created_at,
      updatedAt: row.updated_at
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
  normalizedName,
  scanWorkspaceEntities,
  resolveHomePath
};
