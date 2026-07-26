const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DomiIntegration,
  describeFeishuSyncError,
  isRetryableFeishuReadError,
  resolveWeeklyNewsTimestamps
} = require("../electron/domi-integration.cjs");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");

test("weekly news timestamps distinguish a successful check from changed content", () => {
  const item = {
    recordId: "news-1",
    title: "已有新闻",
    publishedAt: 1_700_000_000_000,
    domains: ["AI"]
  };
  const unchanged = resolveWeeklyNewsTimestamps({
    checkedAt: 1_700_000_100_000,
    contentUpdatedAt: 1_700_000_050_000,
    syncedAt: 1_700_000_050_000,
    items: [item]
  }, [item], 1_700_000_200_000);
  assert.deepEqual(unchanged, {
    checkedAt: 1_700_000_200_000,
    contentUpdatedAt: 1_700_000_050_000,
    changed: false
  });

  const changed = resolveWeeklyNewsTimestamps({
    checkedAt: 1_700_000_100_000,
    contentUpdatedAt: 1_700_000_050_000,
    items: [item]
  }, [{ ...item, title: "新闻有实质更新" }], 1_700_000_300_000);
  assert.deepEqual(changed, {
    checkedAt: 1_700_000_300_000,
    contentUpdatedAt: 1_700_000_300_000,
    changed: true
  });
});

test("weekly news content timestamp does not move when an old item only ages out", () => {
  const retained = {
    recordId: "news-retained",
    title: "仍在七天窗口内",
    publishedAt: 1_700_000_100_000,
    domains: ["AI"]
  };
  const expired = {
    recordId: "news-expired",
    title: "刚滚出七天窗口",
    publishedAt: 1_699_000_000_000,
    domains: ["AI"]
  };
  const result = resolveWeeklyNewsTimestamps({
    checkedAt: 1_700_000_200_000,
    contentUpdatedAt: 1_700_000_150_000,
    items: [retained, expired]
  }, [retained], 1_700_000_300_000);
  assert.deepEqual(result, {
    checkedAt: 1_700_000_300_000,
    contentUpdatedAt: 1_700_000_150_000,
    changed: false
  });
});

test("weekly news radar checkpoint is independent and monotonic", () => {
  const cache = new Map();
  const stateStore = {
    loadCache: (key) => cache.get(key) || null,
    saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    playwrightNodeModules: "/tmp"
  });
  const firstCheckpoint = Date.now() - 60_000;
  assert.deepEqual(integration.recordWeeklyNewsRadarCheckpoint({
    checkedThrough: firstCheckpoint
  }), {
    ok: true,
    radarCheckedThrough: firstCheckpoint
  });
  assert.deepEqual(integration.recordWeeklyNewsRadarCheckpoint({
    checkedThrough: firstCheckpoint - 60_000
  }), {
    ok: true,
    radarCheckedThrough: firstCheckpoint
  });
  assert.equal(integration.loadWeeklyNewsRadarCheckpoint(), firstCheckpoint);
});

test("Feishu record reads retry transient EOF errors and reduce page payload size", async () => {
  const delays = [];
  const calls = [];
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });
  integration.lark = async (args) => {
    calls.push(args);
    if (calls.length < 3) {
      throw new Error('飞书数据读取执行失败：API call failed: Post "[远程接口]": EOF');
    }
    return {
      data: {
        items: [{ record_id: "record-1", fields: { 公司名称: "示例科技" } }],
        total: 1,
        has_more: false
      }
    };
  };

  const result = await integration.fetchRecords({
    appToken: "example",
    tableId: "table_id",
    fieldNames: ["公司名称"]
  });

  assert.equal(calls.length, 3);
  assert.deepEqual(delays, [350, 900]);
  const paramsIndex = calls[0].indexOf("--params");
  assert.equal(JSON.parse(calls[0][paramsIndex + 1]).page_size, 200);
  assert.deepEqual(result.items.map((item) => item.record_id), ["record-1"]);
});

test("Feishu record reads do not retry authorization failures", async () => {
  let attempts = 0;
  const delays = [];
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    sleep: async (milliseconds) => {
      delays.push(milliseconds);
    }
  });
  integration.lark = async () => {
    attempts += 1;
    throw new Error("need_user_authorization");
  };

  await assert.rejects(
    integration.fetchRecords({
      appToken: "example",
      tableId: "table_id",
      fieldNames: ["公司名称"]
    }),
    /need_user_authorization/
  );
  assert.equal(attempts, 1);
  assert.deepEqual(delays, []);
});

test("Feishu sync preserves cached data and hides API URLs after repeated network failure", async () => {
  const cachedSnapshot = {
    version: 1,
    backend: "feishu",
    syncedAt: 1_700_000_000_000,
    health: {},
    sources: {
      projects: { name: "项目库", total: 1, localLibraryDir: "/tmp/library" },
      people: { name: "人脉库", total: 1 }
    },
    projects: [{ recordId: "project-1", name: "缓存项目" }],
    people: [{ recordId: "person-1", name: "缓存人脉" }]
  };
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => ({ value: cachedSnapshot, updatedAt: 1_700_000_100_000 }),
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.readProjectConfig = () => ({
    backend: "feishu",
    appToken: "example",
    tableId: "table_id",
    wikiSpaceId: "placeholder",
    localLibraryDir: "/tmp/library"
  });
  integration.resolvePeopleBase = () => ({
    appToken: "example",
    tableId: "table_id"
  });
  integration.status = async () => ({
    plugin: { ok: true },
    lark: { ok: true },
    plaud: { ok: true }
  });
  integration.fetchRecords = async () => {
    throw new Error(
      '飞书数据读取执行失败：API call failed: Post "https://example.com/api/request": EOF'
    );
  };

  const result = await integration.sync();

  assert.equal(result.ok, false);
  assert.equal(result.stale, true);
  assert.equal(result.snapshot, cachedSnapshot);
  assert.match(result.error, /自动重试后仍未恢复/);
  assert.match(result.error, /已继续使用上次同步的数据/);
  assert.doesNotMatch(result.error, /https?:\/\//);
  assert.doesNotMatch(result.error, /example\.com|api\/request/);
});

test("Feishu error classification distinguishes transient failures from expired authorization", () => {
  assert.equal(isRetryableFeishuReadError(new Error("socket hang up")), true);
  assert.equal(isRetryableFeishuReadError(new Error("Unexpected end of JSON input")), true);
  assert.equal(isRetryableFeishuReadError(new Error("need_user_authorization")), false);
  assert.equal(
    describeFeishuSyncError(new Error("need_user_authorization"), { hasCache: true }),
    "飞书授权已失效，请在“资料连接”中重新授权。当前仍显示上次同步的数据。"
  );
});

test("weekly news falls back to retained local history when Feishu is offline", async () => {
  const retained = [{
    recordId: "retained-news",
    title: "已保留新闻",
    publishedAt: Date.now() - 60_000,
    domains: ["AI"]
  }];
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined,
    upsertNews: () => undefined,
    listNews: ({ rangeStart, rangeEnd }) => retained.filter((item) =>
      item.publishedAt >= rangeStart && item.publishedAt < rangeEnd
    )
  };
  const integration = new DomiIntegration({ stateStore, plaudOutputDir: "/tmp/domi-test" });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.readRadarConfig = () => ({ appToken: "app", tableId: "table", baseUrl: "https://example.com" });
  integration.lark = async () => {
    throw new Error("offline");
  };

  const result = await integration.weeklyNews({ days: 7, page: 0, limit: 100 });
  assert.equal(result.ok, true);
  assert.equal(result.fromCache, true);
  assert.equal(result.stale, true);
  assert.match(result.error, /offline/);
  assert.deepEqual(result.items.map((item) => item.recordId), ["retained-news"]);
});

test("local repository mode syncs projects, people and news without Feishu", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-integration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "资料库");
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  const now = Date.now();
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_demo", "示例科技", "示例科技", "AI", '["Agent"]', "深度跟踪", "A",
    "项目摘要", '["上海"]', '["示例资本"]', now,
    path.join(libraryDir, "3.项目库", "AI", "Agent", "示例科技", "项目主页.md"),
    now, now
  );
  repository.database.prepare(`
    INSERT INTO people (
      id, name, normalized_name, types_json, organization, status, rating,
      last_contact_at, cities_json, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "per_demo", "张三", "张三", '["创业者"]', "示例科技 · CEO", "已联系", "A",
    now, '["上海"]', path.join(libraryDir, "4.人脉库", "张三", "人物主页.md"), now, now
  );
  repository.database.prepare(`
    INSERT INTO news_events (
      event_id, title, domains_json, subdomains_json, types_json, published_at,
      summary, investment_meaning, url, source, companies, institutions,
      importance, confidence, evidence_status, action, worth_following,
      document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "evt_demo", "示例行业动态", '["AI"]', '["Agent"]', '["公司动态"]', now,
    "核心事实", "投资含义", "https://example.com", "示例来源", "示例科技", "",
    8, 9, "官方确认", "继续跟踪", 1,
    path.join(libraryDir, "2.行业动态", "2026", "07", "evt_demo.md"), now, now
  );
  repository.close();

  const cache = new Map();
  const news = [];
  const stateStore = {
    loadCache: (key) => cache.get(key) || null,
    saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() }),
    upsertNews: (items) => {
      news.splice(0, news.length, ...items);
    },
    listNews: ({ rangeStart, rangeEnd, limit }) => news
      .filter((item) => item.publishedAt >= rangeStart && item.publishedAt < rangeEnd)
      .slice(0, limit)
  };
  const integration = new DomiIntegration({
    stateStore,
    configProvider: () => ({
      storageBackend: "local",
      localRepositoryDir: libraryDir,
      localDatabasePath: databasePath
    }),
    plaudOutputDir: path.join(root, "plaud")
  });
  integration.findPlugin = () => ({
    root: "/tmp/domi-plugin",
    version: "test",
    manifest: { interface: { displayName: "Domi" } }
  });
  integration.status = async () => ({
    plugin: { ok: true, version: "test", displayName: "Domi", root: "/tmp/domi-plugin" },
    lark: { ok: true, disabled: true, userName: "", appName: "本地资料库" },
    plaud: { ok: true, queueCount: 0, queueStages: {} }
  });

  const syncResult = await integration.sync();
  assert.equal(syncResult.snapshot.backend, "local");
  assert.equal(syncResult.snapshot.projects[0].name, "示例科技");
  assert.equal(syncResult.snapshot.people[0].name, "张三");
  assert.equal(syncResult.snapshot.sources.projects.localDatabasePath, databasePath);

  const newsResult = await integration.weeklyNews({ days: 7, page: 0 });
  assert.equal(newsResult.backend, "local");
  assert.deepEqual(newsResult.items.map((item) => item.recordId), ["evt_demo"]);
});

test("PLAUD queue loads 50 recordings by default and orders them by creation time", async () => {
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const integration = new DomiIntegration({ stateStore, plaudOutputDir: "/tmp/domi-test" });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  let requestedLimit = "";
  integration.runPlaudWorker = async (command, args) => {
    assert.equal(command, "list");
    requestedLimit = args[0];
    return {
      ok: true,
      pendingCount: 0,
      items: [
        { fileId: "older-recording", fileName: "较早录音", createdAt: 1_720_000_000 },
        { fileId: "newer-recording", fileName: "较新录音", createdAt: 1_730_000_000_000 }
      ]
    };
  };
  integration.runJson = async () => ({ ok: true, items: [] });

  const result = await integration.plaudQueue();

  assert.equal(requestedLimit, "50");
  assert.deepEqual(result.items.map((item) => item.fileId), ["newer-recording", "older-recording"]);
});

test("disabled PLAUD never starts a worker or probes the local login", async () => {
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "local",
      plaudConnectionMode: "disabled"
    })
  });
  integration.findPlugin = () => ({
    root: "/tmp/domi-plugin",
    version: "test",
    manifest: {}
  });
  integration.runJson = async () => {
    throw new Error("disabled PLAUD must not execute a command");
  };
  integration.runPlaudWorker = async () => {
    throw new Error("disabled PLAUD must not start a worker");
  };

  const queue = await integration.plaudQueue();
  const health = await integration.status();

  assert.equal(queue.ok, false);
  assert.equal(queue.disabled, true);
  assert.deepEqual(queue.items, []);
  assert.equal(health.plaud.disabled, true);
  assert.equal(health.plaud.error, "");
});

test("PLAUD queue restores terminal workflow stages for recent remote recordings", async (t) => {
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const plaudStateDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plaud-status-"));
  t.after(() => fs.rmSync(plaudStateDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(plaudStateDir, "plaud-workflow.json"), JSON.stringify({
    version: 1,
    records: {
      completed: {
        fileId: "completed",
        fileName: "已完成录音",
        stage: "managed",
        transcriptPath: "/tmp/completed.md"
      },
      pending: {
        fileId: "pending",
        fileName: "待处理录音",
        stage: "transcript_ready",
        transcriptPath: "/tmp/pending.md"
      }
    }
  }));
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    plaudStateDir
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.runPlaudWorker = async () => ({
    ok: true,
    pendingCount: 0,
    items: [
      { fileId: "completed", fileName: "已完成录音", createdAt: 1_730_000_000_000 },
      { fileId: "pending", fileName: "待处理录音", createdAt: 1_720_000_000_000 }
    ]
  });
  integration.runJson = async () => ({
    ok: true,
    items: [{
      fileId: "pending",
      fileName: "待处理录音",
      stage: "transcript_ready",
      transcriptPath: "/tmp/pending.md"
    }]
  });

  const result = await integration.plaudQueue();

  assert.equal(result.items.find((item) => item.fileId === "completed").queueStage, "managed");
  assert.equal(result.items.find((item) => item.fileId === "pending").queueStage, "transcript_ready");
  assert.equal(result.queueCount, 1);
});

test("PLAUD workers receive the app Playwright runtime through NODE_PATH", async () => {
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const playwrightNodeModules = "/tmp/domi-runtime/node_modules";
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    playwrightNodeModules
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  let receivedOptions;
  integration.runJson = async (_binary, _args, options) => {
    receivedOptions = options;
    return { ok: true, items: [] };
  };

  await integration.runPlaudWorker("list", ["50"]);

  assert.equal(receivedOptions.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(receivedOptions.env.NODE_PATH.split(path.delimiter)[0], playwrightNodeModules);
});
