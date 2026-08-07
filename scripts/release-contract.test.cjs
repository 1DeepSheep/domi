const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const packageMacPath = path.resolve(__dirname, "package-mac.sh");
const source = fs.readFileSync(packageMacPath, "utf8");
const mergeSource = fs.readFileSync(
  path.resolve(__dirname, "merge-mac-update-info.cjs"),
  "utf8"
);
const runtimePreparationSource = fs.readFileSync(
  path.resolve(__dirname, "prepare-codex-runtime.cjs"),
  "utf8"
);
const afterPackSource = fs.readFileSync(
  path.resolve(__dirname, "after-pack.cjs"),
  "utf8"
);
const updateServiceSource = fs.readFileSync(
  path.resolve(__dirname, "..", "electron", "update-service.cjs"),
  "utf8"
);
const packageJson = require("../package.json");
const packageLock = require("../package-lock.json");

execFileSync("/bin/bash", ["-n", packageMacPath]);

const distCase = source.indexOf("  dist)");
const buildLoop = source.indexOf('build_app_for_arch "$arch"', distCase);
const notaryLoop = source.indexOf('notarize_release_app "$arch"', buildLoop);
const finishRelease = source.indexOf("finish_release", notaryLoop);
const finishFunction = /finish_release\(\) \{([\s\S]*?)\n\}/.exec(source)?.[1] || "";
const packageRelease = finishFunction.indexOf('package_release_arch "$arch"');
const privacyCheck = finishFunction.indexOf('verify_release_artifacts "$arch"', packageRelease);
const metadataMerge = finishFunction.indexOf("merge_release_metadata", privacyCheck);

assert(distCase >= 0, "release must define a dist mode");
assert(buildLoop > distCase, "release must build each architecture before notarization");
assert(notaryLoop > buildLoop, "release must notarize each signed architecture");
assert(finishRelease > notaryLoop, "release artifacts must be built from stapled apps");
assert(packageRelease >= 0, "release must package each prepackaged app");
assert(privacyCheck > packageRelease, "each release DMG must pass the artifact privacy gate");
assert(metadataMerge > privacyCheck, "multi-arch metadata must be merged after artifact validation");

assert.match(source, /RELEASE_ARCHES=\(arm64 x64\)/);
assert.match(source, /DOMI_ELECTRON_DIST_ARM64/);
assert.match(source, /DOMI_ELECTRON_DIST_X64/);
assert.match(source, /Using electron-builder's verified official Electron download for \$arch/);
assert.match(source, /verify_electron_dist "\$electron_dist" "\$arch"/);
assert.match(source, /xcrun lipo -archs/);
assert.match(source, /Codex runtime target mismatch/);
assert.match(source, /Media runtime target mismatch/);
assert.match(source, /codesign --verify --deep --strict/);
assert.match(source, /Authority=Developer ID Application:/);
assert.match(source, /notarytool submit[\s\S]*--wait/);
assert.match(source, /domi-\$PACKAGE_VERSION-\$arch-notary\.zip/);
assert.match(source, /stapler staple/);
assert.match(source, /stapler validate/);
assert.match(source, /--mac dmg zip "--\$arch" --prepackaged "\$app_path"/);
assert.match(source, /domi-\$PACKAGE_VERSION-\$arch\.\$extension\.blockmap/);
assert.match(source, /merge-mac-update-info\.cjs/);
assert.match(source, /DOMI_MAC_DIR_ARCH/);
assert.match(source, /resume\)[\s\S]*verify_packaged_app[\s\S]*staple_existing_app[\s\S]*finish_release/);

assert.match(mergeSource, /SUPPORTED_ARCHES = Object\.freeze\(\["x64", "arm64"\]\)/);
assert.match(mergeSource, /SUPPORTED_EXTENSIONS = Object\.freeze\(\["zip", "dmg"\]\)/);
assert.match(mergeSource, /regularFile\(`\$\{filePath\}\.blockmap`\)/);
assert.match(mergeSource, /createHash\("sha512"\)/);
assert.match(mergeSource, /path: \$\{preferred\.url\}/);

assert.match(packageJson.version, /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[""].version, packageJson.version);
assert.equal(packageJson.build.artifactName, "domi-${version}-${arch}.${ext}");
const codexResource = packageJson.build.extraResources.find((item) => item.to === "codex-runtime");
const mediaResource = packageJson.build.extraResources.find((item) => item.to === "media-runtime");
assert.equal(codexResource.from, "build/codex-runtime-${arch}");
assert.equal(mediaResource.from, "build/media-runtime-${arch}");
assert.match(packageJson.scripts["dist:mac"], /DOMI_TARGET_ARCH=arm64/);
assert.match(packageJson.scripts["dist:mac"], /DOMI_TARGET_ARCH=x64/);
assert.match(packageJson.scripts.check, /merge-mac-update-info\.test\.cjs/);

assert.match(afterPackSource, /app-update\.yml/);
assert.match(afterPackSource, /provider: github/);
assert.match(afterPackSource, /owner: 1DeepSheep/);
assert.match(afterPackSource, /repo: domi/);
assert.match(updateServiceSource, /this\.updater\.setFeedURL\(PUBLIC_UPDATE_FEED\)/);
assert.match(runtimePreparationSource, /APPLE_TIMESTAMP_SERVER/);
assert.match(runtimePreparationSource, /http:\/\/timestamp\.apple\.com\/ts01/);
assert.match(runtimePreparationSource, /`--timestamp=\$\{timestampServer\}`/);
assert.match(runtimePreparationSource, /codesignWithTimestampRetry/);
assert.match(runtimePreparationSource, /\[0, 2_000, 5_000, 10_000\]/);

console.log("release contract tests passed");
