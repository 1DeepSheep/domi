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

function syncLocalRepository(source = {}) {
  const repository = new LocalDomiRepository({
    databasePath: source.localDatabasePath,
    libraryDir: source.localLibraryDir
  });
  try {
    testDelay(workerData?.testDelayMs);
    const workspaceIndex = repository.reindexWorkspace();
    return {
      repositoryHealth: repository.health(),
      workspaceIndex,
      projects: repository.listProjects(),
      people: repository.listPeople()
    };
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
