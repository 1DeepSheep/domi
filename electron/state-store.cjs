const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const CURRENT_DATABASE_SCHEMA = 2;
const MAX_DATABASE_BACKUPS = 3;

function backupDatabase(database, databasePath, fromVersion) {
  database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  const backupDir = path.join(path.dirname(databasePath), "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(backupDir, `domi-schema-${fromVersion}-${stamp}.sqlite3`);
  fs.copyFileSync(databasePath, backupPath);

  const backups = fs.readdirSync(backupDir)
    .filter((name) => /^domi-schema-.*\.sqlite3$/.test(name))
    .sort()
    .reverse();
  for (const stale of backups.slice(MAX_DATABASE_BACKUPS)) {
    fs.rmSync(path.join(backupDir, stale), { force: true });
  }
  return backupPath;
}

function safeSegment(value, fallback) {
  const cleaned = String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return cleaned || fallback;
}

function parseJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

class WorkbenchStateStore {
  constructor({ databasePath, projectsDir }) {
    this.projectsDir = path.resolve(projectsDir);
    this.databasePath = path.resolve(databasePath);
    this.threadValueCache = new Map();
    this.metaValueCache = "";
    fs.mkdirSync(path.dirname(this.databasePath), { recursive: true });
    fs.mkdirSync(this.projectsDir, { recursive: true });
    const databaseExisted = fs.existsSync(this.databasePath);
    this.database = new DatabaseSync(this.databasePath);
    this.database.exec("PRAGMA journal_mode = WAL");
    this.database.exec("PRAGMA synchronous = NORMAL");
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    const schemaRow = this.database.prepare("PRAGMA user_version").get();
    const previousSchema = Number(schemaRow?.user_version || 0);
    if (databaseExisted && previousSchema < CURRENT_DATABASE_SCHEMA) {
      backupDatabase(this.database, this.databasePath, previousSchema);
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database.exec(`
        CREATE TABLE IF NOT EXISTS workbench_state (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workbench_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS workbench_threads (
          id TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          sort_order INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_workbench_threads_sort
          ON workbench_threads(sort_order, id);
        CREATE TABLE IF NOT EXISTS news_items (
          record_id TEXT PRIMARY KEY,
          published_at INTEGER NOT NULL,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_news_items_published
          ON news_items(published_at DESC, record_id);
        CREATE TABLE IF NOT EXISTS domi_cache (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS app_secrets (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        PRAGMA user_version = ${CURRENT_DATABASE_SCHEMA};
      `);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }

    this.readLegacyStatement = this.database.prepare(
      "SELECT value, updated_at FROM workbench_state WHERE key = ?"
    );
    this.readMetaStatement = this.database.prepare(
      "SELECT value, updated_at FROM workbench_meta WHERE key = ?"
    );
    this.writeMetaStatement = this.database.prepare(`
      INSERT INTO workbench_meta (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.readThreadsStatement = this.database.prepare(
      "SELECT id, value, sort_order, updated_at FROM workbench_threads ORDER BY sort_order, id"
    );
    this.writeThreadStatement = this.database.prepare(`
      INSERT INTO workbench_threads (id, value, sort_order, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        value = excluded.value,
        sort_order = excluded.sort_order,
        updated_at = excluded.updated_at
    `);
    this.deleteThreadStatement = this.database.prepare(
      "DELETE FROM workbench_threads WHERE id = ?"
    );
    this.readCacheStatement = this.database.prepare(
      "SELECT value, updated_at FROM domi_cache WHERE key = ?"
    );
    this.writeCacheStatement = this.database.prepare(`
      INSERT INTO domi_cache (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.readSettingsStatement = this.database.prepare(
      "SELECT value, updated_at FROM app_settings WHERE key = ?"
    );
    this.writeSettingsStatement = this.database.prepare(`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.readSecretStatement = this.database.prepare(
      "SELECT value, updated_at FROM app_secrets WHERE key = ?"
    );
    this.writeSecretStatement = this.database.prepare(`
      INSERT INTO app_secrets (key, value, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);
    this.deleteSecretStatement = this.database.prepare(
      "DELETE FROM app_secrets WHERE key = ?"
    );
    this.upsertNewsStatement = this.database.prepare(`
      INSERT INTO news_items (record_id, published_at, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(record_id) DO UPDATE SET
        published_at = excluded.published_at,
        value = excluded.value,
        updated_at = excluded.updated_at
    `);
    this.listNewsStatement = this.database.prepare(`
      SELECT value FROM news_items
      WHERE published_at >= ? AND published_at < ?
      ORDER BY published_at DESC, record_id
      LIMIT ?
    `);
  }

  projectWorkspacePath(projectId, projectName, preferredPath) {
    const preferred = preferredPath ? path.resolve(preferredPath) : "";
    const rootPrefix = `${this.projectsDir}${path.sep}`;
    if (preferred.startsWith(rootPrefix)) return preferred;
    const projectPart = safeSegment(String(projectName || "").split("·")[0], "project");
    const idPart = safeSegment(projectId, "workspace").slice(-12);
    return path.join(this.projectsDir, `${projectPart}-${idPart}`);
  }

  ensureProjectWorkspace(projectId, projectName, preferredPath) {
    const workspacePath = this.projectWorkspacePath(projectId, projectName, preferredPath);
    fs.mkdirSync(path.join(workspacePath, "attachments"), { recursive: true });
    fs.mkdirSync(path.join(workspacePath, "outputs"), { recursive: true });
    return workspacePath;
  }

  normalizeThread(thread, index, { ensureWorkspace = false, recoverInterrupted = false } = {}) {
    const id = String(thread?.id || `thread-${Date.now()}-${index}`);
    const projectId = String(thread?.projectId || `project-${id}`);
    const project = String(thread?.project || "未命名项目");
    const workspacePath = ensureWorkspace
      ? this.ensureProjectWorkspace(projectId, project, thread?.workspacePath)
      : this.projectWorkspacePath(projectId, project, thread?.workspacePath);
    const messages = Array.isArray(thread?.messages)
      ? thread.messages.map((message) => recoverInterrupted && message?.status === "running" ? {
          ...message,
          status: "error",
          content: message.content || "上次运行在 domi 关闭时中断。"
        } : message)
      : [];

    return {
      ...thread,
      id,
      projectId,
      project,
      workspacePath,
      lastActiveAt: Number.isFinite(Number(thread?.lastActiveAt)) ? Number(thread.lastActiveAt) : 0,
      pinned: Boolean(thread?.pinned),
      manualTitle: typeof thread?.manualTitle === "boolean"
        ? thread.manualTitle
        : id.startsWith("thread-demo-"),
      messages,
      timeline: Array.isArray(thread?.timeline) ? thread.timeline : [],
      lastUsage: thread?.lastUsage || null
    };
  }

  normalize(state, options = {}) {
    const threads = (Array.isArray(state?.threads) ? state.threads : [])
      .map((thread, index) => this.normalizeThread(thread, index, options));
    const requestedActiveId = String(state?.activeThreadId || "");
    const activeThreadId = threads.some((thread) => thread.id === requestedActiveId)
      ? requestedActiveId
      : threads[0]?.id || "";
    if (!threads.some((thread) => thread.lastActiveAt > 0)) {
      const activeThread = threads.find((thread) => thread.id === activeThreadId);
      if (activeThread) activeThread.lastActiveAt = Date.now();
    }
    const rawPreferences = state?.agentPreferences || {};
    return {
      version: 2,
      activeThreadId,
      threads,
      agentPreferences: {
        model: String(rawPreferences.model || "default").slice(0, 120),
        reasoningEffort: String(rawPreferences.reasoningEffort || "default").slice(0, 40),
        serviceTier: String(rawPreferences.serviceTier || "default").slice(0, 80),
        domiPluginEnabled: rawPreferences.domiPluginEnabled !== false
      },
      executionSuggestionState: state?.executionSuggestionState && typeof state.executionSuggestionState === "object"
        ? state.executionSuggestionState
        : {}
    };
  }

  normalizeMeta(meta, orderedThreadIds) {
    const rawPreferences = meta?.agentPreferences || {};
    const activeThreadId = orderedThreadIds.includes(String(meta?.activeThreadId || ""))
      ? String(meta.activeThreadId)
      : orderedThreadIds[0] || "";
    return {
      version: 2,
      activeThreadId,
      agentPreferences: {
        model: String(rawPreferences.model || "default").slice(0, 120),
        reasoningEffort: String(rawPreferences.reasoningEffort || "default").slice(0, 40),
        serviceTier: String(rawPreferences.serviceTier || "default").slice(0, 80),
        domiPluginEnabled: rawPreferences.domiPluginEnabled !== false
      },
      executionSuggestionState: meta?.executionSuggestionState && typeof meta.executionSuggestionState === "object"
        ? meta.executionSuggestionState
        : {}
    };
  }

  stateMeta(state) {
    const { threads: _threads, ...meta } = state;
    return meta;
  }

  persistNormalizedState(state, updatedAt = Date.now()) {
    const metaValue = JSON.stringify(this.stateMeta(state));
    const nextThreadIds = new Set(state.threads.map((thread) => thread.id));
    const currentRows = this.readThreadsStatement.all();
    if (!this.metaValueCache) {
      this.metaValueCache = this.readMetaStatement.get("current")?.value || "";
    }
    if (this.threadValueCache.size === 0 && currentRows.length > 0) {
      for (const row of currentRows) {
        this.threadValueCache.set(row.id, { value: row.value, sortOrder: row.sort_order });
      }
    }

    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (metaValue !== this.metaValueCache) {
        this.writeMetaStatement.run("current", metaValue, updatedAt);
        this.metaValueCache = metaValue;
      }
      state.threads.forEach((thread, sortOrder) => {
        const value = JSON.stringify(thread);
        const cached = this.threadValueCache.get(thread.id);
        if (!cached || cached.value !== value || cached.sortOrder !== sortOrder) {
          this.writeThreadStatement.run(thread.id, value, sortOrder, updatedAt);
          this.threadValueCache.set(thread.id, { value, sortOrder });
        }
      });
      for (const row of currentRows) {
        if (!nextThreadIds.has(row.id)) {
          this.deleteThreadStatement.run(row.id);
          this.threadValueCache.delete(row.id);
        }
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  load(defaultState) {
    const metaRow = this.readMetaStatement.get("current");
    const threadRows = this.readThreadsStatement.all();
    if (metaRow && threadRows.length > 0) {
      const meta = parseJson(metaRow.value);
      const threads = threadRows.map((row) => parseJson(row.value)).filter(Boolean);
      if (meta && threads.length > 0) {
        this.metaValueCache = metaRow.value;
        for (const row of threadRows) {
          this.threadValueCache.set(row.id, { value: row.value, sortOrder: row.sort_order });
        }
        const normalized = this.normalize(
          { ...meta, threads },
          { ensureWorkspace: true, recoverInterrupted: true }
        );
        // Persist one-time recovery changes so an interrupted run is not repaired
        // again on every launch. Unchanged rows are skipped by the value cache.
        this.persistNormalizedState(normalized, Date.now());
        const updatedAt = Math.max(
          Number(metaRow.updated_at) || 0,
          ...threadRows.map((row) => Number(row.updated_at) || 0)
        );
        return { state: normalized, updatedAt, isNew: false };
      }
    }

    const legacyRow = this.readLegacyStatement.get("current");
    const legacyState = legacyRow ? parseJson(legacyRow.value) : null;
    const normalized = this.normalize(
      legacyState || defaultState,
      { ensureWorkspace: true, recoverInterrupted: true }
    );
    const updatedAt = legacyRow?.updated_at || Date.now();
    this.persistNormalizedState(normalized, updatedAt);
    return { state: normalized, updatedAt, isNew: !legacyState };
  }

  save(state) {
    const normalized = this.normalize(state);
    const updatedAt = Date.now();
    this.persistNormalizedState(normalized, updatedAt);
    return { state: normalized, updatedAt };
  }

  savePatch(patch) {
    const currentRows = this.readThreadsStatement.all();
    const requestedOrder = Array.isArray(patch?.threadOrder)
      ? [...new Set(patch.threadOrder.map(String))]
      : currentRows.map((row) => row.id);
    const changedThreads = Array.isArray(patch?.threads)
      ? patch.threads.map((thread, index) => this.normalizeThread(
          thread,
          requestedOrder.indexOf(String(thread?.id)) >= 0
            ? requestedOrder.indexOf(String(thread?.id))
            : index
        ))
      : [];
    const changedById = new Map(changedThreads.map((thread) => [thread.id, thread]));
    const deletedIds = new Set(Array.isArray(patch?.deletedThreadIds)
      ? patch.deletedThreadIds.map(String)
      : []);
    const currentById = new Map(currentRows.map((row) => [row.id, row]));
    const finalOrder = requestedOrder.filter((id) => !deletedIds.has(id));
    for (const thread of changedThreads) {
      if (!finalOrder.includes(thread.id)) finalOrder.push(thread.id);
    }
    const meta = this.normalizeMeta(patch?.meta, finalOrder);
    const metaValue = JSON.stringify(meta);
    const updatedAt = Date.now();

    this.database.exec("BEGIN IMMEDIATE");
    try {
      const storedMeta = this.metaValueCache || this.readMetaStatement.get("current")?.value || "";
      if (storedMeta !== metaValue) {
        this.writeMetaStatement.run("current", metaValue, updatedAt);
        this.metaValueCache = metaValue;
      }
      for (const deletedId of deletedIds) {
        this.deleteThreadStatement.run(deletedId);
        this.threadValueCache.delete(deletedId);
      }
      finalOrder.forEach((id, sortOrder) => {
        const changed = changedById.get(id);
        const existing = currentById.get(id);
        const value = changed ? JSON.stringify(changed) : existing?.value;
        if (!value) return;
        if (changed || existing?.sort_order !== sortOrder) {
          this.writeThreadStatement.run(id, value, sortOrder, updatedAt);
          this.threadValueCache.set(id, { value, sortOrder });
        }
      });
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { updatedAt };
  }

  upsertNews(items) {
    const normalizedItems = Array.isArray(items) ? items.filter((item) =>
      item?.recordId && Number.isFinite(Number(item?.publishedAt))
    ) : [];
    if (normalizedItems.length === 0) return { count: 0, updatedAt: 0 };
    const updatedAt = Date.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      for (const item of normalizedItems) {
        this.upsertNewsStatement.run(
          String(item.recordId),
          Number(item.publishedAt),
          JSON.stringify(item),
          updatedAt
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return { count: normalizedItems.length, updatedAt };
  }

  listNews({ rangeStart = 0, rangeEnd = Number.MAX_SAFE_INTEGER, limit = 100 } = {}) {
    return this.listNewsStatement
      .all(Number(rangeStart) || 0, Number(rangeEnd) || Number.MAX_SAFE_INTEGER, Math.max(1, Number(limit) || 100))
      .map((row) => parseJson(row.value))
      .filter(Boolean);
  }

  loadCache(key) {
    const row = this.readCacheStatement.get(String(key));
    if (!row) return null;
    const value = parseJson(row.value);
    return value === null ? null : { value, updatedAt: row.updated_at };
  }

  saveCache(key, value) {
    const updatedAt = Date.now();
    this.writeCacheStatement.run(String(key), JSON.stringify(value), updatedAt);
    return { value, updatedAt };
  }

  loadAppSettings(key, fallback) {
    const row = this.readSettingsStatement.get(String(key));
    if (!row) return { value: fallback, updatedAt: 0 };
    const value = parseJson(row.value, fallback);
    return { value, updatedAt: row.updated_at };
  }

  saveAppSettings(key, value) {
    const updatedAt = Date.now();
    this.writeSettingsStatement.run(String(key), JSON.stringify(value), updatedAt);
    return { value, updatedAt };
  }

  loadSecret(key) {
    const row = this.readSecretStatement.get(String(key));
    return row ? { value: row.value, updatedAt: row.updated_at } : null;
  }

  saveSecret(key, value) {
    const updatedAt = Date.now();
    this.writeSecretStatement.run(String(key), String(value), updatedAt);
    return { updatedAt };
  }

  deleteSecret(key) {
    this.deleteSecretStatement.run(String(key));
  }

  close() {
    this.database.close();
  }
}

module.exports = { WorkbenchStateStore };
