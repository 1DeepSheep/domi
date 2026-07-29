const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  DomiIntegration,
  describeFeishuSyncError,
  isRetryableFeishuReadError,
  parseTaskLedger,
  resolveLarkCliExecutable,
  renderTaskLedger,
  resolveWeeklyNewsTimestamps
} = require("../electron/domi-integration.cjs");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");

test("Finder-launched app resolves the npm lark-cli launcher to its native binary", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-lark-cli-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scriptsDir = path.join(root, "lib", "node_modules", "@larksuite", "cli", "scripts");
  const nativeDir = path.join(root, "lib", "node_modules", "@larksuite", "cli", "bin");
  const launcherDir = path.join(root, "bin");
  fs.mkdirSync(scriptsDir, { recursive: true });
  fs.mkdirSync(nativeDir, { recursive: true });
  fs.mkdirSync(launcherDir, { recursive: true });

  const launcher = path.join(scriptsDir, "run.js");
  const native = path.join(nativeDir, "lark-cli");
  const linkedLauncher = path.join(launcherDir, "lark-cli");
  fs.writeFileSync(launcher, "#!/usr/bin/env node\n", { mode: 0o755 });
  fs.writeFileSync(
    native,
    "#!/bin/sh\nprintf '{\"verified\":true,\"identities\":{}}\\n'\n",
    { mode: 0o755 }
  );
  fs.symlinkSync(path.relative(launcherDir, launcher), linkedLauncher);

  const resolvedNative = fs.realpathSync(native);
  assert.equal(resolveLarkCliExecutable(linkedLauncher), resolvedNative);

  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.larkCli = resolveLarkCliExecutable(linkedLauncher);
  const originalPath = process.env.PATH;
  process.env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
  try {
    const status = await integration.larkStatus();
    assert.equal(status.ok, true);
    assert.equal(status.cliPath, resolvedNative);
  } finally {
    process.env.PATH = originalPath;
  }
});

test("1.待办事项 ledger XML round-trips without leaking document configuration", () => {
  const ledger = {
    schemaVersion: 1,
    updatedAt: "2026-07-28T00:00:00.000Z",
    tasks: [{
      id: "task-example",
      title: "联系 A & B",
      reason: "关键节点临近",
      priority: "P1",
      category: "relationship-milestone",
      status: "open",
      source: { kind: "person", recordId: "record-example", displayName: "示例人物" },
      dueAt: "2026-07-31T01:00:00.000Z",
      suggestedAction: { kind: "schedule", label: "约日程", prompt: "采用 $domi:schedule 安排会面。" },
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:00.000Z"
    }]
  };
  const xml = renderTaskLedger(ledger).replace("<pre ", '<pre id="block-example" ');
  assert.match(xml, /caption="domi-task-board-v1"/);
  const parsed = parseTaskLedger({ data: { content: xml } });
  assert.equal(parsed.found, true);
  assert.equal(parsed.blockId, "block-example");
  assert.equal(parsed.ledger.tasks[0].title, "联系 A & B");
  assert.equal(parsed.ledger.tasks[0].category, "key-milestone");
  assert.equal(parsed.ledger.tasks[0].suggestedAction.kind, "schedule");
});

test("1.待办事项 ledger accepts Feishu-rendered captions and code-block line breaks", () => {
  const xml = renderTaskLedger({
    schemaVersion: 1,
    tasks: [{
      id: "task-feishu-rendered",
      title: "跟进示例项目",
      category: "project-follow-up",
      priority: "P1",
      status: "open",
      source: { kind: "project", recordId: "project-example", displayName: "示例项目" },
      suggestedAction: { kind: "contact", label: "联系", prompt: "联系项目团队" }
    }]
  })
    .replace('caption="domi-task-board-v1"', 'caption="domi-task-board-v1&#xA;"')
    .replace(/\n/g, "<br />")
    .replace("<pre ", '<pre id="block-feishu" ');

  const parsed = parseTaskLedger({ data: { document: { content: xml } } });
  assert.equal(parsed.found, true);
  assert.equal(parsed.blockId, "block-feishu");
  assert.equal(parsed.ledger.tasks[0].id, "task-feishu-rendered");
});

test("task status updates use a precise block replacement and verify the result", async () => {
  const cache = new Map();
  const stateStore = {
    loadCache: (key) => cache.get(key) || null,
    saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "feishu",
      taskDocumentUrl: "document_token"
    })
  });
  let documentXml = renderTaskLedger({
    schemaVersion: 1,
    tasks: [{
      id: "task-example",
      title: "安排会面",
      priority: "P2",
      status: "open",
      source: { kind: "person", recordId: "record-example", displayName: "示例人物" },
      suggestedAction: { kind: "schedule", label: "约日程", prompt: "安排会面" }
    }]
  }).replace("<pre ", '<pre id="block-example" ');
  const calls = [];
  integration.lark = async (args) => {
    calls.push(args);
    if (args.includes("+update")) {
      const content = args[args.indexOf("--content") + 1];
      documentXml = content.replace("<pre ", '<pre id="block-verified" ');
      return { ok: true };
    }
    return { data: { content: documentXml } };
  };

  const result = await integration.updateTask({
    taskId: "task-example",
    status: "ignored"
  });
  assert.equal(result.ok, true);
  assert.equal(result.task.status, "ignored");
  const updateCall = calls.find((args) => args.includes("+update"));
  assert.equal(updateCall[updateCall.indexOf("--command") + 1], "block_replace");
  assert.equal(updateCall[updateCall.indexOf("--block-id") + 1], "block-example");
  assert.equal(result.snapshot.tasks[0].status, "ignored");
});

test("task board cache is isolated when the configured document changes", () => {
  const cache = new Map();
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: (key) => cache.get(key) || null,
      saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.saveTaskBoardCache({
    schemaVersion: 1,
    updatedAt: "2026-07-28T00:00:00.000Z",
    tasks: []
  }, "document_one");
  assert.ok(integration.loadTaskBoardCache("document_one"));
  assert.equal(integration.loadTaskBoardCache("document_two"), null);
});

test("task board migrates a legacy 1.Task title to 1.待办事项", async () => {
  const cache = new Map();
  const stateStore = {
    loadCache: (key) => cache.get(key) || null,
    saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "feishu",
      wikiSpaceId: "placeholder"
    })
  });
  const calls = [];
  let currentTitle = "1. Task";
  integration.lark = async (args) => {
    calls.push(args);
    if (args[0] === "drive" && args[1] === "+search") {
      const query = args[args.indexOf("--query") + 1];
      return {
        data: {
          results: query === "intitle:1.Task"
            ? [{
                entity_type: "DOCX",
                title_highlighted: "1. <h>Task</h>",
                result_meta: { token: "task_document" }
              }]
            : []
        }
      };
    }
    if (args[0] === "wiki" && args[1] === "+node-get") {
      return {
        data: {
          node: {
            node_token: "task_node",
            obj_token: "task_document",
            obj_type: "docx",
            title: currentTitle
          }
        }
      };
    }
    if (args[0] === "drive" && args[1] === "files" && args[2] === "patch") {
      currentTitle = JSON.parse(args[args.indexOf("--data") + 1]).new_title;
      return { ok: true };
    }
    return {
      data: {
        content: renderTaskLedger({
          schemaVersion: 1,
          tasks: [{
            id: "task-example",
            title: "安排会面",
            priority: "P2",
            status: "open",
            source: { kind: "person", recordId: "record-example", displayName: "示例人物" },
            suggestedAction: { kind: "schedule", label: "约日程", prompt: "安排会面" }
          }]
        }).replace("<pre ", '<pre id="block-example" ')
      }
    };
  };

  const result = await integration.taskBoard();
  assert.equal(result.ok, true);
  assert.equal(result.configured, true);
  assert.equal(result.tasks.length, 1);
  assert.ok(calls.some((args) => args[0] === "drive" && args[1] === "+search"));
  const resolveCall = calls.find((args) => args[0] === "wiki" && args[1] === "+node-get");
  assert.equal(resolveCall[resolveCall.indexOf("--node-token") + 1], "task_document");
  assert.equal(resolveCall[resolveCall.indexOf("--obj-type") + 1], "docx");
  const renameCall = calls.find((args) =>
    args[0] === "drive" && args[1] === "files" && args[2] === "patch"
  );
  assert.equal(renameCall[renameCall.indexOf("--file-token") + 1], "task_node");
  assert.equal(JSON.parse(renameCall[renameCall.indexOf("--data") + 1]).new_title, "1.待办事项");
  const fetchCall = calls.find((args) => args[0] === "docs" && args[1] === "+fetch");
  assert.equal(fetchCall[fetchCall.indexOf("--doc") + 1], "task_document");
});

test("task board automatically selects the only populated canonical ledger among empty legacy documents", async () => {
  const cache = new Map();
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: (key) => cache.get(key) || null,
      saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "feishu",
      wikiSpaceId: "placeholder"
    })
  });
  const calls = [];
  const nodes = new Map([
    ["https://example.invalid/wiki/wik-canonical", {
      node_token: "wik-canonical",
      obj_token: "document-canonical",
      obj_type: "docx",
      title: "1.待办事项"
    }],
    ["https://example.invalid/wiki/legacy-one", {
      node_token: "legacy-one",
      obj_token: "document-legacy-one",
      obj_type: "docx",
      title: "1.Task"
    }],
    ["https://example.invalid/wiki/legacy-two", {
      node_token: "legacy-two",
      obj_token: "document-legacy-two",
      obj_type: "docx",
      title: "1. Task"
    }]
  ]);
  const renderedLedger = (ledger, blockId) => renderTaskLedger(ledger)
    .replace('caption="domi-task-board-v1"', 'caption="domi-task-board-v1&#xA;"')
    .replace(/\n/g, "<br />")
    .replace("<pre ", `<pre id="${blockId}" `);
  const documents = new Map([
    ["document-canonical", renderedLedger({
      schemaVersion: 1,
      tasks: [{
        id: "task-canonical",
        title: "跟进规范待办",
        category: "project-follow-up",
        priority: "P1",
        status: "open",
        source: { kind: "project", recordId: "project-example", displayName: "示例项目" },
        suggestedAction: { kind: "contact", label: "联系", prompt: "联系项目团队" }
      }]
    }, "block-canonical")],
    ["document-legacy-one", renderedLedger({ schemaVersion: 1, tasks: [] }, "block-legacy-one")],
    ["document-legacy-two", renderedLedger({ schemaVersion: 1, tasks: [] }, "block-legacy-two")]
  ]);

  integration.lark = async (args) => {
    calls.push(args);
    if (args[0] === "drive" && args[1] === "+search") {
      const query = args[args.indexOf("--query") + 1];
      const urls = query === "intitle:1.待办事项"
        ? ["https://example.invalid/wiki/wik-canonical"]
        : [
            "https://example.invalid/wiki/legacy-one",
            "https://example.invalid/wiki/legacy-two"
          ];
      return {
        data: {
          results: urls.map((url) => ({
            entity_type: "WIKI",
            title_highlighted: nodes.get(url).title,
            result_meta: { token: nodes.get(url).node_token, doc_types: "DOCX", url }
          }))
        }
      };
    }
    if (args[0] === "wiki" && args[1] === "+node-get") {
      return { data: { node: nodes.get(args[args.indexOf("--node-token") + 1]) } };
    }
    if (args[0] === "docs" && args[1] === "+fetch") {
      return { data: { document: { content: documents.get(args[args.indexOf("--doc") + 1]) } } };
    }
    throw new Error(`Unexpected call: ${args.join(" ")}`);
  };

  const result = await integration.taskBoard();
  assert.equal(result.ok, true);
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].id, "task-canonical");
  assert.ok(calls.some((args) =>
    args[0] === "wiki"
    && args[1] === "+node-get"
    && args[args.indexOf("--node-token") + 1] === "https://example.invalid/wiki/legacy-one"
  ));
  assert.equal(calls.some((args) =>
    args[0] === "drive" && args[1] === "files" && args[2] === "patch"
  ), false);
});

test("new Feishu libraries get a 1.待办事项 document and initialized ledger", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "feishu",
      wikiSpaceId: "placeholder"
    })
  });
  const calls = [];
  let initializedContent = "";
  integration.lark = async (args) => {
    calls.push(args);
    if (args[0] === "wiki" && args[1] === "+node-list") {
      return { data: { nodes: [] } };
    }
    if (args[0] === "wiki" && args[1] === "+node-create") {
      return {
        data: {
          node_token: "task_node",
          obj_token: "task_document",
          obj_type: "docx",
          title: "1.待办事项"
        }
      };
    }
    if (args[0] === "docs" && args[1] === "+update") {
      initializedContent = args[args.indexOf("--content") + 1];
      return { ok: true };
    }
    return {
      data: {
        content: initializedContent.replace("<pre ", '<pre id="block-example" ')
      }
    };
  };

  const result = await integration.ensureTaskDocument();
  assert.deepEqual(result, { ok: true, created: true });
  const createCall = calls.find((args) => args[0] === "wiki" && args[1] === "+node-create");
  assert.equal(createCall[createCall.indexOf("--space-id") + 1], "placeholder");
  assert.equal(createCall[createCall.indexOf("--title") + 1], "1.待办事项");
  assert.match(initializedContent, /caption="domi-task-board-v1"/);
  assert.ok(calls.some((args) => args[0] === "docs" && args[1] === "+fetch"));
});

test("local task board reads and safely updates 0.待办事项.md", async (t) => {
  const libraryDir = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-task-board-"));
  t.after(() => fs.rmSync(libraryDir, { recursive: true, force: true }));
  const cache = new Map();
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: (key) => cache.get(key) || null,
      saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "local",
      localRepositoryDir: libraryDir
    })
  });

  const emptyBoard = await integration.taskBoard();
  assert.equal(emptyBoard.ok, true);
  assert.deepEqual(emptyBoard.tasks, []);

  const todoDocumentPath = path.join(libraryDir, "0.待办事项.md");
  const initialContent = fs.readFileSync(todoDocumentPath, "utf8");
  const taskBlock = renderTaskLedger({
    schemaVersion: 1,
    tasks: [{
      id: "task-local",
      title: "联系本地项目团队",
      priority: "P1",
      category: "project-follow-up",
      status: "open",
      source: { kind: "project", recordId: "project-local", displayName: "本地项目" },
      suggestedAction: { kind: "contact", label: "联系", prompt: "联系项目团队" }
    }]
  });
  fs.writeFileSync(
    todoDocumentPath,
    `${initialContent.replace(/<pre\b[^>]*>[\s\S]*?<\/pre>/i, taskBlock)}\n用户补充内容\n`
  );

  const result = await integration.updateTask({
    taskId: "task-local",
    status: "ignored"
  });
  assert.equal(result.ok, true);
  assert.equal(result.task.status, "ignored");
  assert.match(fs.readFileSync(todoDocumentPath, "utf8"), /用户补充内容/);
  assert.equal(parseTaskLedger(fs.readFileSync(todoDocumentPath, "utf8")).ledger.tasks[0].status, "ignored");
});

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

test("project and people snapshots preserve system intake timestamps", () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  const projectCreatedAt = 1_753_660_800_000;
  const personCreatedAtSeconds = 1_753_664_400;

  const projects = integration.normalizeProjects({
    items: [
      {
        record_id: "project-1",
        fields: {
          公司名称: "示例科技",
          入库时间: projectCreatedAt
        }
      },
      {
        record_id: "project-2",
        created_time: personCreatedAtSeconds,
        fields: {
          公司名称: "回退科技",
          入库时间: ""
        }
      }
    ]
  });
  const people = integration.normalizePeople({
    items: [
      {
        record_id: "person-1",
        created_time: personCreatedAtSeconds,
        fields: { 人名: "张三" }
      },
      {
        record_id: "person-2",
        createdTime: projectCreatedAt,
        fields: {
          人名: "李四",
          入库时间: []
        }
      }
    ]
  });

  assert.equal(projects[0].createdAt, projectCreatedAt);
  assert.equal(projects[1].createdAt, personCreatedAtSeconds * 1000);
  assert.equal(people[0].createdAt, personCreatedAtSeconds * 1000);
  assert.equal(people[1].createdAt, projectCreatedAt);
});

test("client sync delegates intake field setup to the bundled plugin migration", async (t) => {
  const pluginRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-intake-fields-"));
  t.after(() => fs.rmSync(pluginRoot, { recursive: true, force: true }));
  const script = path.join(
    pluginRoot,
    "skills",
    "investment-mgmt",
    "scripts",
    "ensure-intake-time-fields.js"
  );
  fs.mkdirSync(path.dirname(script), { recursive: true });
  fs.writeFileSync(script, "#!/usr/bin/env node\n");

  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    domiConfigPath: "/tmp/domi-runtime/domi-plugin-config.json"
  });
  let received;
  integration.runJson = async (binary, args, options) => {
    received = { binary, args, options };
    return { ok: true };
  };

  await integration.ensureIntakeTimeFields({ root: pluginRoot });

  assert.equal(received.binary, process.execPath);
  assert.deepEqual(received.args, [script, "ensure"]);
  assert.equal(received.options.queue, "lark");
  assert.equal(received.options.env.DOMI_CONFIG_PATH, "/tmp/domi-runtime/domi-plugin-config.json");
  assert.equal(received.options.env.LARK_CLI_PATH, integration.larkCli);
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
  integration.ensureIntakeTimeFields = async () => ({ ok: true });
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
    manifest: { interface: { displayName: "domi" } }
  });
  integration.status = async () => ({
    plugin: { ok: true, version: "test", displayName: "domi", root: "/tmp/domi-plugin" },
    lark: { ok: true, disabled: true, userName: "", appName: "本地资料库" },
    plaud: { ok: true, queueCount: 0, queueStages: {} }
  });

  const syncResult = await integration.sync();
  assert.equal(syncResult.snapshot.backend, "local");
  assert.equal(syncResult.snapshot.projects[0].name, "示例科技");
  assert.equal(syncResult.snapshot.projects[0].createdAt, now);
  assert.equal(syncResult.snapshot.people[0].name, "张三");
  assert.equal(syncResult.snapshot.people[0].createdAt, now);
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
  integration.loadActivePlaudWorkflowRecords = () => [];
  integration.runJson = async () => ({ ok: true, items: [] });

  const result = await integration.plaudQueue();

  assert.equal(requestedLimit, "50");
  assert.deepEqual(result.items.map((item) => item.fileId), ["newer-recording", "older-recording"]);
  assert.equal(integration.plaudRemoteHealth.ok, true);
  assert.equal(integration.plaudRemoteHealth.error, "");
});

test("PLAUD health status reuses the latest queue result without reopening a browser", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      storageBackend: "local",
      plaudConnectionMode: "enabled",
      plaudBrowser: "tabbit"
    })
  });
  integration.findPlugin = () => ({
    root: "/tmp/domi-plugin",
    version: "test",
    manifest: {}
  });
  integration.plaudRemoteHealth = {
    ok: true,
    error: "",
    checkedAt: Date.now()
  };
  integration.runPlaudConnectionCommand = async () => {
    throw new Error("status must not reopen the PLAUD browser");
  };
  integration.runPlaudWorker = async () => {
    throw new Error("status must not start the remote PLAUD list worker");
  };
  integration.runJson = async () => {
    throw new Error("status must not queue a PLAUD subprocess");
  };
  integration.loadActivePlaudWorkflowRecords = () => [
    { fileId: "queued", stage: "transcript_ready" }
  ];

  const health = await integration.status();

  assert.equal(health.plaud.ok, true);
  assert.equal(health.plaud.queueCount, 1);
  assert.deepEqual(health.plaud.queueStages, { transcript_ready: 1 });
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
  const domiConfigPath = "/tmp/domi-runtime/domi-plugin-config.json";
  const mediaRuntime = {
    ok: true,
    source: "bundled",
    ffmpegPath: "/tmp/domi-runtime/bin/ffmpeg",
    ffprobePath: "/tmp/domi-runtime/bin/ffprobe"
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    domiConfigPath,
    playwrightNodeModules,
    mediaRuntime
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  let receivedOptions;
  integration.runJson = async (_binary, _args, options) => {
    receivedOptions = options;
    return { ok: true, items: [] };
  };

  await integration.runPlaudWorker("list", ["50"]);

  assert.equal(receivedOptions.env.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(receivedOptions.env.DOMI_CONFIG_PATH, domiConfigPath);
  assert.equal(receivedOptions.env.DOMI_FFMPEG_PATH, mediaRuntime.ffmpegPath);
  assert.equal(receivedOptions.env.DOMI_FFPROBE_PATH, mediaRuntime.ffprobePath);
  assert.equal(receivedOptions.env.NODE_PATH.split(path.delimiter)[0], playwrightNodeModules);
});

test("PLAUD connection uses the selected private browser profile command", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      plaudConnectionMode: "enabled",
      plaudBrowser: "chrome"
    })
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  const calls = [];
  integration.runJson = async (binary, args, options) => {
    calls.push({ binary, args, options });
    return {
      ok: true,
      connected: args[1] === "login" || args[1] === "connection",
      browser: args[2],
      browserLabel: args[2] === "tabbit" ? "Tabbit" : "Google Chrome"
    };
  };

  const login = await integration.loginPlaud({ browser: "chrome" });
  const check = await integration.plaudConnection({ browser: "tabbit" });

  assert.equal(login.connected, true);
  assert.deepEqual(calls[0].args.slice(-2), ["doctor", "chrome"]);
  assert.deepEqual(calls[1].args.slice(-2), ["login", "chrome"]);
  assert.deepEqual(calls[2].args.slice(-2), ["doctor", "tabbit"]);
  assert.deepEqual(calls[3].args.slice(-2), ["connection", "tabbit"]);
  assert.equal(calls[1].options.queue, "plaud");
  assert.equal(calls[1].options.timeout, 11 * 60 * 1000);
  assert.equal(check.browserLabel, "Tabbit");
});

test("PLAUD login reports a structured failure before opening a browser when runtime check fails", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      plaudConnectionMode: "enabled",
      plaudBrowser: "chrome"
    })
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  const calls = [];
  integration.runJson = async (_binary, args) => {
    calls.push(args[1]);
    throw new Error("domi 内置音频运行时不完整，请重新安装最新版 domi。");
  };

  const result = await integration.loginPlaud({ browser: "chrome" });
  assert.equal(result.ok, false);
  assert.equal(result.connected, false);
  assert.equal(result.status, "runtime_unavailable");
  assert.match(result.error, /内置音频运行时不完整/);
  assert.deepEqual(calls, ["doctor"]);
});

test("PLAUD connection distinguishes a locked private browser profile", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      plaudConnectionMode: "enabled",
      plaudBrowser: "tabbit"
    })
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.runJson = async () => {
    throw new Error("Profile is already in use: SingletonLock");
  };

  const result = await integration.plaudConnection({ browser: "tabbit" });

  assert.equal(result.status, "profile_locked");
  assert.equal(result.browserLabel, "Tabbit");
  assert.match(result.error, /另一个 domi 实例/);
  assert.equal(typeof result.checkedAt, "number");
});
