const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "resources", "codex-runtime.json");
const outputRoot = path.join(root, "build", "codex-runtime");
const upstreamArchive = path.join(outputRoot, "upstream-codex-package.tar.gz");
const outputArchive = path.join(outputRoot, "codex-package.tar.gz");
const outputManifest = path.join(outputRoot, "manifest.json");
const sourceArchive = String(process.env.DOMI_CODEX_RUNTIME_ARCHIVE || "").trim();
const releaseMode = process.argv.includes("--release");
const auxiliaryBinaries = [
  "codex-path/rg",
  "codex-resources/zsh/bin/zsh"
];

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
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
  return hash.digest("hex");
}

function validateManifest(value) {
  if (
    value?.schemaVersion !== 1
    || !/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(String(value.version || ""))
    || value.target !== "aarch64-apple-darwin"
    || value.assetName !== "codex-package-aarch64-apple-darwin.tar.gz"
    || !String(value.assetUrl || "").startsWith(
      `https://github.com/openai/codex/releases/download/${value.tag}/`
    )
    || !/^[a-f0-9]{64}$/.test(String(value.sha256 || ""))
    || !Number.isSafeInteger(value.size)
    || value.size < 50 * 1024 * 1024
    || value.size > 300 * 1024 * 1024
  ) {
    throw new Error("Codex runtime manifest is invalid.");
  }
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

function archiveMatches(filePath, manifest) {
  return fs.existsSync(filePath)
    && fs.statSync(filePath).size === manifest.size
    && sha256File(filePath) === manifest.sha256;
}

function signingIdentity() {
  const configured = String(process.env.DOMI_CODEX_SIGN_IDENTITY || "").trim();
  if (configured) return configured;
  const identities = execFileSync("/usr/bin/security", [
    "find-identity",
    "-v",
    "-p",
    "codesigning"
  ], { encoding: "utf8" });
  const match = identities.match(/"([^"]*Developer ID Application:[^"]+)"/);
  if (!match) {
    throw new Error(
      "A Developer ID Application identity is required for release runtime preparation."
    );
  }
  return match[1];
}

function waitSynchronously(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function codesignWithTimestampRetry(args) {
  const retryDelays = [0, 2_000, 5_000, 10_000];
  let lastError;
  for (let attempt = 0; attempt < retryDelays.length; attempt += 1) {
    if (retryDelays[attempt]) waitSynchronously(retryDelays[attempt]);
    try {
      execFileSync("/usr/bin/codesign", args, {
        stdio: "inherit",
        timeout: 2 * 60_000
      });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < retryDelays.length - 1) {
        process.stderr.write(
          `Apple timestamp attempt ${attempt + 1} failed; retrying release signature.\n`
        );
      }
    }
  }
  throw lastError;
}

function signAuxiliaryBinaries(identity) {
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), "domi-codex-runtime-sign-"));
  const temporaryArchive = `${outputArchive}.signed-${process.pid}`;
  const timestampServer = String(
    process.env.APPLE_TIMESTAMP_SERVER || "http://timestamp.apple.com/ts01"
  ).trim();
  try {
    execFileSync("/usr/bin/tar", ["-xzf", upstreamArchive, "-C", stagingRoot], {
      stdio: "inherit",
      timeout: 5 * 60_000
    });
    for (const relativePath of auxiliaryBinaries) {
      const binaryPath = path.join(stagingRoot, relativePath);
      if (!fs.existsSync(binaryPath)) {
        throw new Error(`Codex runtime is missing ${relativePath}.`);
      }
      codesignWithTimestampRetry([
        "--force",
        "--sign",
        identity,
        "--options",
        "runtime",
        `--timestamp=${timestampServer}`,
        binaryPath
      ]);
      execFileSync("/usr/bin/codesign", [
        "--verify",
        "--strict",
        "--verbose=2",
        binaryPath
      ], {
        stdio: "inherit",
        timeout: 30_000
      });
    }
    fs.rmSync(temporaryArchive, { force: true });
    execFileSync("/usr/bin/tar", [
      "-czf",
      temporaryArchive,
      "-C",
      stagingRoot,
      "."
    ], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stdio: "inherit",
      timeout: 5 * 60_000
    });
    fs.renameSync(temporaryArchive, outputArchive);
  } finally {
    fs.rmSync(temporaryArchive, { force: true });
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest);
  fs.mkdirSync(outputRoot, { recursive: true });

  if (sourceArchive) {
    fs.copyFileSync(path.resolve(sourceArchive), upstreamArchive);
  } else if (!archiveMatches(upstreamArchive, manifest)) {
    if (archiveMatches(outputArchive, manifest)) {
      fs.copyFileSync(outputArchive, upstreamArchive);
    } else {
      const temporaryArchive = `${upstreamArchive}.download`;
      fs.rmSync(temporaryArchive, { force: true });
      try {
        download(manifest.assetUrl, temporaryArchive);
        fs.renameSync(temporaryArchive, upstreamArchive);
      } finally {
        fs.rmSync(temporaryArchive, { force: true });
      }
    }
  }

  if (!archiveMatches(upstreamArchive, manifest)) {
    const stat = fs.existsSync(upstreamArchive) ? fs.statSync(upstreamArchive) : { size: 0 };
    const digest = fs.existsSync(upstreamArchive) ? sha256File(upstreamArchive) : "missing";
    throw new Error(
      `Codex upstream integrity check failed: expected ${manifest.sha256}/${manifest.size}, `
      + `received ${digest}/${stat.size}.`
    );
  }

  let identity = "";
  if (releaseMode) {
    identity = signingIdentity();
    signAuxiliaryBinaries(identity);
  } else {
    const temporaryArchive = `${outputArchive}.copy`;
    fs.rmSync(temporaryArchive, { force: true });
    try {
      fs.copyFileSync(upstreamArchive, temporaryArchive);
      fs.renameSync(temporaryArchive, outputArchive);
    } finally {
      fs.rmSync(temporaryArchive, { force: true });
    }
  }

  const stat = fs.statSync(outputArchive);
  const digest = sha256File(outputArchive);
  if (stat.size < 50 * 1024 * 1024 || stat.size > 300 * 1024 * 1024) {
    throw new Error("Prepared Codex runtime size is outside the expected range.");
  }
  const packagedManifest = {
    ...manifest,
    upstreamSha256: manifest.sha256,
    upstreamSize: manifest.size,
    sha256: digest,
    size: stat.size,
    auxiliaryBinariesSigned: releaseMode,
    auxiliarySigningIdentity: releaseMode ? identity : ""
  };
  fs.writeFileSync(outputManifest, `${JSON.stringify(packagedManifest, null, 2)}\n`, "utf8");
  console.log(
    `Prepared Codex runtime ${manifest.version} (${manifest.target}, ${stat.size} bytes, `
    + `${releaseMode ? "notarization-ready" : "upstream"}).`
  );
}

try {
  main();
} catch (error) {
  console.error(`Codex runtime preparation failed: ${error.message}`);
  process.exitCode = 1;
}
