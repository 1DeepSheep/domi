const assert = require("node:assert/strict");
const test = require("node:test");

const {
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
