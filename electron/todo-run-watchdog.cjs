"use strict";

const TODO_RUN_DEADLINE_MS = 9 * 60 * 1000;
const TODO_STOP_RETRY_MS = 60 * 1000;

function isTodoSyncRun(runId, payload) {
  return typeof runId === "string" && runId.startsWith("todo-sync-")
    && payload?.workflowId === "task"
    && payload?.background === true
    && payload?.ephemeral === true;
}

/** Main-process deadline; renderer reloads cannot extend a background run. */
class TodoRunWatchdog {
  constructor({ isRunning, stop, onDeadline = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
    this.isRunning = isRunning;
    this.stop = stop;
    this.onDeadline = onDeadline;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.entries = new Map();
  }

  arm(runId, payload) {
    if (!isTodoSyncRun(runId, payload) || this.entries.has(runId)) return false;
    const entry = { timer: null, reported: false };
    this.entries.set(runId, entry);
    this.schedule(runId, entry, TODO_RUN_DEADLINE_MS);
    return true;
  }

  schedule(runId, entry, delay) {
    entry.timer = this.setTimer(() => { void this.check(runId, entry); }, delay);
    entry.timer?.unref?.();
  }

  async check(runId, entry) {
    if (this.entries.get(runId) !== entry) return;
    entry.timer = null;
    if (!this.isRunning(runId)) {
      this.clear(runId);
      return;
    }
    if (!entry.reported) {
      entry.reported = true;
      try { this.onDeadline(runId); } catch { /* Diagnostics cannot disable stopping. */ }
    }
    try {
      await this.stop(runId);
    } catch {
      // RPC failure is not evidence that the remote model has stopped.
    }
    if (this.entries.get(runId) !== entry) return;
    if (this.isRunning(runId)) this.schedule(runId, entry, TODO_STOP_RETRY_MS);
    else this.clear(runId);
  }

  clear(runId) {
    const entry = this.entries.get(runId);
    if (!entry) return;
    if (entry.timer !== null) this.clearTimer(entry.timer);
    this.entries.delete(runId);
  }
}

module.exports = { TodoRunWatchdog, isTodoSyncRun, TODO_RUN_DEADLINE_MS, TODO_STOP_RETRY_MS };
