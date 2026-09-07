const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

function writeAppUpdateConfig(appPath) {
  const resourcesPath = path.join(appPath, "Contents", "Resources");
  fs.mkdirSync(resourcesPath, { recursive: true });
  fs.writeFileSync(
    path.join(resourcesPath, "app-update.yml"),
    [
      "provider: github",
      "owner: 1DeepSheep",
      "repo: domi",
      "updaterCacheDirName: domi-updater",
      ""
    ].join("\n"),
    "utf8"
  );
}

function cleanSigningMetadata(appPath, appOutDir) {
  const output = fs.realpathSync(appOutDir);
  const app = fs.lstatSync(appPath);
  if (app.isSymbolicLink() || !app.isDirectory() || !appPath.endsWith(".app")
    || path.dirname(fs.realpathSync(appPath)) !== output) {
    throw new Error("Signing metadata cleanup requires a staged .app directly inside appOutDir.");
  }
  // Remove only the two attributes rejected by codesign. Preserve quarantine,
  // provenance and all unrelated attributes. -s operates on symlinks themselves
  // so a framework/resource link cannot clean files outside the staged app.
  for (const attribute of ["com.apple.FinderInfo", "com.apple.ResourceFork"]) {
    execFileSync("/usr/bin/xattr", ["-drs", attribute, appPath], { stdio: "inherit" });
  }
}

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appOutDir = path.resolve(context.appOutDir);
  const appPath = path.join(
    appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  writeAppUpdateConfig(appPath);
  cleanSigningMetadata(appPath, appOutDir);
};

module.exports.writeAppUpdateConfig = writeAppUpdateConfig;
module.exports.cleanSigningMetadata = cleanSigningMetadata;
