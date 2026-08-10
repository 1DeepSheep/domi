const path = require("node:path");
const { Worker } = require("node:worker_threads");

const DEFAULT_WORKER_PATH = path.join(__dirname, "local-domi-sync-worker.cjs");

function localSyncSource(source = {}) {
  const localDatabasePath = path.resolve(String(source.localDatabasePath || ""));
  const localLibraryDir = path.resolve(String(source.localLibraryDir || ""));
  if (!String(source.localDatabasePath || "").trim() || !String(source.localLibraryDir || "").trim()) {
    throw new Error("domi 本地资料库尚未配置，无法同步。");
  }
  return { localDatabasePath, localLibraryDir };
}

function workerFailure(error) {
  if (error instanceof Error) return error;
  const message = typeof error?.message === "string" ? error.message : String(error || "本地资料库同步失败。");
  const failure = new Error(message);
  if (typeof error?.code === "string") failure.code = error.code;
  return failure;
}

function runLocalDomiSync(source, options = {}) {
  const WorkerClass = options.WorkerClass || Worker;
  const workerPath = path.resolve(options.workerPath || DEFAULT_WORKER_PATH);
  const workerData = {
    source: localSyncSource(source),
    // Only tests pass a delay. Keeping it inside the worker makes the event-loop
    // regression deterministic without changing production synchronization.
    testDelayMs: Math.min(Math.max(Number(options.testDelayMs) || 0, 0), 5_000)
  };

  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(workerPath, { workerData });
    let settled = false;

    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };

    worker.once("message", (message) => {
      if (message?.ok) {
        settle(resolve, message.value);
      } else {
        settle(reject, workerFailure(message?.error));
      }
    });
    worker.once("error", (error) => settle(reject, workerFailure(error)));
    worker.once("exit", (code) => {
      if (!settled) {
        settle(
          reject,
          new Error(`本地资料库同步进程意外退出（${Number(code) || 0}）。`)
        );
      }
    });
  });
}

module.exports = {
  localSyncSource,
  runLocalDomiSync
};
