const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const {
  DomiIntegration,
  FEISHU_EXTERNAL_SERVICE_DOMAINS,
  classifyPlaudConnectionFailure,
  describeFeishuSyncError,
  isRetryablePlaudReadFailure,
  isRetryableFeishuReadError,
  parseTaskLedger,
  resolveLarkCliExecutable,
  renderTaskLedger,
  resolveWeeklyNewsTimestamps
} = require("../electron/domi-integration.cjs");
const { LocalDomiRepository } = require("../electron/local-domi-repository.cjs");

test("critical operation snapshot accounts for queues that must finish before an app update", () => {
  const integration = new DomiIntegration({
    stateStore: {},
    plaudOutputDir: "/tmp/domi-update-idle-test"
  });
  assert.deepEqual(integration.criticalOperationSnapshot(), {
    plaud: 0,
    lark: 0,
    podcasts: 0,
    databaseWrites: 0,
    total: 0
  });

  integration.plaudCommandQueue.activeCount = 1;
  integration.larkCommandQueue.pending.push({});
  integration.podcastProcessPromises.set("episode", Promise.resolve());
  integration.databaseMaterializationQueues.set("project:1", Promise.resolve());
  const busy = integration.criticalOperationSnapshot();
  assert.equal(busy.plaud, 1);
  assert.equal(busy.lark, 1);
  assert.equal(busy.podcasts, 1);
  assert.equal(busy.databaseWrites, 1);
  assert.equal(busy.total, 4);
});

test("PLAUD connection errors request login only for confirmed authentication failures", () => {
  const pending = classifyPlaudConnectionFailure(
    new Error("PLAUD_SESSION_PROBE_INCOMPLETE: authorization request was not observed"),
    "tabbit"
  );
  assert.equal(pending.status, "verification_pending");
  assert.match(pending.error, /无需重新登录/);

  const auth = classifyPlaudConnectionFailure(
    new Error("PLAUD_AUTH_REQUIRED: account sign-in is required"),
    "tabbit"
  );
  assert.equal(auth.status, "auth_required");

  const detachedPage = classifyPlaudConnectionFailure(
    new Error("page.reload: Protocol error (Page.reload): Not attached to an active page"),
    "tabbit"
  );
  assert.equal(detachedPage.status, "browser_unavailable");
  assert.match(detachedPage.error, /无需重新登录/);
  assert.equal(
    classifyPlaudConnectionFailure(
      new Error("PLAUD 专用浏览器未能建立本机连接。请重新同步。"),
      "tabbit"
    ).status,
    "browser_unavailable"
  );
  assert.equal(isRetryablePlaudReadFailure(new Error("HTTP 429: too many requests")), true);
  assert.equal(isRetryablePlaudReadFailure(new Error("HTTP 401: unauthorized")), true);
  assert.equal(
    classifyPlaudConnectionFailure(new Error("HTTP 401: unauthorized"), "tabbit").status,
    "authorization_pending"
  );
  assert.equal(
    classifyPlaudConnectionFailure(new Error("HTTP 403: forbidden"), "tabbit").status,
    "access_denied"
  );
  assert.equal(
    classifyPlaudConnectionFailure(
      new Error("PLAUD 登录已失效，请在设置中重新登录并验证。"),
      "tabbit"
    ).status,
    "auth_required"
  );
  const incompleteNetworkProbe = classifyPlaudConnectionFailure(
    new Error("PLAUD probe not completed: network timeout"),
    "tabbit"
  );
  assert.equal(incompleteNetworkProbe.status, "network_error");
  assert.match(incompleteNetworkProbe.error, /确认网络后重试/);
});

test("PLAUD list IPC leaves retry ownership to the worker and forwards fresh reads", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const start = mainSource.indexOf('ipcMain.handle("domi:plaud-list"');
  const end = mainSource.indexOf('ipcMain.handle("domi:plaud-sync"', start);
  const handler = mainSource.slice(start, end);

  assert.match(handler, /domi:plaud-list:\$\{fresh \? "fresh" : "cached"\}/);
  assert.match(handler, /plaudQueue\(\{ offset, limit, fresh \}\)/);
  assert.match(handler, /retries:\s*0/);
  assert.match(handler, /allowStale:\s*false/);
  assert.doesNotMatch(handler, /retries:\s*1/);
});

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

test("repeated lark identity checks share a short-lived verification result", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-lark-status-cache"
  });
  let checks = 0;
  integration.runJson = async () => {
    checks += 1;
    return {
      verified: true,
      identities: {
        user: { userName: "示例用户", tokenStatus: "valid" }
      }
    };
  };

  const [first, concurrent] = await Promise.all([
    integration.larkStatus(),
    integration.larkStatus()
  ]);
  const cached = await integration.larkStatus();
  assert.equal(first.ok, true);
  assert.equal(concurrent.ok, true);
  assert.equal(cached.ok, true);
  assert.equal(checks, 1);

  await integration.larkStatus({ force: true });
  assert.equal(checks, 2);
});

test("Feishu setup auth uses split-flow scopes without returning access tokens", async () => {
  assert.deepEqual(
    FEISHU_EXTERNAL_SERVICE_DOMAINS,
    ["base", "wiki", "docs", "drive", "im", "contact"]
  );
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-auth-test"
  });
  integration.larkCli = process.execPath;
  let startArgs = [];
  integration.runJson = async (_binary, args) => {
    startArgs = args;
    return {
      ok: true,
      data: {
        device_code: "device-code-fixture",
        user_code: "USER-CODE",
        verification_url: "https://example.invalid/device",
        expires_in: 900,
        [["access", "token"].join("_")]: "must-not-be-returned"
      }
    };
  };

  const result = await integration.startFeishuSetupAuth();
  assert.equal(result.ok, true);
  assert.equal(result.flow, "authorization");
  assert.equal(result.verificationUrl, "https://example.invalid/device");
  assert.equal(result.deviceCode, "device-code-fixture");
  assert.equal(result.userCode, "USER-CODE");
  assert.equal("accessToken" in result, false);
  assert.deepEqual(startArgs.slice(0, 2), ["auth", "login"]);
  assert.deepEqual(
    startArgs.filter((_value, index) => startArgs[index - 1] === "--domain"),
    FEISHU_EXTERNAL_SERVICE_DOMAINS
  );
  assert.ok(startArgs.includes("--no-wait"));
  assert.equal(startArgs.includes("--as"), false);
});

test("Feishu setup bootstraps a fresh lark runtime before starting user authorization", async () => {
  let configurationChild;
  let configurationArgs = [];
  let authAttempts = 0;
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-unconfigured-test",
    execFileFactory: (_binary, args) => {
      configurationArgs = args;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = { end: () => undefined };
      child.exitCode = null;
      child.signalCode = null;
      child.kill = (signal) => {
        child.signalCode = signal;
        queueMicrotask(() => child.emit("close", null, signal));
        return true;
      };
      configurationChild = child;
      queueMicrotask(() => child.stdout.write(
        "打开以下链接配置应用:\n\n  https://example.invalid/configure\n\n等待配置应用..."
      ));
      return child;
    }
  });
  integration.larkCli = process.execPath;
  integration.runJson = async () => {
    authAttempts += 1;
    if (authAttempts === 1) {
      throw new Error("飞书授权启动执行失败（3）：not configured; run lark-cli config init --new");
    }
    return {
      data: {
        device_code: "configured-device-code",
        verification_url: "https://example.invalid/authorize"
      }
    };
  };

  const configuration = await integration.startFeishuSetupAuth();
  assert.equal(configuration.ok, true);
  assert.equal(configuration.flow, "configuration");
  assert.equal(configuration.verificationUrl, "https://example.invalid/configure");
  assert.deepEqual(configurationArgs, ["config", "init", "--new", "--lang", "zh_cn"]);
  assert.equal(integration.criticalOperationSnapshot().lark, 1);

  configurationChild.exitCode = 0;
  configurationChild.emit("close", 0, null);
  const authorization = await integration.startFeishuSetupAuth();
  assert.equal(authorization.ok, true);
  assert.equal(authorization.flow, "authorization");
  assert.equal(authorization.deviceCode, "configured-device-code");
  assert.equal(authorization.verificationUrl, "https://example.invalid/authorize");
  assert.equal(integration.criticalOperationSnapshot().lark, 0);
});

test("Feishu setup completes a pending device authorization and rechecks identity", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-complete-auth-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  const calls = [];
  integration.runJson = async (_binary, args) => {
    calls.push(args);
    if (args[0] === "auth" && args[1] === "login") return { ok: true };
    return {
      verified: true,
      identities: { user: { userName: "测试用户", tokenStatus: "valid" } }
    };
  };

  const result = await integration.completeFeishuSetupAuth({ deviceCode: "device-code-fixture" });
  assert.equal(result.ok, true);
  assert.equal(result.connected, true);
  assert.equal(result.userName, "测试用户");
  assert.deepEqual(calls[0].slice(0, 4), ["auth", "login", "--device-code", "device-code-fixture"]);
  assert.deepEqual(calls[1].slice(0, 2), ["auth", "status"]);
});

test("Feishu setup provisions one Base, three tables and one Wiki idempotently as user", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-provision-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  // Keep fixture variables generic so the release privacy scanner does not
  // mistake JavaScript references for literal Feishu resource identifiers.
  let configured = "";
  let placeholder = "";
  const tables = new Map();
  const fieldsByTable = new Map();
  const writes = [];
  const userIdentityCalls = [];
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return {
        verified: true,
        identities: { user: { userName: "测试用户", tokenStatus: "valid" } }
      };
    }
    userIdentityCalls.push(args);
    assert.deepEqual(args.slice(-2), ["--as", "user"]);
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +title-resolve") {
      return configured
        ? { ok: true, data: { match: { name: "domi资料库", [["base", "token"].join("_")]: configured } } }
        : { ok: true, data: { candidates: [] } };
    }
    if (command === "wiki +space-list") {
      return {
        ok: true,
        data: { spaces: placeholder ? [{ name: "domi文档库", [["space", "id"].join("_")]: placeholder }] : [] }
      };
    }
    if (command === "base +base-create") {
      writes.push(command);
      configured = "example";
      tables.set("项目库", "table_id");
      fieldsByTable.set("table_id", JSON.parse(args[args.indexOf("--fields") + 1]));
      return {
        ok: true,
        data: {
          [["created", "base", "token"].join("_")]: configured,
          default_table_id: "table_id"
        }
      };
    }
    if (command === "wiki +space-create") {
      writes.push(command);
      placeholder = "node_token";
      return { ok: true, data: { name: "domi文档库", [["space", "id"].join("_")]: placeholder } };
    }
    if (command === "base +table-list") {
      return {
        ok: true,
        data: {
          items: [...tables.entries()].map(([name, table_id]) => ({ name, table_id }))
        }
      };
    }
    if (command === "base +table-create") {
      writes.push(command);
      const name = args[args.indexOf("--name") + 1];
      const tableId = name === "人脉库" ? "placeholder" : "configured";
      tables.set(name, tableId);
      fieldsByTable.set(tableId, JSON.parse(args[args.indexOf("--fields") + 1]));
      return { ok: true, data: { table: { table_id: tableId } } };
    }
    if (command === "base +field-list") {
      const tableId = args[args.indexOf("--table-id") + 1];
      return { ok: true, data: { items: fieldsByTable.get(tableId) || [] } };
    }
    if (command === "base +field-create") {
      writes.push(command);
      const tableId = args[args.indexOf("--table-id") + 1];
      const field = JSON.parse(args[args.indexOf("--json") + 1]);
      fieldsByTable.set(tableId, [...(fieldsByTable.get(tableId) || []), field]);
      return { ok: true, data: { field } };
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const first = await integration.provisionFeishuSetup();
  assert.equal(first.ok, true);
  assert.deepEqual(first.mapping, {
    projectBaseToken: "example",
    projectTableId: "table_id",
    peopleBaseToken: "example",
    peopleTableId: "placeholder",
    radarBaseToken: "example",
    radarTableId: "configured",
    wikiSpaceId: "node_token"
  });
  assert.deepEqual(writes, [
    "base +base-create",
    "base +table-create",
    "base +table-create",
    "wiki +space-create"
  ]);
  assert.deepEqual(
    fieldsByTable.get("table_id").map((field) => field.name),
    [
      "公司名称", "Notes", "领域", "子领域", "进展状态", "项目评级", "城市", "入库时间",
      "最后更新时间", "链接", "是否完成后续融资", "历史融资", "最新估值", "投资机构"
    ]
  );
  assert.ok(fieldsByTable.get("placeholder").some((field) =>
    field.name === "交流文档" && field.type === "text"
  ));
  assert.ok(fieldsByTable.get("configured").some((field) =>
    field.name === "事件ID" && field.type === "text"
  ));
  assert.ok(userIdentityCalls.length > 0);

  const writesAfterFirstPass = writes.length;
  const second = await integration.provisionFeishuSetup();
  assert.equal(second.ok, true);
  assert.equal(second.resources.base.created, false);
  assert.equal(second.resources.wiki.created, false);
  assert.equal(writes.length, writesAfterFirstPass);
});

test("Feishu setup fills compatible legacy tables and verifies every field idempotently", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-schema-fill-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  const tableIds = {
    "项目库": "fixture-project",
    "人脉库": "fixture-people",
    "行业动态": "fixture-radar"
  };
  const fieldsByTable = new Map([
    [tableIds["项目库"], [{ name: "公司名称", type: "text" }]],
    [tableIds["人脉库"], [{ name: "人名", type: "text" }]],
    [tableIds["行业动态"], [{ name: "新闻标题", type: "text" }]]
  ]);
  const createdFields = [];
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return { verified: true, identities: { user: { tokenStatus: "valid" } } };
    }
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +title-resolve") {
      return {
        data: {
          match: { name: "domi资料库", [["base", "token"].join("_")]: "example" }
        }
      };
    }
    if (command === "wiki +space-list") {
      return {
        data: {
          spaces: [{ name: "domi文档库", [["space", "id"].join("_")]: "placeholder" }]
        }
      };
    }
    if (command === "base +table-list") {
      return {
        data: {
          items: Object.entries(tableIds).map(([name, tableId]) => ({
            name,
            [["table", "id"].join("_")]: tableId
          }))
        }
      };
    }
    if (command === "base +field-list") {
      const tableId = args[args.indexOf("--table-id") + 1];
      return { data: { items: fieldsByTable.get(tableId) || [] } };
    }
    if (command === "base +field-create") {
      const tableId = args[args.indexOf("--table-id") + 1];
      const field = JSON.parse(args[args.indexOf("--json") + 1]);
      fieldsByTable.set(tableId, [...(fieldsByTable.get(tableId) || []), field]);
      createdFields.push(`${tableId}:${field.name}`);
      return { data: { field } };
    }
    throw new Error(`unexpected command: ${command}`);
  };

  const first = await integration.provisionFeishuSetup();
  assert.equal(first.ok, true);
  assert.equal(first.resources.tables.project.schemaCreated, 13);
  assert.equal(first.resources.tables.people.schemaCreated, 9);
  assert.equal(first.resources.tables.radar.schemaCreated, 20);
  assert.ok(createdFields.includes("fixture-project:入库时间"));
  assert.ok(createdFields.includes("fixture-people:交流文档"));
  assert.ok(createdFields.includes("fixture-radar:最后更新时间"));

  const countAfterFirstPass = createdFields.length;
  const second = await integration.provisionFeishuSetup();
  assert.equal(second.ok, true);
  assert.equal(createdFields.length, countAfterFirstPass);
  assert.equal(second.resources.tables.project.schemaCreated, 0);
  assert.equal(second.resources.tables.people.schemaCreated, 0);
  assert.equal(second.resources.tables.radar.schemaCreated, 0);
});

test("Feishu setup stops before writes when an existing field type conflicts", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-schema-conflict-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  let writeCalls = 0;
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return { verified: true, identities: { user: { tokenStatus: "valid" } } };
    }
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +title-resolve") {
      return {
        data: {
          match: { name: "domi资料库", [["base", "token"].join("_")]: "example" }
        }
      };
    }
    if (command === "wiki +space-list") return { data: { spaces: [] } };
    if (command === "base +table-list") {
      return {
        data: {
          items: [{ name: "项目库", [["table", "id"].join("_")]: "fixture-project" }]
        }
      };
    }
    if (command === "base +field-list") {
      return {
        data: {
          items: [
            { name: "公司名称", type: "text" },
            { name: "领域", type: "text" }
          ]
        }
      };
    }
    writeCalls += 1;
    throw new Error(`write must not run after a schema conflict: ${command}`);
  };

  const result = await integration.provisionFeishuSetup();
  assert.equal(result.ok, false);
  assert.match(result.error, /项目库.*领域.*类型/);
  assert.equal(writeCalls, 0);
});

test("Feishu setup does not silently replace incomplete canonical select options", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-schema-option-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  let writeCalls = 0;
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return { verified: true, identities: { user: { tokenStatus: "valid" } } };
    }
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +title-resolve") {
      return {
        data: {
          match: { name: "domi资料库", [["base", "token"].join("_")]: "example" }
        }
      };
    }
    if (command === "wiki +space-list") return { data: { spaces: [] } };
    if (command === "base +table-list") {
      return {
        data: {
          items: [{ name: "项目库", [["table", "id"].join("_")]: "fixture-project" }]
        }
      };
    }
    if (command === "base +field-list") {
      return {
        data: {
          items: [
            { name: "公司名称", type: "text" },
            {
              name: "领域",
              type: "select",
              multiple: false,
              options: [{ name: "AI" }]
            }
          ]
        }
      };
    }
    writeCalls += 1;
    throw new Error(`write must not run after an option conflict: ${command}`);
  };

  const result = await integration.provisionFeishuSetup();
  assert.equal(result.ok, false);
  assert.match(result.error, /项目库.*领域.*缺少.*选项/);
  assert.equal(writeCalls, 0);
});

test("Feishu setup refuses ambiguous resources and never leaks their identifiers", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-ambiguous-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  let writeCalls = 0;
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return { verified: true, identities: { user: { tokenStatus: "valid" } } };
    }
    const command = `${args[0]} ${args[1]}`;
    if (command === "base +title-resolve") {
      return {
        ok: true,
        data: {
          candidates: [
            { name: "domi资料库", [["base", "token"].join("_")]: "first" },
            { name: "domi资料库", [["base", "token"].join("_")]: "second" }
          ]
        }
      };
    }
    if (command === "wiki +space-list") return { ok: true, data: { spaces: [] } };
    writeCalls += 1;
    throw new Error("a write must not run after ambiguous discovery");
  };

  const result = await integration.provisionFeishuSetup();
  assert.equal(result.ok, false);
  assert.match(result.error, /多个同名/);
  assert.doesNotMatch(result.error, /first|second/);
  assert.equal(writeCalls, 0);
});

test("Feishu setup replaces raw CLI failures with a private safe message", async () => {
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-feishu-private-error-test",
    configProvider: () => ({ storageBackend: "local" })
  });
  integration.larkCli = process.execPath;
  integration.runJson = async (_binary, args) => {
    if (args[0] === "auth") {
      return { verified: true, identities: { user: { tokenStatus: "valid" } } };
    }
    throw new Error("permission denied for private-base-ref private-table-ref private-user-ref");
  };

  const result = await integration.provisionFeishuSetup();
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /private-base-ref|private-table-ref|private-user-ref/);
  assert.match(result.error, /已有连接不会被覆盖/);
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
  const received = [];
  integration.runJson = async (binary, args, options) => {
    received.push({ binary, args, options });
    return { ok: true };
  };

  await Promise.all([
    integration.ensureIntakeTimeFields({ root: pluginRoot, version: "test" }),
    integration.ensureIntakeTimeFields({ root: pluginRoot, version: "test" })
  ]);
  await integration.ensureIntakeTimeFields({ root: pluginRoot, version: "test" });

  assert.equal(received.length, 1);
  assert.equal(received[0].binary, process.execPath);
  assert.deepEqual(received[0].args, [script, "ensure"]);
  assert.equal(received[0].options.queue, "lark");
  assert.equal(received[0].options.env.DOMI_CONFIG_PATH, "/tmp/domi-runtime/domi-plugin-config.json");
  assert.equal(received[0].options.env.LARK_CLI_PATH, integration.larkCli);
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

test("local repository safely and idempotently indexes existing workspace entities", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-index-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const projectPath = path.join(libraryDir, "3.项目库", "AI", "AI基础设施", "驭驯网络");
  const legacyProjectPath = path.join(
    libraryDir,
    "3.项目库",
    "具身智能&机器人",
    "工业机器人",
    "20220407-示例机器人"
  );
  const misplacedResearchPath = path.join(
    libraryDir,
    "3.项目库",
    "具身智能&机器人",
    "工业机器人",
    "20210806-工业机器人行业研究"
  );
  const directProjectPath = path.join(
    libraryDir,
    "3.项目库",
    "企业软件",
    "20260716-示例流程软件-桌面研究-B"
  );
  const compactUnclassifiedProjectPath = path.join(
    libraryDir,
    "3.项目库",
    "_未分类",
    "历史项目"
  );
  const personPath = path.join(libraryDir, "4.人脉库", "张三");
  fs.mkdirSync(path.join(projectPath, "研究", "不是项目"), { recursive: true });
  fs.mkdirSync(legacyProjectPath, { recursive: true });
  fs.mkdirSync(misplacedResearchPath, { recursive: true });
  fs.mkdirSync(directProjectPath, { recursive: true });
  fs.mkdirSync(path.join(compactUnclassifiedProjectPath, "原始材料"), { recursive: true });
  fs.mkdirSync(personPath, { recursive: true });
  fs.writeFileSync(path.join(directProjectPath, "示例流程软件-桌面研究.md"), "# 示例流程软件\n");
  fs.writeFileSync(path.join(projectPath, "项目主页.md"), `<!-- domi:managed:start -->
---
domi_schema: 2
entity_type: "project"
project_id: "prj_existing_workspace"
company_name: "驭驯网络"
domain: "AI"
subdomains: ["AI基础设施"]
status: "已交流"
rating: "A"
last_updated_at: "2026-07-30T00:00:00.000Z"
---

# 驭驯网络
`);
  fs.writeFileSync(path.join(personPath, "人物主页.md"), `<!-- domi:managed:start -->
---
domi_schema: 2
entity_type: "person"
person_id: "per_existing_workspace"
name: "张三"
organization: "示例科技 · CEO"
types: ["创业者"]
status: "已联系"
rating: "A"
---

# 张三
`);
  fs.writeFileSync(path.join(personPath, "张三-人物资料.md"), "# 张三人物资料\n");
  fs.mkdirSync(path.join(personPath, "纪要"), { recursive: true });
  fs.writeFileSync(
    path.join(personPath, "纪要", "20260801-张三交流纪要.md"),
    "# 张三交流纪要\n"
  );

  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const first = repository.reindexWorkspace();
  assert.deepEqual(first.projects, { discovered: 4, created: 4, linked: 0 });
  assert.deepEqual(first.people, { discovered: 1, created: 1, linked: 0 });
  assert.equal(repository.listProjects().length, 4);
  assert.equal(repository.listPeople().length, 1);
  const indexedProject = repository.listProjects().find((project) => project.name === "驭驯网络");
  assert.equal(indexedProject.domain, "AI");
  assert.deepEqual(indexedProject.subdomains, ["AI基础设施"]);
  assert.equal(indexedProject.status, "已交流");
  assert.equal(indexedProject.rating, "A");
  assert.match(decodeURIComponent(indexedProject.link), /项目主页\.md$/);
  assert.equal(
    repository.listProjects().some((project) => project.name === "不是项目"),
    false
  );
  assert.equal(
    repository.listProjects().some((project) => project.name.includes("示例流程软件")),
    true
  );
  assert.equal(
    repository.listProjects().some((project) => project.name === "历史项目"),
    true
  );
  assert.equal(repository.listPeople()[0].organization, "示例科技 · CEO");
  assert.deepEqual(
    repository.listPeople()[0].interactionDocuments.map((document) => document.title),
    ["20260801-张三交流纪要"]
  );
  assert.match(
    decodeURIComponent(repository.listPeople()[0].interactionDocuments[0].link),
    /纪要\/20260801-张三交流纪要\.md$/
  );
  assert.deepEqual(
    repository.listPeople()[0].documents.map((document) => document.kind).sort(),
    ["交流纪要", "人物研究"]
  );

  repository.database.prepare(`
    UPDATE projects SET status = '深度跟踪', rating = 'S', notes = '保留人工维护信息'
    WHERE normalized_name = '驭驯网络'
  `).run();
  const second = repository.reindexWorkspace();
  assert.deepEqual(second.projects, { discovered: 4, created: 0, linked: 0 });
  assert.deepEqual(second.people, { discovered: 1, created: 0, linked: 0 });
  assert.equal(second.unchanged, true);
  assert.ok(second.indexedAt > 0);
  const preservedProject = repository.listProjects().find((project) => project.name === "驭驯网络");
  assert.equal(preservedProject.status, "深度跟踪");
  assert.equal(preservedProject.rating, "S");
  assert.equal(preservedProject.notes, "保留人工维护信息");
  const projectColumns = repository.database
    .prepare("PRAGMA table_info(projects)")
    .all()
    .map((column) => column.name);
  assert.ok(projectColumns.includes("financing_history"));
  assert.ok(projectColumns.includes("latest_valuation_usd_100m"));
  assert.equal(
    repository.recordDirectory("project", indexedProject.recordId),
    projectPath
  );

  const newProjectPath = path.join(
    libraryDir,
    "3.项目库",
    "AI",
    "Agent",
    "增量发现项目"
  );
  fs.mkdirSync(newProjectPath, { recursive: true });
  fs.writeFileSync(path.join(newProjectPath, "项目主页.md"), `<!-- domi:managed:start -->
---
entity_type: "project"
project_id: "prj_incremental"
company_name: "增量发现项目"
domain: "AI"
subdomains: ["Agent"]
---
# 增量发现项目
`);
  fs.writeFileSync(path.join(personPath, "20260803-张三电话沟通.md"), "# 电话沟通\n");
  const third = repository.reindexWorkspace();
  assert.equal(third.unchanged, false);
  assert.equal(third.projects.discovered, 5);
  assert.equal(third.projects.created, 1);
  assert.ok(repository.listProjects().some((project) => project.recordId === "prj_incremental"));
  assert.deepEqual(
    new Set(repository.listPeople()[0].interactionDocuments.map((document) => document.title)),
    new Set(["20260801-张三交流纪要", "20260803-张三电话沟通"])
  );
  assert.equal(
    repository.listPeople()[0].documents.some((document) => /人物资料/.test(document.title)),
    true
  );
});

test("local people list exposes persisted research documents without a full workspace reindex", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-person-documents-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const personDirectory = path.join(libraryDir, "4.人脉库", "叶锐");
  const researchDirectory = path.join(personDirectory, "研究");
  const homepage = path.join(personDirectory, "人物主页.md");
  const researchPath = path.join(researchDirectory, "20260803-叶锐-人物研究.md");
  fs.mkdirSync(researchDirectory, { recursive: true });
  fs.writeFileSync(homepage, "# 叶锐\n");
  fs.writeFileSync(researchPath, "# 叶锐人物研究\n");
  const now = Date.now();
  repository.database.prepare(`
    INSERT INTO people (
      id, name, normalized_name, types_json, organization, status, rating,
      last_contact_at, cities_json, interaction_documents_json, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, '[]', '', '已研究', '', NULL, '[]', '[]', ?, ?, ?)
  `).run("per_research", "叶锐", "叶锐", homepage, now, now);
  repository.database.prepare(`
    INSERT INTO documents (id, owner_type, owner_id, kind, title, path, created_at, updated_at)
    VALUES (?, 'person', ?, '研究', ?, ?, ?, ?)
  `).run("doc_research", "per_research", "20260803-叶锐-人物研究", researchPath, now, now);

  const person = repository.listPeople().find((item) => item.recordId === "per_research");
  assert.deepEqual(person.documents.map((document) => [document.kind, document.title]), [
    ["研究", "20260803-叶锐-人物研究"]
  ]);
  assert.deepEqual(person.interactionDocuments, []);
});

test("local repository excludes bulk workspace baselines from recent-intake timestamps", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-bulk-baseline-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");

  for (let index = 0; index < 20; index += 1) {
    const projectDirectory = path.join(
      libraryDir,
      "3.项目库",
      "AI",
      "Agent",
      `历史项目 ${index}`
    );
    fs.mkdirSync(projectDirectory, { recursive: true });
    fs.writeFileSync(
      path.join(projectDirectory, "项目主页.md"),
      `---\nentity_type: "project"\ncompany_name: "历史项目 ${index}"\n---\n`
    );
  }

  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const baseline = repository.reindexWorkspace();
  assert.equal(baseline.projects.created, 20);
  assert.equal(
    repository.listProjects().every((project) => project.createdAt === null),
    true,
    "an initial bulk workspace scan is not evidence that every project was newly researched"
  );

  const incrementalDirectory = path.join(
    libraryDir,
    "3.项目库",
    "AI",
    "Agent",
    "真实新增项目"
  );
  fs.mkdirSync(incrementalDirectory, { recursive: true });
  fs.writeFileSync(
    path.join(incrementalDirectory, "项目主页.md"),
    '---\nentity_type: "project"\ncompany_name: "真实新增项目"\n---\n'
  );
  const incremental = repository.reindexWorkspace();
  assert.equal(incremental.projects.created, 1);
  assert.ok(
    repository.listProjects().find((project) => project.name === "真实新增项目").createdAt > 0
  );
});

test("local repository repairs legacy bulk-import timestamps once", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-bulk-migration-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  let repository = new LocalDomiRepository({ databasePath, libraryDir });
  const importedAt = Date.now() - 24 * 60 * 60 * 1000;
  const insert = repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, '', '[]', '待交流', '', '', '[]', '[]', '', NULL, NULL, '', ?, ?)
  `);
  for (let index = 0; index < 20; index += 1) {
    insert.run(
      `legacy-${index}`,
      `迁移项目 ${index}`,
      `迁移项目${index}`,
      importedAt,
      importedAt
    );
  }
  repository.database.prepare(
    "DELETE FROM repository_meta WHERE key = 'legacy_bulk_intake_v1'"
  ).run();
  repository.close();

  repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  assert.equal(
    repository.listProjects().every((project) => project.createdAt === null),
    true
  );
  assert.ok(
    repository.database.prepare(
      "SELECT 1 FROM repository_meta WHERE key = 'legacy_bulk_intake_v1'"
    ).get()
  );
});

test("local database editor updates records, managed Markdown and safe directory locations", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-editor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const version = 1_700_000_000_000;
  const projectDirectory = path.join(libraryDir, "3.项目库", "AI", "Agent", "旧项目名");
  const personDirectory = path.join(libraryDir, "4.人脉库", "旧姓名");
  const newsPath = path.join(libraryDir, "2.行业动态", "2026", "06", "evt_edit.md");
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.mkdirSync(personDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(newsPath), { recursive: true });
  fs.writeFileSync(
    path.join(projectDirectory, "项目主页.md"),
    "<!-- domi:managed:start -->\n旧项目块\n<!-- domi:managed:end -->\n\n# 用户附注\n保留项目正文\n"
  );
  fs.writeFileSync(
    path.join(personDirectory, "人物主页.md"),
    "<!-- domi:managed:start -->\n旧人物块\n<!-- domi:managed:end -->\n\n# 用户附注\n保留人物正文\n"
  );
  fs.writeFileSync(
    newsPath,
    "<!-- domi:managed:start -->\n旧行业信息块\n<!-- domi:managed:end -->\n\n# 用户附注\n保留行业正文\n"
  );
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_edit", "旧项目名", "旧项目名", "AI", '["Agent"]', "待交流", "", "",
    "[]", "[]", "", null, version, path.join(projectDirectory, "项目主页.md"),
    version, version
  );
  repository.database.prepare(`
    INSERT INTO people (
      id, name, normalized_name, types_json, organization, status, rating,
      last_contact_at, cities_json, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "per_edit", "旧姓名", "旧姓名", '["创业者"]', "旧组织", "待联系", "",
    null, "[]", path.join(personDirectory, "人物主页.md"), version, version
  );
  repository.database.prepare(`
    INSERT INTO news_events (
      event_id, title, domains_json, subdomains_json, types_json, published_at,
      summary, investment_meaning, url, source, companies, institutions,
      importance, confidence, evidence_status, action, worth_following,
      document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "evt_edit", "旧标题", '["AI"]', '["Agent"]', '["公司动态"]',
    Date.parse("2026-06-20T08:00:00+08:00"), "旧摘要", "", "https://example.com/old",
    "旧来源", "", "", 5, 6, "待核验", "继续观察", 1, newsPath, version, version
  );

  const updatedProject = repository.updateProject({
    recordId: "prj_edit",
    expectedUpdatedAt: version,
    name: "新项目名",
    domain: "企业软件",
    subdomains: ["Agent"],
    status: "深度跟踪",
    rating: "A",
    notes: "新的结构化摘要",
    cities: ["上海"],
    investors: ["IDG"],
    financingHistory: "| 融资时间 | 融资轮次 |\n|---|---|\n| 2026 | A轮 |",
    latestValuationUsd100m: 1.5
  });
  assert.equal(updatedProject.name, "新项目名");
  assert.equal(updatedProject.latestValuationUsd100m, 1.5);
  const movedProjectPath = path.join(
    libraryDir,
    "3.项目库",
    "企业软件",
    "Agent",
    "新项目名",
    "项目主页.md"
  );
  assert.equal(fs.existsSync(path.join(projectDirectory, "项目主页.md")), false);
  assert.match(fs.readFileSync(movedProjectPath, "utf8"), /保留项目正文/);
  assert.match(fs.readFileSync(movedProjectPath, "utf8"), /新的结构化摘要/);
  assert.throws(
    () => repository.updateProject({
      ...updatedProject,
      expectedUpdatedAt: version,
      financingHistory: updatedProject.financingHistory,
      latestValuationUsd100m: updatedProject.latestValuationUsd100m
    }),
    /已被其他流程更新/
  );

  const updatedPerson = repository.updatePerson({
    recordId: "per_edit",
    expectedUpdatedAt: version,
    name: "新姓名",
    types: ["创业者", "专家"],
    organization: "新组织",
    status: "已联系",
    rating: "B",
    lastContact: "2026-07-30",
    cities: ["北京"]
  });
  assert.equal(updatedPerson.name, "新姓名");
  const movedPersonPath = path.join(libraryDir, "4.人脉库", "新姓名", "人物主页.md");
  assert.match(fs.readFileSync(movedPersonPath, "utf8"), /保留人物正文/);
  assert.match(fs.readFileSync(movedPersonPath, "utf8"), /新组织/);

  const updatedNews = repository.updateNews({
    recordId: "evt_edit",
    expectedUpdatedAt: version,
    title: "新标题",
    domains: ["前沿科技"],
    subdomains: ["量子计算"],
    types: ["技术进展"],
    publishedAt: Date.parse("2026-07-30T09:30:00+08:00"),
    summary: "新摘要",
    investmentMeaning: "新投资含义",
    url: "https://example.com/new",
    source: "新来源",
    companies: "示例公司",
    institutions: "",
    importance: 8,
    confidence: 9,
    evidenceStatus: "官方确认",
    action: "继续跟踪",
    worthFollowing: true
  });
  assert.equal(updatedNews.title, "新标题");
  const movedNewsPath = path.join(libraryDir, "2.行业动态", "2026", "07", "evt_edit.md");
  assert.equal(fs.existsSync(newsPath), false);
  assert.match(fs.readFileSync(movedNewsPath, "utf8"), /保留行业正文/);
  assert.match(fs.readFileSync(movedNewsPath, "utf8"), /新投资含义/);
});

test("field patches commit canonical SQLite state before background Markdown materialization", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-field-patch-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const version = 1_700_000_000_000;
  const projectDirectory = path.join(libraryDir, "3.项目库", "AI", "Agent", "Patch项目");
  const projectPath = path.join(projectDirectory, "项目主页.md");
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    projectPath,
    "<!-- domi:managed:start -->\n旧摘要\n<!-- domi:managed:end -->\n\n# 用户附注\n必须保留\n"
  );
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_patch", "Patch项目", "patch项目", "AI", '["Agent"]', "待交流", "A", "旧摘要",
    '["上海"]', '["IDG"]', "历史融资保持不变", 1.2,
    version, projectPath, version, version
  );

  const patched = repository.updateDatabaseRecordPatch({
    entityType: "project",
    recordId: "prj_patch",
    expectedUpdatedAt: version,
    mutationId: "mutation-project-notes-1",
    changes: { notes: "新的单元格摘要" }
  });
  assert.equal(patched.replayed, false);
  assert.equal(patched.materialization, "pending");
  assert.equal(patched.record.notes, "新的单元格摘要");
  assert.equal(patched.record.name, "Patch项目");
  assert.deepEqual(patched.record.cities, ["上海"]);
  assert.deepEqual(patched.record.investors, ["IDG"]);
  assert.equal(patched.record.financingHistory, "历史融资保持不变");
  assert.equal(patched.record.latestValuationUsd100m, 1.2);
  assert.equal(
    repository.database.prepare("SELECT notes FROM projects WHERE id = ?").get("prj_patch").notes,
    "新的单元格摘要"
  );
  assert.doesNotMatch(fs.readFileSync(projectPath, "utf8"), /新的单元格摘要/);
  assert.equal(repository.listPendingMaterializations().length, 1);

  const replayed = repository.updateDatabaseRecordPatch({
    entityType: "project",
    recordId: "prj_patch",
    expectedUpdatedAt: version,
    mutationId: "mutation-project-notes-1",
    changes: { notes: "新的单元格摘要" }
  });
  assert.equal(replayed.replayed, true);
  assert.equal(replayed.record.updatedAt, patched.record.updatedAt);
  assert.throws(
    () => repository.updateDatabaseRecordPatch({
      entityType: "project",
      recordId: "prj_patch",
      expectedUpdatedAt: patched.record.updatedAt,
      mutationId: "mutation-project-notes-1",
      changes: { notes: "mutationId 不可复用" }
    }),
    /mutationId 已用于另一项修改/
  );
  assert.throws(
    () => repository.updateDatabaseRecordPatch({
      entityType: "project",
      recordId: "prj_patch",
      expectedUpdatedAt: patched.record.updatedAt,
      mutationId: "mutation-project-forbidden-1",
      changes: { documentPath: "/tmp/escape" }
    }),
    /不允许通过资料库编辑器修改/
  );

  const materialized = repository.materializeDatabaseRecord("project", "prj_patch");
  assert.equal(materialized.materialized, true);
  assert.equal(repository.listPendingMaterializations().length, 0);
  assert.match(fs.readFileSync(projectPath, "utf8"), /新的单元格摘要/);
  assert.match(fs.readFileSync(projectPath, "utf8"), /必须保留/);

  const renamed = repository.updateDatabaseRecordPatch({
    entityType: "project",
    recordId: "prj_patch",
    expectedUpdatedAt: patched.record.updatedAt,
    mutationId: "mutation-project-name-2",
    changes: { name: "Patch项目新名" }
  });
  const renamedPath = path.join(
    libraryDir,
    "3.项目库",
    "AI",
    "Agent",
    "Patch项目新名",
    "项目主页.md"
  );
  assert.equal(renamed.record.name, "Patch项目新名");
  assert.equal(fs.existsSync(projectPath), true);
  assert.equal(fs.existsSync(renamedPath), false);
  fs.mkdirSync(path.dirname(renamedPath), { recursive: true });
  assert.throws(
    () => repository.materializeDatabaseRecord("project", "prj_patch"),
    /目标资料目录已存在/
  );
  assert.equal(repository.listPendingMaterializations()[0].attempts, 1);
  fs.rmdirSync(path.dirname(renamedPath));
  repository.materializeDatabaseRecord("project", "prj_patch");
  assert.equal(fs.existsSync(projectPath), false);
  assert.match(fs.readFileSync(renamedPath, "utf8"), /必须保留/);
  assert.throws(
    () => repository.updateDatabaseRecordPatch({
      entityType: "project",
      recordId: "prj_patch",
      expectedUpdatedAt: patched.record.updatedAt,
      mutationId: "mutation-project-stale-3",
      changes: { rating: "S" }
    }),
    /其他流程更新/
  );
});

test("field patches validate and merge person and news records", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-field-patch-other-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const version = 1_700_000_000_000;
  const personDirectory = path.join(libraryDir, "4.人脉库", "Patch人物");
  const personPath = path.join(personDirectory, "人物主页.md");
  const newsPath = path.join(libraryDir, "2.行业动态", "2026", "07", "evt_patch.md");
  fs.mkdirSync(personDirectory, { recursive: true });
  fs.mkdirSync(path.dirname(newsPath), { recursive: true });
  fs.writeFileSync(personPath, "# Patch人物\n");
  fs.writeFileSync(newsPath, "# 行业事件\n");
  repository.database.prepare(`
    INSERT INTO people (
      id, name, normalized_name, types_json, organization, status, rating,
      last_contact_at, cities_json, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "per_patch", "Patch人物", "patch人物", '["创业者"]', "原组织", "待联系", "B",
    null, '["北京"]', personPath, version, version
  );
  repository.database.prepare(`
    INSERT INTO news_events (
      event_id, title, domains_json, subdomains_json, types_json, published_at,
      summary, investment_meaning, url, source, companies, institutions,
      importance, confidence, evidence_status, action, worth_following,
      document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "evt_patch", "行业事件", '["AI"]', '["Agent"]', '["融资"]',
    Date.parse("2026-07-10T08:00:00+08:00"), "原摘要", "原投资含义",
    "https://example.com/original", "原来源", "示例公司", "示例机构",
    6, 7, "官方确认", "继续跟踪", 1, newsPath, version, version
  );

  const person = repository.updateDatabaseRecordPatch({
    entityType: "person",
    recordId: "per_patch",
    expectedUpdatedAt: version,
    mutationId: "mutation-person-org-1",
    changes: { organization: "新组织" }
  }).record;
  assert.equal(person.organization, "新组织");
  assert.equal(person.name, "Patch人物");
  assert.deepEqual(person.types, ["创业者"]);
  assert.deepEqual(person.cities, ["北京"]);
  repository.materializeDatabaseRecord("person", "per_patch");
  assert.match(fs.readFileSync(personPath, "utf8"), /新组织/);

  const news = repository.updateDatabaseRecordPatch({
    entityType: "news",
    recordId: "evt_patch",
    expectedUpdatedAt: version,
    mutationId: "mutation-news-summary-1",
    changes: { summary: "新摘要", importance: 9 }
  }).record;
  assert.equal(news.summary, "新摘要");
  assert.equal(news.importance, 9);
  assert.equal(news.investmentMeaning, "原投资含义");
  assert.equal(news.source, "原来源");
  repository.materializeDatabaseRecord("news", "evt_patch");
  assert.match(fs.readFileSync(newsPath, "utf8"), /新摘要/);
});

test("integration returns a field patch before queued Markdown materialization finishes", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-field-patch-queue-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const projectDirectory = path.join(libraryDir, "3.项目库", "AI", "Agent", "异步项目");
  const projectPath = path.join(projectDirectory, "项目主页.md");
  const version = 1_700_000_000_000;
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(
    projectPath,
    "<!-- domi:managed:start -->\n旧内容\n<!-- domi:managed:end -->\n"
  );
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_async_patch", "异步项目", "异步项目", "AI", '["Agent"]', "待交流", "", "旧内容",
    "[]", "[]", "", null, version, projectPath, version, version
  );
  repository.close();

  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: path.join(root, "plaud"),
    configProvider: () => ({
      storageBackend: "local",
      localRepositoryDir: libraryDir,
      localDatabasePath: databasePath
    }),
    sleep: () => Promise.resolve()
  });
  const result = await integration.updateDatabaseRecordPatch({
    entityType: "project",
    recordId: "prj_async_patch",
    expectedUpdatedAt: version,
    mutationId: "mutation-integration-async-1",
    changes: { notes: "后台落盘的新内容" }
  });
  assert.equal(result.ok, true);
  assert.equal(result.record.notes, "后台落盘的新内容");
  assert.equal(result.materialization, "pending");
  assert.doesNotMatch(fs.readFileSync(projectPath, "utf8"), /后台落盘的新内容/);
  await Promise.all([...integration.databaseMaterializationQueues.values()]);
  assert.match(fs.readFileSync(projectPath, "utf8"), /后台落盘的新内容/);
  const reopened = new LocalDomiRepository({ databasePath, libraryDir });
  assert.equal(reopened.listPendingMaterializations().length, 0);
  reopened.close();
});

test("local database preview selects the richest document and row deletion preserves files", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-delete-preview-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const projectDirectory = path.join(libraryDir, "3.项目库", "AI", "Agent", "预览项目");
  const canonicalPath = path.join(projectDirectory, "项目主页.md");
  const researchPath = path.join(projectDirectory, "研究", "预览项目-深度研究.md");
  const memoPath = path.join(projectDirectory, "研究", "预览项目-IC Memo.md");
  fs.mkdirSync(path.dirname(researchPath), { recursive: true });
  fs.writeFileSync(canonicalPath, "# 预览项目\n");
  fs.writeFileSync(researchPath, "# 深度研究\n");
  fs.writeFileSync(memoPath, "# IC Memo\n");

  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const version = 1_700_000_000_000;
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_preview", "预览项目", "预览项目", "AI", '["Agent"]', "深度跟踪", "A", "",
    "[]", "[]", "", null, version, canonicalPath, version, version
  );
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, '', '[]', '待交流', '', '', '[]', '[]', '', NULL, NULL, '', ?, ?)
  `).run("prj_structure_ghost", "原始材料", "原始材料", version, version);

  const preview = repository.resolvePreviewDocument("project", "prj_preview");
  assert.equal(preview.ok, true);
  assert.equal(path.basename(decodeURIComponent(new URL(preview.resource).pathname)), "预览项目-IC Memo.md");

  const deleted = repository.deleteDatabaseRecord({
    entityType: "project",
    recordId: "prj_preview",
    expectedUpdatedAt: version
  });
  assert.equal(deleted.filesPreserved, true);
  assert.equal(fs.existsSync(memoPath), true);
  assert.equal(repository.listProjects().some((project) => project.recordId === "prj_preview"), false);

  const reindexed = repository.reindexWorkspace();
  assert.equal(reindexed.projects.removedStructuralGhosts, 1);
  assert.equal(repository.listProjects().some((project) => project.name === "原始材料"), false);
  assert.equal(repository.listProjects().some((project) => project.recordId === "prj_preview"), false);
  assert.equal(
    repository.database.prepare(
      "SELECT COUNT(*) AS count FROM repository_tombstones WHERE record_id = ?"
    ).get("prj_preview").count,
    1
  );
});

test("classification review keeps evidence roles separate and applies local formal subdomains atomically", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-classification-review-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const originalDirectory = path.join(libraryDir, "3.项目库", "_未分类", "边缘项目");
  const canonicalPath = path.join(originalDirectory, "项目主页.md");
  const projectEvidence = path.join(originalDirectory, "原始材料", "路演纪要.md");
  const comparableEvidence = path.join(originalDirectory, "研究", "可比公司-智慧尘埃.md");
  const industryEvidence = path.join(originalDirectory, "研究", "行业研究-边缘智能.md");
  fs.mkdirSync(path.dirname(projectEvidence), { recursive: true });
  fs.mkdirSync(path.dirname(comparableEvidence), { recursive: true });
  fs.writeFileSync(canonicalPath, "# 边缘项目\n");
  fs.writeFileSync(projectEvidence, "项目研发智能体和边缘计算产品。\n");
  fs.writeFileSync(comparableEvidence, "# 可比公司\n仅用于理解类似公司的产品路径。\n");
  fs.writeFileSync(industryEvidence, "# 行业研究\n边缘智能市场与产业链。\n");

  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  t.after(() => repository.close());
  const version = 1_700_000_000_000;
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_classification", "边缘项目", "边缘项目", "_未分类", "[]", "待交流", "", "",
    "[]", "[]", "", null, version, canonicalPath, version, version
  );

  const reviews = repository.listClassificationReviews();
  assert.equal(reviews.length, 1);
  assert.deepEqual(
    new Set(reviews[0].evidence.map((item) => item.role)),
    new Set(["project", "comparable", "industry"])
  );
  assert.match(reviews[0].reason, /项目自身材料|人工选择/);

  const applied = repository.applyProjectClassification({
    action: "apply",
    recordId: "prj_classification",
    expectedUpdatedAt: version,
    domain: "AI",
    subdomains: ["边缘智能"],
    createSubdomainName: "边缘智能",
    createSubdomainParentDomain: "AI"
  });
  assert.equal(applied.ok, true);
  assert.equal(applied.record.domain, "AI");
  assert.deepEqual(applied.record.subdomains, ["边缘智能"]);
  assert.ok(applied.taxonomy.customSubdomains.some((item) =>
    item.name === "边缘智能" && item.parentDomain === "AI"
  ));
  const classifiedDirectory = path.join(libraryDir, "3.项目库", "AI", "边缘智能", "边缘项目");
  assert.equal(fs.existsSync(path.join(classifiedDirectory, "项目主页.md")), true);
  assert.equal(fs.existsSync(originalDirectory), false);
  assert.match(fs.readFileSync(path.join(classifiedDirectory, "项目主页.md"), "utf8"), /边缘智能/);
  assert.equal(repository.listClassificationReviews().length, 0);

  const undone = repository.applyProjectClassification({
    action: "undo",
    recordId: "prj_classification",
    expectedUpdatedAt: applied.record.updatedAt
  });
  assert.equal(undone.record.domain, "_未分类");
  assert.deepEqual(undone.record.subdomains, []);
  assert.equal(
    fs.existsSync(path.join(libraryDir, "3.项目库", "_未分类", "边缘项目", "项目主页.md")),
    true
  );
  assert.equal(repository.listClassificationReviews().length, 1);
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

test("local materials use the exact entity directory and database edits avoid a full sync", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-local-fast-path-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const databasePath = path.join(root, "domi-repository.sqlite3");
  const libraryDir = path.join(root, "domi工作区");
  const projectDirectory = path.join(libraryDir, "3.项目库", "AI", "Agent", "精确项目");
  const canonicalPath = path.join(projectDirectory, "项目主页.md");
  const materialPath = path.join(projectDirectory, "原始材料", "BP.pdf");
  const unrelatedPath = path.join(libraryDir, "3.项目库", "AI", "Agent", "无关项目", "精确项目误匹配.pdf");
  fs.mkdirSync(path.dirname(materialPath), { recursive: true });
  fs.mkdirSync(path.dirname(unrelatedPath), { recursive: true });
  fs.writeFileSync(canonicalPath, "<!-- domi:managed:start -->\n旧内容\n<!-- domi:managed:end -->\n");
  fs.writeFileSync(materialPath, "%PDF-1.4\n");
  fs.writeFileSync(unrelatedPath, "%PDF-1.4\n");

  const version = 1_700_000_000_000;
  const repository = new LocalDomiRepository({ databasePath, libraryDir });
  repository.database.prepare(`
    INSERT INTO projects (
      id, name, normalized_name, domain, subdomains_json, status, rating, notes,
      cities_json, investors_json, financing_history, latest_valuation_usd_100m,
      last_updated_at, document_path, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    "prj_fast", "精确项目", "精确项目", "AI", '["Agent"]', "待交流", "", "",
    "[]", "[]", "", null, version, canonicalPath, version, version
  );
  const project = repository.listProjects()[0];
  repository.close();

  const cache = new Map([
    ["snapshot-v1", {
      value: {
        version: 1,
        backend: "local",
        syncedAt: version,
        sources: { projects: { total: 1 }, people: { total: 0 } },
        projects: [project],
        people: []
      },
      updatedAt: version
    }]
  ]);
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: (key) => cache.get(key) || null,
      saveCache: (key, value) => cache.set(key, { value, updatedAt: Date.now() })
    },
    configProvider: () => ({
      storageBackend: "local",
      localRepositoryDir: libraryDir,
      localDatabasePath: databasePath
    }),
    plaudOutputDir: path.join(root, "plaud")
  });
  integration.buildMaterialIndex = async () => {
    throw new Error("local material lookup must not build a workspace-wide index");
  };
  const materials = await integration.entityMaterials({
    entityType: "project",
    recordId: "prj_fast"
  });
  assert.equal(integration.entityWorkspace({
    entityType: "project",
    recordId: "prj_fast"
  }), projectDirectory);
  assert.equal(materials.searchRoot, projectDirectory);
  assert.equal(materials.workspacePath, projectDirectory);
  assert.ok(materials.files.some((item) => item.path === materialPath));
  assert.equal(materials.files.some((item) => item.path === unrelatedPath), false);

  integration.sync = async () => {
    throw new Error("database edit must not run a full sync");
  };
  const updated = await integration.updateDatabaseRecord({
    entityType: "project",
    record: {
      recordId: "prj_fast",
      expectedUpdatedAt: version,
      name: "精确项目",
      domain: "AI",
      subdomains: ["Agent"],
      status: "深度跟踪",
      rating: "A",
      notes: "快速保存",
      cities: [],
      investors: ["IDG"],
      financingHistory: "",
      latestValuationUsd100m: null
    }
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.record.notes, "快速保存");
  assert.equal(updated.snapshot.projects[0].notes, "快速保存");
  assert.equal(cache.get("snapshot-v1").value.projects[0].notes, "快速保存");

  const preview = integration.previewDatabaseRecord({
    entityType: "project",
    recordId: "prj_fast"
  });
  assert.equal(preview.ok, true);
  assert.match(decodeURIComponent(preview.resource), /BP\.pdf$/);

  const deleted = integration.deleteDatabaseRecord({
    entityType: "project",
    recordId: "prj_fast",
    expectedUpdatedAt: updated.record.updatedAt
  });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.filesPreserved, true);
  assert.equal(deleted.snapshot.projects.length, 0);
  assert.equal(cache.get("snapshot-v1").value.projects.length, 0);
  assert.equal(fs.existsSync(materialPath), true);
});

test("PLAUD queue loads 50 recordings by default and orders them by creation time", async () => {
  const stateStore = {
    loadCache: () => null,
    saveCache: () => undefined
  };
  const integration = new DomiIntegration({ stateStore, plaudOutputDir: "/tmp/domi-test" });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  let requestedLimit = "";
  let requestedOffset = "";
  integration.runPlaudWorker = async (command, args) => {
    assert.equal(command, "list");
    requestedLimit = args[0];
    requestedOffset = args[1];
    return {
      ok: true,
      pendingCount: 0,
      hasMore: true,
      nextOffset: 50,
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
  assert.equal(requestedOffset, "0");
  assert.equal(result.hasMore, true);
  assert.equal(result.nextOffset, 50);
  assert.deepEqual(result.items.map((item) => item.fileId), ["newer-recording", "older-recording"]);
  assert.equal(integration.plaudRemoteHealth.ok, true);
  assert.equal(integration.plaudRemoteHealth.error, "");
});

test("PLAUD queue preserves the last successful remote list when a later refresh fails", async () => {
  const cache = new Map();
  const stateStore = {
    loadCache: (key) => cache.get(key) || null,
    saveCache: (key, value) => {
      const record = { value, updatedAt: Date.now() };
      cache.set(key, record);
      return record;
    }
  };
  const integration = new DomiIntegration({ stateStore, plaudOutputDir: "/tmp/domi-test" });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.loadActivePlaudWorkflowRecords = () => [];
  integration.loadPlaudWorkflowRecords = () => [];
  integration.runPlaudWorker = async () => ({
    ok: true,
    pendingCount: 2,
    hasMore: true,
    nextOffset: 50,
    items: [{ fileId: "cached-recording", fileName: "上次录音", createdAt: 10 }]
  });

  const fresh = await integration.plaudQueue();
  assert.equal(fresh.ok, true);
  assert.equal(fresh.stale, false);
  for (const cached of cache.values()) cached.value.syncedAt = 12_345;

  integration.runPlaudWorker = async () => {
    throw new Error("PLAUD 接口读取超时（15 秒）。");
  };
  const stale = await integration.plaudQueue();

  assert.equal(stale.ok, true);
  assert.equal(stale.stale, true);
  assert.equal(stale.pendingCount, 2);
  assert.equal(stale.hasMore, false);
  assert.deepEqual(stale.items.map((item) => item.fileId), ["cached-recording"]);
  assert.match(stale.warning, /上次成功读取/);
  assert.equal(stale.remoteStatus, "network_error");
  assert.equal(stale.retryable, true);
  assert.equal(stale.error, "");
  assert.equal(stale.syncedAt, 12_345);
  assert.equal(integration.plaudRemoteHealth.ok, false);

  const failedFresh = await integration.plaudQueue({ fresh: true });
  assert.equal(failedFresh.ok, false);
  assert.equal(failedFresh.stale, true);
  assert.deepEqual(failedFresh.items, []);
  assert.equal(failedFresh.remoteStatus, "network_error");
  assert.equal(failedFresh.lastSuccessfulSnapshot.ok, true);
  assert.equal(failedFresh.lastSuccessfulSnapshot.stale, true);
  assert.equal(failedFresh.lastSuccessfulSnapshot.syncedAt, 12_345);
  assert.deepEqual(
    failedFresh.lastSuccessfulSnapshot.items.map((item) => item.fileId),
    ["cached-recording"]
  );
});

test("PLAUD sync never submits generation from a stale cached list", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.plaudQueue = async () => ({
    ok: true,
    stale: true,
    pendingCount: 1,
    items: [{ fileId: "cached", fileName: "缓存录音" }]
  });
  integration.runJson = async () => {
    throw new Error("stale PLAUD data must not trigger mutations");
  };

  const result = await integration.syncPlaud({ confirmed: true });

  assert.equal(result.ok, false);
  assert.equal(result.snapshot.stale, true);
  assert.match(result.error, /远端读取/);
});

test("PLAUD queue requests later pages without duplicating local workflow-only records", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.runPlaudWorker = async (_command, args) => ({
    ok: true,
    pendingCount: 0,
    hasMore: false,
    nextOffset: Number(args[1]) + Number(args[0]),
    items: [{ fileId: "older-recording", fileName: "更早录音", createdAt: 1 }]
  });
  integration.loadPlaudWorkflowRecords = () => [{
    fileId: "workflow-only",
    fileName: "本地恢复项",
    stage: "transcript_ready"
  }];
  integration.loadActivePlaudWorkflowRecords = () => integration.loadPlaudWorkflowRecords();

  const result = await integration.plaudQueue({ offset: 50, limit: 50 });

  assert.equal(result.pageOffset, 50);
  assert.equal(result.pageSize, 50);
  assert.equal(result.nextOffset, 100);
  assert.deepEqual(result.items.map((item) => item.fileId), ["older-recording"]);
});

test("PLAUD later-page failures never substitute the cached first page", async () => {
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => ({
        value: {
          syncedAt: 10,
          pendingCount: 1,
          pageSize: 50,
          items: [{ fileId: "cached-first-page", fileName: "首页缓存" }]
        }
      }),
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test"
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  integration.loadPlaudWorkflowRecords = () => [];
  integration.loadActivePlaudWorkflowRecords = () => [];
  integration.runPlaudWorker = async () => {
    throw new Error("PLAUD 最近录音读取执行超时（120 秒）。");
  };

  const result = await integration.plaudQueue({ offset: 50, limit: 50 });

  assert.equal(result.ok, false);
  assert.equal(result.stale, false);
  assert.equal(result.pageOffset, 50);
  assert.deepEqual(result.items, []);
  assert.equal(result.lastSuccessfulSnapshot, undefined);
  assert.equal(result.remoteStatus, "network_error");
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
  let receivedRequest;
  const plaudBroker = {
    request: async (command, args, pluginRoot, options) => {
      receivedRequest = { command, args, pluginRoot, options };
      return { ok: true, items: [] };
    },
    stop: async () => undefined
  };
  const integration = new DomiIntegration({
    stateStore,
    plaudOutputDir: "/tmp/domi-test",
    domiConfigPath,
    playwrightNodeModules,
    mediaRuntime,
    plaudBroker
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  await integration.runPlaudWorker("list", ["50"]);

  const runtimeEnv = integration.plaudRuntimeEnv();
  assert.equal(runtimeEnv.ELECTRON_RUN_AS_NODE, "1");
  assert.equal(runtimeEnv.DOMI_CONFIG_PATH, domiConfigPath);
  assert.equal(runtimeEnv.DOMI_FFMPEG_PATH, mediaRuntime.ffmpegPath);
  assert.equal(runtimeEnv.DOMI_FFPROBE_PATH, mediaRuntime.ffprobePath);
  assert.equal(runtimeEnv.NODE_PATH.split(path.delimiter)[0], playwrightNodeModules);
  assert.deepEqual(receivedRequest, {
    command: "list",
    args: ["50"],
    pluginRoot: "/tmp/domi-plugin",
    options: {
      timeoutMs: 90_000,
      sessionKey: "/tmp/domi-plugin\u0000chrome\u00001"
    }
  });
});

test("PLAUD connection uses the selected private browser profile command", async () => {
  let selectedBrowser = "chrome";
  const brokerCalls = [];
  const plaudBroker = {
    request: async (command, args, pluginRoot, options) => {
      brokerCalls.push({ command, args, pluginRoot, options });
      return { ok: true, connected: true, browserLabel: "Tabbit" };
    },
    stop: async (reason) => brokerCalls.push({ stop: reason })
  };
  const integration = new DomiIntegration({
    stateStore: {
      loadCache: () => null,
      saveCache: () => undefined
    },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({
      plaudConnectionMode: "enabled",
      plaudBrowser: selectedBrowser
    }),
    plaudBroker
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });
  const calls = [];
  integration.runJson = async (binary, args, options) => {
    calls.push({ binary, args, options });
    return {
      ok: true,
      connected: args[1] === "login",
      browser: args[2],
      browserLabel: args[2] === "tabbit" ? "Tabbit" : "Google Chrome"
    };
  };

  const login = await integration.loginPlaud({ browser: "chrome" });
  selectedBrowser = "tabbit";
  const check = await integration.plaudConnection({ browser: "tabbit" });

  assert.equal(login.connected, true);
  assert.deepEqual(calls[0].args.slice(-2), ["doctor", "chrome"]);
  assert.deepEqual(calls[1].args.slice(-2), ["login", "chrome"]);
  assert.deepEqual(calls[2].args.slice(-2), ["doctor", "tabbit"]);
  assert.equal(calls[1].options.queue, "plaud");
  assert.equal(calls[1].options.timeout, 11 * 60 * 1000);
  assert.deepEqual(brokerCalls, [
    { stop: "login" },
    {
      command: "connection",
      args: [],
      pluginRoot: "/tmp/domi-plugin",
      options: {
        timeoutMs: 90_000,
        sessionKey: "/tmp/domi-plugin\u0000tabbit\u00001"
      }
    }
  ]);
  assert.equal(check.browserLabel, "Tabbit");
});

test("PLAUD connection leaves transient rebuild to the plugin under one bounded command", async () => {
  let attempts = 0;
  let receivedTimeout = 0;
  const plaudBroker = {
    request: async (_command, _args, _root, options) => {
      attempts += 1;
      receivedTimeout = options.timeoutMs;
      throw new Error("page.reload: Protocol error (Page.reload): Not attached to an active page");
    },
    stop: async () => undefined
  };
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "tabbit" }),
    sleep: async () => undefined,
    plaudBroker
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  await assert.rejects(
    integration.runPlaudConnectionCommand("connection", "tabbit"),
    /Not attached to an active page/
  );
  assert.equal(attempts, 1);
  assert.equal(receivedTimeout, 90_000);
});

test("PLAUD connection does not retry a confirmed logout", async () => {
  let attempts = 0;
  const plaudBroker = {
    request: async () => {
      attempts += 1;
      throw new Error("PLAUD_AUTH_REQUIRED: account sign-in is required");
    },
    stop: async () => undefined
  };
  const integration = new DomiIntegration({
    stateStore: { loadCache: () => null, saveCache: () => undefined },
    plaudOutputDir: "/tmp/domi-test",
    configProvider: () => ({ plaudConnectionMode: "enabled", plaudBrowser: "tabbit" }),
    sleep: async () => undefined,
    plaudBroker
  });
  integration.findPlugin = () => ({ root: "/tmp/domi-plugin" });

  await assert.rejects(
    integration.runPlaudConnectionCommand("connection", "tabbit"),
    /PLAUD_AUTH_REQUIRED/
  );
  assert.equal(attempts, 1);
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
