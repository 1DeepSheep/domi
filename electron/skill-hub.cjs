const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const yaml = require("js-yaml");

const REGISTRY_VERSION = 1;
const MAX_SCAN_DEPTH = 3;
const MAX_SCAN_DIRECTORIES = 5_000;
const MAX_SCAN_CANDIDATES = 1_000;
const MAX_SKILL_FILES = 2_000;
const MAX_SKILL_DIRECTORIES = 5_000;
const MAX_SKILL_BYTES = 32 * 1024 * 1024;
const MAX_SKILL_METADATA_BYTES = 256 * 1024;

function canonicalPath(filePath) {
  try {
    return fs.realpathSync(filePath);
  } catch {
    return path.resolve(filePath);
  }
}

function pathInside(parent, candidate) {
  const relative = path.relative(canonicalPath(parent), canonicalPath(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function directChildPath(parent, candidate) {
  return path.dirname(canonicalPath(candidate)) === canonicalPath(parent);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function skillFrontmatter(markdown) {
  const match = String(markdown || "").match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("SKILL.md 缺少有效的 YAML frontmatter，请先修复后重新扫描。");
  const metadata = yaml.load(match[1], { schema: yaml.JSON_SCHEMA });
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new Error("SKILL.md frontmatter 必须是包含 name 和 description 的对象。");
  }
  if (typeof metadata.name !== "string"
    || !/^[a-z0-9]+(?:[-_][a-z0-9]+)*$/.test(metadata.name)
    || metadata.name.length > 64) {
    throw new Error("Skill name 必须为 1–64 个小写字母、数字、连字符或下划线，不能自动猜测调用名。");
  }
  if (typeof metadata.description !== "string" || !metadata.description.trim()) {
    throw new Error("Skill description 必须是非空文本，请先修复后重新扫描。");
  }
  return metadata;
}

function skillMetadata(skillPath) {
  const markdownPath = path.join(skillPath, "SKILL.md");
  if (!fs.existsSync(markdownPath)) return null;
  const stat = fs.statSync(markdownPath);
  if (!stat.isFile()) return null;
  if (stat.size > MAX_SKILL_METADATA_BYTES) {
    throw new Error("SKILL.md 超过 256 KB，已跳过。");
  }
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const metadata = skillFrontmatter(markdown);
  return {
    name: metadata.name,
    title: typeof metadata.title === "string" && metadata.title.trim() ? metadata.title.trim() : metadata.name,
    description: metadata.description.trim(),
    metadataFingerprint: crypto.createHash("sha256").update(markdown).digest("hex")
  };
}

function normalizedSkillName(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 64);
  return normalized || "imported-skill";
}

function skillFiles(skillPath) {
  const files = [];
  let totalBytes = 0;
  let directoryCount = 0;
  const pending = [{ directory: skillPath, relativeDirectory: "" }];
  while (pending.length > 0) {
    const { directory, relativeDirectory } = pending.pop();
    directoryCount += 1;
    if (directoryCount > MAX_SKILL_DIRECTORIES) {
      throw new Error("Skill 目录过多，未导入。");
    }
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === ".DS_Store") continue;
      if (entry.isSymbolicLink()) {
        throw new Error(`Skill 中包含不受支持的符号链接：${path.join(relativeDirectory, entry.name)}`);
      }
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.join(relativeDirectory, entry.name);
      if (entry.isDirectory()) {
        pending.push({ directory: absolutePath, relativeDirectory: relativePath });
        continue;
      }
      if (!entry.isFile()) continue;
      const stat = fs.statSync(absolutePath);
      totalBytes += stat.size;
      files.push({ absolutePath, relativePath, size: stat.size });
      if (files.length > MAX_SKILL_FILES || totalBytes > MAX_SKILL_BYTES) {
        throw new Error("Skill 文件过多或体积超过 32 MB，未导入。");
      }
    }
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath, "en"));
}

function skillFingerprint(skillPath) {
  const hash = crypto.createHash("sha256");
  for (const file of skillFiles(skillPath)) {
    hash.update(file.relativePath);
    hash.update("\0");
    hash.update(fs.readFileSync(file.absolutePath));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function candidateId(sourcePath) {
  return crypto.createHash("sha256").update(canonicalPath(sourcePath)).digest("hex").slice(0, 24);
}

function discoverSkillDirectories(root, maximumDepth = MAX_SCAN_DEPTH) {
  if (!root || !fs.existsSync(root)) return [];
  const canonicalRoot = canonicalPath(root);
  const discovered = [];
  const visited = new Set();
  function visit(directory, depth) {
    if (visited.size >= MAX_SCAN_DIRECTORIES || discovered.length >= MAX_SCAN_CANDIDATES) return;
    const canonicalDirectory = canonicalPath(directory);
    if (!pathInside(canonicalRoot, canonicalDirectory) || visited.has(canonicalDirectory)) return;
    visited.add(canonicalDirectory);
    try {
      if (skillMetadata(canonicalDirectory)) {
        discovered.push(canonicalDirectory);
        return;
      }
    } catch {
      // A malformed or unreadable candidate must not abort the whole scan.
      return;
    }
    if (depth >= maximumDepth) return;
    let entries = [];
    try {
      entries = fs.readdirSync(canonicalDirectory, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith(".")) continue;
      visit(path.join(canonicalDirectory, entry.name), depth + 1);
    }
  }
  visit(canonicalRoot, 0);
  return discovered;
}

function copySkillDirectory(sourcePath, destinationPath) {
  const temporaryPath = `${destinationPath}.tmp-${process.pid}-${Date.now()}`;
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
  fs.rmSync(temporaryPath, { recursive: true, force: true });
  fs.mkdirSync(temporaryPath, { recursive: true });
  try {
    for (const file of skillFiles(sourcePath)) {
      const target = path.join(temporaryPath, file.relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(file.absolutePath, target, fs.constants.COPYFILE_EXCL);
    }
    fs.renameSync(temporaryPath, destinationPath);
  } catch (error) {
    fs.rmSync(temporaryPath, { recursive: true, force: true });
    throw error;
  }
}

function rewriteSkillName(skillPath, name) {
  const markdownPath = path.join(skillPath, "SKILL.md");
  const markdown = fs.readFileSync(markdownPath, "utf8");
  const frontmatter = markdown.match(/^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) return;
  const body = frontmatter[1];
  const nextBody = /^name\s*:/im.test(body)
    ? body.replace(/^name\s*:.*$/im, `name: ${name}`)
    : `name: ${name}\n${body}`;
  fs.writeFileSync(markdownPath, markdown.replace(frontmatter[0], `---\n${nextBody}\n---\n`), "utf8");
}

function rewriteSkillSelfReferences(skillPath, previousName, nextName) {
  const promptPath = path.join(skillPath, "agents", "openai.yaml");
  if (!fs.existsSync(promptPath) || !fs.statSync(promptPath).isFile()) return;
  const escaped = previousName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = fs.readFileSync(promptPath, "utf8");
  const updated = source.replace(new RegExp(`\\$${escaped}(?![a-z0-9_-])`, "gi"), `$${nextName}`);
  if (updated !== source) fs.writeFileSync(promptPath, updated, "utf8");
}

function unsafeCopiedSkillReferences(skillPath, previousName, sourcePath, renamed) {
  const escapedName = previousName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const invocationPattern = new RegExp(`\\$${escapedName}(?![a-z0-9_-])`, "i");
  const canonicalSource = canonicalPath(sourcePath);
  const pathPattern = new RegExp(
    `(?:^|[/\\\\])skills[/\\\\]${escapedName}(?:[/\\\\]|$)`,
    "i"
  );
  const unresolved = [];
  for (const file of skillFiles(skillPath)) {
    const buffer = fs.readFileSync(file.absolutePath);
    // Binary resources cannot contain executable prompt/path references that
    // Codex is expected to resolve. Avoid corrupting or heuristically decoding
    // them while still inspecting every ordinary text file.
    if (buffer.includes(0)) continue;
    const source = buffer.toString("utf8");
    if (
      (renamed && invocationPattern.test(source))
      || source.includes(canonicalSource)
      || (renamed && pathPattern.test(source))
    ) {
      unresolved.push(file.relativePath);
    }
  }
  return unresolved;
}

function availableDestinationName(destinationRoot, baseName, reservedNames = new Set()) {
  let candidate = baseName.slice(0, 64);
  let suffix = 2;
  while (reservedNames.has(candidate) || fs.existsSync(path.join(destinationRoot, candidate))) {
    const ending = `-${suffix}`;
    candidate = `${baseName.slice(0, Math.max(1, 64 - ending.length))}${ending}`;
    suffix += 1;
  }
  return candidate;
}

class SkillHubService {
  constructor({
    userDataPath,
    codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
    agentsHome = path.join(os.homedir(), ".agents"),
    officialSkillNames = []
  }) {
    this.userDataPath = userDataPath;
    this.codexHome = codexHome;
    this.destinationRoot = path.join(codexHome, "skills");
    this.sourceRoots = [
      { path: path.join(codexHome, "skills"), label: "Codex 用户 Skill" },
      { path: path.join(agentsHome, "skills"), label: "Agents 用户 Skill" }
    ];
    this.registryPath = path.join(userDataPath, "skill-hub", "user-skills.json");
    this.setOfficialSkillNames(officialSkillNames);
  }

  setOfficialSkillNames(officialSkillNames = []) {
    this.officialSkillNames = new Set(
      officialSkillNames.map((name) => normalizedSkillName(name))
    );
  }

  readRegistry() {
    if (!fs.existsSync(this.registryPath)) return { version: REGISTRY_VERSION, skills: [] };
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(this.registryPath, "utf8"));
    } catch {
      throw new Error("Skill Hub 注册记录暂时无法读取，已停止修改以保护已有 Skill；请恢复 user-skills.json 或其 .backup 备份后重试。Skill 原文件没有被删除。");
    }
    if (!parsed || parsed.version !== REGISTRY_VERSION || !Array.isArray(parsed.skills)) {
      throw new Error("Skill Hub 注册记录格式或版本不兼容，已保留原记录和全部 Skill 文件，请更新软件或恢复备份后重试。");
    }
    return parsed;
  }

  writeRegistry(skills) {
    // Validate before writing: an unreadable/newer registry must never be
    // interpreted as an empty catalog and overwritten by an import or refresh.
    const previous = this.readRegistry();
    if (fs.existsSync(this.registryPath)) {
      writeJsonAtomic(`${this.registryPath}.backup`, previous);
    }
    writeJsonAtomic(this.registryPath, { version: REGISTRY_VERSION, skills });
  }

  listImported() {
    const registry = this.readRegistry();
    // Resolve the live namespace, including local Skills that have not yet
    // been registered in Skill Hub. A bare $name must resolve unambiguously.
    const namespace = new Map();
    for (const target of discoverSkillDirectories(this.destinationRoot, 1)) {
      if (!directChildPath(this.destinationRoot, target)) continue;
      try {
        const metadata = skillMetadata(target);
        if (!metadata) continue;
        const paths = namespace.get(metadata.name) || new Set();
        paths.add(canonicalPath(target));
        namespace.set(metadata.name, paths);
      } catch { /* Invalid Skills cannot contribute an invocable alias. */ }
    }
    const skills = registry.skills.filter((entry) => (
      entry && typeof entry.path === "string" && entry.path.trim()
      && typeof entry.id === "string" && entry.id.startsWith("user-skill:")
    )).map((entry) => {
      const target = canonicalPath(entry.path);
      let next = { ...entry, path: target, available: false, error: "" };
      try {
        if (!directChildPath(this.destinationRoot, target)) {
          throw new Error("Skill 已移出 Codex 用户 Skill 目录，请从 Skill Hub 重新选择导入。");
        }
        const metadata = skillMetadata(target);
        if (!metadata) throw new Error("Skill 文件已不存在，请恢复 SKILL.md 后重新扫描。");
        next = { ...next, ...metadata };
        if ((namespace.get(metadata.name)?.size || 0) !== 1) {
          throw new Error(`本机有多个 $${metadata.name}，为避免运行错误 Skill，请重命名冲突项后重新扫描。`);
        }
        if (registry.skills.some((other) => other !== entry && other?.id === entry.id)) {
          throw new Error("Skill 注册标识存在冲突，请修复注册记录后重新扫描。");
        }
        // Preserve the registered workflow id across a safe rename. Existing
        // queued tasks retain their target path instead of switching to a new
        // unrelated Skill that later adopts the old name.
        next.fingerprint = entry.available && entry.metadataFingerprint === metadata.metadataFingerprint
          ? entry.fingerprint
          : skillFingerprint(target);
        next.available = true;
      } catch (error) {
        next.error = error instanceof Error ? error.message : String(error);
      }
      return next;
    });
    const changed = JSON.stringify(skills) !== JSON.stringify(registry.skills);
    if (changed) this.writeRegistry(skills);
    return { ok: true, skills, changed, updatedAt: Date.now() };
  }

  scan() {
    const listed = this.listImported();
    const imported = listed.skills;
    const importedBySource = new Map();
    for (const entry of imported) {
      if (entry.sourcePath) importedBySource.set(canonicalPath(entry.sourcePath), entry);
      if (entry.path) importedBySource.set(canonicalPath(entry.path), entry);
    }
    const seen = new Set();
    const seenImportedRecords = new Set();
    const reservedNames = new Set(imported.map((entry) => normalizedSkillName(entry.name)));
    const candidates = [];
    for (const root of this.sourceRoots) {
      for (const skillPath of discoverSkillDirectories(root.path)) {
        if (candidates.length >= MAX_SCAN_CANDIDATES) break;
        const sourcePath = canonicalPath(skillPath);
        if (seen.has(sourcePath)) continue;
        seen.add(sourcePath);
        let metadata = null;
        try {
          metadata = skillMetadata(sourcePath);
        } catch {
          continue;
        }
        if (!metadata) continue;
        const safeName = normalizedSkillName(metadata.name);
        const registered = importedBySource.get(sourcePath);
        if (registered && seenImportedRecords.has(registered.id)) continue;
        if (registered) seenImportedRecords.add(registered.id);
        const officialNameConflict = this.officialSkillNames.has(safeName);
        const destinationPath = path.join(this.destinationRoot, safeName);
        // Codex invokes only direct children of ~/.codex/skills. A nested
        // candidate may still be discovered for import, but must be copied to
        // a canonical top-level directory instead of being registered in place.
        const sourceIsDestination = directChildPath(this.destinationRoot, sourcePath);
        const duplicateBareName = !registered && reservedNames.has(safeName);
        const collision = duplicateBareName || (!sourceIsDestination && fs.existsSync(destinationPath));
        const suggestedName = registered?.name || (sourceIsDestination
          ? safeName
          : collision
            ? availableDestinationName(this.destinationRoot, `${safeName}-imported`, reservedNames)
            : safeName);
        reservedNames.add(suggestedName);
        candidates.push({
          id: candidateId(sourcePath),
          name: safeName,
          title: metadata.title,
          description: metadata.description,
          sourcePath,
          sourceLabel: root.label,
          status: registered ? (registered.available ? "imported" : "unavailable") : "available",
          error: registered?.error || "",
          suggestedName,
          officialNameConflict,
          nameCollision: collision,
          sourceIsDestination
        });
      }
    }
    // Keep broken or missing registered Skills visible with an actionable
    // error, while withholding them from the invocable sidebar workflows.
    for (const registered of imported) {
      if (seenImportedRecords.has(registered.id)) continue;
      candidates.push({
        id: candidateId(registered.path),
        name: registered.name,
        title: registered.title,
        description: registered.description,
        sourcePath: registered.path,
        sourceLabel: "Codex 用户 Skill",
        status: "unavailable",
        error: registered.error,
        suggestedName: registered.name,
        officialNameConflict: this.officialSkillNames.has(registered.name),
        nameCollision: false,
        sourceIsDestination: true
      });
    }
    for (const candidate of candidates) {
      if (candidate.status !== "available" || !candidate.sourceIsDestination) continue;
      if (candidates.some((other) => other.id !== candidate.id
        && other.sourceIsDestination && other.name === candidate.name)) {
        candidate.nameCollision = true;
        candidate.error = `本机有多个 $${candidate.name}，请先重命名冲突项后重新扫描。`;
      }
    }
    candidates.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    return {
      ok: true,
      candidates,
      imported,
      changed: listed.changed,
      scannedAt: Date.now()
    };
  }

  import(request = {}) {
    const requestedIds = new Set(
      (Array.isArray(request.candidateIds) ? request.candidateIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    );
    if (!requestedIds.size) {
      return { ok: false, imported: [], error: "请至少选择一个要导入的 Skill。" };
    }
    const snapshot = this.scan();
    const registry = this.readRegistry();
    const records = [...registry.skills];
    const imported = [];
    const failures = [];
    const selectedCandidates = snapshot.candidates.filter((item) => requestedIds.has(item.id));
    const matchedIds = new Set(selectedCandidates.map((candidate) => candidate.id));
    for (const staleId of requestedIds) {
      if (matchedIds.has(staleId)) continue;
      failures.push({
        id: staleId,
        title: staleId,
        error: "该 Skill 候选已不存在或扫描结果已变化，请重新扫描后再试。"
      });
    }
    for (const candidate of selectedCandidates) {
      if (candidate.status !== "available") {
        failures.push({
          id: candidate.id,
          title: candidate.title,
          error: candidate.error || "该 Skill 已加入 Skill Hub，无需重复导入。"
        });
        continue;
      }
      if (candidate.sourceIsDestination && candidate.nameCollision) {
        failures.push({
          id: candidate.id,
          title: candidate.title,
          error: `本机 Codex 用户目录已有另一个 $${candidate.name}，请先重命名其中一个 Skill。`
        });
        continue;
      }
      let createdDestinationPath = "";
      try {
        const sourcePath = canonicalPath(candidate.sourcePath);
        const destinationName = candidate.suggestedName;
        const sourceIsDestination = directChildPath(this.destinationRoot, sourcePath);
        const destinationPath = sourceIsDestination
          ? sourcePath
          : path.join(this.destinationRoot, destinationName);
        if (!sourceIsDestination) {
          copySkillDirectory(sourcePath, destinationPath);
          createdDestinationPath = destinationPath;
          if (destinationName !== candidate.name) {
            rewriteSkillName(destinationPath, destinationName);
            rewriteSkillSelfReferences(destinationPath, candidate.name, destinationName);
          }
          const unresolved = unsafeCopiedSkillReferences(
            destinationPath,
            candidate.name,
            sourcePath,
            destinationName !== candidate.name
          );
          if (unresolved.length > 0) {
            throw new Error(
              `${destinationName !== candidate.name ? `名称冲突需要改为 $${destinationName}，但` : "复制到 Codex 顶层目录后"} ${unresolved.join("、")} 仍含${destinationName !== candidate.name ? ` $${candidate.name} 或` : ""}旧路径自引用；为避免导入损坏，请先在原 Skill 中改名后重试。`
            );
          }
        }
        const metadata = skillMetadata(destinationPath);
        if (!metadata) throw new Error("复制完成后没有找到 SKILL.md。");
        const record = {
          id: `user-skill:${candidateId(destinationPath)}`,
          name: destinationName,
          title: metadata.title,
          description: metadata.description,
          path: canonicalPath(destinationPath),
          sourcePath,
          fingerprint: skillFingerprint(destinationPath),
          metadataFingerprint: metadata.metadataFingerprint,
          available: true,
          error: "",
          importedAt: Date.now()
        };
        const existingIndex = records.findIndex((entry) => entry.id === record.id);
        if (existingIndex >= 0) records.splice(existingIndex, 1, record);
        else records.push(record);
        imported.push(record);
      } catch (error) {
        if (createdDestinationPath) {
          fs.rmSync(createdDestinationPath, { recursive: true, force: true });
        }
        failures.push({
          id: candidate.id,
          title: candidate.title,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (imported.length) this.writeRegistry(records);
    const listed = this.listImported();
    return {
      ok: failures.length === 0,
      imported,
      skills: listed.skills,
      changed: snapshot.changed || listed.changed || imported.length > 0,
      failures,
      error: failures.length ? `${failures.length} 个 Skill 未能导入。` : undefined
    };
  }
}

module.exports = {
  MAX_SCAN_CANDIDATES,
  MAX_SCAN_DIRECTORIES,
  MAX_SKILL_BYTES,
  MAX_SKILL_DIRECTORIES,
  MAX_SKILL_FILES,
  MAX_SKILL_METADATA_BYTES,
  SkillHubService,
  discoverSkillDirectories,
  normalizedSkillName,
  skillFingerprint,
  skillMetadata
};
