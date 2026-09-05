const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { SkillHubService } = require("../electron/skill-hub.cjs");
const { DomiPluginManager } = require("../electron/domi-plugin-manager.cjs");

test("official forks bundle shared references, retain origin and survive source upgrades", () => {
  const fixture = createFixture();
  try {
    const plugin = path.join(fixture.root, "official");
    const source = writeSkill(path.join(plugin, "skills"), "slides", { description: "生成 slides 演示文稿", defaultPrompt: "Use $domi:slides." });
    const shared = path.join(plugin, "shared");
    fs.mkdirSync(shared, { recursive: true });
    fs.writeFileSync(path.join(shared, "rules.md"), "Official source rule");
    fs.appendFileSync(path.join(source, "SKILL.md"), "\nRead [rules](../../shared/rules.md), then use $domi:slides.\n");
    fs.mkdirSync(path.join(source, "assets", "nested"), { recursive: true });
    fs.writeFileSync(path.join(source, "assets", "nested", "template.html"), "<!-- Uses ../theme.css. -->");
    fixture.service.setOfficialPlugin({ root: plugin, manifest: { version: "test-v1" } });
    const item = fixture.service.scan().official[0];
    const before = fs.readFileSync(path.join(source, "SKILL.md"), "utf8");
    const result = fixture.service.manage({ action: "fork", id: item.id });
    assert.equal(result.ok, true, JSON.stringify(result.failures));
    const personal = result.skills[0];
    assert.equal(personal.sourceVersion, "test-v1");
    assert.equal(personal.producesSlides, true);
    assert.equal(personal.independentCopy, true);
    assert.equal(fs.readFileSync(path.join(source, "SKILL.md"), "utf8"), before);
    const markdown = fs.readFileSync(path.join(personal.path, "SKILL.md"), "utf8");
    assert.match(markdown, /\$slides-personal/);
    assert.doesNotMatch(markdown, /\$domi:slides/);
    assert.equal(fs.readFileSync(path.join(personal.path, "_dependencies/shared/rules.md"), "utf8"), "Official source rule");
    fixture.service.manage({ action: "enable", id: personal.id, enabled: false });
    assert.equal(fixture.service.listImported().skills[0].enabled, false);
    fs.appendFileSync(path.join(personal.path, "SKILL.md"), "\nPersonal edit\n");
    assert.deepEqual(fixture.service.details(personal.id).changes, ["修改 · SKILL.md"]);
    fs.renameSync(plugin, `${plugin}-moved`);
    const retained = fixture.service.listImported().skills[0];
    assert.equal(retained.available, true);
    assert.equal(retained.enabled, false);
    assert.match(fs.readFileSync(path.join(retained.path, "SKILL.md"), "utf8"), /Personal edit/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("user import refuses unresolved external relative dependencies without altering source", () => {
  const fixture = createFixture();
  try {
    const source = writeSkill(path.join(fixture.codexHome, "skills"), "dependent");
    fs.appendFileSync(path.join(source, "SKILL.md"), "\nRead ../shared/rules.md\n");
    const result = fixture.service.import({ candidateIds: fixture.service.scan().candidates.map(item => item.id) });
    assert.equal(result.ok, false);
    assert.match(result.failures[0].error, /外部相对依赖/);
    assert.equal(fs.existsSync(path.join(source, "SKILL.md")), true);
    assert.equal(fs.existsSync(path.join(fixture.codexHome, "skills", "dependent-imported")), false);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("official changes are flagged only against a matching bundled version, without overwriting", () => {
  const fixture = createFixture();
  try {
    const plugin = path.join(fixture.root, "installed");
    const bundled = path.join(fixture.root, "bundled");
    const source = writeSkill(path.join(plugin, "skills"), "slides");
    fs.cpSync(plugin, bundled, { recursive: true });
    const info = (root, version) => ({ root, manifest: { version } });
    fixture.service.setOfficialPlugin(info(plugin, "v1"), info(bundled, "v1"));
    assert.equal(fixture.service.officialSkills()[0].integrity, "matches-bundled");
    fs.appendFileSync(path.join(source, "SKILL.md"), "\nPersonal adjustment\n");
    assert.equal(fixture.service.officialSkills()[0].integrity, "modified");
    assert.match(fs.readFileSync(path.join(source, "SKILL.md"), "utf8"), /Personal adjustment/);
    fixture.service.setOfficialPlugin(info(plugin, "v2"), info(bundled, "v1"));
    assert.equal(fixture.service.officialSkills()[0].integrity, "unverified");
    fs.writeFileSync(path.join(source, "SKILL.md"), "invalid frontmatter");
    assert.match(fixture.service.officialSkills()[0].error, /frontmatter/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-skill-hub-"));
  const codexHome = path.join(root, "codex-home");
  const agentsHome = path.join(root, "agents-home");
  const userDataPath = path.join(root, "user-data");
  fs.mkdirSync(path.join(codexHome, "skills"), { recursive: true });
  fs.mkdirSync(path.join(agentsHome, "skills"), { recursive: true });
  return {
    root,
    codexHome,
    agentsHome,
    userDataPath,
    service: new SkillHubService({ codexHome, agentsHome, userDataPath })
  };
}

function writeSkill(parent, folder, {
  name = folder,
  title = name,
  description = `${name} description`,
  defaultPrompt = `Use $${name}.`
} = {}) {
  const skillPath = path.join(parent, folder);
  fs.mkdirSync(path.join(skillPath, "agents"), { recursive: true });
  fs.writeFileSync(path.join(skillPath, "SKILL.md"), [
    "---",
    `name: ${name}`,
    `title: ${title}`,
    `description: ${description}`,
    "---",
    "",
    `# ${title}`,
    ""
  ].join("\n"));
  fs.writeFileSync(
    path.join(skillPath, "agents", "openai.yaml"),
    `interface:\n  default_prompt: \"${defaultPrompt}\"\n`
  );
  return skillPath;
}

test("scans Codex and Agents roots, copies both independently, and keeps official skills isolated", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const agentsSkills = path.join(fixture.agentsHome, "skills");
    const localPath = writeSkill(codexSkills, "research", {
      name: "research",
      title: "My Research"
    });
    const agentsPath = writeSkill(agentsSkills, "notes", {
      name: "notes",
      title: "My Notes"
    });
    const officialSentinel = path.join(fixture.root, "official-skill-sentinel.txt");
    fs.writeFileSync(officialSentinel, "official stays unchanged");
    fixture.service.setOfficialSkillNames(["research"]);

    const firstScan = fixture.service.scan();
    assert.equal(firstScan.ok, true);
    assert.equal(firstScan.candidates.length, 2);
    const local = firstScan.candidates.find((candidate) => candidate.title === "My Research");
    const agents = firstScan.candidates.find((candidate) => candidate.title === "My Notes");
    assert.ok(local);
    assert.ok(agents);
    assert.equal(local.officialNameConflict, true);
    assert.equal(local.suggestedName, "research-imported");
    assert.equal(local.sourceIsDestination, true);

    const result = fixture.service.import({ candidateIds: [local.id, agents.id] });
    assert.equal(result.ok, true);
    assert.equal(result.imported.length, 2);
    const importedLocal = result.imported.find((skill) => skill.name === "research-imported");
    const importedAgents = result.imported.find((skill) => skill.name === "notes");
    assert.notEqual(importedLocal.path, fs.realpathSync(localPath));
    fs.writeFileSync(path.join(localPath, "source-only.txt"), "later source edit");
    assert.equal(fs.existsSync(path.join(importedLocal.path, "source-only.txt")), false);
    assert.equal(importedAgents.path, fs.realpathSync(path.join(codexSkills, "notes")));
    assert.equal(fs.readFileSync(officialSentinel, "utf8"), "official stays unchanged");

    fs.writeFileSync(path.join(agentsPath, "source-only.txt"), "later source edit");
    assert.equal(fs.existsSync(path.join(importedAgents.path, "source-only.txt")), false);

    const nextScan = fixture.service.scan();
    assert.equal(nextScan.candidates.length, 2);
    assert.deepEqual(
      nextScan.candidates.map((candidate) => candidate.status),
      ["imported", "imported"]
    );
    assert.equal(nextScan.candidates.some((candidate) => (
      candidate.sourcePath === fs.realpathSync(agentsPath) && candidate.status === "available"
    )), false);

    const reloaded = new SkillHubService({
      codexHome: fixture.codexHome,
      agentsHome: fixture.agentsHome,
      userDataPath: fixture.userDataPath
    });
    assert.equal(reloaded.listImported().skills.length, 2);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("a damaged or newer registry is preserved instead of silently becoming an empty catalog", () => {
  const fixture = createFixture();
  try {
    const skillPath = writeSkill(path.join(fixture.codexHome, "skills"), "keep-me");
    const candidate = fixture.service.scan().candidates[0];
    fixture.service.import({ candidateIds: [candidate.id] });
    const original = fs.readFileSync(fixture.service.registryPath, "utf8");
    const skillBytes = fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8");
    fixture.service.writeRegistry(fixture.service.readRegistry().skills);
    assert.equal(fs.readFileSync(`${fixture.service.registryPath}.backup`, "utf8"), original);

    for (const damaged of ["{ truncated", JSON.stringify({ version: 99, skills: [] })]) {
      fs.writeFileSync(fixture.service.registryPath, damaged);
      assert.throws(() => fixture.service.listImported(), /注册记录/);
      assert.throws(() => fixture.service.import({ candidateIds: [candidate.id] }), /注册记录/);
      assert.throws(() => fixture.service.writeRegistry([]), /注册记录/);
      assert.equal(fs.readFileSync(fixture.service.registryPath, "utf8"), damaged);
      assert.equal(fs.readFileSync(`${fixture.service.registryPath}.backup`, "utf8"), original);
      assert.equal(fs.readFileSync(path.join(skillPath, "SKILL.md"), "utf8"), skillBytes);
    }

    fs.copyFileSync(`${fixture.service.registryPath}.backup`, fixture.service.registryPath);
    assert.equal(fixture.service.listImported().skills[0].name, "keep-me-imported");
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("official plugin upgrade and rollback preserve a user's derived Skill and its resources", () => {
  const fixture = createFixture();
  try {
    const sourcePath = writeSkill(path.join(fixture.agentsHome, "skills"), "my-slides");
    fs.mkdirSync(path.join(sourcePath, "assets"));
    fs.writeFileSync(path.join(sourcePath, "assets", "style.css"), "/* user customized style */");
    const candidate = fixture.service.scan().candidates[0];
    const imported = fixture.service.import({ candidateIds: [candidate.id] }).skills[0];
    const registryBytes = fs.readFileSync(fixture.service.registryPath, "utf8");
    const skillBytes = fs.readFileSync(path.join(imported.path, "SKILL.md"), "utf8");
    const resourceBytes = fs.readFileSync(path.join(imported.path, "assets", "style.css"), "utf8");
    const pluginRoot = path.join(fixture.root, "bundled-plugin");
    fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
    const lockPath = path.join(fixture.root, "bundled-lock.json");
    function version(version) {
      fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({ name: "domi", version }));
      fs.writeFileSync(lockPath, JSON.stringify({ pluginVersion: version, gitCommit: version, sha256: version }));
      writeSkill(path.join(pluginRoot, "skills"), "slides", { description: `Official ${version}` });
    }
    version("0.3.20");
    const manager = new DomiPluginManager({
      userDataPath: fixture.userDataPath,
      bundledPluginRoot: pluginRoot,
      bundledLockPath: lockPath,
      remoteUpdateEnabled: false
    });
    manager.writeManagedMarketplace(manager.bundledInfo());
    version("0.3.21");
    manager.prepareManagedMarketplace(manager.bundledInfo()).rollback();
    assert.equal(manager.installedInfo().manifest.version, "0.3.20");
    manager.writeManagedMarketplace(manager.bundledInfo());
    assert.equal(manager.installedInfo().manifest.version, "0.3.21");

    assert.equal(fs.readFileSync(fixture.service.registryPath, "utf8"), registryBytes);
    assert.equal(fs.readFileSync(path.join(imported.path, "SKILL.md"), "utf8"), skillBytes);
    assert.equal(fs.readFileSync(path.join(imported.path, "assets", "style.css"), "utf8"), resourceBytes);
    const restarted = new SkillHubService({
      userDataPath: fixture.userDataPath, codexHome: fixture.codexHome, agentsHome: fixture.agentsHome,
      officialSkillNames: ["slides"]
    });
    const restored = restarted.listImported().skills[0];
    assert.equal(restored.available, true);
    assert.equal(restored.id, imported.id);
    assert.equal(restored.fingerprint, imported.fingerprint);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("reserves unique names for a scan batch and rewrites renamed copies", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const agentsSkills = path.join(fixture.agentsHome, "skills");
    writeSkill(codexSkills, "dup", { name: "existing", title: "Existing" });
    const firstPath = writeSkill(path.join(agentsSkills, "one"), "skill", {
      name: "dup",
      title: "Duplicate One"
    });
    const secondPath = writeSkill(path.join(agentsSkills, "two"), "skill", {
      name: "dup",
      title: "Duplicate Two"
    });

    const scan = fixture.service.scan();
    const duplicatePaths = new Set([fs.realpathSync(firstPath), fs.realpathSync(secondPath)]);
    const duplicates = scan.candidates
      .filter((candidate) => duplicatePaths.has(candidate.sourcePath))
      .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, "en"));
    assert.equal(duplicates.length, 2);
    assert.deepEqual(
      new Set(duplicates.map((candidate) => candidate.suggestedName)).size,
      2
    );
    assert.deepEqual(
      duplicates.map((candidate) => candidate.suggestedName).sort(),
      ["dup-imported", "dup-imported-2"]
    );

    const result = fixture.service.import({
      candidateIds: duplicates.map((candidate) => candidate.id)
    });
    assert.equal(result.ok, true);
    assert.equal(result.imported.length, 2);
    for (const imported of result.imported) {
      const markdown = fs.readFileSync(path.join(imported.path, "SKILL.md"), "utf8");
      const yaml = fs.readFileSync(path.join(imported.path, "agents", "openai.yaml"), "utf8");
      assert.match(markdown, new RegExp(`^name: ${imported.name}$`, "m"));
      assert.match(yaml, new RegExp(`\\$${imported.name}(?:[^a-z0-9_-]|$)`, "i"));
      assert.doesNotMatch(yaml, /\$dup(?:[^a-z0-9_-]|$)/i);
    }
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed and rolls back when a collision rename leaves ambiguous self references", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const agentsSkills = path.join(fixture.agentsHome, "skills");
    fs.mkdirSync(path.join(codexSkills, "conflicted"), { recursive: true });
    const sourcePath = writeSkill(agentsSkills, "conflicted", {
      name: "conflicted",
      title: "Unsafe collision"
    });
    fs.appendFileSync(
      path.join(sourcePath, "SKILL.md"),
      `\nRun $conflicted and load ${fs.realpathSync(sourcePath)}/scripts/check.js.\n`
    );

    const candidate = fixture.service.scan().candidates.find(
      (item) => item.sourcePath === fs.realpathSync(sourcePath)
    );
    assert.ok(candidate);
    assert.equal(candidate.nameCollision, true);
    const result = fixture.service.import({ candidateIds: [candidate.id] });
    assert.equal(result.ok, false);
    assert.equal(result.imported.length, 0);
    assert.match(result.failures[0].error, /旧路径自引用|避免导入损坏/);
    assert.equal(
      fs.existsSync(path.join(codexSkills, candidate.suggestedName)),
      false
    );
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("copies a nested Codex candidate to an invocable top-level directory", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const nestedPath = writeSkill(path.join(codexSkills, "collection"), "nested", {
      name: "nested-tool",
      title: "Nested Tool"
    });
    const candidate = fixture.service.scan().candidates.find(
      (item) => item.sourcePath === fs.realpathSync(nestedPath)
    );
    assert.ok(candidate);
    assert.equal(candidate.sourceIsDestination, false);
    assert.equal(candidate.suggestedName, "nested-tool");

    const result = fixture.service.import({ candidateIds: [candidate.id] });
    assert.equal(result.ok, true);
    assert.equal(result.imported.length, 1);
    assert.equal(
      result.imported[0].path,
      fs.realpathSync(path.join(codexSkills, "nested-tool"))
    );
    assert.equal(fs.existsSync(path.join(nestedPath, "SKILL.md")), true);
    assert.notEqual(result.imported[0].path, fs.realpathSync(nestedPath));
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("rejects a nested candidate that hard-codes its non-invocable source path", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const nestedPath = writeSkill(path.join(codexSkills, "collection"), "fragile", {
      name: "fragile",
      title: "Fragile nested Skill"
    });
    fs.appendFileSync(
      path.join(nestedPath, "SKILL.md"),
      `\nRead ${fs.realpathSync(nestedPath)}/references/policy.md.\n`
    );
    const candidate = fixture.service.scan().candidates.find(
      (item) => item.sourcePath === fs.realpathSync(nestedPath)
    );
    const result = fixture.service.import({ candidateIds: [candidate.id] });
    assert.equal(result.ok, false);
    assert.match(result.failures[0].error, /旧路径自引用|避免导入损坏/);
    assert.equal(fs.existsSync(path.join(codexSkills, "fragile")), false);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("fails closed for stale candidate ids while preserving valid selections", () => {
  const fixture = createFixture();
  try {
    const candidatePath = writeSkill(path.join(fixture.agentsHome, "skills"), "valid");
    const candidate = fixture.service.scan().candidates.find(
      (item) => item.sourcePath === fs.realpathSync(candidatePath)
    );
    const result = fixture.service.import({
      candidateIds: [candidate.id, "stale-candidate-id"]
    });
    assert.equal(result.ok, false);
    assert.equal(result.imported.length, 1);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].error, /不存在|变化/);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("isolates malformed candidates and refreshes the official-name snapshot", () => {
  const fixture = createFixture();
  try {
    const skillsRoot = path.join(fixture.codexHome, "skills");
    writeSkill(skillsRoot, "healthy", { name: "healthy" });
    const oversized = path.join(skillsRoot, "oversized");
    fs.mkdirSync(oversized, { recursive: true });
    fs.writeFileSync(path.join(oversized, "SKILL.md"), Buffer.alloc(256 * 1024 + 1, 65));

    let scan = fixture.service.scan();
    assert.equal(scan.candidates.length, 1);
    assert.equal(scan.candidates[0].officialNameConflict, false);
    fixture.service.setOfficialSkillNames(["healthy"]);
    scan = fixture.service.scan();
    assert.equal(scan.candidates.length, 1);
    assert.equal(scan.candidates[0].officialNameConflict, true);
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refreshes edited metadata and multiline YAML without changing workflow identity", () => {
  const fixture = createFixture();
  try {
    writeSkill(path.join(fixture.codexHome, "skills"), "editable");
    const initial = fixture.service.import({ candidateIds: fixture.service.scan().candidates.map((item) => item.id) });
    const original = initial.skills[0];
    const skillPath = original.path;
    assert.equal(fixture.service.listImported().changed, false);
    fs.writeFileSync(path.join(skillPath, "SKILL.md"), [
      "---", "name: editable-imported", 'title: "Edited: Skill"', "description: >",
      "  First line of the description.", "  Second line of the description.", "---", "# Updated instructions", ""
    ].join("\n"));
    const updated = fixture.service.listImported();
    assert.equal(updated.changed, true);
    assert.equal(updated.skills[0].id, original.id);
    assert.equal(updated.skills[0].title, "Edited: Skill");
    assert.equal(updated.skills[0].description, "First line of the description. Second line of the description.");
    assert.notEqual(updated.skills[0].fingerprint, original.fingerprint);
    assert.equal(updated.skills[0].available, true);
    assert.equal(fixture.service.listImported().changed, false);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("safe renames retain queued workflow identity and old aliases cannot capture it", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    writeSkill(codexSkills, "original", { name: "original" });
    const initial = fixture.service.import({ candidateIds: fixture.service.scan().candidates.map((item) => item.id) });
    const queuedWorkflowId = initial.skills[0].id;
    const skillPath = initial.skills[0].path;
    writeSkill(codexSkills, path.basename(skillPath), { name: "renamed" });
    const listed = fixture.service.listImported();
    assert.equal(listed.changed, true);
    assert.equal(listed.skills[0].id, queuedWorkflowId);
    assert.equal(listed.skills[0].name, "renamed");
    assert.equal(listed.skills[0].path, fs.realpathSync(skillPath));

    writeSkill(codexSkills, "unrelated", { name: "original-imported" });
    const replacement = fixture.service.scan().candidates.find((item) => item.name === "original-imported");
    const imported = fixture.service.import({ candidateIds: [replacement.id] });
    assert.equal(imported.ok, true);
    assert.notEqual(imported.imported[0].id, queuedWorkflowId);
    assert.equal(imported.skills.find((item) => item.id === queuedWorkflowId).name, "renamed");
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("conflicting and invalid edits are unavailable, visible, and recover with the same id", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    const sourcePath = writeSkill(codexSkills, "first");
    writeSkill(codexSkills, "second");
    const first = fixture.service.scan().candidates.find((item) => item.name === "first");
    const initial = fixture.service.import({ candidateIds: [first.id] });
    const originalId = initial.skills[0].id;
    const skillPath = initial.skills[0].path;
    writeSkill(codexSkills, path.basename(skillPath), { name: "second" });
    const conflicted = fixture.service.scan();
    assert.equal(conflicted.imported[0].available, false);
    assert.match(conflicted.imported[0].error, /多个 \$second/);
    assert.equal(conflicted.candidates.find((item) => item.sourcePath === fs.realpathSync(sourcePath)).status, "unavailable");
    const second = conflicted.candidates.find((item) => item.name === "second");
    assert.equal(second.nameCollision, true);
    assert.equal(fixture.service.import({ candidateIds: [second.id] }).imported.length, 0);

    fs.writeFileSync(path.join(skillPath, "SKILL.md"), "---\nname: Unsafe Alias\ndescription: invalid name\n---\n");
    const invalid = fixture.service.scan();
    assert.equal(invalid.imported[0].available, false);
    assert.match(invalid.imported[0].error, /不能自动猜测调用名/);
    assert.equal(invalid.candidates.some((item) => item.status === "unavailable"), true);

    fs.writeFileSync(path.join(skillPath, "SKILL.md"), "# No frontmatter\n");
    assert.match(fixture.service.listImported().skills[0].error, /缺少有效的 YAML/);
    writeSkill(codexSkills, path.basename(skillPath), { name: "repaired" });
    const repaired = fixture.service.listImported();
    assert.equal(repaired.skills[0].available, true);
    assert.equal(repaired.skills[0].name, "repaired");
    assert.equal(repaired.skills[0].id, originalId);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("legacy registry ids survive metadata refresh and failed imports report catalog changes", () => {
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    writeSkill(codexSkills, "legacy");
    const candidate = fixture.service.scan().candidates[0];
    fixture.service.import({ candidateIds: [candidate.id] });
    const registry = fixture.service.readRegistry();
    registry.skills[0].id = "user-skill:legacy";
    fixture.service.writeRegistry(registry.skills);
    writeSkill(codexSkills, path.basename(registry.skills[0].path), { name: "renamed-legacy" });
    const result = fixture.service.import({ candidateIds: [candidate.id] });
    assert.equal(result.ok, false);
    assert.equal(result.imported.length, 0);
    assert.equal(result.changed, true);
    assert.equal(result.skills[0].id, "user-skill:legacy");
    assert.equal(result.skills[0].name, "renamed-legacy");
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("concurrent newly created Skills require explicit selection instead of automatic import", async () => {
  const { newSkillHubCandidatesForReview } = await import("../src/skill-hub-review.ts");
  const fixture = createFixture();
  try {
    const codexSkills = path.join(fixture.codexHome, "skills");
    writeSkill(codexSkills, "existing");
    const baseline = new Set(fixture.service.scan().candidates.map((item) => item.id));
    const intendedPath = writeSkill(codexSkills, "created-in-current-task");
    writeSkill(codexSkills, "created-in-other-task");
    const scanned = fixture.service.scan();
    const reviewIds = newSkillHubCandidatesForReview(scanned.candidates, baseline);
    assert.equal(reviewIds.length, 2);
    assert.equal(fixture.service.listImported().skills.length, 0);
    const intended = scanned.candidates.find((item) => item.sourcePath === fs.realpathSync(intendedPath));
    const confirmed = fixture.service.import({ candidateIds: [intended.id] });
    assert.equal(confirmed.skills.length, 1);
    assert.equal(confirmed.skills[0].name, "created-in-current-task-imported");
    assert.equal(fixture.service.scan().candidates.find((item) => item.name === "created-in-other-task").status, "available");

    const app = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
    const refresh = app.slice(app.indexOf("async function refreshSkillsAfterCreatorRun"), app.indexOf("async function stopRun"));
    assert.doesNotMatch(refresh, /importSkillHub/);
    assert.match(refresh, /setSkillHubReviewCandidateIds\(reviewCandidateIds\)/);
    const manager = fs.readFileSync(path.resolve(__dirname, "../src/SkillHubManager.tsx"), "utf8");
    assert.match(manager, /\[selected, setSelected\] = useState<Set<string>>\(new Set\(\)\)/);
  } finally { fs.rmSync(fixture.root, { recursive: true, force: true }); }
});

test("personal Skill prompts pin the selected path even when another root has the same alias", async () => {
  const { workflowPrompt } = await import("../src/workflows.ts");
  const prompt = workflowPrompt({
    id: "user-skill:stable-path-id", title: "Personal Research", shortTitle: "Research",
    skill: "$research", skillPath: "/verified/codex/skills/research", source: "user",
    description: "Custom research", output: "Research result", defaultPrompt: "Research this."
  }, "研究这个项目", "", true, "user");
  assert.match(prompt, /唯一来源文件为 \/verified\/codex\/skills\/research\/SKILL\.md/);
  assert.match(prompt, /即使本机另一目录存在同名 Skill/);
  assert.match(prompt, /该文件不可用时停止，不得改用同名副本/);
});

test("Skill Hub UI stays compact and launches the native skill-creator conversation", () => {
  const root = path.resolve(__dirname, "..");
  const app = fs.readFileSync(path.join(root, "src", "App.tsx"), "utf8");
  const manager = fs.readFileSync(path.join(root, "src", "SkillHubManager.tsx"), "utf8");
  const styles = fs.readFileSync(path.join(root, "src", "styles.css"), "utf8");
  const workflows = fs.readFileSync(path.join(root, "src", "workflows.ts"), "utf8");
  const main = fs.readFileSync(path.join(root, "electron", "main.cjs"), "utf8");

  assert.match(app, /<strong>Skill Hub<\/strong>/);
  assert.match(app, /openNewSkillConversation[\s\S]*?submitToCodex\(workflow/);
  assert.match(app, /refreshSkillsAfterCreatorRun\(context\.threadId\)/);
  assert.match(app, /skillHubReady[\s\S]*?用户 Skill/);
  assert.match(app, /queuedUserSkill && !skillHubReady[\s\S]*?continue/);
  assert.match(app, /selectedUserSkillId && !skillHubReady[\s\S]*?当前输入已保留/);
  assert.match(manager, /技能管理与本机导入[\s\S]*?selected[\s\S]*?importSelected/);
  assert.match(manager, /原生 skill-creator 边聊边创建/);
  assert.match(styles, /\.sidebar-skill-hub-content\s*\{[^}]*max-height:\s*min\(220px, 28vh\)/);
  assert.match(styles, /\.sidebar-workflow-section \.sidebar-workflows\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(workflows, /skill:\s*"\$skill-creator"[\s\S]*?不得改造成表单向导/);
  assert.match(workflows, /所需 references、scripts、assets 完整复制到个人 Skill 目录/);
  assert.match(workflows, /不得依赖会随官方升级变化的插件缓存绝对路径/);
  assert.match(main, /activeRuns\.size > 0[\s\S]*?skillHubCodexReloadPending = true[\s\S]*?after-current-tasks/);
});

test("Skill Hub has a gear-free header and a non-scrolling management footer", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
  const styles = fs.readFileSync(path.resolve(__dirname, "../src/styles.css"), "utf8");
  const header = app.match(/<div className="sidebar-skill-hub-header">([\s\S]*?)\{skillsExpanded &&/)[1];
  const manage = styles.match(/\.sidebar-skill-hub-manage\s*\{([^}]+)\}/)[1];
  assert.equal((header.match(/<button\b/g) || []).length, 1);
  assert.match(header, /<ChevronRight/);
  assert.doesNotMatch(header, /<Settings|sidebar-skill-hub-manage/);
  assert.match(app, /\{skillsExpanded && \([\s\S]*?sidebar-skill-hub-content[\s\S]*?sidebar-workflows[\s\S]*?<\/div>\s*<button\s*className="sidebar-skill-hub-manage"[\s\S]*?管理技能…/);
  assert.match(manage, /flex:\s*0 0 auto/);
  assert.match(manage, /border-top:\s*1px solid/);
  assert.doesNotMatch(manage, /position:\s*absolute|transform:/);
});

test("sidebar and workspace headings use 投资档案 and 文档中心 without changing workspace IDs", () => {
  const app = fs.readFileSync(path.resolve(__dirname, "../src/App.tsx"), "utf8");
  assert.match(app, /openPrimaryWorkspace\("data"\)[\s\S]*?<strong>投资档案<\/strong>/);
  assert.match(app, /onClick=\{openDocumentLibrary\}[\s\S]*?<strong>文档中心<\/strong>/);
  assert.match(app, /workspaceView === "data"\s*\? "投资档案"\s*: workspaceView === "documents"\s*\? "文档中心"/);
  assert.match(app, /aria-label="投资档案类型"/);
  assert.match(app, /aria-label="文档中心目录"/);
  assert.doesNotMatch(app, /<strong>(?:资料库|文档库)<\/strong>|刷新本地文档库|在左侧“文档库”/);
});
