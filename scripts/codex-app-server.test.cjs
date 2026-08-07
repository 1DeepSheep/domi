const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CodexAppServer } = require("../electron/codex-app-server.cjs");
const { isSelectedCodexConnectionReady } = require("../electron/codex-protocol.cjs");

test("ChatGPT and Responses relay are independent connection choices", () => {
  assert.equal(isSelectedCodexConnectionReady({
    authMode: "chatgpt",
    requiresOpenaiAuth: true,
    account: { email: "user@example.com" },
    relayCredentialStored: false
  }), true);
  assert.equal(isSelectedCodexConnectionReady({
    authMode: "chatgpt",
    requiresOpenaiAuth: true,
    account: null,
    relayCredentialStored: true
  }), false);
  assert.equal(isSelectedCodexConnectionReady({
    authMode: "relay",
    requiresOpenaiAuth: true,
    account: null,
    relayCredentialStored: true
  }), true);
  assert.equal(isSelectedCodexConnectionReady({
    authMode: "relay",
    requiresOpenaiAuth: false,
    account: { email: "user@example.com" },
    relayCredentialStored: false
  }), false);
});

test("concurrent requests wait for Codex App Server initialization", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-init-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
let initialized = false;
let initializeCapabilities = null;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    initializeCapabilities = message.params.capabilities || null;
    setTimeout(() => {
      initialized = true;
      process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    }, 50);
    return;
  }
  if (message.method === "ping") {
    if (!initialized) {
      process.stdout.write(JSON.stringify({
        id: message.id,
        error: { code: -32002, message: "Not initialized" }
      }) + "\\n");
      return;
    }
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "capabilities") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: initializeCapabilities
    }) + "\\n");
  }
});
`, { mode: 0o755 });

  const server = new CodexAppServer({
    cwd: temporaryDirectory,
    version: "test",
    requestTimeoutMs: 3_000,
    onLog: (text) => process.stderr.write(text),
    runtimeProvider: () => ({ codexPath: fakeCodexPath })
  });

  try {
    const results = await Promise.all([
      server.request("ping"),
      server.request("ping"),
      server.request("ping")
    ]);
    assert.deepEqual(results, [{ ok: true }, { ok: true }, { ok: true }]);
    assert.deepEqual(await server.request("capabilities"), { experimentalApi: true });
    assert.deepEqual(server.capabilities(), { experimentalApi: true });
  } finally {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("unsupported experimental capability falls back during initialization", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-capability-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
let initializeAttempts = 0;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    initializeAttempts += 1;
    if (message.params.capabilities?.experimentalApi === true) {
      process.stdout.write(JSON.stringify({
        id: message.id,
        error: { code: -32602, message: "unknown capability experimentalApi" }
      }) + "\\n");
      return;
    }
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "attempts") {
    process.stdout.write(JSON.stringify({
      id: message.id,
      result: { initializeAttempts }
    }) + "\\n");
  }
});
`, { mode: 0o755 });

  const logs = [];
  const server = new CodexAppServer({
    cwd: temporaryDirectory,
    version: "test",
    requestTimeoutMs: 3_000,
    onLog: (text) => logs.push(text),
    runtimeProvider: () => ({ codexPath: fakeCodexPath })
  });

  try {
    await server.start();
    assert.deepEqual(server.capabilities(), { experimentalApi: false });
    assert.deepEqual(await server.request("attempts"), { initializeAttempts: 2 });
    assert.match(logs.join(""), /稳定兼容模式/);
  } finally {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("Codex App Server requests time out without poisoning later requests", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-server-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize" || message.method === "ping") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
  }
});
`, { mode: 0o755 });

  const server = new CodexAppServer({
    cwd: temporaryDirectory,
    version: "test",
    requestTimeoutMs: 3_000,
    onLog: (text) => process.stderr.write(text),
    runtimeProvider: () => ({ codexPath: fakeCodexPath })
  });

  try {
    await server.start();
    await assert.rejects(
      server.request("hang", {}, { timeoutMs: 30 }),
      (error) => error?.code === "DOMI_CODEX_REQUEST_TIMEOUT"
    );
    assert.deepEqual(await server.request("ping"), { ok: true });
  } finally {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("request_user_input waits for a validated answer and duplicate submits are idempotent", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-user-input-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
let beginRequestId = null;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "begin") {
    beginRequestId = message.id;
    process.stdout.write(JSON.stringify({
      id: "ask-1",
      method: "item/tool/requestUserInput",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-1",
        isBlocking: true,
        autoResolutionMs: null,
        questions: [{
          id: "project",
          header: "归档位置",
          question: "归入哪个项目？",
          isOther: false,
          isSecret: false,
          options: [
            { label: "芯星元", description: "归入已有项目" },
            { label: "暂不归档", description: "稍后处理" }
          ]
        }]
      }
    }) + "\\n");
    return;
  }
  if (message.id === "ask-1") {
    process.stdout.write(JSON.stringify({
      id: beginRequestId,
      result: { userInputResponse: message.result || null, userInputError: message.error || null }
    }) + "\\n");
  }
});
`, { mode: 0o755 });

  let releaseRequest;
  const requestReceived = new Promise((resolve) => { releaseRequest = resolve; });
  const closed = [];
  const server = new CodexAppServer({
    cwd: temporaryDirectory,
    version: "test",
    requestTimeoutMs: 3_000,
    runtimeProvider: () => ({ codexPath: fakeCodexPath }),
    onUserInputRequest: releaseRequest,
    onUserInputRequestClosed: (request) => closed.push(request)
  });

  try {
    const resultPromise = server.request("begin");
    const request = await requestReceived;
    assert.equal(request.id, "ask-1");
    assert.equal(request.params.questions[0].isSecret, false);
    assert.equal(server.pendingUserInputRequests().length, 1);

    assert.deepEqual(server.answerUserInput("ask-1", { project: ["不存在"] }), {
      ok: false,
      error: "“归档位置”包含无效选项。"
    });
    assert.equal(server.pendingUserInputRequests().length, 1);

    assert.deepEqual(server.answerUserInput("ask-1", { project: ["芯星元"] }), {
      ok: true,
      duplicate: false
    });
    assert.deepEqual(server.answerUserInput("ask-1", { project: ["芯星元"] }), {
      ok: true,
      duplicate: true
    });
    assert.deepEqual(await resultPromise, {
      userInputResponse: { answers: { project: { answers: ["芯星元"] } } },
      userInputError: null
    });
    assert.equal(server.pendingUserInputRequests().length, 0);
    assert.equal(closed.length, 1);
    assert.equal(closed[0].reason, "answered");
  } finally {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});

test("approval requests remain declined and never enter the user-input queue", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-approval-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
let beginRequestId = null;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: message.id, result: { ok: true } }) + "\\n");
    return;
  }
  if (message.method === "begin") {
    beginRequestId = message.id;
    process.stdout.write(JSON.stringify({
      id: "approval-1",
      method: "item/commandExecution/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1" }
    }) + "\\n");
    return;
  }
  if (message.id === "approval-1") {
    process.stdout.write(JSON.stringify({ id: beginRequestId, result: message.result }) + "\\n");
  }
});
`, { mode: 0o755 });

  let userInputCount = 0;
  const server = new CodexAppServer({
    cwd: temporaryDirectory,
    version: "test",
    requestTimeoutMs: 3_000,
    runtimeProvider: () => ({ codexPath: fakeCodexPath }),
    onUserInputRequest: () => { userInputCount += 1; }
  });
  try {
    assert.deepEqual(await server.request("begin"), { decision: "decline" });
    assert.equal(userInputCount, 0);
    assert.equal(server.pendingUserInputRequests().length, 0);
  } finally {
    server.close();
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
});
