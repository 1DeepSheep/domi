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

function readManifest(manifestPath, targetArch) {
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest?.name !== "lark-cli" || manifest?.targetArch !== targetArch) return null;
    if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version || ""))) return null;
    return manifest;
  } catch {
    return null;
  }
}

function resolveBundledLarkRuntime(options = {}) {
  const resourcesPath = String(options.resourcesPath || process.resourcesPath || "").trim();
  const appRoot = path.resolve(options.appRoot || path.join(__dirname, ".."));
  const targetArch = String(options.targetArch || process.arch || "").trim();
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "lark-runtime") : "",
    path.join(appRoot, "build", `lark-runtime-${targetArch}`),
    path.join(appRoot, "build", "lark-runtime")
  ].filter(Boolean);

  for (const runtimeRoot of candidates) {
    const cliPath = path.join(runtimeRoot, "bin", "lark-cli");
    const manifestPath = path.join(runtimeRoot, "manifest.json");
    const manifest = readManifest(manifestPath, targetArch);
    if (!manifest || !executableFile(cliPath)) continue;
    return {
      ok: true,
      source: resourcesPath && path.resolve(runtimeRoot).startsWith(path.resolve(resourcesPath))
        ? "bundled"
        : "development",
      runtimeRoot,
      cliPath,
      manifest
    };
  }

  return {
    ok: false,
    source: "unavailable",
    runtimeRoot: "",
    cliPath: "",
    manifest: null
  };
}

function resolveLarkCliForChild(options = {}) {
  const bundled = resolveBundledLarkRuntime(options);
  if (bundled.ok) return bundled.cliPath;
  const fallbackPath = String(options.fallbackPath || "").trim();
  return executableFile(fallbackPath) ? path.resolve(fallbackPath) : "";
}

module.exports = {
  executableFile,
  readManifest,
  resolveBundledLarkRuntime,
  resolveLarkCliForChild
};
