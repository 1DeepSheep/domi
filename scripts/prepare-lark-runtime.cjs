const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const specificationPath = path.join(root, "resources", "lark-runtime.json");

function resolveTargetArchitecture(value = process.env.DOMI_TARGET_ARCH || process.arch) {
  const targetArch = String(value || "").trim();
  if (!new Set(["arm64", "x64"]).has(targetArch)) {
    throw new Error(`Unsupported Lark runtime architecture: ${targetArch || "empty"}.`);
  }
  return targetArch;
}

function outputRootForArchitecture(value) {
  return path.join(root, "build", `lark-runtime-${resolveTargetArchitecture(value)}`);
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function download(url, destination, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error("Too many redirects while downloading Lark CLI."));
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { "User-Agent": "domi-lark-runtime-preparer" }
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, url).toString();
        download(nextUrl, destination, redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Lark CLI download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const file = fs.createWriteStream(destination, { mode: 0o600 });
      response.pipe(file);
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
    });
    request.setTimeout(60_000, () => request.destroy(new Error("Lark CLI download timed out.")));
    request.on("error", reject);
  });
}

function validateSpecification(specification, targetArch) {
  const target = specification?.targets?.[targetArch];
  if (
    specification?.license !== "MIT"
    || !/^\d+\.\d+\.\d+$/.test(String(specification?.version || ""))
    || !target
    || !/^https:\/\/github\.com\/larksuite\/cli\/releases\/download\//.test(String(target.url || ""))
    || !/^[a-f0-9]{64}$/.test(String(target.sha256 || ""))
    || !new Set(["arm64", "x86_64"]).has(target.machoArch)
  ) {
    throw new Error("Lark runtime specification is invalid.");
  }
  return target;
}

function validateArchiveEntries(archivePath) {
  const entries = execFileSync("/usr/bin/tar", ["-tzf", archivePath], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  }).split(/\r?\n/).filter(Boolean);
  if (!entries.includes("lark-cli") || !entries.includes("LICENSE")) {
    throw new Error("Lark CLI archive is missing its executable or license.");
  }
  if (entries.some((entry) => path.isAbsolute(entry) || entry.split("/").includes(".."))) {
    throw new Error("Lark CLI archive contains an unsafe path.");
  }
}

function validateMachO(binaryPath, expectedArch) {
  if (process.platform !== "darwin") {
    throw new Error("The Lark CLI macOS runtime can only be prepared on macOS.");
  }
  const actual = execFileSync("/usr/bin/xcrun", ["lipo", "-archs", binaryPath], {
    encoding: "utf8"
  }).trim();
  if (actual !== expectedArch) {
    throw new Error(`Lark CLI architecture mismatch: expected ${expectedArch}, received ${actual || "unknown"}.`);
  }
}

function installPreparedRuntime(stagingRoot, outputRoot) {
  const preparedRoot = path.join(stagingRoot, "prepared");
  fs.mkdirSync(path.dirname(outputRoot), { recursive: true });
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.renameSync(preparedRoot, outputRoot);
}

async function prepare(options = {}) {
  const targetArch = resolveTargetArchitecture(options.targetArch);
  const specification = JSON.parse(fs.readFileSync(specificationPath, "utf8"));
  const target = validateSpecification(specification, targetArch);
  const outputRoot = outputRootForArchitecture(targetArch);
  const cacheRoot = path.join(
    os.homedir(),
    "Library", "Caches", "com.domi.workbench", "lark-runtime", specification.version
  );
  const archivePath = options.archivePath
    ? path.resolve(options.archivePath)
    : path.join(cacheRoot, path.basename(new URL(target.url).pathname));

  fs.mkdirSync(path.dirname(archivePath), { recursive: true });
  if (!fs.existsSync(archivePath) || sha256(archivePath) !== target.sha256) {
    if (options.archivePath) throw new Error("Provided Lark CLI archive checksum does not match the pinned release.");
    const temporaryArchive = `${archivePath}.download-${process.pid}`;
    await download(target.url, temporaryArchive);
    if (sha256(temporaryArchive) !== target.sha256) {
      fs.rmSync(temporaryArchive, { force: true });
      throw new Error("Downloaded Lark CLI archive checksum does not match the pinned release.");
    }
    fs.renameSync(temporaryArchive, archivePath);
  }

  validateArchiveEntries(archivePath);
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-lark-runtime-"));
  const extractedRoot = path.join(stagingRoot, "extracted");
  const preparedRoot = path.join(stagingRoot, "prepared");
  fs.mkdirSync(extractedRoot, { recursive: true });
  execFileSync("/usr/bin/tar", ["-xzf", archivePath, "-C", extractedRoot, "lark-cli", "LICENSE"]);

  const extractedBinary = path.join(extractedRoot, "lark-cli");
  const extractedLicense = path.join(extractedRoot, "LICENSE");
  if (fs.lstatSync(extractedBinary).isSymbolicLink() || fs.lstatSync(extractedLicense).isSymbolicLink()) {
    throw new Error("Lark CLI archive entries must be regular files.");
  }
  fs.chmodSync(extractedBinary, 0o755);
  validateMachO(extractedBinary, target.machoArch);
  const licenseText = fs.readFileSync(extractedLicense, "utf8");
  if (!licenseText.startsWith("MIT License") || !licenseText.includes(specification.copyright)) {
    throw new Error("Lark CLI archive license does not match the pinned MIT notice.");
  }

  fs.mkdirSync(path.join(preparedRoot, "bin"), { recursive: true });
  fs.copyFileSync(extractedBinary, path.join(preparedRoot, "bin", "lark-cli"));
  fs.chmodSync(path.join(preparedRoot, "bin", "lark-cli"), 0o755);
  fs.copyFileSync(extractedLicense, path.join(preparedRoot, "LICENSE"));
  const manifest = {
    name: "lark-cli",
    version: specification.version,
    targetArch,
    target: target.target,
    license: specification.license,
    source: specification.source,
    upstreamUrl: target.url,
    upstreamSha256: target.sha256,
    binarySha256: sha256(path.join(preparedRoot, "bin", "lark-cli"))
  };
  fs.writeFileSync(path.join(preparedRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, {
    mode: 0o644
  });
  installPreparedRuntime(stagingRoot, outputRoot);
  console.log(`Prepared Lark CLI ${specification.version} for ${targetArch} at ${outputRoot}.`);
  return { outputRoot, manifest };
}

if (require.main === module) {
  prepare().catch((error) => {
    console.error(`Lark runtime preparation failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  outputRootForArchitecture,
  prepare,
  resolveTargetArchitecture,
  sha256,
  validateArchiveEntries,
  validateMachO,
  validateSpecification
};
