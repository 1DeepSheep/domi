const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "resources", "codex-runtime.json");
const outputRoot = path.join(root, "build", "codex-runtime");
const outputArchive = path.join(outputRoot, "codex-package.tar.gz");
const outputManifest = path.join(outputRoot, "manifest.json");
const sourceArchive = String(process.env.DOMI_CODEX_RUNTIME_ARCHIVE || "").trim();

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

function main() {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  validateManifest(manifest);
  fs.mkdirSync(outputRoot, { recursive: true });

  if (sourceArchive) {
    fs.copyFileSync(path.resolve(sourceArchive), outputArchive);
  } else if (
    !fs.existsSync(outputArchive)
    || fs.statSync(outputArchive).size !== manifest.size
    || sha256File(outputArchive) !== manifest.sha256
  ) {
    const temporaryArchive = `${outputArchive}.download`;
    fs.rmSync(temporaryArchive, { force: true });
    try {
      download(manifest.assetUrl, temporaryArchive);
      fs.renameSync(temporaryArchive, outputArchive);
    } finally {
      fs.rmSync(temporaryArchive, { force: true });
    }
  }

  const stat = fs.statSync(outputArchive);
  const digest = sha256File(outputArchive);
  if (stat.size !== manifest.size || digest !== manifest.sha256) {
    throw new Error(
      `Codex runtime integrity check failed: expected ${manifest.sha256}/${manifest.size}, `
      + `received ${digest}/${stat.size}.`
    );
  }
  fs.writeFileSync(outputManifest, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Prepared Codex runtime ${manifest.version} (${manifest.target}, ${stat.size} bytes).`);
}

try {
  main();
} catch (error) {
  console.error(`Codex runtime preparation failed: ${error.message}`);
  process.exitCode = 1;
}
