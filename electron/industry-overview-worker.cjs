const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
const { IndustryOverviewCache } = require("./industry-overview-service.cjs");
const { refreshRepositoryIndustryOverviews } = require("./industry-overview.cjs");
const taxonomy = require("../shared/investment-taxonomy.json");

// Reading the board must not run repository schema migrations or rewrite project
// homepages. Only derived overview pages are maintained by this readonly adapter.
function refresh(source, lockToken) {
  const database = new DatabaseSync(source.localDatabasePath, { readOnly: true });
  try {
    database.exec("PRAGMA busy_timeout = 1000; BEGIN");
    return refreshRepositoryIndustryOverviews({ database, databasePath: source.localDatabasePath,
      libraryDir: source.localLibraryDir, industryOverviewLockToken: lockToken }, taxonomy);
  } finally { database.close(); }
}

try {
  let saved = null;
  const cache = new IndustryOverviewCache({
    stateStore: { loadCache: () => workerData.previous && { value: workerData.previous }, saveCache: (_key, value) => { saved = value; } },
    refresh: source => refresh(source, workerData.lockToken)
  });
  const result = cache.read(workerData.source, { force: workerData.force });
  parentPort.postMessage({ ok: true, result, cache: saved || [...cache.entries.values()][0] || null });
} catch (error) {
  parentPort.postMessage({ ok: false, error: error instanceof Error ? error.message : String(error) });
}
