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
