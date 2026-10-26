const { parentPort, workerData } = require("node:worker_threads");
const { LocalDomiRepository } = require("./local-domi-repository.cjs");

function serializedError(error) {
  return {
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    code: typeof error?.code === "string" ? error.code : ""
  };
}

function testDelay(milliseconds) {
  const delay = Math.min(Math.max(Number(milliseconds) || 0, 0), 5_000);
  if (!delay) return;
  const signal = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));
  Atomics.wait(signal, 0, 0, delay);
}

function repositoryNotReadyError() {
  const error = new Error("本地资料库尚未初始化或需要升级，请在资料连接中检查路径并重新扫描本地文件。");
  error.code = "DOMI_LOCAL_REPOSITORY_NOT_READY";
  return error;
}

function syncLocalRepository(source = {}, lockToken = workerData?.lockToken, options = workerData || {}) {
  const reindex = options.reindex === true;
  let repository;
  try {
    repository = new LocalDomiRepository({
      databasePath: source.localDatabasePath,
      libraryDir: source.localLibraryDir,
      readOnly: !reindex
    });
  } catch (error) {
    // SQLITE_CANTOPEN: never bootstrap a new empty database on the read path.
    if (!reindex && Number(error?.errcode) === 14) throw repositoryNotReadyError();
    throw error;
  }
  repository.industryOverviewLockToken = lockToken;
  try {
    testDelay(options.testDelayMs);
    if (!reindex) repository.database.exec("BEGIN");
    let repositoryHealth;
    try { repositoryHealth = repository.health(); }
    catch (error) {
      if (!reindex && /no such table: repository_meta/.test(error?.message || "")) throw repositoryNotReadyError();
      throw error;
    }
    if (!repositoryHealth.ok) throw repositoryNotReadyError();
    let workspaceIndex;
    if (reindex) {
      workspaceIndex = repository.reindexWorkspace();
    } else {
      const cached = repository.database.prepare(
        "SELECT value, updated_at FROM repository_meta WHERE key = 'workspace_index'"
      ).get();
      let metadata = {};
      try { metadata = JSON.parse(cached?.value || "{}"); } catch { /* Index metadata is optional. */ }
      workspaceIndex = {
        ...(metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {}),
        snapshotOnly: true,
        indexedAt: Number(cached?.updated_at) || 0
      };
    }
    const result = {
      repositoryHealth,
      workspaceIndex,
      projects: repository.listProjects(),
      people: repository.listPeople()
    };
    if (!reindex) repository.database.exec("COMMIT");
    return result;
  } finally {
    repository.close();
  }
}

if (parentPort) {
  try {
    parentPort.postMessage({
      ok: true,
      value: syncLocalRepository(workerData?.source)
    });
  } catch (error) {
    parentPort.postMessage({ ok: false, error: serializedError(error) });
  }
}

module.exports = { syncLocalRepository };
