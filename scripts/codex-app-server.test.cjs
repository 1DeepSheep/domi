const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { CodexAppServer } = require("../electron/codex-app-server.cjs");

test("concurrent requests wait for Codex App Server initialization", async () => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-init-test-"));
  const fakeCodexPath = path.join(temporaryDirectory, "fake-codex");
  fs.writeFileSync(fakeCodexPath, `#!/usr/bin/env node
const readline = require("node:readline");
let initialized = false;
const input = readline.createInterface({ input: process.stdin });
input.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
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
