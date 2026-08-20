const fs = require("node:fs");
const path = require("node:path");
const { parentPort, workerData } = require("node:worker_threads");
const {
  configureRoot,
  openDocumentSearchIndex,
  pathInsideRoot,
  removeStaleDocuments,
  searchIndexedDocuments,
  shouldIndexFile,
  upsertIndexedDocument
} = require("./document-search-index.cjs");

const database = openDocumentSearchIndex(workerData.databasePath);
let activeRoot = "";
let indexing = false;
let indexedCount = 0;
let lastIndexedAt = 0;
let lastError = "";
let rerunRequested = false;
let activeGeneration = "";
const INDEX_FRESHNESS_MS = 5 * 60_000;

function status() {
  return { indexing, indexedCount, lastIndexedAt, error: lastError || undefined };
}

function yieldToMessages() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function* walk(rootPath, scanState, directoryPath = rootPath) {
  let directory;
  try {
    directory = await fs.promises.opendir(directoryPath);
  } catch {
    scanState.complete = false;
    return;
  }
  for await (const entry of directory) {
    if (entry.name.startsWith(".")) continue;
    const candidatePath = path.join(directoryPath, entry.name);
    if (!pathInsideRoot(rootPath, candidatePath) || entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      yield* walk(rootPath, scanState, candidatePath);
    } else if (entry.isFile() && shouldIndexFile(entry.name)) {
      yield candidatePath;
    }
  }
}

async function indexRoot(rootPath) {
  if (indexing) {
    rerunRequested = true;
    return;
  }
  indexing = true;
  lastError = "";
  const generation = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  activeGeneration = generation;
  const scanState = { complete: true };
  let scanned = 0;
  let changed = 0;
  let scanRoot = "";
  try {
    scanRoot = configureRoot(database, rootPath);
    activeRoot = scanRoot;
    for await (const filePath of walk(scanRoot, scanState)) {
      if (activeRoot !== scanRoot) break;
      let stat;
      try {
        stat = await fs.promises.stat(filePath);
      } catch {
        scanState.complete = false;
        continue;
      }
      if (!stat.isFile()) continue;
      try {
        if (upsertIndexedDocument(database, scanRoot, filePath, stat, generation)) changed += 1;
      } catch {
        // A single unreadable/partially-synced OneDrive file must not invalidate the index.
      }
      scanned += 1;
      if (scanned % 20 === 0) {
        indexedCount = scanned;
        parentPort.postMessage({ type: "status", status: status() });
        await yieldToMessages();
      }
    }
    if (activeRoot === scanRoot && scanState.complete) {
      removeStaleDocuments(database, generation);
      indexedCount = scanned;
      lastIndexedAt = Date.now();
    }
    parentPort.postMessage({ type: "indexed", status: status(), changed });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    lastIndexedAt = Date.now();
    parentPort.postMessage({ type: "status", status: status() });
  } finally {
    if (activeGeneration === generation) activeGeneration = "";
    indexing = false;
    parentPort.postMessage({ type: "status", status: status() });
    if (rerunRequested) {
      rerunRequested = false;
      void indexRoot(activeRoot || rootPath);
    }
  }
}

parentPort.on("message", (message) => {
  if (!message || typeof message !== "object") return;
  if (message.type === "index-file") {
    const rootPath = path.resolve(message.rootPath);
    const filePath = path.resolve(message.filePath);
    if (activeRoot !== rootPath) {
      activeRoot = configureRoot(database, rootPath);
      lastIndexedAt = 0;
      indexedCount = 0;
      if (indexing) rerunRequested = true;
    }
    if (activeRoot === rootPath && pathInsideRoot(rootPath, filePath) && shouldIndexFile(filePath)) {
      void fs.promises.stat(filePath).then((stat) => {
        if (!stat.isFile()) return;
        upsertIndexedDocument(
          database,
          rootPath,
          filePath,
          stat,
          activeGeneration || `direct-${Date.now()}`
        );
      }).catch(() => undefined);
    }
    return;
  }
  if (message.type === "index") {
    const rootPath = path.resolve(message.rootPath);
    if (activeRoot !== rootPath) {
      activeRoot = configureRoot(database, rootPath);
      lastIndexedAt = 0;
      indexedCount = 0;
      if (indexing) rerunRequested = true;
    }
    if (indexing && message.force === true) {
      rerunRequested = true;
    } else if (!indexing && (message.force === true || Date.now() - lastIndexedAt >= INDEX_FRESHNESS_MS)) {
      void indexRoot(rootPath);
    }
    return;
  }
  if (message.type !== "search") return;
  try {
    const rootPath = path.resolve(message.rootPath);
    if (activeRoot !== rootPath) {
      activeRoot = configureRoot(database, rootPath);
      lastIndexedAt = 0;
      indexedCount = 0;
      if (indexing) rerunRequested = true;
    }
    if (!indexing && Date.now() - lastIndexedAt >= INDEX_FRESHNESS_MS) {
      void indexRoot(rootPath);
    }
    const results = searchIndexedDocuments(database, message.request);
    parentPort.postMessage({
      type: "response",
      id: message.id,
      result: { ok: !lastError, results, ...status() }
    });
  } catch (error) {
    parentPort.postMessage({
      type: "response",
      id: message.id,
      result: {
        ok: false,
        results: [],
        error: error instanceof Error ? error.message : String(error),
        ...status()
      }
    });
  }
});

process.on("exit", () => {
  try {
    database.close();
  } catch {
    // Best-effort cache close.
  }
});
