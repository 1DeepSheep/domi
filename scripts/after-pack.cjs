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

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  writeAppUpdateConfig(appPath);
  execFileSync("/usr/bin/xattr", ["-cr", appPath], { stdio: "inherit" });
};

module.exports.writeAppUpdateConfig = writeAppUpdateConfig;
