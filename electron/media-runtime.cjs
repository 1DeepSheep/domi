const fs = require("node:fs");
const path = require("node:path");

function executableFile(filePath) {
  if (!filePath) return false;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveMediaRuntime(options = {}) {
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || "").trim();
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, ".."));
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "media-runtime", "bin") : "",
    path.join(appRoot, "build", "media-runtime", "bin")
  ].filter(Boolean);
  for (const binDirectory of candidates) {
    const ffmpegPath = path.join(binDirectory, "ffmpeg");
    const ffprobePath = path.join(binDirectory, "ffprobe");
    if (executableFile(ffmpegPath) && executableFile(ffprobePath)) {
      return {
        ok: true,
        source: binDirectory.includes(`${path.sep}Resources${path.sep}`)
          ? "bundled"
          : "development",
        binDirectory,
        ffmpegPath,
        ffprobePath
      };
    }
  }
  return {
    ok: false,
    source: "system",
    binDirectory: "",
    ffmpegPath: "",
    ffprobePath: ""
  };
}

function withMediaRuntimeEnvironment(runtime = {}, options = {}) {
  const mediaRuntime = options.mediaRuntime || resolveMediaRuntime(options);
  return {
    ...runtime,
    env: {
      ...(runtime.env || {}),
      ...(mediaRuntime.ffmpegPath
        ? { DOMI_FFMPEG_PATH: mediaRuntime.ffmpegPath }
        : {}),
      ...(mediaRuntime.ffprobePath
        ? { DOMI_FFPROBE_PATH: mediaRuntime.ffprobePath }
        : {})
    }
  };
}

module.exports = {
  executableFile,
  resolveMediaRuntime,
  withMediaRuntimeEnvironment
};
