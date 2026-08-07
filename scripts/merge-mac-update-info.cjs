const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SUPPORTED_ARCHES = Object.freeze(["x64", "arm64"]);
const SUPPORTED_EXTENSIONS = Object.freeze(["zip", "dmg"]);

function sha512File(filePath) {
  const hash = crypto.createHash("sha512");
  const input = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(input, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(input);
  }
  return hash.digest("base64");
}

function normalizedVersion(value) {
  const version = String(value || "").trim();
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`Invalid release version: ${version || "missing"}`);
  }
  return version;
}

function normalizedReleaseDate(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid release date: ${value}`);
  }
  return date.toISOString();
}

function requiredArtifactNames(version) {
  return SUPPORTED_EXTENSIONS.flatMap((extension) =>
    SUPPORTED_ARCHES.map((arch) => `domi-${version}-${arch}.${extension}`)
  );
}

function regularFile(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      throw new Error(`Required release artifact is missing: ${path.basename(filePath)}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0) {
    throw new Error(`Release artifact must be a non-empty regular file: ${path.basename(filePath)}`);
  }
  return stat;
}

function collectReleaseFiles(inputDirectory, version) {
  const files = [];
  for (const name of requiredArtifactNames(version)) {
    const filePath = path.join(inputDirectory, name);
    const stat = regularFile(filePath);
    regularFile(`${filePath}.blockmap`);
    files.push({
      url: name,
      sha512: sha512File(filePath),
      size: stat.size
    });
  }
  return files;
}

function serializeUpdateInfo({ version, files, releaseDate }) {
  const preferredPath = `domi-${version}-x64.zip`;
  const preferred = files.find((file) => file.url === preferredPath);
  if (!preferred) throw new Error(`Preferred x64 ZIP is missing: ${preferredPath}`);
  return [
    `version: ${version}`,
    "files:",
    ...files.flatMap((file) => [
      `  - url: ${file.url}`,
      `    sha512: ${file.sha512}`,
      `    size: ${file.size}`
    ]),
    `path: ${preferred.url}`,
    `sha512: ${preferred.sha512}`,
    `releaseDate: '${releaseDate}'`,
    ""
  ].join("\n");
}

function mergeMacUpdateInfo({ inputDirectory, outputPath, version, releaseDate } = {}) {
  const normalizedInput = path.resolve(String(inputDirectory || ""));
  const normalizedOutput = path.resolve(
    String(outputPath || path.join(normalizedInput, "latest-mac.yml"))
  );
  const normalized = normalizedVersion(version);
  const normalizedDate = normalizedReleaseDate(releaseDate);
  const files = collectReleaseFiles(normalizedInput, normalized);
  const content = serializeUpdateInfo({
    version: normalized,
    files,
    releaseDate: normalizedDate
  });
  fs.mkdirSync(path.dirname(normalizedOutput), { recursive: true });
  const temporaryPath = `${normalizedOutput}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(temporaryPath, content, { encoding: "utf8", mode: 0o644 });
    fs.renameSync(temporaryPath, normalizedOutput);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  return { files, outputPath: normalizedOutput, releaseDate: normalizedDate, version: normalized };
}

function parseArguments(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!["--input", "--output", "--version", "--release-date"].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${argument}`);
    index += 1;
    if (argument === "--input") result.inputDirectory = value;
    if (argument === "--output") result.outputPath = value;
    if (argument === "--version") result.version = value;
    if (argument === "--release-date") result.releaseDate = value;
  }
  if (!result.inputDirectory) throw new Error("--input is required");
  if (!result.version) throw new Error("--version is required");
  return result;
}

if (require.main === module) {
  try {
    const result = mergeMacUpdateInfo(parseArguments(process.argv.slice(2)));
    console.log(
      `Merged ${result.files.length} macOS update artifacts into ${result.outputPath}.`
    );
  } catch (error) {
    console.error(`macOS update metadata merge failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  collectReleaseFiles,
  mergeMacUpdateInfo,
  normalizedReleaseDate,
  normalizedVersion,
  requiredArtifactNames,
  serializeUpdateInfo,
  sha512File
};
