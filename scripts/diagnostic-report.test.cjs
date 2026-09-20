const test = require("node:test");
const assert = require("node:assert/strict");
const { MAX_CHECKS, MAX_REPORT_BYTES, sanitizeDiagnosticReport } = require("../electron/diagnostic-report.cjs");
const syntheticHome = ["", "Users", "synthetic-person"].join("/");
const syntheticToken = ["SyntheticSecret", "ForTestsOnly12345"].join("");

function report(overrides = {}) {
  return {
    ok: false, generatedAt: 1234567890000, durationMs: 91,
    app: { name: "domi", version: "7.0.14", packaged: true },
    system: { platform: "darwin", arch: "arm64", release: "25.0.0" },
    connection: { authMode: "chatgpt", providerLabel: "ChatGPT", credentialStored: true },
    checks: [{ id: "codex", label: "Codex App Server", ok: false, detail: "连接超时", diagnosticCode: "DOMI_CODEX_CONNECTION_TEST_TIMEOUT", stage: "model-tool", durationMs: 90_000 }],
    ...overrides
  };
}

test("retains versions, outcome, stage, error codes and durations", () => {
  const safe = sanitizeDiagnosticReport(report({
    stage: { id: "connection", status: "error", durationMs: 910, stdout: "private material" },
    network: { online: true, httpStatus: 503, errorCode: "ETIMEDOUT", durationMs: 82 }
  }));
  assert.equal(safe.sanitized, true);
  assert.equal(safe.app.version, "7.0.14");
  assert.equal(safe.system.arch, "arm64");
  assert.equal(safe.durationMs, 91);
  assert.equal(safe.checks[0].diagnosticCode, "DOMI_CODEX_CONNECTION_TEST_TIMEOUT");
  assert.equal(safe.checks[0].stage, "model-tool");
  assert.equal(safe.checks[0].durationMs, 90_000);
  assert.deepEqual(safe.stage, { status: "error", durationMs: 910, id: "connection" });
  assert.deepEqual(safe.network, { errorCode: "ETIMEDOUT", durationMs: 82, httpStatus: 503, online: true });
});

test("drops unknown fields, task data, raw stdout/stderr, credentials and deep objects", () => {
  const source = report({
    credentials: { secret: "top-private" }, raw: "raw-private", tasks: [{ text: "material-private" }],
    app: { name: "domi", version: "7.0.14", secret: "app-private", nested: { private: "nested-private" } },
    connection: { authMode: "api", apiKey: "connection-private", headers: { Authorization: ["header", "private"].join("-") } },
    checks: [{ id: "codex", ok: false, stdout: "stdout-private", stderr: "stderr-private", stack: "stack-private", taskContent: "content-private", metadata: { private: "meta-private" } }]
  });
  const safe = sanitizeDiagnosticReport(source);
  assert.doesNotMatch(JSON.stringify(safe), /private/);
  assert.deepEqual(safe.checks, [{ ok: false, id: "codex" }]);
  assert.equal(source.connection.apiKey, "connection-private", "input is not mutated");
});

test("masks macOS, Unix, Windows, UNC, tilde and encoded private paths", () => {
  for (const value of [
    `${syntheticHome}/Library/Application Support/private-project/file.json`,
    "/home/synthetic-person/private-project.txt",
    "/private/var/folders/synthetic-person/private-project.txt",
    "/var/folders/synthetic-person/private-project.txt",
    "~/private-project.txt", "C:\\Users\\synthetic-person\\private-project.txt",
    "\\\\synthetic-server\\private-project\\file.txt",
    `file://${syntheticHome}/private-project.txt`,
    "%2FUsers%2Fsynthetic-person%2Fprivate-project.txt",
    "%252FUsers%252Fsynthetic-person%252Fprivate-project.txt"
  ]) {
    const safe = sanitizeDiagnosticReport(report({ checks: [{ id: "workspace", detail: `EACCES: ${value}` }] }));
    assert.match(safe.checks[0].detail, /\[local path\]/, value);
    assert.doesNotMatch(JSON.stringify(safe), /synthetic-person|private-project|synthetic-server/);
  }
});

test("URL fields retain only origin, excluding account, path, query and fragment", () => {
  const safe = sanitizeDiagnosticReport(report({
    connection: { apiBaseUrl: ["https://synthetic-user:synthetic-pass", "gateway.example.test:8443/account-private/v1?api_key=query-private#fragment-private"].join("@") },
    network: { endpoint: "https://api.example.test/private-path?token=network-private" },
    checks: [{ detail: ["HTTP 401 https://u:p", "api.example.test/private-path?token=detail-private#anchor"].join("@") }]
  }));
  assert.equal(safe.connection.apiBaseUrl, "https://gateway.example.test:8443");
  assert.equal(safe.network.endpoint, "https://api.example.test");
  assert.equal(safe.checks[0].detail, "HTTP 401 https://api.example.test");
  assert.doesNotMatch(JSON.stringify(safe), /synthetic-user|synthetic-pass|private|anchor/);
});

test("masks emails, authorization headers, bearer/basic values and secret assignments", () => {
  const samples = [
    "Account synthetic.person+test@example.com failed",
    ["Authorization:", "Bearer", "authorization-private"].join(" "),
    ["proxy-authorization=Basic", "c3ludGhldGljLXNlY3JldA=="].join(" "),
    ["failed Bearer", "bearer-private"].join(" "),
    ["failed Basic", "c3ludGhldGljLXNlY3JldA=="].join(" "),
    'OPENAI_API_KEY="api-key-private"',
    "apiKey='camel-private'", "access_token=access-private", "refresh-token=refresh-private",
    "password=password-private", "client_secret=client-private", "token=token-private",
    "cookie=CookiePrivateValue", "session_id=session-private", "CUSTOM_SECRET=custom-private"
  ];
  for (const detail of samples) {
    const safe = sanitizeDiagnosticReport(report({ checks: [{ detail }] }));
    assert.doesNotMatch(JSON.stringify(safe), /synthetic\.person|example\.com|private|c3ludGhldGlj|CookiePrivateValue/);
    assert.match(safe.checks[0].detail, /\[(?:redacted|email)\]/);
  }
});

test("masks recognizable bare API keys, access tokens and JWTs", () => {
  for (const secret of [
    `sk-proj-${syntheticToken}`,
    `sk-ant-${syntheticToken}`,
    `ghp_${syntheticToken}`,
    `github_pat_${syntheticToken}`,
    ["AKIA", "ABCDEFGHIJKLMNOP"].join(""),
    "eyJhbGciOiJIUzI1NiJ9.c3ludGhldGlj.c2lnbmF0dXJl",
    "1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
  ]) {
    const safe = sanitizeDiagnosticReport(report({ checks: [{ detail: `Request failed ${secret}` }] }));
    assert.equal(safe.checks[0].detail, "Request failed [redacted]");
  }
});

test("omits command output and material appended to diagnostics", () => {
  for (const detail of [
    "Command failed: tool --prompt private-material",
    "stderr: private-material", 'Error: stderr="private-material"',
    'Failed prompt="private-material"', 'Error: taskContent="private-material"',
    "连接失败，任务材料：private-material", "Error\nprivate-material\nmore-private-material"
  ]) {
    const safe = sanitizeDiagnosticReport(report({ checks: [{ detail }] }));
    assert.doesNotMatch(JSON.stringify(safe), /private-material/);
  }
});

test("does not evaluate unknown or allowed getters, toJSON, inherited data or cycles", () => {
  const source = report();
  source.self = source;
  source.stage = source;
  source.app = Object.create({ version: "inherited-private" });
  source.app.name = "domi";
  Object.defineProperty(source.app, "version", { get() { throw new Error("must not call getter"); } });
  source.toJSON = () => { throw new Error("must not call toJSON"); };
  source.checks.push(source);
  const safe = sanitizeDiagnosticReport(source);
  assert.equal(safe.app.name, "domi");
  assert.equal(safe.app.version, undefined);
  assert.doesNotThrow(() => JSON.stringify(safe));
  assert.doesNotMatch(JSON.stringify(safe), /inherited-private/);
});

test("limits count, text size and total UTF-8 size", () => {
  const checks = Array.from({ length: 10_000 }, () => ({
    id: "check", label: "字".repeat(10_000), detail: "字".repeat(10_000), error: "字".repeat(10_000)
  }));
  const safe = sanitizeDiagnosticReport(report({ checks }));
  assert.equal(safe.truncated, true);
  assert.ok(safe.checks.length <= MAX_CHECKS);
  assert.ok(Buffer.byteLength(JSON.stringify(safe)) <= MAX_REPORT_BYTES);
  assert.ok(safe.checks.every(item => item.detail.length <= 240 && item.label.length <= 80));
});

test("rejects wrong types and invalid identifiers instead of stringifying private objects", () => {
  const safe = sanitizeDiagnosticReport(report({
    generatedAt: "private", durationMs: Infinity,
    app: { version: { secret: "private" }, name: ["private"], packaged: "true" },
    system: { arch: "arm64 private", platform: null, release: `${syntheticHome}/private/file` },
    stage: "model-tool secret=private",
    checks: [{ id: { private: true }, label: ["private"], errorCode: "secret=private", detail: { private: true }, durationMs: -1 }]
  }));
  assert.doesNotMatch(JSON.stringify(safe), /private|Infinity/);
  assert.deepEqual(safe.checks, []);
  assert.equal(safe.stage, undefined);
});

test("null and malformed reports remain safe and bounded", () => {
  for (const input of [null, undefined, false, 17, "private", [], { checks: {} }]) {
    const safe = sanitizeDiagnosticReport(input);
    assert.equal(safe.sanitized, true);
    assert.deepEqual(safe.checks, []);
    assert.doesNotMatch(JSON.stringify(safe), /private/);
  }
});

test("safe reports retain their useful content when sanitized again", () => {
  const once = sanitizeDiagnosticReport(report({ connection: { apiBaseUrl: "https://api.example.test/private?key=private" } }));
  assert.deepEqual(sanitizeDiagnosticReport(once), once);
});

test("preserves the actual relay auth mode as well as older API reports", () => {
  for (const authMode of ["relay", "chatgpt", "api"]) {
    const safe = sanitizeDiagnosticReport(report({ connection: { authMode } }));
    assert.equal(safe.connection.authMode, authMode);
  }
});
