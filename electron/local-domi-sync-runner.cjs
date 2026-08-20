const path = require("node:path");
const { Worker } = require("node:worker_threads");

const DEFAULT_WORKER_PATH = path.join(__dirname, "local-domi-sync-worker.cjs");
const DEFAULT_SYNC_TIMEOUT_MS = 3 * 60 * 1000;

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
  const timeoutMs = Math.max(100, Number(options.timeoutMs) || DEFAULT_SYNC_TIMEOUT_MS);

  return new Promise((resolve, reject) => {
    const worker = new WorkerClass(workerPath, { workerData });
    let settled = false;
    const timeoutTimer = setTimeout(() => {
      const failure = new Error(
        `本地资料库扫描超过 ${Math.ceil(timeoutMs / 1000)} 秒，已停止本轮刷新并保留上次成功数据。`
      );
      failure.code = "DOMI_LOCAL_SYNC_TIMEOUT";
      if (!settled) {
        settled = true;
        void Promise.resolve(worker.terminate?.()).catch(() => undefined);
        reject(failure);
      }
    }, timeoutMs);
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
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
  DEFAULT_SYNC_TIMEOUT_MS,
  localSyncSource,
  runLocalDomiSync
};
