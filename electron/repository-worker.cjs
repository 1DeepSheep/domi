const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Worker } = require("node:worker_threads");

function industryWorkerLock(source) {
  const libraryDir = path.resolve(source.localLibraryDir);
  const suffix = crypto.createHash("sha256").update(libraryDir).digest("hex").slice(0, 16);
  return {
    path: path.join(path.dirname(path.resolve(source.localDatabasePath)), `.domi-industry-${suffix}.lock`),
    token: JSON.stringify({ pid: process.pid, token: crypto.randomUUID() })
  };
}

// A request may time out before native/cloud IO lets a worker terminate. Report
// that deadline promptly, but retain its lock and single-flight slot until the
// worker has actually finished. Worker threads share their parent's PID.
function runRepositoryWorker({ workerPath, workerData, WorkerClass = Worker, timeoutMs,
  timeoutError, exitError, resourceLimits }) {
  const lock = industryWorkerLock(workerData.source);
  const worker = new WorkerClass(workerPath, {
    workerData: { ...workerData, lockToken: lock.token },
    ...(resourceLimits ? { resourceLimits } : {})
  });
  let resolveResult, rejectResult, resolveCompletion;
  const result = new Promise((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  let reported = false, finishing = false, abortError = null, termination = null;
  let timer;
  const report = (error, message) => {
    if (reported) return;
    reported = true;
    if (error) rejectResult(error);
    else resolveResult(message);
  };
  const cleanupLock = async () => {
    try {
      // Never remove a different worker's lock, even if it has the same PID.
      if (await fs.promises.readFile(lock.path, "utf8") === lock.token) await fs.promises.unlink(lock.path);
    } catch (error) {
      if (error.code !== "ENOENT") console.warn("[repository-worker] 行业速览锁清理失败", error.code || error.message);
    }
  };
  const finish = async (error, message) => {
    if (finishing) return completion;
    finishing = true;
    clearTimeout(timer);
    await cleanupLock();
    report(abortError || error, message);
    resolveCompletion();
    return completion;
  };
  const cancel = error => {
    abortError ||= error;
    clearTimeout(timer);
    report(abortError);
    if (!termination && !finishing) {
      // Only a fulfilled terminate() or an exit/message event proves that the
      // worker can no longer be generating pages. A rejected terminate is not
      // permission to release the lock.
      try {
        termination = Promise.resolve(worker.terminate()).then(
          () => finish(abortError),
          failure => console.warn("[repository-worker] 后台线程终止失败，等待退出", failure.code || failure.message)
        );
      } catch (failure) {
        termination = Promise.resolve();
        console.warn("[repository-worker] 后台线程终止失败，等待退出", failure.code || failure.message);
      }
    }
    return completion;
  };
  worker.once("message", message => { void finish(null, message); });
  worker.once("error", error => { void cancel(error); });
  worker.once("exit", code => { void finish(abortError || exitError(code)); });
  timer = setTimeout(() => { void cancel(timeoutError()); }, timeoutMs);
  return { result, completion, cancel, get abortError() { return abortError; } };
}

module.exports = { industryWorkerLock, runRepositoryWorker };
