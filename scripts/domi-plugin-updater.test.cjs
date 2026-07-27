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
  validateArchiveEntries
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
    "# Domi router\n"
  );
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
    release,
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

  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-plugin-updater-unit-"));
  try {
    const fixture = createReleaseFixture(temporaryRoot);
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
  .then(() => console.log("Domi plugin updater tests passed."))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
