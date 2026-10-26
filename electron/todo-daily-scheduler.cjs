"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash, randomUUID } = require("node:crypto");

const DAILY_HOUR = 9;
const DAILY_ATTEMPTS = 3;
const LEASE_MS = 12 * 60 * 1000;
const RETRY_DELAYS_MS = [5 * 60 * 1000, 30 * 60 * 1000];
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const KEY_PATTERN = /^[a-f0-9]{64}$/;

function localDay(now) {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function scheduledAt(now, offset = 0) {
  const date = new Date(now);
  date.setDate(date.getDate() + offset);
  date.setHours(DAILY_HOUR, 0, 0, 0);
  return date.getTime();
}

function repositoryKey(identity) {
  if (typeof identity !== "string" || !identity.trim() || identity.length > 4096) {
    throw new Error("待办自动更新缺少有效的资料库标识。");
  }
  return createHash("sha256").update(identity).digest("hex");
}

function blankEntry() {
  return { successDays: {}, attemptDay: "", attempts: 0, retryAt: 0, lastAttemptAt: 0, lastSuccessAt: 0 };
}

function normalizeEntry(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid entry");
  const entry = blankEntry();
  if (!value.successDays || typeof value.successDays !== "object" || Array.isArray(value.successDays)) throw new Error("invalid success days");
  for (const [day, stamp] of Object.entries(value.successDays)) {
    if (!DAY_PATTERN.test(day) || !Number.isFinite(stamp) || stamp <= 0) throw new Error("invalid success date");
    entry.successDays[day] = stamp;
  }
  if (value.attemptDay !== "" && !DAY_PATTERN.test(value.attemptDay)) throw new Error("invalid attempt day");
  entry.attemptDay = value.attemptDay;
  if (!Number.isInteger(value.attempts) || value.attempts < 0 || value.attempts > DAILY_ATTEMPTS) throw new Error("invalid attempts");
  entry.attempts = value.attempts;
  for (const field of ["retryAt", "lastAttemptAt", "lastSuccessAt"]) {
    if (!Number.isFinite(value[field]) || value[field] < 0) throw new Error(`invalid ${field}`);
    entry[field] = value[field];
  }
  return entry;
}

/**
 * One instance is owned by Electron's single main process. The persisted lease
 * also survives renderer reloads and application restarts. It coordinates work;
 * it never reads, changes or executes a user's tasks itself.
 */
class TodoDailyScheduler {
  constructor({ filePath, now = Date.now }) {
    this.filePath = path.resolve(filePath);
    this.now = now;
  }

  read() {
    let raw;
    try {
      raw = fs.readFileSync(this.filePath, "utf8");
    } catch (error) {
      if (error.code === "ENOENT") return { version: 1, repositories: {}, lease: null };
      throw error;
    }
    try {
      const parsed = JSON.parse(raw);
      if (parsed.version !== 1 || !parsed.repositories || typeof parsed.repositories !== "object" || Array.isArray(parsed.repositories)) {
        throw new Error("invalid schedule");
      }
      const state = { version: 1, repositories: {}, lease: null };
      for (const [key, entry] of Object.entries(parsed.repositories)) {
        if (!KEY_PATTERN.test(key)) throw new Error("invalid repository key");
        state.repositories[key] = normalizeEntry(entry);
      }
      if (parsed.lease !== null) {
        const lease = parsed.lease;
        if (!lease || typeof lease.token !== "string" || !lease.token || lease.token.length > 100
          || !KEY_PATTERN.test(lease.repositoryKey || "") || !state.repositories[lease.repositoryKey]
          || !DAY_PATTERN.test(lease.day || "") || !["daily", "manual"].includes(lease.trigger)
          || !Number.isFinite(lease.startedAt) || lease.startedAt <= 0
          || lease.expiresAt !== lease.startedAt + LEASE_MS) throw new Error("invalid lease");
        state.lease = {
          token: lease.token, repositoryKey: lease.repositoryKey, day: lease.day,
          trigger: lease.trigger, startedAt: lease.startedAt, expiresAt: lease.expiresAt
        };
      }
      return state;
    } catch {
      // A damaged checkpoint must not silently erase success or duplicate a run.
      throw new Error("待办自动更新记录暂时无法读取，已保留现有记录。");
    }
  }

  write(state) {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    let descriptor;
    try {
      descriptor = fs.openSync(temporary, "wx", 0o600);
      fs.writeFileSync(descriptor, `${JSON.stringify(state)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      fs.renameSync(temporary, this.filePath);
    } finally {
      if (descriptor !== undefined) fs.closeSync(descriptor);
      fs.rmSync(temporary, { force: true });
    }
  }

  clock() {
    const now = this.now();
    if (!Number.isFinite(now) || now <= 0) throw new Error("待办自动更新时间无效。");
    return now;
  }

  expireLease(state, now) {
    if (!state.lease || state.lease.expiresAt > now) return false;
    const lease = state.lease;
    const entry = state.repositories[lease.repositoryKey];
    // Calculate from expiry, so reopening long after a crash catches up at once.
    if (entry.attemptDay === lease.day) {
      entry.retryAt = lease.expiresAt + RETRY_DELAYS_MS[Math.min(Math.max(entry.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
    }
    state.lease = null;
    return true;
  }

  snapshot(state, key, now) {
    const day = localDay(now);
    const entry = state.repositories[key] || blankEntry();
    const attempts = entry.attemptDay === day ? entry.attempts : 0;
    const retryAt = entry.attemptDay === day ? entry.retryAt : 0;
    const completed = Boolean(entry.successDays[day]);
    const running = Boolean(state.lease);
    let status = "due";
    let nextRunAt = Math.max(scheduledAt(now), retryAt);
    if (running) {
      status = "running";
      nextRunAt = state.lease.expiresAt;
    } else if (completed) {
      status = "completed";
      nextRunAt = scheduledAt(now, 1);
    } else if (attempts >= DAILY_ATTEMPTS) {
      status = "exhausted";
      nextRunAt = scheduledAt(now, 1);
    } else if (now < scheduledAt(now)) {
      status = "scheduled";
    } else if (now < retryAt) {
      status = "retrying";
    }
    return {
      ok: true, state: status, due: status === "due", localDay: day,
      scheduledAt: scheduledAt(now), nextRunAt, lastSuccessAt: entry.lastSuccessAt || null,
      lastAttemptAt: entry.lastAttemptAt || null, attempts, running,
      runningForRepository: running && state.lease.repositoryKey === key,
      leaseExpiresAt: state.lease?.expiresAt || null
    };
  }

  status({ repositoryIdentity }) {
    const key = repositoryKey(repositoryIdentity);
    const now = this.clock();
    const state = this.read();
    if (this.expireLease(state, now)) this.write(state);
    return this.snapshot(state, key, now);
  }

  claim({ repositoryIdentity, trigger = "daily" }) {
    if (!["daily", "manual"].includes(trigger)) throw new Error("无效的待办更新触发方式。");
    const key = repositoryKey(repositoryIdentity);
    const now = this.clock();
    const state = this.read();
    const expired = this.expireLease(state, now);
    const status = this.snapshot(state, key, now);
    if (status.running || (trigger === "daily" && !status.due)) {
      if (expired) this.write(state);
      return { ...status, claimed: false, token: null, reason: status.state };
    }
    const entry = state.repositories[key] ||= blankEntry();
    if (entry.attemptDay !== status.localDay) {
      entry.attemptDay = status.localDay;
      entry.attempts = 0;
      entry.retryAt = 0;
    }
    if (trigger === "daily") entry.attempts += 1;
    entry.lastAttemptAt = now;
    const token = randomUUID();
    state.lease = {
      token, repositoryKey: key, day: status.localDay, trigger,
      startedAt: now, expiresAt: now + LEASE_MS
    };
    this.write(state);
    return { ...this.snapshot(state, key, now), claimed: true, token, reason: null };
  }

  finish({ repositoryIdentity, token, success }) {
    if (typeof success !== "boolean") throw new Error("待办更新结果必须经过验证。");
    const key = repositoryKey(repositoryIdentity);
    const now = this.clock();
    const state = this.read();
    const expired = this.expireLease(state, now);
    if (!state.lease || state.lease.repositoryKey !== key || state.lease.token !== token) {
      if (expired) this.write(state);
      return { ...this.snapshot(state, key, now), accepted: false };
    }
    const lease = state.lease;
    const entry = state.repositories[key];
    if (success) {
      // A run crossing midnight evaluated yesterday's inputs, not today's.
      entry.successDays[lease.day] = now;
      entry.lastSuccessAt = Math.max(entry.lastSuccessAt, now);
      entry.retryAt = 0;
      const days = Object.keys(entry.successDays).sort().reverse();
      for (const old of days.slice(32)) delete entry.successDays[old];
    } else if (entry.attemptDay === lease.day) {
      entry.retryAt = now + RETRY_DELAYS_MS[Math.min(Math.max(entry.attempts - 1, 0), RETRY_DELAYS_MS.length - 1)];
    }
    state.lease = null;
    this.write(state);
    return { ...this.snapshot(state, key, now), accepted: true };
  }
}

module.exports = { TodoDailyScheduler, DAILY_HOUR, DAILY_ATTEMPTS, LEASE_MS, RETRY_DELAYS_MS };
