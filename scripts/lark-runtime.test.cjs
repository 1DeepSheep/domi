const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  outputRootForArchitecture,
  resolveTargetArchitecture,
  validateSpecification
} = require("./prepare-lark-runtime.cjs");
const {
  resolveBundledLarkRuntime,
  resolveLarkCliForChild
} = require("../electron/lark-runtime.cjs");

test("Lark runtime specification pins both official macOS releases", () => {
  const specification = require("../resources/lark-runtime.json");
  assert.equal(specification.version, "1.0.60");
  assert.equal(specification.license, "MIT");
  assert.equal(validateSpecification(specification, "arm64").sha256,
    "3c9ae7a6f98a13e4f429add6f845f25b4099e9275e56fe0b82b587bad8d633f6");
  assert.equal(validateSpecification(specification, "x64").sha256,
    "5a42a244cd3ae95725514f1f8d264f95a82f99d20f769fc27fdece44b7c38b6d");
});

test("Lark runtime output is architecture-specific", () => {
  assert.equal(resolveTargetArchitecture("arm64"), "arm64");
  assert.equal(resolveTargetArchitecture("x64"), "x64");
  assert.throws(() => resolveTargetArchitecture("universal"), /Unsupported Lark runtime architecture/);
  assert.match(outputRootForArchitecture("arm64"), /build\/lark-runtime-arm64$/);
  assert.match(outputRootForArchitecture("x64"), /build\/lark-runtime-x64$/);
});

test("Lark runtime resolver prefers packaged resources and validates the manifest", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-lark-runtime-test-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const resourcesPath = path.join(temporaryRoot, "Resources");
  const runtimeRoot = path.join(resourcesPath, "lark-runtime");
  fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true });
  fs.writeFileSync(path.join(runtimeRoot, "bin", "lark-cli"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(runtimeRoot, "manifest.json"), JSON.stringify({
    name: "lark-cli",
    version: "1.0.60",
    targetArch: "arm64"
  }));
  const result = resolveBundledLarkRuntime({ resourcesPath, appRoot: temporaryRoot, targetArch: "arm64" });
  assert.equal(result.ok, true);
  assert.equal(result.source, "bundled");
  assert.equal(result.cliPath, path.join(runtimeRoot, "bin", "lark-cli"));
});

test("Lark runtime resolver rejects a symlinked executable", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-lark-runtime-link-test-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const runtimeRoot = path.join(temporaryRoot, "build", "lark-runtime-arm64");
  fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true });
  const target = path.join(temporaryRoot, "lark-cli");
  fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.symlinkSync(target, path.join(runtimeRoot, "bin", "lark-cli"));
  fs.writeFileSync(path.join(runtimeRoot, "manifest.json"), JSON.stringify({
    name: "lark-cli",
    version: "1.0.60",
    targetArch: "arm64"
  }));
  assert.equal(resolveBundledLarkRuntime({ appRoot: temporaryRoot, targetArch: "arm64" }).ok, false);
});

test("Codex child processes receive an absolute verified Lark CLI, preferring the bundled runtime", (t) => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-lark-child-test-"));
  t.after(() => fs.rmSync(temporaryRoot, { recursive: true, force: true }));
  const fallback = path.join(temporaryRoot, "fallback-lark-cli");
  fs.writeFileSync(fallback, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  assert.equal(resolveLarkCliForChild({
    resourcesPath: path.join(temporaryRoot, "missing-resources"),
    appRoot: temporaryRoot,
    targetArch: "arm64",
    fallbackPath: fallback
  }), fallback);

  const resourcesPath = path.join(temporaryRoot, "Resources");
  const runtimeRoot = path.join(resourcesPath, "lark-runtime");
  fs.mkdirSync(path.join(runtimeRoot, "bin"), { recursive: true });
  const bundled = path.join(runtimeRoot, "bin", "lark-cli");
  fs.writeFileSync(bundled, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.writeFileSync(path.join(runtimeRoot, "manifest.json"), JSON.stringify({
    name: "lark-cli",
    version: "1.0.60",
    targetArch: "arm64"
  }));
  assert.equal(resolveLarkCliForChild({
    resourcesPath,
    appRoot: temporaryRoot,
    targetArch: "arm64",
    fallbackPath: fallback
  }), bundled);
});

test("main injects only the non-secret Lark CLI into the long-lived Codex child environment", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  assert.match(source, /LARK_CLI_PATH:\s*larkCliPath/);
  const runtimeFunction = source.slice(source.indexOf("function getCodexRuntime()"), source.indexOf("function getCodexRuntimeManager()"));
  assert.doesNotMatch(runtimeFunction, /DOMI_FEISHU_EXPORT_(?:SOCKET|TOKEN|RUN_ID)/);
});
