const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.resolve(__dirname, "package-mac.sh"),
  "utf8"
);
const runtimePreparationSource = fs.readFileSync(
  path.resolve(__dirname, "prepare-codex-runtime.cjs"),
  "utf8"
);

const packageStart = source.indexOf('"$BUILDER" --mac dir --arm64');
const notarize = source.indexOf("notarize_release_app", packageStart);
const prepackaged = source.indexOf("--prepackaged", notarize);
const privacyCheck = source.indexOf("verify_release_dmg", prepackaged);

assert(packageStart >= 0, "release must build a signed app before notarization");
assert(notarize > packageStart, "release must notarize the signed app");
assert(prepackaged > notarize, "release artifacts must be rebuilt from the stapled app");
assert(privacyCheck > prepackaged, "release DMG must pass the artifact privacy gate");
assert.match(source, /notarytool submit[\s\S]*--wait/);
assert.match(source, /stapler staple/);
assert.match(source, /stapler validate/);
assert.match(runtimePreparationSource, /APPLE_TIMESTAMP_SERVER/);
assert.match(runtimePreparationSource, /http:\/\/timestamp\.apple\.com\/ts01/);
assert.match(runtimePreparationSource, /`--timestamp=\$\{timestampServer\}`/);
assert.match(runtimePreparationSource, /codesignWithTimestampRetry/);
assert.match(runtimePreparationSource, /\[0, 2_000, 5_000, 10_000\]/);

console.log("release contract tests passed");
