const path = require("node:path");
const { Worker } = require("node:worker_threads");

class DocumentSearchService {
  constructor(options) {
    this.databasePath = options.databasePath;
    this.workerPath = options.workerPath || path.join(__dirname, "document-search-worker.cjs");
    this.worker = null;
    this.sequence = 0;
    this.pending = new Map();
  }

  ensureWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerPath, {
      workerData: { databasePath: this.databasePath }
    });
    worker.on("message", (message) => {
      if (message?.type !== "response") return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timeout);
      pending.resolve(message.result);
    });
    const fail = (error) => {
      if (this.worker === worker) this.worker = null;
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timeout);
        pending.resolve({ ok: false, results: [], error: error.message || String(error) });
      }
      this.pending.clear();
    };
    worker.on("error", fail);
    worker.on("exit", (code) => {
      if (code !== 0) fail(new Error(`文档搜索后台服务异常退出（${code}）。`));
      else if (this.worker === worker) this.worker = null;
    });
    this.worker = worker;
    return worker;
  }

  scheduleIndex(rootPath, force = false) {
    if (!rootPath) return;
    this.ensureWorker().postMessage({ type: "index", rootPath, force });
  }

  updateFile(rootPath, filePath) {
    if (!rootPath || !filePath) return;
    this.ensureWorker().postMessage({ type: "index-file", rootPath, filePath });
  }

  search(rootPath, request) {
    if (!rootPath || !String(request?.query || "").trim()) {
      return Promise.resolve({ ok: true, results: [], indexing: false, indexedCount: 0, lastIndexedAt: 0 });
    }
    const id = ++this.sequence;
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, results: [], error: "文档搜索暂时繁忙，请稍后重试。" });
      }, 3_000);
      this.pending.set(id, { resolve, timeout });
      this.ensureWorker().postMessage({ type: "search", id, rootPath, request });
    });
  }

  async close() {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    await worker.terminate();
  }
}

module.exports = { DocumentSearchService };
