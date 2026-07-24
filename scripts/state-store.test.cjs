const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { WorkbenchStateStore } = require("../electron/state-store.cjs");

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
