const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  ARCHIVE_URL_PREFIX,
  DomiPluginUpdater,
  sha256,
  validateArchiveEntries,
  validateRequiredPluginContracts
} = require("../electron/domi-plugin-updater.cjs");

function byteResponse(value) {
  const bytes = Buffer.from(value);
  return {
    ok: true,
    status: 200,
    async arrayBuffer() {
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    }
  };
}

function jsonResponse(value) {
  return {
    ok: true,
    status: 200,
    async json() {
      return value;
    }
  };
}

function createReleaseFixture(root) {
  const fixtureRoot = path.join(root, "fixture");
  const pluginRoot = path.join(fixtureRoot, "domi");
  fs.mkdirSync(path.join(pluginRoot, ".codex-plugin"), { recursive: true });
  fs.mkdirSync(path.join(pluginRoot, "skills", "domi-router"), { recursive: true });
  fs.writeFileSync(path.join(pluginRoot, ".codex-plugin", "plugin.json"), JSON.stringify({
    name: "domi",
    version: "0.4.0+codex.20260727090000"
  }));
  fs.writeFileSync(
    path.join(pluginRoot, "skills", "domi-router", "SKILL.md"),
    "# domi router\n"
  );
  const investmentSkillRoot = path.join(pluginRoot, "skills", "investment-analysis");
  fs.mkdirSync(investmentSkillRoot, { recursive: true });
  fs.writeFileSync(path.join(investmentSkillRoot, "SKILL.md"), "# investment analysis\n");
  const slidesSkillRoot = path.join(pluginRoot, "skills", "slides");
  const slidesFiles = [
    ["SKILL.md", "# slides\n"],
    [path.join("agents", "openai.yaml"), "interface:\n  default_prompt: Use $domi:slides\n"],
    [path.join("references", "investment-banking-slides.md"), "# slides\n"],
    [path.join("references", "morgan-stanley-ibd-template-notes.md"), "# Morgan Stanley notes\n"],
    [path.join("assets", "slides", "base-deck.html"), "<main></main>\n"],
    [path.join("assets", "slides", "ms-research.css"), "/* base style */\n"],
    [path.join("assets", "slides", "page-templates.html"), "<template></template>\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "style-lock.yml"), "style: morgan-stanley\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "style.css"), "/* style */\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "templates.html"), "<section></section>\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "layout-index.json"), "{}\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "layout-recipes.md"), "# layouts\n"],
    [path.join("assets", "slides", "style-packs", "morgan-stanley", "chart-recipes.md"), "# charts\n"],
    [path.join("scripts", "audit_research_deck.js"), "// audit\n"],
    [path.join("scripts", "init_deck.js"), "// init\n"],
    [path.join("scripts", "qa_deck.js"), "// qa\n"],
    [path.join("scripts", "export_pdf.js"), "// export\n"],
  ];
  for (const [relativePath, content] of slidesFiles) {
    const target = path.join(slidesSkillRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  fs.writeFileSync(path.join(pluginRoot, "fixture.txt"), "signed remote plugin\n");

  const archivePath = path.join(root, "domi-plugin.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", fixtureRoot, "domi"]);
  const archiveBytes = fs.readFileSync(archivePath);
  const archiveUrl = `${ARCHIVE_URL_PREFIX}plugin-test/domi-plugin.tar.gz`;
  const manifest = {
    schemaVersion: 1,
    name: "domi",
    version: "0.4.0+codex.20260727090000",
    gitCommit: "a".repeat(40),
    sha256: sha256(archiveBytes),
    archiveUrl,
    archiveFormat: "tar.gz",
    archiveRoot: "domi",
    minClientVersion: "0.3.0",
    publishedAt: "2026-07-27T09:00:00.000Z"
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  const signatureBytes = crypto.sign(null, manifestBytes, privateKey);
  const publicKeyDerBase64 = publicKey
    .export({ format: "der", type: "spki" })
    .toString("base64");
  const manifestUrl = `${ARCHIVE_URL_PREFIX}plugin-test/latest.json`;
  const signatureUrl = `${ARCHIVE_URL_PREFIX}plugin-test/latest.json.sig`;
  const release = {
    id: 42,
    assets: [
      { name: "latest.json", browser_download_url: manifestUrl },
      { name: "latest.json.sig", browser_download_url: signatureUrl },
      { name: "domi-plugin.tar.gz", browser_download_url: archiveUrl }
    ]
  };
  return {
    archiveBytes,
    archiveUrl,
    manifest,
    manifestBytes,
    manifestUrl,
    publicKeyDerBase64,
    pluginRoot,
    release,
    slidesSkillRoot,
    signatureBytes,
    signatureUrl
  };
}

function fetchFixture(fixture, calls) {
  return async (url) => {
    calls.push(url);
    if (url === "https://example.test/latest") return jsonResponse(fixture.release);
    if (url === fixture.manifestUrl) return byteResponse(fixture.manifestBytes);
    if (url === fixture.signatureUrl) return byteResponse(fixture.signatureBytes);
    if (url === fixture.archiveUrl) return byteResponse(fixture.archiveBytes);
    throw new Error(`Unexpected URL: ${url}`);
  };
}

async function run() {
  assert.throws(
    () => validateArchiveEntries("domi/../../escape"),
    /Unsafe plugin archive entry/
  );

  const missingContractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-contract-"));
  try {
    assert.throws(
      () => validateRequiredPluginContracts(missingContractRoot),
      /missing required contract/
    );
  } finally {
    fs.rmSync(missingContractRoot, { recursive: true, force: true });
  }

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-updater-unit-"));
  try {
    const fixture = createReleaseFixture(temporaryRoot);
    validateRequiredPluginContracts(fixture.pluginRoot);
    const missingLayoutRecipe = path.join(
      fixture.slidesSkillRoot,
      "assets",
      "slides",
      "style-packs",
      "morgan-stanley",
      "layout-recipes.md"
    );
    fs.rmSync(missingLayoutRecipe);
    assert.throws(
      () => validateRequiredPluginContracts(fixture.pluginRoot),
      /layout-recipes\.md/
    );
    fs.writeFileSync(missingLayoutRecipe, "# layouts\n");
    const calls = [];
    const marketplaceRoot = path.join(temporaryRoot, "marketplace");
    const updater = new DomiPluginUpdater({
      marketplaceRoot,
      clientVersion: "0.3.0",
      fetchImpl: fetchFixture(fixture, calls),
      releaseApiUrl: "https://example.test/latest",
      publicKeyDerBase64: fixture.publicKeyDerBase64,
      now: () => 1000
    });

    const first = await updater.check({ force: true });
    assert.equal(first.ok, true);
    assert.equal(first.checked, true);
    assert.equal(first.candidate.source, "remote-release");
    assert.equal(first.candidate.manifest.version, fixture.manifest.version);
    assert.equal(
      fs.readFileSync(path.join(first.candidate.root, "fixture.txt"), "utf8"),
      "signed remote plugin\n"
    );
    assert.equal(calls.length, 4);

    const cached = await updater.check();
    assert.equal(cached.ok, true);
    assert.equal(cached.checked, false);
    assert.equal(cached.candidate.manifest.version, fixture.manifest.version);
    assert.equal(calls.length, 4);

    const rolledBackClient = new DomiPluginUpdater({
      marketplaceRoot,
      clientVersion: "0.2.9",
      fetchImpl: fetchFixture(fixture, []),
      releaseApiUrl: "https://example.test/latest",
      publicKeyDerBase64: fixture.publicKeyDerBase64,
      now: () => 1000
    });
    assert.equal(rolledBackClient.cachedCandidate(), null);
    assert.equal((await rolledBackClient.check()).candidate, null);
    const incompatible = await rolledBackClient.check({ force: true });
    assert.equal(incompatible.reason, "requires-client-0.3.0");
    assert.equal(incompatible.candidate, null);
    // Repopulate the verified state after simulating the older client.
    assert.equal((await updater.check({ force: true })).ok, true);

    const cachedRecipe = path.join(first.candidate.root, "skills", "slides", "scripts", "qa_deck.js");
    fs.writeFileSync(cachedRecipe, "");
    assert.equal(updater.cachedCandidate(), null, "empty QA resources must not bypass the contract via cache");
    const repaired = await updater.check({ force: true });
    assert.equal(repaired.ok, true);
    assert.ok(fs.statSync(cachedRecipe).size > 0, "a signed archive repairs an invalid cache");
    fs.rmSync(cachedRecipe);
    fs.mkdirSync(cachedRecipe);
    assert.equal(updater.cachedCandidate(), null, "directories cannot stand in for required files");
    assert.equal((await updater.check({ force: true })).ok, true);
    assert.equal(fs.statSync(cachedRecipe).isFile(), true);

    const missingAssetsUpdater = new DomiPluginUpdater({
      marketplaceRoot,
      clientVersion: "0.3.0",
      fetchImpl: async () => jsonResponse({ id: 43, assets: [] }),
      releaseApiUrl: "https://example.test/latest",
      publicKeyDerBase64: fixture.publicKeyDerBase64,
      now: () => 2000
    });
    const missingAssets = await missingAssetsUpdater.check({ force: true });
    assert.equal(missingAssets.reason, "release-assets-missing");
    assert.equal(missingAssets.candidate.manifest.version, fixture.manifest.version);

    const preservedCache = await missingAssetsUpdater.check();
    assert.equal(preservedCache.checked, false);
    assert.equal(preservedCache.candidate.manifest.version, fixture.manifest.version);

    const badSignatureRoot = path.join(temporaryRoot, "bad-signature");
    const badSignatureFixture = {
      ...fixture,
      signatureBytes: Buffer.alloc(fixture.signatureBytes.length)
    };
    const badSignatureUpdater = new DomiPluginUpdater({
      marketplaceRoot: badSignatureRoot,
      clientVersion: "0.3.0",
      fetchImpl: fetchFixture(badSignatureFixture, []),
      releaseApiUrl: "https://example.test/latest",
      publicKeyDerBase64: fixture.publicKeyDerBase64
    });
    const rejected = await badSignatureUpdater.check({ force: true });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.reason, "remote-check-failed");
    assert.match(rejected.error, /signature is invalid/);
    assert.equal(rejected.candidate, null);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

run()
  .then(() => console.log("domi plugin updater tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
