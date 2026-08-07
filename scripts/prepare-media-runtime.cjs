const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const specificationPath = path.join(root, "resources", "media-runtime.json");
const SUPPORTED_TARGET_ARCHITECTURES = new Set(["arm64", "x64"]);
const REQUIRED_DEPLOYMENT_TARGET = "12.0";

function resolveTargetArchitecture(value = process.env.DOMI_TARGET_ARCH || process.arch) {
  const targetArch = String(value || process.arch).trim().toLowerCase();
  if (!SUPPORTED_TARGET_ARCHITECTURES.has(targetArch)) {
    throw new Error(
      `Unsupported media runtime architecture: ${targetArch || "empty"}. `
      + "Expected DOMI_TARGET_ARCH=arm64 or DOMI_TARGET_ARCH=x64."
    );
  }
  return targetArch;
}

function outputRootForArchitecture(targetArch) {
  return path.join(root, "build", `media-runtime-${resolveTargetArchitecture(targetArch)}`);
}

function expectedMachOArchitecture(specification) {
  return specification.targetArch === "x64" ? "x86_64" : "arm64";
}

function deriveSpecification(baseSpecification, targetArch) {
  const normalizedArch = resolveTargetArchitecture(targetArch);
  const flags = Array.isArray(baseSpecification?.configureFlags)
    ? [...baseSpecification.configureFlags]
    : [];
  if (normalizedArch === "arm64") {
    return {
      ...baseSpecification,
      targetArch: "arm64",
      configureFlags: flags
    };
  }

  const x64Flags = flags.map((flag) => {
    if (flag === "--arch=arm64") return "--arch=x86_64";
    if (flag === "--cc=/usr/bin/clang") return "--cc=/usr/bin/clang -arch x86_64";
    return flag;
  });
  if (!x64Flags.includes("--disable-x86asm")) x64Flags.push("--disable-x86asm");
  return {
    ...baseSpecification,
    targetArch: "x64",
    configureFlags: x64Flags
  };
}

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  const descriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(descriptor);
  }
  return hash.digest("hex");
}

function validateSpecification(value) {
  const flags = Array.isArray(value?.configureFlags) ? value.configureFlags : [];
  const expectedArchitectureFlag = value?.targetArch === "x64"
    ? "--arch=x86_64"
    : "--arch=arm64";
  const expectedCompilerFlag = value?.targetArch === "x64"
    ? "--cc=/usr/bin/clang -arch x86_64"
    : "--cc=/usr/bin/clang";
  if (
    value?.schemaVersion !== 1
    || value.name !== "FFmpeg"
    || !/^\d+\.\d+\.\d+$/.test(String(value.version || ""))
    || value.targetPlatform !== "darwin"
    || !SUPPORTED_TARGET_ARCHITECTURES.has(value.targetArch)
    || value.deploymentTarget !== REQUIRED_DEPLOYMENT_TARGET
    || value.sourceUrl !== `https://ffmpeg.org/releases/ffmpeg-${value.version}.tar.xz`
    || !/^[a-f0-9]{64}$/.test(String(value.sourceSha256 || ""))
    || !Number.isSafeInteger(value.sourceSize)
    || value.sourceSize < 5 * 1024 * 1024
    || value.sourceSize > 40 * 1024 * 1024
    || value.license !== "LGPL-2.1-or-later"
    || flags.length < 10
    || !flags.includes("--disable-everything")
    || !flags.includes("--disable-shared")
    || !flags.includes("--enable-static")
    || !flags.includes("--disable-network")
    || !flags.includes("--enable-ffmpeg")
    || !flags.includes("--enable-ffprobe")
    || !flags.includes("--enable-encoder=opus")
    || !flags.includes(expectedArchitectureFlag)
    || !flags.includes(expectedCompilerFlag)
    || !flags.includes(`--extra-cflags=-mmacosx-version-min=${value.deploymentTarget}`)
    || !flags.includes(`--extra-ldflags=-mmacosx-version-min=${value.deploymentTarget}`)
    || (value.targetArch === "x64" && !flags.includes("--disable-x86asm"))
    || flags.some((flag) => /--enable-(?:gpl|nonfree)\b/.test(flag))
  ) {
    throw new Error("Media runtime specification is invalid or not redistributable.");
  }
  return value;
}

function archiveMatches(filePath, specification) {
  return fs.existsSync(filePath)
    && fs.statSync(filePath).size === specification.sourceSize
    && sha256File(filePath) === specification.sourceSha256;
}

function download(url, destination) {
  execFileSync("/usr/bin/curl", [
    "--fail",
    "--location",
    "--show-error",
    "--silent",
    "--connect-timeout",
    "20",
    "--max-time",
    "900",
    "--retry",
    "3",
    "--retry-all-errors",
    "--output",
    destination,
    url
  ], {
    env: process.env,
    stdio: "inherit",
    timeout: 920_000
  });
}

function commandOutput(binary, args) {
  return execFileSync(binary, args, {
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C" },
    timeout: 30_000
  });
}

function inspectMachOArchitectures(binaryPath) {
  const output = commandOutput("/usr/bin/lipo", ["-archs", binaryPath]).trim();
  const architectures = output.split(/\s+/).filter(Boolean);
  if (!architectures.length) {
    throw new Error(`Prepared binary is not a readable Mach-O file: ${binaryPath}`);
  }
  return architectures;
}

function compareVersions(left, right) {
  const leftParts = String(left || "").split(".").map((part) => Number(part) || 0);
  const rightParts = String(right || "").split(".").map((part) => Number(part) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function inspectMacOSMinimumVersion(binaryPath) {
  const output = commandOutput("/usr/bin/otool", ["-l", binaryPath]);
  const versions = [];
  let loadCommand = "";
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    const commandMatch = line.match(/^cmd\s+(LC_[A-Z0-9_]+)$/);
    if (commandMatch) {
      loadCommand = commandMatch[1];
      continue;
    }
    if (loadCommand === "LC_BUILD_VERSION") {
      const match = line.match(/^minos\s+(\d+(?:\.\d+){1,2})$/);
      if (match) versions.push(match[1]);
    } else if (loadCommand === "LC_VERSION_MIN_MACOSX") {
      const match = line.match(/^version\s+(\d+(?:\.\d+){1,2})$/);
      if (match) versions.push(match[1]);
    }
  }
  if (versions.length !== 1) {
    throw new Error(
      `Prepared binary must declare exactly one macOS deployment target: ${binaryPath}`
    );
  }
  return versions[0];
}

function validateBinary(binaryPath, name, specification, options = {}) {
  if (!fs.existsSync(binaryPath)) throw new Error(`Prepared ${name} binary is missing.`);
  fs.chmodSync(binaryPath, 0o755);
  const runCommand = options.commandOutput || commandOutput;
  const inspectArchitectures = options.inspectMachOArchitectures || inspectMachOArchitectures;
  const inspectMinimumVersion = options.inspectMacOSMinimumVersion || inspectMacOSMinimumVersion;
  const output = runCommand(binaryPath, ["-version"]);
  if (
    !output.startsWith(`${name} version ${specification.version}`)
    || /--enable-(?:gpl|nonfree)\b/.test(output)
    || !output.includes("--disable-network")
    || !output.includes("--enable-static")
  ) {
    throw new Error(`Prepared ${name} binary failed the LGPL runtime policy check.`);
  }
  const expectedArchitecture = expectedMachOArchitecture(specification);
  const architectures = inspectArchitectures(binaryPath);
  if (architectures.length !== 1 || architectures[0] !== expectedArchitecture) {
    throw new Error(
      `Prepared ${name} binary architecture mismatch: expected ${expectedArchitecture}, `
      + `received ${architectures.join(", ") || "unknown"}.`
    );
  }
  const minimumMacOSVersion = inspectMinimumVersion(binaryPath);
  if (compareVersions(minimumMacOSVersion, specification.deploymentTarget) > 0) {
    throw new Error(
      `Prepared ${name} binary requires macOS ${minimumMacOSVersion}; `
      + `expected ${specification.deploymentTarget} or earlier.`
    );
  }
  const stat = fs.statSync(binaryPath);
  if (stat.size < 500_000 || stat.size > 20 * 1024 * 1024) {
    throw new Error(`Prepared ${name} binary size is outside the expected range.`);
  }
  return {
    name,
    architecture: expectedArchitecture,
    minimumMacOSVersion,
    sha256: sha256File(binaryPath),
    size: stat.size
  };
}

function buildCacheDirectory(specification) {
  const digest = crypto
    .createHash("sha256")
    .update(JSON.stringify({
      configureFlags: specification.configureFlags,
      deploymentTarget: specification.deploymentTarget
    }))
    .digest("hex")
    .slice(0, 16);
  const configured = String(process.env.DOMI_MEDIA_RUNTIME_CACHE || "").trim();
  const cacheRoot = configured
    ? path.resolve(configured)
    : path.join(os.homedir(), "Library", "Caches", "com.domi.workbench", "media-runtime");
  return {
    cacheRoot,
    cacheDirectory: path.join(
      cacheRoot,
      `${specification.version}-${specification.targetPlatform}-${specification.targetArch}-${digest}`
    )
  };
}

function prepareSourceArchive(specification, cacheRoot) {
  fs.mkdirSync(cacheRoot, { recursive: true });
  const archivePath = path.join(cacheRoot, `ffmpeg-${specification.version}.tar.xz`);
  const configuredArchive = String(process.env.DOMI_MEDIA_RUNTIME_ARCHIVE || "").trim();
  if (configuredArchive) {
    fs.copyFileSync(path.resolve(configuredArchive), archivePath);
  } else if (!archiveMatches(archivePath, specification)) {
    const temporaryPath = `${archivePath}.download-${process.pid}`;
    fs.rmSync(temporaryPath, { force: true });
    try {
      download(specification.sourceUrl, temporaryPath);
      fs.renameSync(temporaryPath, archivePath);
    } finally {
      fs.rmSync(temporaryPath, { force: true });
    }
  }
  if (!archiveMatches(archivePath, specification)) {
    throw new Error("FFmpeg source archive integrity check failed.");
  }
  return archivePath;
}

function buildBinaries(specification, archivePath, cacheDirectory) {
  const cachedFfmpeg = path.join(cacheDirectory, "ffmpeg");
  const cachedFfprobe = path.join(cacheDirectory, "ffprobe");
  try {
    validateBinary(cachedFfmpeg, "ffmpeg", specification);
    validateBinary(cachedFfprobe, "ffprobe", specification);
    return { ffmpeg: cachedFfmpeg, ffprobe: cachedFfprobe };
  } catch {
    // Rebuild a stale or incomplete cache entry below.
  }

  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-media-runtime-"));
  const buildEnvironment = {
    ...process.env,
    LC_ALL: "C",
    SOURCE_DATE_EPOCH: "0",
    ZERO_AR_DATE: "1",
    MACOSX_DEPLOYMENT_TARGET: specification.deploymentTarget
  };
  try {
    execFileSync("/usr/bin/tar", ["-xf", archivePath, "-C", stagingRoot], {
      stdio: "inherit",
      timeout: 2 * 60_000
    });
    const sourceRoot = path.join(stagingRoot, `ffmpeg-${specification.version}`);
    execFileSync(path.join(sourceRoot, "configure"), specification.configureFlags, {
      cwd: sourceRoot,
      env: buildEnvironment,
      stdio: "inherit",
      timeout: 5 * 60_000
    });
    const concurrency = String(Math.max(1, Math.min(os.cpus().length, 8)));
    execFileSync("/usr/bin/make", [`-j${concurrency}`, "ffmpeg", "ffprobe"], {
      cwd: sourceRoot,
      env: buildEnvironment,
      stdio: "inherit",
      timeout: 20 * 60_000
    });
    validateBinary(path.join(sourceRoot, "ffmpeg"), "ffmpeg", specification);
    validateBinary(path.join(sourceRoot, "ffprobe"), "ffprobe", specification);
    fs.mkdirSync(cacheDirectory, { recursive: true });
    fs.copyFileSync(path.join(sourceRoot, "ffmpeg"), cachedFfmpeg);
    fs.copyFileSync(path.join(sourceRoot, "ffprobe"), cachedFfprobe);
    fs.chmodSync(cachedFfmpeg, 0o755);
    fs.chmodSync(cachedFfprobe, 0o755);
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
  return { ffmpeg: cachedFfmpeg, ffprobe: cachedFfprobe };
}

function copyLicenseFiles(specification, archivePath, destination) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-media-license-"));
  try {
    execFileSync("/usr/bin/tar", [
      "-xf",
      archivePath,
      "-C",
      stagingRoot,
      `ffmpeg-${specification.version}/LICENSE.md`,
      `ffmpeg-${specification.version}/COPYING.LGPLv2.1`,
      `ffmpeg-${specification.version}/COPYING.LGPLv3`
    ], {
      stdio: "inherit",
      timeout: 2 * 60_000
    });
    const sourceRoot = path.join(stagingRoot, `ffmpeg-${specification.version}`);
    fs.mkdirSync(destination, { recursive: true });
    for (const fileName of ["LICENSE.md", "COPYING.LGPLv2.1", "COPYING.LGPLv3"]) {
      fs.copyFileSync(path.join(sourceRoot, fileName), path.join(destination, fileName));
    }
  } finally {
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  if (process.platform !== "darwin") {
    throw new Error("The domi media runtime can only be prepared on macOS.");
  }
  const targetArch = resolveTargetArchitecture();
  if (targetArch === "arm64" && process.arch !== "arm64") {
    throw new Error("The darwin-arm64 media runtime must be prepared on Apple Silicon.");
  }
  const specification = validateSpecification(
    deriveSpecification(
      JSON.parse(fs.readFileSync(specificationPath, "utf8")),
      targetArch
    )
  );
  const outputRoot = outputRootForArchitecture(targetArch);
  const { cacheRoot, cacheDirectory } = buildCacheDirectory(specification);
  const archivePath = prepareSourceArchive(specification, cacheRoot);
  const binaries = buildBinaries(specification, archivePath, cacheDirectory);

  fs.rmSync(outputRoot, { recursive: true, force: true });
  const binDirectory = path.join(outputRoot, "bin");
  const sourceDirectory = path.join(outputRoot, "source");
  const licenseDirectory = path.join(outputRoot, "licenses");
  fs.mkdirSync(binDirectory, { recursive: true });
  fs.mkdirSync(sourceDirectory, { recursive: true });
  fs.copyFileSync(binaries.ffmpeg, path.join(binDirectory, "ffmpeg"));
  fs.copyFileSync(binaries.ffprobe, path.join(binDirectory, "ffprobe"));
  fs.chmodSync(path.join(binDirectory, "ffmpeg"), 0o755);
  fs.chmodSync(path.join(binDirectory, "ffprobe"), 0o755);
  fs.copyFileSync(
    archivePath,
    path.join(sourceDirectory, `ffmpeg-${specification.version}.tar.xz`)
  );
  copyLicenseFiles(specification, archivePath, licenseDirectory);

  const manifest = {
    ...specification,
    sourceArchive: `source/ffmpeg-${specification.version}.tar.xz`,
    binaries: [
      validateBinary(path.join(binDirectory, "ffmpeg"), "ffmpeg", specification),
      validateBinary(path.join(binDirectory, "ffprobe"), "ffprobe", specification)
    ]
  };
  fs.writeFileSync(
    path.join(outputRoot, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8"
  );
  console.log(
    `Prepared LGPL FFmpeg ${specification.version} runtime for `
    + `${specification.targetPlatform}-${specification.targetArch}.`
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`Media runtime preparation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  archiveMatches,
  buildCacheDirectory,
  deriveSpecification,
  expectedMachOArchitecture,
  inspectMacOSMinimumVersion,
  inspectMachOArchitectures,
  outputRootForArchitecture,
  resolveTargetArchitecture,
  sha256File,
  validateBinary,
  validateSpecification
};
