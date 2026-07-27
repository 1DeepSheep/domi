const fs = require("node:fs");
const path = require("node:path");

const PRODUCT_NAME = "domi";

function legacyProductName() {
  return String.fromCodePoint(0x8c46, 0x7c73);
}

function migrateBrandDirectory(sourcePath, destinationPath, fileSystem = fs) {
  if (!fileSystem.existsSync(sourcePath) || sourcePath === destinationPath) {
    return { path: destinationPath, migrated: false, copied: false };
  }
  try {
    if (!fileSystem.existsSync(destinationPath)) {
      fileSystem.mkdirSync(path.dirname(destinationPath), { recursive: true });
      try {
        fileSystem.renameSync(sourcePath, destinationPath);
        return { path: destinationPath, migrated: true, copied: false };
      } catch {
        fileSystem.cpSync(sourcePath, destinationPath, {
          recursive: true,
          force: false,
          errorOnExist: false
        });
        return { path: destinationPath, migrated: true, copied: true };
      }
    }
    fileSystem.cpSync(sourcePath, destinationPath, {
      recursive: true,
      force: false,
      errorOnExist: false
    });
    return { path: destinationPath, migrated: true, copied: true };
  } catch (error) {
    return {
      path: sourcePath,
      migrated: false,
      copied: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function prepareApplicationBrandPaths(app, options = {}) {
  const fileSystem = options.fileSystem || fs;
  const applicationSupport = app.getPath("appData");
  const documents = app.getPath("documents");
  const legacyName = legacyProductName();
  const developmentSuffix = app.isPackaged ? "" : "开发工作区";
  const userData = migrateBrandDirectory(
    path.join(applicationSupport, legacyName),
    path.join(applicationSupport, PRODUCT_NAME),
    fileSystem
  );
  const workspace = migrateBrandDirectory(
    path.join(documents, `${legacyName}${developmentSuffix}`),
    path.join(documents, `${PRODUCT_NAME}${developmentSuffix}`),
    fileSystem
  );

  app.setName(PRODUCT_NAME);
  app.setPath("userData", userData.path);

  return {
    appName: PRODUCT_NAME,
    userDataPath: userData.path,
    workspacePath: workspace.path,
    userDataMigration: userData,
    workspaceMigration: workspace
  };
}

module.exports = {
  PRODUCT_NAME,
  legacyProductName,
  migrateBrandDirectory,
  prepareApplicationBrandPaths
};
