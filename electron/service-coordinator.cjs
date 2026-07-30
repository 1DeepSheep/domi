class ServiceCoordinator {
  constructor({ now = () => Date.now(), sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    this.now = now;
    this.sleep = sleep;
    this.entries = new Map();
  }

  entry(key) {
    if (!this.entries.has(key)) {
      this.entries.set(key, {
        value: undefined,
        expiresAt: 0,
        inFlight: null,
        failures: 0,
        circuitUntil: 0,
        lastError: ""
      });
    }
    return this.entries.get(key);
  }

  staleValue(value, error) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return value;
    return {
      ...value,
      stale: true,
      coordinatorError: error instanceof Error ? error.message : String(error || "服务暂时不可用")
    };
  }

  async run(key, operation, options = {}) {
    const entry = this.entry(String(key));
    const now = this.now();
    const ttlMs = Math.max(0, Number(options.ttlMs) || 0);
    const retries = Math.max(0, Number(options.retries) || 0);
    const retryDelayMs = Math.max(20, Number(options.retryDelayMs) || 250);
    const failureThreshold = Math.max(1, Number(options.failureThreshold) || 3);
    const circuitCooldownMs = Math.max(1000, Number(options.circuitCooldownMs) || 30_000);
    const allowStale = options.allowStale !== false;

    if (!options.force && entry.value !== undefined && entry.expiresAt > now) {
      return entry.value;
    }
    if (entry.inFlight) return entry.inFlight;
    if (entry.circuitUntil > now) {
      const error = new Error(`服务熔断中，请在 ${Math.ceil((entry.circuitUntil - now) / 1000)} 秒后重试。`);
      if (allowStale && entry.value !== undefined) return this.staleValue(entry.value, error);
      throw error;
    }

    entry.inFlight = (async () => {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          const value = await operation();
          if (options.isSuccess && !options.isSuccess(value)) {
            throw new Error(value?.error || "服务返回失败结果。");
          }
          const valueTtlMs = typeof options.ttlForValue === "function"
            ? Math.max(0, Number(options.ttlForValue(value)) || 0)
            : ttlMs;
          entry.value = value;
          entry.expiresAt = this.now() + valueTtlMs;
          entry.failures = 0;
          entry.circuitUntil = 0;
          entry.lastError = "";
          return value;
        } catch (error) {
          lastError = error;
          if (attempt < retries) {
            await this.sleep(retryDelayMs * (2 ** attempt));
          }
        }
      }

      entry.failures += 1;
      entry.lastError = lastError instanceof Error ? lastError.message : String(lastError || "未知错误");
      if (entry.failures >= failureThreshold) {
        entry.circuitUntil = this.now() + circuitCooldownMs;
      }
      if (allowStale && entry.value !== undefined) return this.staleValue(entry.value, lastError);
      throw lastError;
    })().finally(() => {
      entry.inFlight = null;
    });

    return entry.inFlight;
  }

  invalidate(prefix) {
    const normalizedPrefix = String(prefix || "");
    for (const [key, entry] of this.entries) {
      if (!normalizedPrefix || key.startsWith(normalizedPrefix)) {
        entry.expiresAt = 0;
        entry.circuitUntil = 0;
      }
    }
  }

  snapshot() {
    const now = this.now();
    return [...this.entries.entries()].map(([key, entry]) => ({
      key,
      cached: entry.value !== undefined,
      fresh: entry.expiresAt > now,
      inFlight: Boolean(entry.inFlight),
      failures: entry.failures,
      circuitOpen: entry.circuitUntil > now,
      lastError: entry.lastError
    }));
  }
}

class TaskQueue {
  constructor(maxConcurrency = 1) {
    this.maxConcurrency = Math.max(1, Number(maxConcurrency) || 1);
    this.activeCount = 0;
    this.pending = [];
  }

  run(operation) {
    return new Promise((resolve, reject) => {
      this.pending.push({ operation, resolve, reject });
      this.drain();
    });
  }

  drain() {
    while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
      const task = this.pending.shift();
      this.activeCount += 1;
      Promise.resolve()
        .then(task.operation)
        .then(task.resolve, task.reject)
        .finally(() => {
          this.activeCount -= 1;
          this.drain();
        });
    }
  }

  snapshot() {
    return { activeCount: this.activeCount, pendingCount: this.pending.length };
  }
}

module.exports = { ServiceCoordinator, TaskQueue };
