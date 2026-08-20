import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STATE_DIR, ensurePrivateDir, migrateLegacyState } from "./state.js";

const LABEL = "com.codex.wechat-bridge";
const currentFile = fileURLToPath(import.meta.url);
const serviceRoot = path.resolve(path.dirname(currentFile), "..");
const repositoryRoot = path.resolve(serviceRoot, "../..");
const entryPath = path.join(serviceRoot, "src", "index.js");
const launchAgentsDirectory = path.join(os.homedir(), "Library", "LaunchAgents");
const plistPath = path.join(launchAgentsDirectory, `${LABEL}.plist`);
const workspace = path.resolve(
  process.env.CODEX_WECHAT_WORKDIR || path.join(os.homedir(), "Documents", "Codex"),
);

function xml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function environmentEntries(environment) {
  return Object.entries(environment)
    .map(([key, value]) => `      <key>${xml(key)}</key>\n      <string>${xml(value)}</string>`)
    .join("\n");
}

ensurePrivateDir();
const migrated = migrateLegacyState();
fs.mkdirSync(launchAgentsDirectory, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });

const environment = {
  HOME: os.homedir(),
  CODEX_WECHAT_FULL_ACCESS: process.env.CODEX_WECHAT_FULL_ACCESS || "1",
  CODEX_WECHAT_WORKDIR: workspace,
  CODEX_WECHAT_STATE_DIR: STATE_DIR,
};

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>${xml(process.execPath)}</string>
      <string>${xml(entryPath)}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${xml(repositoryRoot)}</string>
    <key>EnvironmentVariables</key>
    <dict>
${environmentEntries(environment)}
    </dict>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>5</integer>
    <key>StandardOutPath</key>
    <string>${xml(path.join(STATE_DIR, "bridge.log"))}</string>
    <key>StandardErrorPath</key>
    <string>${xml(path.join(STATE_DIR, "bridge-error.log"))}</string>
  </dict>
</plist>
`;

const backupPath = `${plistPath}.pre-domi`;
if (fs.existsSync(plistPath) && !fs.existsSync(backupPath)) {
  fs.copyFileSync(plistPath, backupPath);
  fs.chmodSync(backupPath, 0o600);
}
try {
  execFileSync("/bin/launchctl", ["bootout", `gui/${process.getuid()}`, plistPath], { stdio: "ignore" });
} catch {
  // A service that is not currently loaded needs no bootout.
}
fs.writeFileSync(plistPath, plist, { encoding: "utf8", mode: 0o600 });
fs.chmodSync(plistPath, 0o600);
execFileSync("/bin/launchctl", ["bootstrap", `gui/${process.getuid()}`, plistPath], { stdio: "inherit" });
execFileSync("/bin/launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LABEL}`], { stdio: "inherit" });

console.log(`微信桥接后台服务已安装：${plistPath}`);
console.log(`运行状态目录：${STATE_DIR}`);
if (migrated.length) console.log(`已迁移${migrated.length}项原运行状态，无需重新扫码。`);
