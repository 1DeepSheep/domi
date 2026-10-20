const path = require("node:path");
const { Worker } = require("node:worker_threads");
const { runRepositoryWorker } = require("./repository-worker.cjs");

const DEFAULT_WORKER_PATH = path.join(__dirname, "local-domi-sync-worker.cjs");
const DEFAULT_SYNC_TIMEOUT_MS = 3 * 60 * 1000;
const activeSyncs = new Map();

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
  const key = JSON.stringify(workerData.source);
  const active = activeSyncs.get(key);
  if (active) return active.result;
  let run;
  try {
    run = runRepositoryWorker({
      workerPath, workerData, WorkerClass, timeoutMs,
      timeoutError: () => {
        const failure = new Error(
          `本地资料库扫描超过 ${Math.ceil(timeoutMs / 1000)} 秒，已停止本轮刷新并保留上次成功数据。`
        );
        failure.code = "DOMI_LOCAL_SYNC_TIMEOUT";
        return failure;
      },
      exitError: code => new Error(`本地资料库同步进程意外退出（${Number(code) || 0}）。`)
    });
  } catch (error) { return Promise.reject(error); }
  const result = run.result.then(message => {
    if (!message?.ok) throw workerFailure(message?.error);
    return message.value;
  });
  const item = { result };
  activeSyncs.set(key, item);
  // A timed-out caller may retry immediately. Reuse its rejected result until
  // termination is confirmed instead of starting another concurrent scanner.
  void run.completion.then(() => {
    if (activeSyncs.get(key) === item) activeSyncs.delete(key);
  });
  return result;
}

module.exports = {
  DEFAULT_SYNC_TIMEOUT_MS,
  localSyncSource,
  runLocalDomiSync
};
