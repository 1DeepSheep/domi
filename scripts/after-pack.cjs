const { execFileSync } = require("node:child_process");
const path = require("node:path");

module.exports = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  execFileSync("/usr/bin/xattr", ["-cr", appPath], { stdio: "inherit" });
};
