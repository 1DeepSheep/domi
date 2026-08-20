import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const STATE_DIR = path.resolve(
  process.env.CODEX_WECHAT_STATE_DIR
    || path.join(os.homedir(), "Library", "Application Support", "domi", "wechat-bridge"),
);
export const CREDENTIALS_PATH = path.join(STATE_DIR, "credentials.json");
export const SESSIONS_PATH = path.join(STATE_DIR, "sessions.json");
export const PREFERENCES_PATH = path.join(STATE_DIR, "preferences.json");
export const SYNC_PATH = path.join(STATE_DIR, "sync.json");
export const TASKS_PATH = path.join(STATE_DIR, "tasks.json");
export const SEEN_PATH = path.join(STATE_DIR, "seen.json");
export const METRICS_PATH = path.join(STATE_DIR, "usage-events.jsonl");
export const INBOUND_DIR = path.join(STATE_DIR, "inbound");

const MIGRATABLE_FILES = [
  "credentials.json",
  "sessions.json",
  "preferences.json",
  "sync.json",
  "tasks.json",
  "seen.json",
];

export function ensurePrivateDir(directoryPath = STATE_DIR) {
  fs.mkdirSync(directoryPath, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(directoryPath, 0o700);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
}

export function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJsonPrivate(filePath, value) {
  ensurePrivateDir(path.dirname(filePath));
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  fs.renameSync(temporaryPath, filePath);
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
}

export function appendJsonLinePrivate(filePath, value) {
  ensurePrivateDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // Best effort on filesystems without POSIX permissions.
  }
}

export function migrateLegacyState() {
  const legacy = process.env.CODEX_WECHAT_LEGACY_STATE_DIR?.trim();
  if (!legacy) return [];
  const legacyRoot = path.resolve(legacy);
  if (legacyRoot === STATE_DIR || !fs.existsSync(legacyRoot)) return [];

  ensurePrivateDir();
  const migrated = [];
  for (const name of MIGRATABLE_FILES) {
    const source = path.join(legacyRoot, name);
    const target = path.join(STATE_DIR, name);
    if (!fs.existsSync(source) || fs.existsSync(target)) continue;
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    try {
      fs.chmodSync(target, 0o600);
    } catch {
      // Best effort on filesystems without POSIX permissions.
    }
    migrated.push(name);
  }
  return migrated;
}

export function pruneDirectory(directoryPath, olderThanMs) {
  if (!fs.existsSync(directoryPath)) return;
  const cutoff = Date.now() - olderThanMs;
  for (const entry of fs.readdirSync(directoryPath, { withFileTypes: true })) {
    const target = path.join(directoryPath, entry.name);
    try {
      const stat = fs.statSync(target);
      if (stat.mtimeMs >= cutoff) continue;
      fs.rmSync(target, { recursive: entry.isDirectory(), force: true });
    } catch {
      // Cleanup is best effort and never blocks message handling.
    }
  }
}
