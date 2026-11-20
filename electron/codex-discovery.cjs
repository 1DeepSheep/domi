const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const exec = promisify(require("node:child_process").execFile);
const semver = require("semver");

function stamp(file) {
  try {
    const stat = fs.statSync(file);
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs].join(":");
  } catch { return ""; }
}

const applicationRoots = ["/Applications", path.join(os.homedir(), "Applications")];
function isDesktopRuntimePath(file) {
  return applicationRoots.some(root => ["ChatGPT.app", "Codex.app"].some(name =>
    ["codex-cli/bin/codex", "codex"].some(entry => file === path.join(root, name, "Contents", "Resources", entry))));
}

function desktopInstalls(roots = applicationRoots) {
  return roots.flatMap(root => ["ChatGPT.app", "Codex.app"].flatMap(name => {
    const bundle = path.join(root, name);
    const resources = path.join(bundle, "Contents", "Resources");
    return [path.join(resources, "codex-cli", "bin", "codex"), path.join(resources, "codex")].map(binary => ({
      bundle, binary,
      identity: [binary, path.join(path.dirname(binary), "codex-code-mode-host"),
        path.join(resources, "codex-cli", "CodexCLI.app", "Contents", "MacOS", "codex"),
        path.join(bundle, "Contents", "_CodeSignature", "CodeResources")].map(stamp).join("|")
    })).filter(candidate => fs.existsSync(candidate.binary));
  }));
}

async function verifiedVersion(candidate) {
  const { bundle, binary } = candidate;
  const host = path.join(path.dirname(binary), "codex-code-mode-host");
  for (const file of [binary, host]) {
    if (!fs.realpathSync(file).startsWith(fs.realpathSync(bundle) + path.sep)) return "";
    fs.accessSync(file, fs.constants.X_OK);
  }
  await exec("/usr/bin/codesign", ["--verify", "--strict", "-R=anchor apple generic and certificate leaf[subject.OU] = \"2DC432GLL2\"", bundle], { timeout: 25000 });
  return (await exec(binary, ["--version"], { timeout: 5000 })).stdout.trim();
}

function cliVersion(value) {
  return semver.valid(String(value || "").replace(/^codex-cli\s+/, ""));
}

async function newestRuntime(managed, candidates, versionOf = verifiedVersion) {
  let selected = managed;
  for (const candidate of candidates) {
    const version = await versionOf(candidate).catch(() => "");
    const next = cliVersion(version);
    const current = cliVersion(selected.version);
    if (next && (!current || semver.gt(next, current))) {
      selected = { ok: true, source: "desktop", path: candidate.binary, version, identity: candidate.identity };
    }
  }
  return selected;
}

async function visibleModels(client, timeoutMs) {
  const seen = new Set(), models = new Map();
  const deadline = Date.now() + timeoutMs;
  let cursor = null;
  do {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || seen.has(cursor)) throw new Error("Codex 模型列表读取未完成。");
    seen.add(cursor);
    const page = await client.request("model/list", { cursor, limit: 50, includeHidden: false }, { timeoutMs: remaining });
    for (const item of page.data) {
      const id = item.id || item.model;
      if (id && !item.hidden) models.set(id, item);
    }
    cursor = page.nextCursor;
  } while (cursor);
  return { data: [...models.values()] };
}

module.exports = { desktopInstalls, isDesktopRuntimePath, newestRuntime, stamp, visibleModels };
