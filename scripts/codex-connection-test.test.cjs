const assert = require("node:assert/strict");
const test = require("node:test");
const {
  CodexConnectionTestController
} = require("../electron/codex-connection-test.cjs");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

test("the connection test deadline covers the whole workflow and reports its active stage", async () => {
  const late = deferred();
  const controller = new CodexConnectionTestController({ timeoutMs: 20 });
  let operationSignal;
  const outcomePromise = controller.run({ requestId: "timeout-case" }, async ({ signal, setStage }) => {
    operationSignal = signal;
    setStage("model-tool");
    return late.promise;
  });

  const outcome = await outcomePromise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.cancelled, false);
  assert.equal(outcome.requestId, "timeout-case");
  assert.equal(outcome.stage, "model-tool");
  assert.equal(outcome.diagnosticCode, "DOMI_CODEX_CONNECTION_TEST_TIMEOUT");
  assert.match(outcome.error, /模型或 Shell 工具没有按时返回/);
  assert.equal(operationSignal.aborted, true);
  assert.equal(controller.active.size, 1, "the single-flight slot must remain held while timed-out work drains");

  late.resolve({ ok: true, verification: { ok: true } });
  await nextTurn();
  assert.equal(outcome.timedOut, true, "a late success must not replace the timeout result");
  assert.equal(controller.active.size, 0);
});

test("cancel affects only the matching request and late completion cannot replace it", async () => {
  const late = deferred();
  const controller = new CodexConnectionTestController({ timeoutMs: 5_000 });
  const outcomePromise = controller.run({ requestId: "cancel-case" }, async ({ signal }) => {
    await late.promise;
    return { ok: !signal.aborted };
  });
  await nextTurn();

  assert.deepEqual(controller.cancel("another-request"), {
    ok: true,
    requestId: "another-request",
    cancelled: false
  });
  assert.equal(controller.active.has("cancel-case"), true);
  assert.equal(controller.cancel("cancel-case").cancelled, true);

  const outcome = await outcomePromise;
  assert.equal(outcome.ok, false);
  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.timedOut, false);
  assert.equal(outcome.diagnosticCode, "DOMI_CODEX_CONNECTION_TEST_CANCELLED");
  assert.equal(controller.active.size, 1, "cancelled work must keep the global slot until it really finishes");

  let overlappingOperationRuns = 0;
  const overlapping = await controller.run({ requestId: "new-request-too-soon" }, async () => {
    overlappingOperationRuns += 1;
    return { ok: true };
  });
  assert.equal(overlapping.ok, false);
  assert.equal(overlapping.diagnosticCode, "DOMI_CODEX_CONNECTION_TEST_BUSY");
  assert.match(overlapping.error, /正在安全停止/);
  assert.equal(overlappingOperationRuns, 0, "a retry must not overlap draining work from the cancelled request");

  late.resolve();
  await nextTurn();
  assert.equal(outcome.cancelled, true, "a late completion must not replace cancellation");
  assert.equal(controller.active.size, 0);

  const afterDrain = await controller.run({ requestId: "new-request-after-drain" }, async () => {
    overlappingOperationRuns += 1;
    return { ok: true };
  });
  assert.equal(afterDrain.ok, true);
  assert.equal(overlappingOperationRuns, 1, "the next test may start only after the old work has drained");
});

test("a completed request retains its request id for renderer generation checks", async () => {
  const controller = new CodexConnectionTestController({ timeoutMs: 100 });
  const outcome = await controller.run({ requestId: "success-case" }, async ({ setStage }) => {
    setStage("model-tool");
    return { ok: true, verification: { ok: true, modelOk: true, toolOk: true } };
  });

  assert.equal(outcome.ok, true);
  assert.equal(outcome.requestId, "success-case");
  assert.equal(outcome.verification.modelOk, true);
  assert.equal(controller.active.size, 0);
});
