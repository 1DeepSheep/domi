const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const asar = require("@electron/asar");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const artifactIndex = args.indexOf("--artifact");
const artifactPath = artifactIndex >= 0 ? path.resolve(args[artifactIndex + 1] || "") : "";
const historyRequested = args.includes("--history");
const failures = [];
const seenFailures = new Set();
const localIdentityTermsPath = path.join(root, ".privacy-terms.local");

const forbiddenExtensions = new Set([
  ".cer", ".crt", ".db", ".key", ".log", ".m4a", ".mobileprovision",
  ".mp3", ".mp4", ".p12", ".p8", ".pem", ".provisionprofile",
  ".sqlite", ".sqlite3", ".wav"
]);
const forbiddenRuntimeNames = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.privacy-terms\.local$/i,
  /^domi-plugin-config\.json$/i,
  /^domi\.sqlite3?(?:-.+)?$/i,
  /^(?:threads?|sessions?|history|runtime-state)\.json$/i,
  /^(?:plaud|lark|feishu).*(?:session|cookie|token|credential)/i
];
const allowedEmailDomains = new Set([
  "example.com",
  "example.org",
  "example.net",
  "users.noreply.github.com"
]);

function loadPrivateIdentityTerms() {
  const configured = [
    process.env.DOMI_PRIVATE_IDENTITY_TERMS || "",
    fs.existsSync(localIdentityTermsPath)
      ? fs.readFileSync(localIdentityTermsPath, "utf8")
      : ""
  ].join("\n");
  return [...new Set(configured
    .split(/\r?\n|,/)
    .map((term) => term.trim().toLocaleLowerCase("en-US"))
    .filter((term) => term.length >= 2))];
}

const privateIdentityTerms = loadPrivateIdentityTerms();

function fail(category, displayPath) {
  const message = `${category}：${displayPath}`;
  if (seenFailures.has(message)) return;
  seenFailures.add(message);
  failures.push(message);
}

function displayPath(filePath, scanRoot) {
  return path.relative(scanRoot, filePath) || path.basename(filePath);
}

function isPrivacyChecker(filePath) {
  return new Set(["privacy-check.cjs", "public-release-check.cjs"])
    .has(path.basename(filePath));
}

function inspectContent(content, filePath, scanRoot, options = {}) {
  const relative = displayPath(filePath, scanRoot);
  const normalizedContent = content.toLocaleLowerCase("en-US");
  if (privateIdentityTerms.some((term) => normalizedContent.includes(term))) {
    fail("发现本机配置的禁止公开身份标识", relative);
  }
  if (options.identityOnly) return;
  const secretPatterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
    /\bAKIA[0-9A-Z]{16}\b/,
    /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}\b/i,
    /\b(?:client_secret|access_token|refresh_token|api_key|authorization|cookie)\b\s*[:=]\s*["'][^"']{12,}["']/i
  ];
  if (secretPatterns.some((pattern) => pattern.test(content))) {
    fail("疑似硬编码密钥或登录凭据", relative);
  }

  if (!/(?:^|[/:])(?:package-lock|npm-shrinkwrap)\.json$/i.test(relative)) {
    const emails = content.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z][A-Za-z0-9.-]*\.[A-Za-z]{2,}\b/g) || [];
    for (const email of emails) {
      const domain = email.split("@").pop().toLowerCase();
      if (!allowedEmailDomains.has(domain)) fail("发现非示例或 noreply 邮箱", relative);
    }
  }

  if (/\/Users\/(?!Shared(?:\/|\b))[^/\s"'<>]+\//.test(content)) {
    fail("发现 macOS 用户绝对路径", relative);
  }
  if (/OneDrive-[^/\s"'<>]+/.test(content)) {
    fail("发现 OneDrive 租户或账户路径", relative);
  }
  if (/https?:\/\/[A-Za-z0-9-]+\.(?:feishu\.cn|larksuite\.com)(?:\/|\b)/i.test(content)) {
    fail("发现飞书租户域名", relative);
  }
  if (/\bou_[A-Za-z0-9_-]{20,}\b/.test(content)) {
    fail("发现飞书用户标识", relative);
  }
  if (/\b(?:bascn|wikcn|doccn|shtcn)[A-Za-z0-9_-]{10,}\b/.test(content)) {
    fail("发现飞书文档或数据资源标识", relative);
  }

  const feishuAssignment = /(?:app[_ -]?token|base[_ -]?token|table[_ -]?id|field[_ -]?id|wiki[_ -]?(?:space|node)?[_ -]?(?:id|token)|space[_ -]?id|parent[_ -]?node[_ -]?token)["'`\s]*[：:=]["'`\s]*([A-Za-z0-9_-]{8,})/gi;
  for (const match of content.matchAll(feishuAssignment)) {
    if (!/^(?:example|placeholder|configured|employee|user|node_token|field_id|table_id)$/i.test(match[1])) {
      fail("发现硬编码飞书标识", relative);
      break;
    }
  }
}

function shouldSkipDirectory(name) {
  return new Set([".git", "node_modules", "demo-workspace", "release"]).has(name);
}

function scanTree(scanRoot, options = {}) {
  if (!scanRoot || !fs.existsSync(scanRoot)) return;
  const stack = [scanRoot];
  while (stack.length) {
    const current = stack.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!shouldSkipDirectory(entry.name)) stack.push(target);
        continue;
      }
      const relative = displayPath(target, scanRoot);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        fail("禁止发布符号链接", relative);
        continue;
      }
      const extension = path.extname(entry.name).toLowerCase();
      if (forbiddenExtensions.has(extension) || forbiddenRuntimeNames.some((pattern) => pattern.test(entry.name))) {
        fail("禁止发布运行数据或敏感文件", relative);
        continue;
      }
      if (stat.size > (options.maxTextSize || 4 * 1024 * 1024)) continue;
      inspectContent(
        fs.readFileSync(target).toString("utf8"),
        target,
        scanRoot,
        { identityOnly: isPrivacyChecker(target) }
      );
    }
  }
}

function gitReleaseCandidates() {
  try {
    return execFileSync(
      "git",
      ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"],
      { encoding: "utf8" }
    ).split("\0").filter(Boolean);
  } catch {
    return null;
  }
}

function scanSource() {
  const candidates = gitReleaseCandidates();
  if (candidates) {
    for (const relativePath of candidates) {
      const target = path.join(root, relativePath);
      if (!fs.existsSync(target)) continue;
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) {
        fail("禁止发布符号链接", relativePath);
        continue;
      }
      if (!stat.isFile()) continue;
      const extension = path.extname(relativePath).toLowerCase();
      if (forbiddenExtensions.has(extension) || forbiddenRuntimeNames.some((pattern) => pattern.test(path.basename(relativePath)))) {
        fail("禁止发布运行数据或敏感文件", relativePath);
        continue;
      }
      if (stat.size > 4 * 1024 * 1024) continue;
      inspectContent(
        fs.readFileSync(target).toString("utf8"),
        target,
        root,
        { identityOnly: isPrivacyChecker(target) }
      );
    }
  } else {
    for (const relativePath of ["electron", "src", "public", "scripts", "docs"]) {
      scanTree(path.join(root, relativePath));
    }
  }
  // build/ is ignored by Git, but its plugin snapshot and lock file are packaged.
  if (fs.existsSync(path.join(root, "build"))) {
    scanTree(path.join(root, "build"));
  }
  for (const relativePath of ["package.json", "README.md"]) {
    const target = path.join(root, relativePath);
    if (fs.existsSync(target) && !candidates) inspectContent(fs.readFileSync(target, "utf8"), target, root);
  }
}

function scanHistory() {
  const commits = execFileSync("git", ["-C", root, "rev-list", "--all"], { encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
  for (const commit of commits) {
    const files = execFileSync(
      "git",
      ["-C", root, "ls-tree", "-r", "--name-only", "-z", commit],
      { encoding: "utf8" }
    ).split("\0").filter(Boolean);
    for (const relativePath of files) {
      const extension = path.extname(relativePath).toLowerCase();
      const name = path.basename(relativePath);
      const historyPath = `${commit.slice(0, 12)}:${relativePath}`;
      if (forbiddenExtensions.has(extension) || forbiddenRuntimeNames.some((pattern) => pattern.test(name))) {
        fail("Git 历史包含运行数据或敏感文件", historyPath);
        continue;
      }
      let blob;
      try {
        blob = execFileSync(
          "git",
          ["-C", root, "show", `${commit}:${relativePath}`],
          { maxBuffer: 8 * 1024 * 1024 }
        );
      } catch {
        continue;
      }
      if (blob.length > 4 * 1024 * 1024) continue;
      inspectContent(
        blob.toString("utf8"),
        path.join(root, historyPath),
        root,
        { identityOnly: isPrivacyChecker(relativePath) }
      );
    }
  }
}

function findApp(mountPoint) {
  const apps = fs.readdirSync(mountPoint, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(".app"))
    .map((entry) => path.join(mountPoint, entry.name));
  if (apps.length !== 1) throw new Error(`DMG 中应只有一个应用，实际找到 ${apps.length} 个。`);
  return apps[0];
}

function scanAppBundle(appPath, temporaryRoot) {
  const resources = path.join(appPath, "Contents", "Resources");
  scanTree(resources);
  const lockPath = path.join(resources, "domi-plugin-lock.json");
  if (fs.existsSync(lockPath)) inspectContent(fs.readFileSync(lockPath, "utf8"), lockPath, resources);

  const asarPath = path.join(resources, "app.asar");
  if (!fs.existsSync(asarPath)) throw new Error("DMG 中缺少 app.asar。");
  const extracted = path.join(temporaryRoot, "app-asar");
  asar.extractAll(asarPath, extracted);
  for (const relativePath of ["electron", "dist", "public"]) scanTree(path.join(extracted, relativePath));
  const packagePath = path.join(extracted, "package.json");
  if (fs.existsSync(packagePath)) inspectContent(fs.readFileSync(packagePath, "utf8"), packagePath, extracted);
}

function scanDmg(dmgPath) {
  if (!dmgPath || !fs.existsSync(dmgPath)) throw new Error(`找不到待扫描 DMG：${dmgPath || "未提供路径"}`);
  if (path.extname(dmgPath).toLowerCase() !== ".dmg") throw new Error("最终发布检查目前只接受 DMG。");
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-privacy-"));
  const mountPoint = path.join(temporaryRoot, "mount");
  fs.mkdirSync(mountPoint);
  let mounted = false;
  try {
    execFileSync("hdiutil", ["attach", "-nobrowse", "-readonly", "-mountpoint", mountPoint, dmgPath], { stdio: "ignore" });
    mounted = true;
    scanAppBundle(findApp(mountPoint), temporaryRoot);
  } finally {
    if (mounted) {
      try {
        execFileSync("hdiutil", ["detach", mountPoint, "-quiet"], { stdio: "ignore" });
      } catch {
        execFileSync("hdiutil", ["detach", mountPoint, "-force", "-quiet"], { stdio: "ignore" });
      }
    }
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

try {
  if (artifactPath) scanDmg(artifactPath);
  else {
    scanSource();
    if (historyRequested) scanHistory();
  }
} catch (error) {
  fail("隐私扫描无法完成", path.basename(artifactPath || root));
  console.error(error instanceof Error ? error.message : String(error));
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log(artifactPath
  ? `DMG privacy check passed: ${path.basename(artifactPath)}`
  : "Privacy check passed: no private identifiers, credentials, or runtime data found in release sources.");
