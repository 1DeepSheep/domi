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
  validateSpecification
} = require("./prepare-media-runtime.cjs");

test("media runtime specification is pinned to a redistributable LGPL build", () => {
  const specification = require("../resources/media-runtime.json");
  assert.doesNotThrow(() => validateSpecification(specification));
  assert.equal(specification.sourceUrl.startsWith("https://ffmpeg.org/releases/"), true);
  assert.equal(specification.configureFlags.includes("--disable-network"), true);
  assert.equal(
    specification.configureFlags.some((flag) => /--enable-(?:gpl|nonfree)\b/.test(flag)),
    false
  );
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
