const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const outputRoot = path.join(root, "build", "domi-plugin");
const lockPath = path.join(root, "build", "domi-plugin-lock.json");
const releaseMode = process.argv.includes("--release");
const repository = process.env.DOMI_PLUGIN_REPOSITORY
  || "https://github.com/1DeepSheep/domi-plugin.git";

function run(binary, args, options = {}) {
  const output = execFileSync(binary, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio || ["ignore", "pipe", "pipe"],
    env: process.env
  });
  return typeof output === "string" ? output.trim() : "";
}

function fail(message) {
  console.error(`Domi plugin preparation failed: ${message}`);
  process.exit(1);
}

function resolveSource() {
  const provided = String(process.env.DOMI_PLUGIN_SOURCE || "").trim();
  if (provided) return { root: path.resolve(provided), temporaryRoot: "" };

  if (!releaseMode) {
    return {
      root: path.join(os.homedir(), "plugins", "domi"),
      temporaryRoot: ""
    };
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-release-"));
  const checkoutRoot = path.join(temporaryRoot, "domi");
  const githubSlug = repository.match(/github\.com[/:]([^/]+\/[^/]+?)(?:\.git)?$/)?.[1]
    || (/^[^/]+\/[^/]+$/.test(repository) ? repository : "");
  try {
    if (githubSlug) {
      run("gh", ["repo", "clone", githubSlug, checkoutRoot, "--", "--depth", "1", "--branch", "main"], {
        stdio: "inherit"
      });
    } else {
      run("git", ["clone", "--depth", "1", "--branch", "main", repository, checkoutRoot], {
        stdio: "inherit"
      });
    }
  } catch {
    fail("无法从 GitHub 拉取 Domi 插件 main。请检查仓库权限和网络连接。");
  }
  return { root: checkoutRoot, temporaryRoot };
}

function validateSource(sourceRoot) {
  const manifestPath = path.join(sourceRoot, ".codex-plugin", "plugin.json");
  if (!fs.existsSync(manifestPath)) fail(`缺少插件清单：${manifestPath}`);

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    fail(`plugin.json 无法解析：${error.message}`);
  }
  if (manifest.name !== "domi") fail(`插件名称必须是 domi，当前为 ${manifest.name || "空"}`);
  if (!String(manifest.version || "").trim()) fail("plugin.json 缺少 version");
  if (!fs.existsSync(path.join(sourceRoot, "skills", "domi-router", "SKILL.md"))) {
    fail("缺少 domi-router Skill");
  }

  let commit = "local-uncommitted";
  try {
    commit = run("git", ["rev-parse", "HEAD"], { cwd: sourceRoot });
    if (releaseMode) {
      const dirty = run("git", ["status", "--porcelain"], { cwd: sourceRoot });
      if (dirty) fail("正式发布使用的 Domi 插件工作区不是干净状态");
      if (process.env.DOMI_PLUGIN_SOURCE) {
        run("git", ["fetch", "origin", "main", "--quiet"], { cwd: sourceRoot });
        const remoteCommit = run("git", ["rev-parse", "origin/main"], { cwd: sourceRoot });
        if (commit !== remoteCommit) {
          fail(`Domi 插件不是 GitHub main 最新提交（本地 ${commit.slice(0, 8)}，远端 ${remoteCommit.slice(0, 8)}）`);
        }
      }
    }
  } catch (error) {
    if (releaseMode) fail(error.message || "无法验证 Domi 插件 Git 状态");
  }

  return { manifest, commit };
}

function validatePublicReleaseContent(sourceRoot) {
  const checkerPath = path.join(sourceRoot, "scripts", "public-release-check.cjs");
  if (!fs.existsSync(checkerPath)) {
    if (releaseMode) fail("Domi 插件缺少 scripts/public-release-check.cjs");
    return;
  }
  try {
    run(process.execPath, [checkerPath], { cwd: sourceRoot, stdio: "inherit" });
  } catch {
    fail("Domi 插件公共发布身份检查未通过");
  }
}

function pluginFiles(sourceRoot) {
  try {
    const args = releaseMode
      ? ["ls-files", "-z"]
      : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
    return run("git", args, { cwd: sourceRoot })
      .split("\0")
      .filter(Boolean);
  } catch {
    fail("Domi 插件源码必须是 Git 仓库");
  }
}

function safePluginFile(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  if (!normalized || normalized.startsWith("../") || path.isAbsolute(relativePath)) return false;
  if (normalized === ".gitignore") return true;
  return normalized.startsWith(".codex-plugin/")
    || normalized.startsWith("assets/")
    || normalized.startsWith("scripts/")
    || normalized.startsWith("skills/");
}

function copyPlugin(sourceRoot, files) {
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(outputRoot, { recursive: true });
  const hash = crypto.createHash("sha256");

  for (const relativePath of files.filter(safePluginFile).sort()) {
    const sourcePath = path.join(sourceRoot, relativePath);
    if (!fs.statSync(sourcePath).isFile()) continue;
    const content = fs.readFileSync(sourcePath);
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, content);
    hash.update(relativePath);
    hash.update("\0");
    hash.update(content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

const source = resolveSource();
try {
  if (!fs.existsSync(source.root)) fail(`没有找到 Domi 插件源码：${source.root}`);
  const { manifest, commit } = validateSource(source.root);
  validatePublicReleaseContent(source.root);
  const files = pluginFiles(source.root);
  const sha256 = copyPlugin(source.root, files);
  const lock = {
    schemaVersion: 1,
    pluginName: manifest.name,
    pluginVersion: manifest.version,
    gitCommit: commit,
    gitRef: releaseMode ? "refs/heads/main" : "local-worktree",
    repository,
    sha256,
    preparedAt: new Date().toISOString()
  };
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
  console.log(`Prepared Domi plugin ${lock.pluginVersion} (${lock.gitCommit.slice(0, 8)})`);
} finally {
  if (source.temporaryRoot) fs.rmSync(source.temporaryRoot, { recursive: true, force: true });
}
