const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { load } = require("js-yaml");
const { MacUpdater } = require("electron-updater/out/MacUpdater.js");
const {
  mergeMacUpdateInfo,
  requiredArtifactNames
} = require("./merge-mac-update-info.cjs");

const VERSION = "9.8.7";
const RELEASE_DATE = "2026-08-07T12:34:56.000Z";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-mac-update-info-"));
  for (const name of requiredArtifactNames(VERSION)) {
    fs.writeFileSync(path.join(root, name), `artifact:${name}\n`, "utf8");
    fs.writeFileSync(path.join(root, `${name}.blockmap`), `blockmap:${name}\n`, "utf8");
  }
  return root;
}

function sha512(content) {
  return crypto.createHash("sha512").update(content).digest("base64");
}

test("merged mac update metadata contains both architectures and both targets", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "latest-mac.yml");

  const result = mergeMacUpdateInfo({
    inputDirectory: root,
    outputPath,
    releaseDate: RELEASE_DATE,
    version: VERSION
  });

  assert.equal(result.files.length, 4);
  const updateInfo = load(fs.readFileSync(outputPath, "utf8"));
  assert.equal(updateInfo.version, VERSION);
  assert.equal(updateInfo.releaseDate, RELEASE_DATE);
  assert.equal(updateInfo.path, `domi-${VERSION}-x64.zip`);
  assert.deepEqual(
    updateInfo.files.map((file) => file.url),
    [
      `domi-${VERSION}-x64.zip`,
      `domi-${VERSION}-arm64.zip`,
      `domi-${VERSION}-x64.dmg`,
      `domi-${VERSION}-arm64.dmg`
    ]
  );
  for (const file of updateInfo.files) {
    const bytes = fs.readFileSync(path.join(root, file.url));
    assert.equal(file.size, bytes.length);
    assert.equal(file.sha512, sha512(bytes));
  }
  assert.equal(updateInfo.sha512, updateInfo.files[0].sha512);
});

test("current MacUpdater selects only the matching architecture", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "latest-mac.yml");
  mergeMacUpdateInfo({
    inputDirectory: root,
    outputPath,
    releaseDate: RELEASE_DATE,
    version: VERSION
  });
  const updateInfo = load(fs.readFileSync(outputPath, "utf8"));
  const files = updateInfo.files.map((info) => ({
    info,
    url: new URL(`https://example.invalid/${info.url}`)
  }));

  assert.deepEqual(
    MacUpdater.filterFilesForArch(files, false).map((file) => file.info.url),
    [`domi-${VERSION}-x64.zip`, `domi-${VERSION}-x64.dmg`]
  );
  assert.deepEqual(
    MacUpdater.filterFilesForArch(files, true).map((file) => file.info.url),
    [`domi-${VERSION}-arm64.zip`, `domi-${VERSION}-arm64.dmg`]
  );
});

test("missing blockmaps fail before replacing existing metadata", (t) => {
  const root = fixture();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const outputPath = path.join(root, "latest-mac.yml");
  fs.writeFileSync(outputPath, "previous metadata\n", "utf8");
  fs.rmSync(path.join(root, `domi-${VERSION}-x64.zip.blockmap`));

  assert.throws(
    () => mergeMacUpdateInfo({ inputDirectory: root, outputPath, version: VERSION }),
    /Required release artifact is missing: domi-9\.8\.7-x64\.zip\.blockmap/
  );
  assert.equal(fs.readFileSync(outputPath, "utf8"), "previous metadata\n");
});

test("invalid versions are rejected before reading release artifacts", () => {
  assert.throws(
    () => mergeMacUpdateInfo({ inputDirectory: "/tmp", version: "../0.6.21" }),
    /Invalid release version/
  );
});
