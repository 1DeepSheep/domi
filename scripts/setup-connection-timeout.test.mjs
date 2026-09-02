import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  codexConnectionConfigFingerprint,
  codexConnectionDraftBlockReason,
  codexConnectionRuntimeMatchesSnapshot,
  codexConnectionRuntimeSnapshot,
  runBoundedCodexConnectionTest
} from "../src/codex-connection-test.ts";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("renderer timeout restores control and ignores a late IPC success", async () => {
  const late = deferred();
  const controller = new AbortController();
  const cancellations = [];
  let visibleState = "testing";
  const resultPromise = runBoundedCodexConnectionTest({
    requestId: "renderer-timeout",
    signal: controller.signal,
    invoke: () => late.promise,
    cancel: async (request) => cancellations.push(request.requestId),
    timeoutMs: 15
  }).then((outcome) => {
    visibleState = outcome.status;
    return outcome;
  });

  const outcome = await resultPromise;
  assert.equal(outcome.status, "timed-out");
  assert.equal(visibleState, "timed-out");
  assert.deepEqual(cancellations, ["renderer-timeout"]);

  late.resolve({ ok: true, requestId: "renderer-timeout" });
  await nextTurn();
  assert.equal(visibleState, "timed-out", "late IPC success must not change visible state");
});

test("renderer cancellation exits immediately and requests the matching main-process cancel", async () => {
  const controller = new AbortController();
  const cancellations = [];
  let invokeCount = 0;
  const resultPromise = runBoundedCodexConnectionTest({
    requestId: "renderer-cancel",
    signal: controller.signal,
    invoke: async () => {
      invokeCount += 1;
      return { ok: true, requestId: "renderer-cancel" };
    },
    cancel: async (request) => cancellations.push(request.requestId),
    timeoutMs: 5_000
  });

  controller.abort();
  const outcome = await resultPromise;
  assert.equal(outcome.status, "cancelled");
  assert.deepEqual(cancellations, ["renderer-cancel"]);
  await nextTurn();
  assert.equal(invokeCount, 0, "cancelling before the invoke microtask must not start a ghost IPC request");
  assert.equal(outcome.status, "cancelled");
});

test("renderer accepts a current successful result without asking main to cancel", async () => {
  const controller = new AbortController();
  const cancellations = [];
  const outcome = await runBoundedCodexConnectionTest({
    requestId: "renderer-success",
    signal: controller.signal,
    invoke: async () => ({ ok: true, requestId: "renderer-success" }),
    cancel: async (request) => cancellations.push(request.requestId),
    timeoutMs: 100
  });

  assert.equal(outcome.status, "completed");
  assert.equal(outcome.result.ok, true);
  assert.deepEqual(cancellations, []);
});

test("connection fingerprints change for every tested identity and path field", () => {
  const baseline = {
    authMode: "chatgpt",
    apiBaseUrl: "",
    apiModel: "",
    relayCredentialConfigured: false,
    codexPath: "/Applications/domi.app/codex",
    relayApiKey: "",
    runtimeAuthMode: "chatgpt",
    runtimeApiBaseUrl: "",
    runtimeModel: "gpt-current",
    runtimePath: "/Applications/domi.app/codex",
    runtimeAccount: "person@example.com"
  };
  const original = codexConnectionConfigFingerprint(baseline);
  for (const [field, value] of [
    ["authMode", "relay"],
    ["apiBaseUrl", "https://relay.example/v1"],
    ["apiModel", "relay-model"],
    ["relayCredentialConfigured", true],
    ["codexPath", "/tmp/another-codex"],
    ["relayApiKey", "changed-secret"],
    ["runtimeAuthMode", "relay"],
    ["runtimeApiBaseUrl", "https://runtime.example/v1"],
    ["runtimeModel", "another-model"],
    ["runtimePath", "/tmp/runtime-codex"],
    ["runtimeAccount", "other@example.com"]
  ]) {
    assert.notEqual(
      codexConnectionConfigFingerprint({ ...baseline, [field]: value }),
      original,
      `${field} must invalidate an earlier successful connection test`
    );
  }
});

test("generic testing rejects an unsaved Codex path and a replacement relay key", () => {
  assert.match(codexConnectionDraftBlockReason({
    draftCodexPath: "/tmp/new-codex",
    savedCodexPath: "/tmp/saved-codex",
    runtimePath: "/tmp/saved-codex",
    relayApiKey: ""
  }), /尚未应用/);
  assert.match(codexConnectionDraftBlockReason({
    draftCodexPath: "/tmp/saved-codex",
    savedCodexPath: "/tmp/saved-codex",
    runtimePath: "/tmp/saved-codex",
    relayApiKey: "replacement-secret"
  }), /安全保存并测试/);
  assert.equal(codexConnectionDraftBlockReason({
    draftCodexPath: "/tmp/saved-codex",
    savedCodexPath: "/tmp/saved-codex",
    runtimePath: "/tmp/saved-codex",
    relayApiKey: ""
  }), "");
});

test("first-run path application can replace a package-manager symlink with the tested realpath", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-path-"));
  try {
    const runtime = path.join(root, "runtime-codex");
    const symlink = path.join(root, "codex");
    fs.writeFileSync(runtime, "runtime");
    fs.symlinkSync(runtime, symlink);
    const canonicalPath = fs.realpathSync(symlink);

    assert.match(codexConnectionDraftBlockReason({
      draftCodexPath: symlink,
      savedCodexPath: "",
      runtimePath: canonicalPath,
      relayApiKey: ""
    }), /尚未应用/);
    assert.equal(codexConnectionDraftBlockReason({
      draftCodexPath: canonicalPath,
      savedCodexPath: canonicalPath,
      runtimePath: canonicalPath,
      relayApiKey: ""
    }), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a successful IPC result must match every expected runtime identity field", () => {
  const expected = codexConnectionRuntimeSnapshot({
    authMode: "relay",
    path: "/tmp/codex",
    apiBaseUrl: "https://relay.example.com/v1/",
    configuredModel: "gpt-current"
  });
  const actual = {
    authMode: "relay",
    path: "/tmp/codex",
    apiBaseUrl: "HTTPS://RELAY.EXAMPLE.COM:443/v1",
    configuredModel: "gpt-current"
  };
  assert.equal(codexConnectionRuntimeMatchesSnapshot(expected, actual), true);
  for (const [field, value] of [
    ["authMode", "chatgpt"],
    ["path", "/tmp/other-codex"],
    ["apiBaseUrl", "https://other.example.com/v1"],
    ["configuredModel", "gpt-other"]
  ]) {
    assert.equal(
      codexConnectionRuntimeMatchesSnapshot(expected, { ...actual, [field]: value }),
      false,
      `${field} mismatch must reject a stale or wrong-runtime success`
    );
  }
});
