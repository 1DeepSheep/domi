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
const NEWS_DIRECTORY = "2.行业动态";
const PROJECT_PAGE_NAME = "项目主页.md";
const PERSON_PAGE_NAME = "人物主页.md";
const MANAGED_BLOCK_PATTERN = /<!-- domi:managed:start -->[\s\S]*?<!-- domi:managed:end -->/;
const PROJECT_STATUSES = new Set(["待交流", "已交流", "深度跟踪", "已投", "Miss", "放弃"]);
const PROJECT_RATINGS = new Set(["", "S", "A", "B", "C"]);
const TRACKED_INVESTORS = new Set([
  "红杉",
  "高瓴",
  "IDG",
  "锦秋",
  "Monolith/励思资本",
  "五源",
  "蓝驰",
  "经纬"
]);

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
  const indexedProjectPaths = new Set();

  function addProject(projectPath, domainName, subdomainName, fallbackName) {
    const resolvedProjectPath = path.resolve(projectPath);
    if (indexedProjectPaths.has(resolvedProjectPath)) return;
    const canonicalPath = path.join(resolvedProjectPath, PROJECT_PAGE_NAME);
    const hasCanonicalPage = fs.existsSync(canonicalPath);
    if (!looksLikeProjectDirectory(fallbackName, hasCanonicalPage)) return;
    const metadata = readManagedFrontmatter(canonicalPath);
    if (metadata.entity_type && metadata.entity_type !== "project") return;
    const name = String(metadata.company_name || fallbackName || "").trim();
    const normalized = normalizedName(name);
    if (!normalized) return;
    const metadataSubdomains = stringList(metadata.subdomains);
    const documentPath = hasCanonicalPage
      ? canonicalPath
      : firstMarkdownFile(resolvedProjectPath);
    indexedProjectPaths.add(resolvedProjectPath);
    projects.push({
      id: String(metadata.project_id || stableId("prj", normalized)),
      name,
      normalizedName: normalized,
      domain: String(metadata.domain || domainName || "").trim(),
      subdomains: metadataSubdomains.length
        ? metadataSubdomains
        : subdomainName
          ? [subdomainName]
          : [],
      status: String(metadata.status || "待交流").trim(),
      rating: String(metadata.rating || "").trim(),
      lastUpdatedAt: toEpochMs(metadata.last_updated_at, null),
      documentPath,
      createdAt: fileCreatedAt(resolvedProjectPath)
    });
  }

  for (const domainEntry of listDirectories(projectRoot)) {
    const domainPath = path.join(projectRoot, domainEntry.name);
    for (const subdomainEntry of listDirectories(domainPath)) {
      const subdomainPath = path.join(domainPath, subdomainEntry.name);
      const directProject = fs.existsSync(path.join(subdomainPath, PROJECT_PAGE_NAME))
        || (domainEntry.name === "_未分类" && subdomainEntry.name !== "_未分类")
        || (Boolean(firstMarkdownFile(subdomainPath)) && listDirectories(subdomainPath).length === 0);
      if (directProject) {
        addProject(subdomainPath, domainEntry.name, "", subdomainEntry.name);
        continue;
      }
      for (const projectEntry of listDirectories(subdomainPath)) {
        addProject(
          path.join(subdomainPath, projectEntry.name),
          domainEntry.name,
          subdomainEntry.name,
          projectEntry.name
        );
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

function workspaceEntitiesSignature(discovered) {
  const projects = [...(discovered?.projects || [])]
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName, "zh-CN"))
    .map((project) => [
      project.id,
      project.name,
      project.normalizedName,
      project.domain,
      ...(project.subdomains || []),
      project.status,
      project.rating,
      project.documentPath
    ]);
  const people = [...(discovered?.people || [])]
    .sort((left, right) => left.normalizedName.localeCompare(right.normalizedName, "zh-CN"))
    .map((person) => [
      person.id,
      person.name,
      person.normalizedName,
      ...(person.types || []),
      person.organization,
      person.status,
      person.rating,
      person.documentPath
    ]);
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ projects, people }))
    .digest("hex");
}

function localDocumentUrl(value) {
  const documentPath = String(value || "").trim();
  return documentPath && path.isAbsolute(documentPath) ? pathToFileURL(documentPath).href : "";
}

function safePathSegment(value, fallback = "_未分类") {
  const normalized = String(value || "").trim()
    .replace(/[\/\\:*?"<>|\u0000-\u001f]/g, "／")
    .replace(/^\.+$/, "")
    .slice(0, 160);
  return normalized || fallback;
}

function assertWithin(rootPath, targetPath) {
  const root = path.resolve(rootPath);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("资料库路径超出允许范围。");
  }
}

function replaceManagedBlock(existingContent, managedBlock) {
  const existing = String(existingContent || "");
  if (MANAGED_BLOCK_PATTERN.test(existing)) {
    return existing.replace(MANAGED_BLOCK_PATTERN, managedBlock);
  }
  return existing.trim()
    ? `${managedBlock}\n\n${existing.trimStart()}`
    : `${managedBlock}\n`;
}

function atomicWriteText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  try {
    fs.writeFileSync(tempPath, content, { encoding: "utf8", mode: 0o600 });
    fs.renameSync(tempPath, filePath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function renderProjectManagedBlock(project) {
  const latestValuation = project.latestValuationUsd100m === null
    ? "未填写"
    : `${project.latestValuationUsd100m} 亿美元`;
  const financingHistory = project.financingHistory || "未填写";
  const updatedAt = project.lastUpdatedAt
    ? new Date(project.lastUpdatedAt).toISOString()
    : "";
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "project"
project_id: ${JSON.stringify(project.recordId)}
company_name: ${JSON.stringify(project.name)}
domain: ${JSON.stringify(project.domain)}
subdomains: ${JSON.stringify(project.subdomains)}
status: ${JSON.stringify(project.status)}
rating: ${JSON.stringify(project.rating)}
cities: ${JSON.stringify(project.cities)}
investors: ${JSON.stringify(project.investors)}
latest_valuation_usd_100m: ${project.latestValuationUsd100m === null ? "null" : project.latestValuationUsd100m}
last_updated_at: ${JSON.stringify(updatedAt)}
---

# ${project.name}

## 项目状态

- 领域：${project.domain || "未分类"}
- 子领域：${project.subdomains.join("、") || "未分类"}
- 进展：${project.status || "待交流"}
- 评级：${project.rating || "未评级"}
- 城市：${project.cities.join("、") || "未填写"}
- 投资机构：${project.investors.join("、") || "未填写"}
- 最新估值：${latestValuation}

## 历史融资

${financingHistory}

## 结构化摘要

${project.notes || "未填写"}
<!-- domi:managed:end -->`;
}

function renderPersonManagedBlock(person) {
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "person"
person_id: ${JSON.stringify(person.recordId)}
name: ${JSON.stringify(person.name)}
organization: ${JSON.stringify(person.organization)}
types: ${JSON.stringify(person.types)}
status: ${JSON.stringify(person.status)}
rating: ${JSON.stringify(person.rating)}
cities: ${JSON.stringify(person.cities)}
last_contact_at: ${JSON.stringify(person.lastContact ? new Date(person.lastContact).toISOString() : "")}
---

# ${person.name}

- 组织与身份：${person.organization || "未填写"}
- 类型：${person.types.join("、") || "未填写"}
- 进展：${person.status || "未填写"}
- 评级：${person.rating || "未评级"}
- 城市：${person.cities.join("、") || "未填写"}
- 最后联系：${person.lastContact ? new Date(person.lastContact).toISOString().slice(0, 10) : "未填写"}
<!-- domi:managed:end -->`;
}

function renderNewsManagedBlock(item) {
  return `<!-- domi:managed:start -->
---
domi_schema: ${LOCAL_REPOSITORY_SCHEMA}
entity_type: "news_event"
event_id: ${JSON.stringify(item.recordId)}
title: ${JSON.stringify(item.title)}
domains: ${JSON.stringify(item.domains)}
subdomains: ${JSON.stringify(item.subdomains)}
types: ${JSON.stringify(item.types)}
published_at: ${JSON.stringify(new Date(item.publishedAt).toISOString())}
importance: ${item.importance}
confidence: ${item.confidence}
source_url: ${JSON.stringify(item.url)}
source: ${JSON.stringify(item.source)}
companies: ${JSON.stringify(item.companies)}
institutions: ${JSON.stringify(item.institutions)}
evidence_status: ${JSON.stringify(item.evidenceStatus)}
worth_following: ${item.worthFollowing ? "true" : "false"}
---

# ${item.title}

## 核心事实

${item.summary || "未填写"}

## 投资含义

${item.investmentMeaning || "未填写"}

## 建议动作

${item.action || "未填写"}
<!-- domi:managed:end -->`;
}

function normalizedProjectStatus(value) {
  const status = String(value || "").trim();
  const normalized = status === "找投资窗口" ? "深度跟踪" : status || "待交流";
  if (!PROJECT_STATUSES.has(normalized)) {
    throw new Error("项目进展状态不在允许范围内。");
  }
  return normalized;
}

function normalizedRating(value) {
  const rating = String(value || "").trim().toUpperCase();
  if (!PROJECT_RATINGS.has(rating)) throw new Error("评级只允许 S、A、B、C 或留空。");
  return rating;
}

function projectRow(row) {
  return {
    recordId: row.id,
    name: row.name,
    domain: row.domain,
    subdomains: parseList(row.subdomains_json),
    status: row.status,
    rating: row.rating,
    notes: row.notes,
    cities: parseList(row.cities_json),
    investors: parseList(row.investors_json),
    financingHistory: row.financing_history || "",
    latestValuationUsd100m: row.latest_valuation_usd_100m === null
      ? null
      : Number(row.latest_valuation_usd_100m),
    createdAt: row.created_at || null,
    lastFollowup: row.last_updated_at || null,
    updatedAt: row.updated_at || 0,
    link: localDocumentUrl(row.document_path)
  };
}

function personRow(row) {
  return {
    recordId: row.id,
    name: row.name,
    types: parseList(row.types_json),
    organization: row.organization,
    status: row.status,
    rating: row.rating,
    createdAt: row.created_at || null,
    lastContact: row.last_contact_at || null,
    cities: parseList(row.cities_json),
    updatedAt: row.updated_at || 0,
    link: localDocumentUrl(row.document_path)
  };
}

function newsRow(row) {
  return {
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
    action: row.action,
    worthFollowing: Boolean(row.worth_following),
    updatedAt: row.updated_at || 0
  };
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
          updated_at = excluded.updated_at
        WHERE repository_meta.value <> excluded.value;
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
    const signature = workspaceEntitiesSignature(discovered);
    const previousSignature = this.database.prepare(
      "SELECT value FROM repository_meta WHERE key = 'workspace_index_signature'"
    ).get()?.value;
    if (previousSignature === signature) {
      const cached = this.database.prepare(
        "SELECT value, updated_at FROM repository_meta WHERE key = 'workspace_index'"
      ).get();
      let result;
      try {
        result = JSON.parse(cached?.value || "{}");
      } catch {
        result = {};
      }
      return {
        projects: {
          ...(result.projects || {}),
          discovered: discovered.projects.length,
          created: 0,
          linked: 0
        },
        people: {
          ...(result.people || {}),
          discovered: discovered.people.length,
          created: 0,
          linked: 0
        },
        unchanged: true,
        indexedAt: Number(cached?.updated_at) || 0
      };
    }
    const result = {
      projects: { discovered: discovered.projects.length, created: 0, linked: 0 },
      people: { discovered: discovered.people.length, created: 0, linked: 0 },
      unchanged: false
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
          const shouldEnrich = (
            (!existing.domain && project.domain)
            || (existing.subdomains_json === "[]" && project.subdomains.length > 0)
            || (!existing.status && project.status)
            || (!existing.rating && project.rating)
            || (!existing.last_updated_at && project.lastUpdatedAt)
            || shouldLink
          );
          if (shouldEnrich) {
            enrichProject.run(
              project.domain,
              JSON.stringify(project.subdomains),
              project.status,
              project.rating,
              project.lastUpdatedAt,
              project.documentPath,
              project.normalizedName
            );
          }
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
          const shouldEnrich = (
            (existing.types_json === "[]" && person.types.length > 0)
            || (!existing.organization && person.organization)
            || (!existing.status && person.status)
            || (!existing.rating && person.rating)
            || shouldLink
          );
          if (shouldEnrich) {
            enrichPerson.run(
              JSON.stringify(person.types),
              person.organization,
              person.status,
              person.rating,
              person.documentPath,
              person.normalizedName
            );
          }
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
      this.database.prepare(`
        INSERT INTO repository_meta (key, value, updated_at)
        VALUES ('workspace_index_signature', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(signature, now);
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
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      FROM projects
      ORDER BY updated_at DESC, name
    `).all().map(projectRow);
  }

  listPeople() {
    return this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at, updated_at
      FROM people
      ORDER BY updated_at DESC, name
    `).all().map(personRow);
  }

  listNews({ rangeStart, rangeEnd, limit = 500 }) {
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events
      WHERE published_at >= ? AND published_at < ? AND worth_following = 1
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(rangeStart, rangeEnd, limit).map(newsRow);
  }

  listAllNews(limit = 2_000) {
    const safeLimit = Math.min(Math.max(Number(limit) || 2_000, 1), 10_000);
    return this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events
      ORDER BY published_at DESC, importance DESC, event_id
      LIMIT ?
    `).all(safeLimit).map(newsRow);
  }

  recordDirectory(entityType, recordId) {
    const id = String(recordId || "").trim();
    if (!id) return "";
    if (entityType === "person") {
      const row = this.database.prepare(
        `SELECT id, name, types_json, organization, status, rating,
          last_contact_at, cities_json, document_path, created_at, updated_at
         FROM people WHERE id = ?`
      ).get(id);
      if (!row) return "";
      const person = personRow(row);
      const peopleRoot = path.join(this.libraryDir, PEOPLE_DIRECTORY);
      const directory = row.document_path
        ? path.dirname(row.document_path)
        : this.personDirectory(person);
      assertWithin(peopleRoot, directory);
      return fs.existsSync(directory) ? directory : "";
    }
    const row = this.database.prepare(
      `SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
       FROM projects WHERE id = ?`
    ).get(id);
    if (!row) return "";
    const project = projectRow(row);
    const projectRoot = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    const directory = row.document_path
      ? path.dirname(row.document_path)
      : this.projectDirectory(project);
    assertWithin(projectRoot, directory);
    return fs.existsSync(directory) ? directory : "";
  }

  projectDirectory(project) {
    const root = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    const domain = safePathSegment(project.domain);
    const mainSubdomain = safePathSegment(project.subdomains[0]);
    const projectName = safePathSegment(project.name, "未命名项目");
    const directory = domain === "_未分类" && mainSubdomain === "_未分类"
      ? path.join(root, domain, projectName)
      : path.join(root, domain, mainSubdomain, projectName);
    assertWithin(root, directory);
    return directory;
  }

  personDirectory(person) {
    const root = path.join(this.libraryDir, PEOPLE_DIRECTORY);
    const directory = path.join(root, safePathSegment(person.name, "未命名人物"));
    assertWithin(root, directory);
    return directory;
  }

  newsDocumentPath(item) {
    const root = path.join(this.libraryDir, NEWS_DIRECTORY);
    const published = new Date(item.publishedAt);
    if (!Number.isFinite(published.getTime())) throw new Error("行业信息发布时间无效。");
    const year = String(published.getUTCFullYear()).padStart(4, "0");
    const month = String(published.getUTCMonth() + 1).padStart(2, "0");
    const filePath = path.join(root, year, month, `${safePathSegment(item.recordId, "event")}.md`);
    assertWithin(root, filePath);
    return filePath;
  }

  updateProject(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id);
    if (!row) throw new Error("找不到要修改的项目记录。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("项目已被其他流程更新，请刷新后再保存。");
    }

    const name = String(request.name || "").trim();
    if (!name) throw new Error("公司名称不能为空。");
    const domain = String(request.domain || "").trim() || "_未分类";
    const subdomains = stringList(request.subdomains);
    const status = normalizedProjectStatus(request.status);
    const rating = normalizedRating(request.rating);
    const investors = stringList(request.investors);
    const invalidInvestor = investors.find((item) => !TRACKED_INVESTORS.has(item));
    if (invalidInvestor) throw new Error(`投资机构“${invalidInvestor}”不在当前关注名单中。`);
    const valuationInput = request.latestValuationUsd100m;
    const latestValuationUsd100m = valuationInput === null
      || valuationInput === undefined
      || valuationInput === ""
      ? null
      : Number(valuationInput);
    if (
      latestValuationUsd100m !== null
      && (!Number.isFinite(latestValuationUsd100m) || latestValuationUsd100m < 0)
    ) {
      throw new Error("最新估值必须是非负数字，单位为亿美元。");
    }
    const now = Date.now();
    const project = {
      recordId: id,
      name,
      domain,
      subdomains,
      status,
      rating,
      notes: String(request.notes || "").trim(),
      cities: stringList(request.cities),
      investors,
      financingHistory: String(request.financingHistory || "").trim(),
      latestValuationUsd100m,
      lastUpdatedAt: now
    };
    const targetDirectory = this.projectDirectory(project);
    const currentDocumentPath = String(row.document_path || "").trim();
    const currentDirectory = currentDocumentPath ? path.dirname(currentDocumentPath) : "";
    const projectRoot = path.join(this.libraryDir, PROJECTS_DIRECTORY);
    if (currentDirectory) assertWithin(projectRoot, currentDirectory);
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && targetDirectory.startsWith(`${currentDirectory}${path.sep}`)
    ) {
      throw new Error("新的项目目录不能位于原项目目录内部。");
    }
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && fs.existsSync(targetDirectory)
    ) {
      throw new Error("目标项目目录已存在，请先处理同名目录。");
    }

    let movedDirectory = false;
    let createdDirectory = false;
    let canonicalPath = path.join(targetDirectory, PROJECT_PAGE_NAME);
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (currentDirectory && targetDirectory !== currentDirectory && fs.existsSync(currentDirectory)) {
        fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
        fs.renameSync(currentDirectory, targetDirectory);
        movedDirectory = true;
      } else if (!fs.existsSync(targetDirectory)) {
        fs.mkdirSync(targetDirectory, { recursive: true });
        createdDirectory = true;
      }
      canonicalPath = path.join(targetDirectory, PROJECT_PAGE_NAME);
      previousPageExists = fs.existsSync(canonicalPath);
      previousPageContent = previousPageExists ? fs.readFileSync(canonicalPath, "utf8") : "";
      atomicWriteText(
        canonicalPath,
        replaceManagedBlock(previousPageContent, renderProjectManagedBlock(project))
      );
      const updateResult = this.database.prepare(`
        UPDATE projects SET
          name = ?, normalized_name = ?, domain = ?, subdomains_json = ?,
          status = ?, rating = ?, notes = ?, cities_json = ?, investors_json = ?,
          financing_history = ?, latest_valuation_usd_100m = ?,
          last_updated_at = ?, document_path = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(
        project.name,
        normalizedName(project.name),
        project.domain,
        JSON.stringify(project.subdomains),
        project.status,
        project.rating,
        project.notes,
        JSON.stringify(project.cities),
        JSON.stringify(project.investors),
        project.financingHistory,
        project.latestValuationUsd100m,
        now,
        canonicalPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("项目已被其他流程更新，请刷新后再保存。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(canonicalPath, previousPageContent);
        else fs.rmSync(canonicalPath, { force: true });
        if (movedDirectory && fs.existsSync(targetDirectory)) {
          fs.mkdirSync(path.dirname(currentDirectory), { recursive: true });
          fs.renameSync(targetDirectory, currentDirectory);
        } else if (createdDirectory) {
          fs.rmdirSync(targetDirectory);
        }
      } catch {}
      throw error;
    }
    return projectRow(this.database.prepare(`
      SELECT id, name, domain, subdomains_json, status, rating, notes,
        cities_json, investors_json, financing_history, latest_valuation_usd_100m,
        last_updated_at, document_path, created_at, updated_at
      FROM projects WHERE id = ?
    `).get(id));
  }

  updatePerson(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM people WHERE id = ?").get(id);
    if (!row) throw new Error("找不到要修改的人脉记录。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("人脉记录已被其他流程更新，请刷新后再保存。");
    }
    const name = String(request.name || "").trim();
    if (!name) throw new Error("人名不能为空。");
    const lastContact = request.lastContact === null
      || request.lastContact === undefined
      || request.lastContact === ""
      ? null
      : toEpochMs(request.lastContact, NaN);
    if (lastContact !== null && !Number.isFinite(lastContact)) {
      throw new Error("最后联系日期格式不正确。");
    }
    const now = Date.now();
    const person = {
      recordId: id,
      name,
      types: stringList(request.types),
      organization: String(request.organization || "").trim(),
      status: String(request.status || "").trim(),
      rating: normalizedRating(request.rating),
      lastContact,
      cities: stringList(request.cities)
    };
    const targetDirectory = this.personDirectory(person);
    const currentDocumentPath = String(row.document_path || "").trim();
    const currentDirectory = currentDocumentPath ? path.dirname(currentDocumentPath) : "";
    const peopleRoot = path.join(this.libraryDir, PEOPLE_DIRECTORY);
    if (currentDirectory) assertWithin(peopleRoot, currentDirectory);
    if (
      currentDirectory
      && targetDirectory !== currentDirectory
      && fs.existsSync(targetDirectory)
    ) {
      throw new Error("目标人脉目录已存在，请先处理同名目录。");
    }

    let movedDirectory = false;
    let createdDirectory = false;
    let canonicalPath = path.join(targetDirectory, PERSON_PAGE_NAME);
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (currentDirectory && targetDirectory !== currentDirectory && fs.existsSync(currentDirectory)) {
        fs.mkdirSync(path.dirname(targetDirectory), { recursive: true });
        fs.renameSync(currentDirectory, targetDirectory);
        movedDirectory = true;
      } else if (!fs.existsSync(targetDirectory)) {
        fs.mkdirSync(targetDirectory, { recursive: true });
        createdDirectory = true;
      }
      canonicalPath = path.join(targetDirectory, PERSON_PAGE_NAME);
      previousPageExists = fs.existsSync(canonicalPath);
      previousPageContent = previousPageExists ? fs.readFileSync(canonicalPath, "utf8") : "";
      atomicWriteText(
        canonicalPath,
        replaceManagedBlock(previousPageContent, renderPersonManagedBlock(person))
      );
      const updateResult = this.database.prepare(`
        UPDATE people SET
          name = ?, normalized_name = ?, types_json = ?, organization = ?,
          status = ?, rating = ?, last_contact_at = ?, cities_json = ?,
          document_path = ?, updated_at = ?
        WHERE id = ? AND updated_at = ?
      `).run(
        person.name,
        normalizedName(person.name),
        JSON.stringify(person.types),
        person.organization,
        person.status,
        person.rating,
        person.lastContact,
        JSON.stringify(person.cities),
        canonicalPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("人脉记录已被其他流程更新，请刷新后再保存。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(canonicalPath, previousPageContent);
        else fs.rmSync(canonicalPath, { force: true });
        if (movedDirectory && fs.existsSync(targetDirectory)) {
          fs.mkdirSync(path.dirname(currentDirectory), { recursive: true });
          fs.renameSync(targetDirectory, currentDirectory);
        } else if (createdDirectory) {
          fs.rmdirSync(targetDirectory);
        }
      } catch {}
      throw error;
    }
    return personRow(this.database.prepare(`
      SELECT id, name, types_json, organization, status, rating,
        last_contact_at, cities_json, document_path, created_at, updated_at
      FROM people WHERE id = ?
    `).get(id));
  }

  updateNews(request = {}) {
    const id = String(request.recordId || "").trim();
    const row = this.database.prepare("SELECT * FROM news_events WHERE event_id = ?").get(id);
    if (!row) throw new Error("找不到要修改的行业信息。");
    const expectedUpdatedAt = Number(request.expectedUpdatedAt);
    if (!Number.isFinite(expectedUpdatedAt) || expectedUpdatedAt !== Number(row.updated_at)) {
      throw new Error("行业信息已被其他流程更新，请刷新后再保存。");
    }
    const title = String(request.title || "").trim();
    if (!title) throw new Error("行业信息标题不能为空。");
    const publishedAt = toEpochMs(request.publishedAt, NaN);
    if (!Number.isFinite(publishedAt)) throw new Error("行业信息发布时间格式不正确。");
    const importance = Math.min(Math.max(Number(request.importance) || 0, 0), 10);
    const confidence = Math.min(Math.max(Number(request.confidence) || 0, 0), 10);
    const now = Date.now();
    const item = {
      recordId: id,
      title,
      domains: stringList(request.domains),
      subdomains: stringList(request.subdomains),
      types: stringList(request.types),
      publishedAt,
      summary: String(request.summary || "").trim(),
      investmentMeaning: String(request.investmentMeaning || "").trim(),
      url: String(request.url || "").trim(),
      source: String(request.source || "").trim(),
      companies: String(request.companies || "").trim(),
      institutions: String(request.institutions || "").trim(),
      importance,
      confidence,
      evidenceStatus: String(request.evidenceStatus || "").trim(),
      action: String(request.action || "").trim(),
      worthFollowing: request.worthFollowing !== false
    };
    if (item.url && !/^https?:\/\//i.test(item.url)) {
      throw new Error("来源链接必须使用 HTTP 或 HTTPS。");
    }
    const targetPath = this.newsDocumentPath(item);
    const currentPath = String(row.document_path || "").trim();
    const newsRoot = path.join(this.libraryDir, NEWS_DIRECTORY);
    if (currentPath) assertWithin(newsRoot, currentPath);
    if (currentPath && currentPath !== targetPath && fs.existsSync(targetPath)) {
      throw new Error("目标行业信息文档已存在。");
    }

    let movedDocument = false;
    let previousPageExists = false;
    let previousPageContent = "";
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (currentPath && currentPath !== targetPath && fs.existsSync(currentPath)) {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.renameSync(currentPath, targetPath);
        movedDocument = true;
      }
      previousPageExists = fs.existsSync(targetPath);
      previousPageContent = previousPageExists ? fs.readFileSync(targetPath, "utf8") : "";
      atomicWriteText(
        targetPath,
        replaceManagedBlock(previousPageContent, renderNewsManagedBlock(item))
      );
      const updateResult = this.database.prepare(`
        UPDATE news_events SET
          title = ?, domains_json = ?, subdomains_json = ?, types_json = ?,
          published_at = ?, summary = ?, investment_meaning = ?, url = ?,
          source = ?, companies = ?, institutions = ?, importance = ?,
          confidence = ?, evidence_status = ?, action = ?, worth_following = ?,
          document_path = ?, updated_at = ?
        WHERE event_id = ? AND updated_at = ?
      `).run(
        item.title,
        JSON.stringify(item.domains),
        JSON.stringify(item.subdomains),
        JSON.stringify(item.types),
        item.publishedAt,
        item.summary,
        item.investmentMeaning,
        item.url,
        item.source,
        item.companies,
        item.institutions,
        item.importance,
        item.confidence,
        item.evidenceStatus,
        item.action,
        item.worthFollowing ? 1 : 0,
        targetPath,
        now,
        id,
        expectedUpdatedAt
      );
      if (Number(updateResult.changes) !== 1) {
        throw new Error("行业信息已被其他流程更新，请刷新后再保存。");
      }
      this.database.exec("COMMIT");
    } catch (error) {
      try { this.database.exec("ROLLBACK"); } catch {}
      try {
        if (previousPageExists) atomicWriteText(targetPath, previousPageContent);
        else fs.rmSync(targetPath, { force: true });
        if (movedDocument && fs.existsSync(targetPath)) {
          fs.mkdirSync(path.dirname(currentPath), { recursive: true });
          fs.renameSync(targetPath, currentPath);
        }
      } catch {}
      throw error;
    }
    return newsRow(this.database.prepare(`
      SELECT event_id, title, domains_json, subdomains_json, types_json,
        published_at, summary, investment_meaning, url, source, companies,
        institutions, importance, confidence, evidence_status, action,
        worth_following, updated_at
      FROM news_events WHERE event_id = ?
    `).get(id));
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
  workspaceEntitiesSignature,
  resolveHomePath
};
