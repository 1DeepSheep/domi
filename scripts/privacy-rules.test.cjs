const assert = require("node:assert/strict");
const test = require("node:test");

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
