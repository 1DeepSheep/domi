const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");

const {
  containsHardcodedFeishuAssignment,
  containsHardcodedSecret,
  containsOneDriveAccountPath,
  isForbiddenRuntimeName
} = require("./privacy-rules.cjs");

test("privacy rules allow a scanned env template but reject real env files", () => {
  assert.equal(isForbiddenRuntimeName(".env.example"), false);
  assert.equal(isForbiddenRuntimeName(".env"), true);
  assert.equal(isForbiddenRuntimeName(".env.local"), true);
});

test("credential detection never joins adjacent OpenAPI lines", () => {
  assert.equal(containsHardcodedSecret("scheme: bearer\n      bearerFormat: JWT"), false);
  assert.equal(containsHardcodedSecret("Authorization: \"a-realistic-long-secret-value\""), true);
  assert.equal(containsHardcodedSecret("Bearer abcdefghijklmnop"), true);
});

test("OneDrive detection distinguishes account paths from descriptive prose", () => {
  assert.equal(containsOneDriveAccountPath("iCloud/OneDrive-style folders"), false);
  assert.equal(
    containsOneDriveAccountPath("/Users/example/Library/CloudStorage/OneDrive-company/Documents"),
    true
  );
});


test("Feishu assignment detection allows only the exact historical synthetic-library placeholders", () => {
  const historicalFixture = 'settings = { ...settings, storageBackend: "feishu", projectBaseToken: "test-base", projectTableId: "test-table", wikiSpaceId: "test-space" };';
  assert.equal(containsHardcodedFeishuAssignment(historicalFixture), false);
  for (const value of ["test-private-resource-1234", "test-base-secret", "test-table-1234", "test-space-opaque", "opaqueResourceIdentifier123"]) {
    for (const key of ["projectBaseToken", "projectTableId", "wikiSpaceId"]) {
      assert.equal(containsHardcodedFeishuAssignment(`${key}: "${value}"`), true, `${key} must reject ${value}`);
    }
  }
  assert.equal(containsHardcodedFeishuAssignment(`${historicalFixture} field_id = "opaqueResourceIdentifier123";`), true,
    "an allowed placeholder must not exempt a different hardcoded identifier in the same file");
  assert.equal(containsHardcodedFeishuAssignment('app_token: "configured"'), false);
});


test("history privacy scanning deduplicates content without sharing path exemptions", () => {
  const checkerName = "privacy-check.cjs";
  const exemptPath = "scripts/privacy-rules.test.cjs";
  const supportFiles = [checkerName, "privacy-rules.cjs"];

  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "domi-history-dedupe-test-"));
  const tracePath = path.join(os.tmpdir(), `domi-history-trace-${path.basename(fixture)}.jsonl`);
  try {
    const git = (...args) => execFileSync("git", ["-C", fixture, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    const write = (name, content) => { fs.mkdirSync(path.dirname(path.join(fixture, name)), { recursive: true }); fs.writeFileSync(path.join(fixture, name), content); };
    const commit = () => { git("add", "."); git("-c", "core.hooksPath=/dev/null", "commit", "-qm", "fixture"); return git("rev-parse", "HEAD"); };
    git("init", "-q");
    git("config", "user.name", "Privacy Test");
    git("config", "user.email", "test@example.com");
    const email = ["historical-author", "private.invalid"].join("@");
    const oldContent = JSON.stringify({ email });
    write("stable.txt", "unchanged safe content");
    write("changed.txt", oldContent);
    write("legacy-lock.json", oldContent);
    write("legacy-checker.txt", oldContent);
    write("runtime.sqlite", "unchanged safe content");
    write("docs/review\tnotes.md", "safe tabbed path");
    const oldest = commit();
    git("mv", "legacy-lock.json", "package-lock.json");
    fs.mkdirSync(path.join(fixture, "scripts"), { recursive: true });
    git("mv", "legacy-checker.txt", exemptPath);
    const renamed = commit();
    fs.unlinkSync(path.join(fixture, "runtime.sqlite"));
    write("changed.txt", "current safe content");
    for (const name of supportFiles) write(`scripts/${name}`, fs.readFileSync(path.join(__dirname, name)));
    commit();
    git("-c", "core.hooksPath=/dev/null", "commit", "--allow-empty", "-qm", "unchanged tree");
    const result = spawnSync(process.execPath, [path.join(fixture, "scripts", checkerName), "--history"], {
      encoding: "utf8", timeout: 20_000,
      env: { ...process.env, DOMI_PRIVATE_IDENTITY_TERMS: "", NODE_PATH: path.join(__dirname, "..", "node_modules"), GIT_TRACE2_EVENT: tracePath }
    });
    assert.equal(result.status, 1, result.error?.message || result.stderr);
    for (const name of ["changed.txt", "legacy-lock.json", "legacy-checker.txt"]) {
      const firstOccurrence = name === "changed.txt" ? renamed : oldest;
      assert.ok(result.stderr.includes(`${firstOccurrence.slice(0, 12)}:${name}`), `Historical content is checked after it is fixed or renamed: ${name}`);
    }
    for (const revision of [oldest, renamed]) {
      assert.ok(result.stderr.includes(`${revision.slice(0, 12)}:runtime.sqlite`), "Forbidden paths are checked at every commit even for identical blobs");
    }
    assert.equal(result.stderr.includes(`${renamed.slice(0, 12)}:package-lock.json`), false, "Lockfile email exemption remains path-specific");
    assert.equal(result.stderr.includes(`${renamed.slice(0, 12)}:${exemptPath}`), false, "Checker content exemption remains path-specific");
    const reads = fs.readFileSync(tracePath, "utf8").trim().split("\n").map(line => JSON.parse(line))
      .filter(event => event.event === "start" && event.argv?.includes("show"))
      .map(event => event.argv[event.argv.indexOf("show") + 1].split(":").slice(1).join(":"));
    assert.equal(reads.filter(name => name === "stable.txt").length, 1, "Identical path and blob is read once across commits");
    assert.equal(reads.filter(name => name === "changed.txt").length, 2, "Every different historical content version is read");
    assert.equal(reads.filter(name => name === "docs/review\tnotes.md").length, 1, "NUL-delimited tree parsing preserves tabs in paths");
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true });
    fs.rmSync(tracePath, { force: true });
  }
});
