const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  resolveMediaRuntime,
  withMediaRuntimeEnvironment
} = require("../electron/media-runtime.cjs");
const {
  deriveSpecification,
  buildCacheDirectory,
  outputRootForArchitecture,
  resolveTargetArchitecture,
  validateBinary,
  validateSpecification
} = require("./prepare-media-runtime.cjs");

test("media runtime specification is pinned to a redistributable LGPL build", () => {
  const specification = require("../resources/media-runtime.json");
  assert.doesNotThrow(() => validateSpecification(specification));
  assert.equal(specification.sourceUrl.startsWith("https://ffmpeg.org/releases/"), true);
  assert.equal(specification.deploymentTarget, "12.0");
  assert.equal(
    specification.configureFlags.includes("--extra-cflags=-mmacosx-version-min=12.0"),
    true
  );
  assert.equal(
    specification.configureFlags.includes("--extra-ldflags=-mmacosx-version-min=12.0"),
    true
  );
  assert.equal(specification.configureFlags.includes("--disable-network"), true);
  assert.equal(
    specification.configureFlags.some((flag) => /--enable-(?:gpl|nonfree)\b/.test(flag)),
    false
  );
});

test("media runtime specification derives a pinned Intel build without mutating arm64", () => {
  const arm64 = require("../resources/media-runtime.json");
  const x64 = deriveSpecification(arm64, "x64");
  assert.doesNotThrow(() => validateSpecification(x64));
  assert.equal(arm64.targetArch, "arm64");
  assert.equal(arm64.configureFlags.includes("--arch=arm64"), true);
  assert.equal(x64.targetArch, "x64");
  assert.equal(x64.configureFlags.includes("--arch=x86_64"), true);
  assert.equal(x64.configureFlags.includes("--cc=/usr/bin/clang -arch x86_64"), true);
  assert.equal(x64.configureFlags.includes("--disable-x86asm"), true);
  assert.equal(x64.configureFlags.includes("--arch=arm64"), false);
});

test("media runtime target architecture and output directories are explicit", () => {
  assert.equal(resolveTargetArchitecture("arm64"), "arm64");
  assert.equal(resolveTargetArchitecture("x64"), "x64");
  assert.throws(() => resolveTargetArchitecture("universal"), /Unsupported media runtime architecture/);
  assert.match(outputRootForArchitecture("arm64"), /build\/media-runtime-arm64$/);
  assert.match(outputRootForArchitecture("x64"), /build\/media-runtime-x64$/);
});

test("media runtime cache identity includes the deployment target", () => {
  const specification = require("../resources/media-runtime.json");
  const current = buildCacheDirectory(specification).cacheDirectory;
  const changed = buildCacheDirectory({
    ...specification,
    deploymentTarget: "13.0"
  }).cacheDirectory;
  assert.notEqual(current, changed);
});

test("prepared media binaries must be thin Mach-O files for the requested architecture", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-media-binary-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binaryPath = path.join(root, "ffmpeg");
  fs.writeFileSync(binaryPath, Buffer.alloc(600_000), { mode: 0o755 });
  const specification = deriveSpecification(require("../resources/media-runtime.json"), "x64");
  const versionOutput = [
    `ffmpeg version ${specification.version}`,
    "configuration: --disable-network --enable-static"
  ].join("\n");
  const result = validateBinary(binaryPath, "ffmpeg", specification, {
    commandOutput: () => versionOutput,
    inspectMachOArchitectures: () => ["x86_64"],
    inspectMacOSMinimumVersion: () => "12.0"
  });
  assert.equal(result.architecture, "x86_64");
  assert.equal(result.minimumMacOSVersion, "12.0");
  assert.throws(() => validateBinary(binaryPath, "ffmpeg", specification, {
    commandOutput: () => versionOutput,
    inspectMachOArchitectures: () => ["arm64"],
    inspectMacOSMinimumVersion: () => "12.0"
  }), /architecture mismatch/);
  assert.throws(() => validateBinary(binaryPath, "ffmpeg", specification, {
    commandOutput: () => versionOutput,
    inspectMachOArchitectures: () => ["x86_64", "arm64"],
    inspectMacOSMinimumVersion: () => "12.0"
  }), /architecture mismatch/);
  assert.throws(() => validateBinary(binaryPath, "ffmpeg", specification, {
    commandOutput: () => versionOutput,
    inspectMachOArchitectures: () => ["x86_64"],
    inspectMacOSMinimumVersion: () => "15.4"
  }), /requires macOS 15\.4/);
});

test("media runtime resolver prefers the packaged resource binaries", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-media-runtime-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const resourcesPath = path.join(root, "domi.app", "Contents", "Resources");
  const binDirectory = path.join(resourcesPath, "media-runtime", "bin");
  fs.mkdirSync(binDirectory, { recursive: true });
  for (const name of ["ffmpeg", "ffprobe"]) {
    fs.writeFileSync(path.join(binDirectory, name), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  }
  const result = resolveMediaRuntime({
    resourcesPath,
    appRoot: path.join(root, "source")
  });
  assert.equal(result.ok, true);
  assert.equal(result.source, "bundled");
  assert.equal(result.ffmpegPath, path.join(binDirectory, "ffmpeg"));
  assert.equal(result.ffprobePath, path.join(binDirectory, "ffprobe"));
});

test("media runtime resolver rejects symlinked executables", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-media-runtime-link-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binDirectory = path.join(root, "build", "media-runtime", "bin");
  fs.mkdirSync(binDirectory, { recursive: true });
  const target = path.join(root, "tool");
  fs.writeFileSync(target, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  fs.symlinkSync(target, path.join(binDirectory, "ffmpeg"));
  fs.symlinkSync(target, path.join(binDirectory, "ffprobe"));
  const result = resolveMediaRuntime({ resourcesPath: "", appRoot: root });
  assert.equal(result.ok, false);
});

test("Codex child processes inherit the bundled media runtime without losing private config", () => {
  const runtime = withMediaRuntimeEnvironment({
    codexPath: "/opt/domi/codex",
    env: {
      DOMI_CONFIG_PATH: "/private/domi/config.json"
    }
  }, {
    mediaRuntime: {
      ffmpegPath: "/Applications/domi.app/Contents/Resources/media-runtime/bin/ffmpeg",
      ffprobePath: "/Applications/domi.app/Contents/Resources/media-runtime/bin/ffprobe"
    }
  });
  assert.deepEqual(runtime, {
    codexPath: "/opt/domi/codex",
    env: {
      DOMI_CONFIG_PATH: "/private/domi/config.json",
      DOMI_FFMPEG_PATH: "/Applications/domi.app/Contents/Resources/media-runtime/bin/ffmpeg",
      DOMI_FFPROBE_PATH: "/Applications/domi.app/Contents/Resources/media-runtime/bin/ffprobe"
    }
  });
});
