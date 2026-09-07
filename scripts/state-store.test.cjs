const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { WorkbenchStateStore } = require("../electron/state-store.cjs");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

for (const method of ["save", "savePatch"]) {
  test(`${method} retries all changes after a failed COMMIT without a reload`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-rollback-"));
    const store = new WorkbenchStateStore({
      databasePath: path.join(root, "domi.sqlite3"), projectsDir: path.join(root, "projects")
    });
    try {
      const initial = store.save({ activeThreadId: "one", threads: [
        { id: "one", title: "one", lastActiveAt: 1, messages: [] },
        { id: "two", title: "two", lastActiveAt: 2, messages: [] }
      ] }).state;
      const next = structuredClone(initial);
      next.agentPreferences.model = "selected-model";
      next.threads[0].messages.push({ role: "user", content: "Must survive a retry" });
      next.threads.pop();
      const write = () => method === "save"
        ? store.save(next)
        : store.savePatch({ meta: store.stateMeta(next), threads: next.threads,
            threadOrder: ["one"], deletedThreadIds: ["two"] });
      const exec = store.database.exec.bind(store.database);
      store.database.exec = (sql) => {
        if (sql === "COMMIT") throw new Error("synthetic commit failure");
        return exec(sql);
      };
      assert.throws(write, /synthetic commit failure/);
      assert.equal(JSON.parse(store.readMetaStatement.get("current").value).agentPreferences.model, "default");
      assert.equal(store.readThreadsStatement.all().length, 2);
      store.database.exec = exec;
      write();
      const stored = store.load({ threads: [] }).state;
      assert.equal(stored.agentPreferences.model, "selected-model");
      assert.equal(stored.threads.length, 1);
      assert.equal(stored.threads[0].messages[0].content, "Must survive a retry");
    } finally {
      store.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
}

test("a cold patch reorders and deletes history without reading unrelated message bodies", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-patch-history-"));
  const options = { databasePath: path.join(root, "domi.sqlite3"), projectsDir: path.join(root, "projects") };
  let store = new WorkbenchStateStore(options);
  try {
    const state = store.save({ activeThreadId: "one", threads: ["one", "two", "three"].map((id) => ({
      id, title: id, lastActiveAt: 1, messages: [{ role: "assistant", content: id.repeat(30_000) }]
    })) }).state;
    store.close();
    store = new WorkbenchStateStore(options);
    const readAll = store.readThreadsStatement.all.bind(store.readThreadsStatement);
    store.readThreadsStatement.all = () => { throw new Error("patch read the entire history"); };
    const changed = { ...state.threads[1], title: "edited" };
    store.savePatch({ meta: { ...store.stateMeta(state), activeThreadId: "two" },
      threads: [changed], threadOrder: ["two", "one"], deletedThreadIds: ["three"] });
    const rows = readAll();
    assert.deepEqual(rows.map((row) => row.id), ["two", "one"]);
    assert.equal(JSON.parse(rows[0].value).title, "edited");
    assert.equal(JSON.parse(rows[1].value).messages[0].content, "one".repeat(30_000));
    // Metadata-only patches are also independent of history size.
    store.savePatch({ meta: { ...store.stateMeta(state), activeThreadId: "one" } });
    assert.equal(JSON.parse(store.readMetaStatement.get("current").value).activeThreadId, "one");
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("todo checkpoints survive full saves and patches, while invalid evidence is discarded", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-todo-checkpoint-"));
  const options = { databasePath: path.join(root, "domi.sqlite3"), projectsDir: path.join(root, "projects") };
  let store = new WorkbenchStateStore(options);
  const checkpoint = { fingerprint: "a".repeat(64), ledgerFingerprint: "b".repeat(64),
    ruleVersion: "todo-v1", repositoryIdentity: "local:synthetic", verifiedAt: 100, nextEvaluationAt: 200 };
  try {
    const saved = store.save({ activeThreadId: "one", threads: [{ id: "one", messages: [], lastActiveAt: 1 }],
      todoSyncCheckpoint: checkpoint }).state;
    store.close();
    store = new WorkbenchStateStore(options);
    assert.deepEqual(store.load({ threads: [] }).state.todoSyncCheckpoint, checkpoint);
    const next = { ...checkpoint, nextEvaluationAt: 300 };
    store.savePatch({ meta: { ...store.stateMeta(saved), todoSyncCheckpoint: next } });
    assert.deepEqual(store.load({ threads: [] }).state.todoSyncCheckpoint, next);
    for (const invalid of [{ fingerprint: "not-a-hash" }, { verifiedAt: 0 }, { nextEvaluationAt: Infinity },
      { ruleVersion: "x".repeat(121) }, { repositoryIdentity: "" }]) {
      store.savePatch({ meta: { ...store.stateMeta(saved), todoSyncCheckpoint: { ...checkpoint, ...invalid } } });
      assert.equal(store.load({ threads: [] }).state.todoSyncCheckpoint, undefined);
    }
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("state store migrates legacy snapshots and writes only changed threads", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-store-"));
  const databasePath = path.join(root, "domi.sqlite3");
  const projectsDir = path.join(root, "projects");
  const legacyDatabase = new DatabaseSync(databasePath);
  legacyDatabase.exec(`
    CREATE TABLE workbench_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);
    PRAGMA user_version = 1;
  `);
  const legacyState = {
    version: 1,
    activeThreadId: "one",
    threads: [
      { id: "one", projectId: "project-one", project: "项目一", title: "一", messages: [], lastActiveAt: 2 },
      { id: "two", projectId: "project-two", project: "项目二", title: "二", messages: [], lastActiveAt: 1 }
    ],
    agentPreferences: {
      model: "gpt-test",
      reasoningEffort: "high",
      serviceTier: "fast",
      domiPluginEnabled: false
    },
    executionSuggestionState: { dismissedKeys: ["person-a"] }
  };
  legacyDatabase.prepare("INSERT INTO workbench_state VALUES (?, ?, ?)")
    .run("current", JSON.stringify(legacyState), 1234);
  legacyDatabase.close();

  const store = new WorkbenchStateStore({ databasePath, projectsDir });
  try {
    const loaded = store.load({ threads: [] });
    assert.equal(loaded.isNew, false);
    assert.equal(loaded.state.threads.length, 2);
    assert.equal(loaded.state.agentPreferences.domiPluginEnabled, false);
    assert.deepEqual(loaded.state.executionSuggestionState.dismissedKeys, ["person-a"]);

    const inspect = new DatabaseSync(databasePath, { readOnly: true });
    const initialRows = inspect.prepare("SELECT id, updated_at FROM workbench_threads ORDER BY id").all();
    assert.equal(initialRows.length, 2);
    const initialTimes = Object.fromEntries(initialRows.map((row) => [row.id, row.updated_at]));

    await pause(5);
    store.save(loaded.state);
    const unchangedRows = inspect.prepare("SELECT id, updated_at FROM workbench_threads ORDER BY id").all();
    assert.deepEqual(Object.fromEntries(unchangedRows.map((row) => [row.id, row.updated_at])), initialTimes);

    await pause(5);
    const changedState = structuredClone(loaded.state);
    changedState.threads[0].messages.push({ id: "m1", role: "user", content: "测试" });
    store.save(changedState);
    const changedRows = inspect.prepare("SELECT id, updated_at FROM workbench_threads ORDER BY id").all();
    const changedTimes = Object.fromEntries(changedRows.map((row) => [row.id, row.updated_at]));
    assert.ok(changedTimes.one > initialTimes.one);
    assert.equal(changedTimes.two, initialTimes.two);

    await pause(5);
    store.savePatch({
      meta: {
        activeThreadId: "two",
        agentPreferences: changedState.agentPreferences,
        executionSuggestionState: changedState.executionSuggestionState
      },
      threads: [{ ...changedState.threads[1], title: "二（补丁更新）" }],
      deletedThreadIds: [],
      threadOrder: ["two", "one"]
    });
    const patched = store.load({ threads: [] }).state;
    assert.equal(patched.activeThreadId, "two");
    assert.equal(patched.threads[0].id, "two");
    assert.equal(patched.threads[0].title, "二（补丁更新）");
    assert.equal(patched.threads[1].messages[0].content, "测试");
    inspect.close();

    store.upsertNews([
      { recordId: "news-1", publishedAt: 1000, title: "一" },
      { recordId: "news-2", publishedAt: 2000, title: "二" }
    ]);
    assert.deepEqual(
      store.listNews({ rangeStart: 0, rangeEnd: 3000 }).map((item) => item.recordId),
      ["news-2", "news-1"]
    );
    assert.ok(fs.readdirSync(path.join(root, "backups")).some((name) => name.endsWith(".sqlite3")));
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("generic tasks use isolated hidden runtimes while entity tasks keep their canonical directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-workspaces-"));
  const databasePath = path.join(root, "domi.sqlite3");
  const projectsDir = path.join(root, "projects");
  const entityDirectory = path.join(root, "domi工作区", "3.项目库", "AI", "Agent", "示例项目");
  fs.mkdirSync(entityDirectory, { recursive: true });
  const store = new WorkbenchStateStore({ databasePath, projectsDir });
  try {
    const normalized = store.normalize({
      activeThreadId: "generic",
      threads: [
        {
          id: "generic",
          projectId: "generic-project",
          project: "未命名项目",
          workspacePath: path.join(projectsDir, "old-generic-runtime"),
          messages: []
        },
        {
          id: "generic-two",
          projectId: "generic-project-two",
          project: "未命名项目",
          workspacePath: root,
          messages: []
        },
        {
          id: "entity",
          projectId: "entity-project",
          project: "AI · Agent",
          workspacePath: entityDirectory,
          messages: []
        }
      ]
    }, { ensureWorkspace: true });

    assert.equal(normalized.threads[0].workspacePath.startsWith(`${projectsDir}${path.sep}task-`), true);
    assert.notEqual(normalized.threads[0].workspacePath, root);
    assert.equal(normalized.threads[1].workspacePath.startsWith(`${projectsDir}${path.sep}task-`), true);
    assert.notEqual(normalized.threads[0].workspacePath, normalized.threads[1].workspacePath);
    assert.equal(normalized.threads[2].workspacePath, entityDirectory);
    assert.equal(fs.existsSync(path.join(entityDirectory, "attachments")), false);
    assert.equal(fs.existsSync(path.join(entityDirectory, "outputs")), false);
    assert.equal(fs.existsSync(path.join(normalized.threads[0].workspacePath, "attachments")), true);
    assert.equal(fs.existsSync(path.join(normalized.threads[0].workspacePath, "outputs")), true);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reopening an untouched new-task draft does not create a task workspace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-unused-draft-"));
  const databasePath = path.join(root, "domi.sqlite3");
  const projectsDir = path.join(root, "projects");
  const draft = {
    id: "unused-draft",
    projectId: "unused-draft-project",
    title: "新的投资任务",
    project: "未命名项目",
    manualTitle: false,
    messages: [{
      id: "greeting",
      role: "assistant",
      status: "idle",
      content: "新对话已创建。选择一个 workflow，或直接输入你要 Codex 完成的投资任务。"
    }],
    timeline: []
  };

  let store = new WorkbenchStateStore({ databasePath, projectsDir });
  try {
    const saved = store.save({ activeThreadId: draft.id, threads: [draft] });
    const workspacePath = saved.state.threads[0].workspacePath;
    assert.equal(workspacePath, root);
    assert.deepEqual(fs.readdirSync(projectsDir), []);
    store.close();

    store = new WorkbenchStateStore({ databasePath, projectsDir });
    const loaded = store.load({ activeThreadId: "", threads: [] });
    assert.equal(loaded.state.threads[0].workspacePath, workspacePath);
    assert.deepEqual(loaded.state.threads[0].messages, []);
    assert.deepEqual(fs.readdirSync(projectsDir), []);
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cache pruning is scoped by prefix and retains only the newest entries", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-cache-"));
  const store = new WorkbenchStateStore({
    databasePath: path.join(root, "domi.sqlite3"),
    projectsDir: path.join(root, "projects")
  });
  try {
    store.saveCache("research-cache-v1:project:a", { value: "a" });
    await pause(3);
    store.saveCache("research-cache-v1:project:b", { value: "b" });
    store.saveCache("other-cache", { value: "keep" });
    const result = store.pruneCache("research-cache-v1:project:", { maxEntries: 1 });
    assert.equal(result.deleted, 1);
    assert.equal(store.loadCache("research-cache-v1:project:a"), null);
    assert.deepEqual(store.loadCache("research-cache-v1:project:b")?.value, { value: "b" });
    assert.deepEqual(store.loadCache("other-cache")?.value, { value: "keep" });
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cache compare-and-swap rejects a stale concurrent writer", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-state-cache-cas-"));
  const store = new WorkbenchStateStore({
    databasePath: path.join(root, "domi.sqlite3"),
    projectsDir: path.join(root, "projects")
  });
  try {
    const initial = store.saveCache("research-cache-v1:project:example", { value: "initial" });
    const newer = store.saveCacheIfUnchanged(
      "research-cache-v1:project:example",
      { value: "newer" },
      initial.updatedAt
    );
    const stale = store.saveCacheIfUnchanged(
      "research-cache-v1:project:example",
      { value: "stale" },
      initial.updatedAt
    );
    assert.equal(newer.saved, true);
    assert.equal(stale.saved, false);
    assert.deepEqual(
      store.loadCache("research-cache-v1:project:example")?.value,
      { value: "newer" }
    );
  } finally {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
