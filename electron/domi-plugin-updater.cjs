const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;
const MAX_MANIFEST_BYTES = 128 * 1024;
const MAX_SIGNATURE_BYTES = 4096;
const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXTRACTED_BYTES = 256 * 1024 * 1024;
const RELEASE_API_URL = "https://api.github.com/repos/1DeepSheep/domi-plugin/releases/latest";
const ARCHIVE_URL_PREFIX = "https://github.com/1DeepSheep/domi-plugin/releases/download/";
const SIGNING_PUBLIC_KEY_DER_B64 =
  "MCowBQYDK2VwAyEA8xYKbT5cdiyFEDY3wmn3oaPEGSl3A+i/CbS5WAGToAM=";

function numericVersionParts(version) {
  return String(version || "0").match(/\d+/g)?.map(Number) || [0];
}

function compareVersions(left, right) {
  const a = numericVersionParts(left);
  const b = numericVersionParts(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if ((a[index] || 0) !== (b[index] || 0)) return (a[index] || 0) - (b[index] || 0);
  }
  return 0;
}

function safeError(error) {
  return String(error?.message || error || "domi plugin update failed.")
    .replace(/([?&](?:token|key|authorization)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, filePath);
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function validateManifest(manifest, clientVersion) {
  if (!manifest || manifest.schemaVersion !== 1 || manifest.name !== "domi") {
    throw new Error("Remote plugin manifest has an unsupported schema.");
  }
  if (!String(manifest.version || "").trim()) throw new Error("Remote plugin version is missing.");
  if (!/^[0-9a-f]{40}$/i.test(manifest.gitCommit || "")) {
    throw new Error("Remote plugin commit is invalid.");
  }
  if (!/^[0-9a-f]{64}$/i.test(manifest.sha256 || "")) {
    throw new Error("Remote plugin SHA-256 is invalid.");
  }
  if (manifest.archiveFormat !== "tar.gz" || manifest.archiveRoot !== "domi") {
    throw new Error("Remote plugin archive format is unsupported.");
  }
  if (!String(manifest.archiveUrl || "").startsWith(ARCHIVE_URL_PREFIX)) {
    throw new Error("Remote plugin archive URL is not trusted.");
  }
  if (compareVersions(clientVersion, manifest.minClientVersion || "0") < 0) {
    return {
      compatible: false,
      reason: `requires-client-${manifest.minClientVersion}`
    };
  }
  return { compatible: true, reason: "" };
}

function verifySignedManifest(manifestBytes, signatureBytes, publicKeyDerBase64, clientVersion) {
  const publicKey = crypto.createPublicKey({
    key: Buffer.from(publicKeyDerBase64, "base64"),
    format: "der",
    type: "spki"
  });
  if (!crypto.verify(null, manifestBytes, publicKey, signatureBytes)) {
    throw new Error("Remote plugin manifest signature is invalid.");
  }
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  return { manifest, ...validateManifest(manifest, clientVersion) };
}

function validateArchiveEntries(listing) {
  const entries = String(listing || "").split(/\r?\n/).filter(Boolean);
  if (!entries.length) throw new Error("Remote plugin archive is empty.");
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (!normalized.startsWith("domi/")
        || normalized.startsWith("/")
        || segments.includes("..")) {
      throw new Error(`Unsafe plugin archive entry: ${entry}`);
    }
  }
  return entries;
}

function validateExtractedTree(root) {
  let fileCount = 0;
  let totalBytes = 0;
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink()) throw new Error("Remote plugin archive contains a symbolic link.");
      if (stat.isDirectory()) {
        pending.push(target);
      } else if (stat.isFile()) {
        fileCount += 1;
        totalBytes += stat.size;
        if (fileCount > 10000) throw new Error("Remote plugin archive contains too many files.");
        if (totalBytes > MAX_EXTRACTED_BYTES) {
          throw new Error("Remote plugin archive expands beyond the allowed size.");
        }
      } else {
        throw new Error("Remote plugin archive contains an unsupported file type.");
      }
    }
  }
}

function releaseAsset(release, name) {
  return (Array.isArray(release?.assets) ? release.assets : [])
    .find((asset) => asset?.name === name && asset?.browser_download_url);
}

class DomiPluginUpdater {
  constructor({
    marketplaceRoot,
    clientVersion,
    fetchImpl = globalThis.fetch,
    execFileImpl = execFileAsync,
    now = () => Date.now(),
    checkIntervalMs = CHECK_INTERVAL_MS,
    releaseApiUrl = RELEASE_API_URL,
    publicKeyDerBase64 = SIGNING_PUBLIC_KEY_DER_B64
  }) {
    this.marketplaceRoot = marketplaceRoot;
    this.clientVersion = clientVersion;
    this.fetchImpl = fetchImpl;
    this.execFileImpl = execFileImpl;
    this.now = now;
    this.checkIntervalMs = checkIntervalMs;
    this.releaseApiUrl = releaseApiUrl;
    this.publicKeyDerBase64 = publicKeyDerBase64;
    this.updatesRoot = path.join(marketplaceRoot, "updates");
    this.statePath = path.join(this.updatesRoot, "remote-update-state.json");
  }

  cachedCandidate() {
    const state = readJson(this.statePath);
    const manifest = state?.candidateManifest
      || (state?.status === "available" ? state.manifest : null);
    if (!manifest?.sha256) return null;
    const root = path.join(this.updatesRoot, manifest.sha256, "plugin");
    const pluginManifest = readJson(path.join(root, ".codex-plugin", "plugin.json"));
    if (pluginManifest?.name !== "domi" || pluginManifest.version !== manifest.version) {
      return null;
    }
    return this.candidate(root, pluginManifest, manifest);
  }

  candidate(root, pluginManifest, releaseManifest) {
    return {
      source: "remote-release",
      root,
      manifest: pluginManifest,
      lock: {
        schemaVersion: 1,
        pluginName: "domi",
        pluginVersion: pluginManifest.version,
        gitCommit: releaseManifest.gitCommit,
        gitRef: "github-release",
        repository: "https://github.com/1DeepSheep/domi-plugin.git",
        sha256: releaseManifest.sha256,
        publishedAt: releaseManifest.publishedAt || "",
        source: "remote-release"
      }
    };
  }

  async fetchResponse(url, maximumBytes, responseType = "bytes") {
    if (typeof this.fetchImpl !== "function") throw new Error("Fetch is unavailable.");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    timer.unref?.();
    try {
      const response = await this.fetchImpl(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "domi-Workbench-Plugin-Updater"
        },
        signal: controller.signal
      });
      if (!response?.ok) throw new Error(`Plugin update request failed with HTTP ${response?.status || 0}.`);
      if (responseType === "json") return response.json();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > maximumBytes) throw new Error("Plugin update response is too large.");
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  }

  async extractArchive(archiveBytes, manifest) {
    if (sha256(archiveBytes) !== manifest.sha256) {
      throw new Error("Remote plugin archive SHA-256 does not match the signed manifest.");
    }
    fs.mkdirSync(this.updatesRoot, { recursive: true });
    const finalRoot = path.join(this.updatesRoot, manifest.sha256);
    const finalPluginRoot = path.join(finalRoot, "plugin");
    const existingManifest = readJson(path.join(finalPluginRoot, ".codex-plugin", "plugin.json"));
    if (existingManifest?.name === "domi" && existingManifest.version === manifest.version) {
      return { root: finalPluginRoot, pluginManifest: existingManifest };
    }

    const stagingRoot = fs.mkdtempSync(path.join(this.updatesRoot, ".staging-"));
    try {
      const archivePath = path.join(stagingRoot, "domi-plugin.tar.gz");
      const pluginRoot = path.join(stagingRoot, "plugin");
      fs.writeFileSync(archivePath, archiveBytes);
      const { stdout } = await this.execFileImpl("tar", ["-tzf", archivePath], {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024
      });
      validateArchiveEntries(stdout);
      fs.mkdirSync(pluginRoot, { recursive: true });
      await this.execFileImpl("tar", [
        "-xzf", archivePath,
        "-C", pluginRoot,
        "--strip-components", "1"
      ], { maxBuffer: 8 * 1024 * 1024 });
      fs.rmSync(archivePath, { force: true });
      validateExtractedTree(pluginRoot);

      const pluginManifest = readJson(path.join(pluginRoot, ".codex-plugin", "plugin.json"));
      if (pluginManifest?.name !== "domi" || pluginManifest.version !== manifest.version) {
        throw new Error("Extracted plugin manifest does not match the signed release.");
      }
      if (!fs.existsSync(path.join(pluginRoot, "skills", "domi-router", "SKILL.md"))) {
        throw new Error("Extracted plugin is missing domi-router.");
      }
      writeJsonAtomic(path.join(stagingRoot, "release-lock.json"), manifest);
      fs.rmSync(finalRoot, { recursive: true, force: true });
      fs.renameSync(stagingRoot, finalRoot);
      return { root: path.join(finalRoot, "plugin"), pluginManifest };
    } catch (error) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
      throw error;
    }
  }

  async check({ force = false } = {}) {
    const state = readJson(this.statePath, {});
    const cached = this.cachedCandidate();
    if (!force && Number(state.checkedAt || 0) + this.checkIntervalMs > this.now()) {
      return {
        ok: true,
        checked: false,
        cached: Boolean(cached),
        candidate: cached,
        reason: state.reason || "check-interval"
      };
    }

    try {
      const release = await this.fetchResponse(this.releaseApiUrl, MAX_MANIFEST_BYTES, "json");
      const manifestAsset = releaseAsset(release, "latest.json");
      const signatureAsset = releaseAsset(release, "latest.json.sig");
      const archiveAsset = releaseAsset(release, "domi-plugin.tar.gz");
      if (!manifestAsset || !signatureAsset || !archiveAsset) {
        writeJsonAtomic(this.statePath, {
          checkedAt: this.now(),
          status: "unavailable",
          reason: "release-assets-missing",
          candidateManifest: cached
            ? state.candidateManifest || state.manifest || null
            : null
        });
        return { ok: true, checked: true, candidate: cached, reason: "release-assets-missing" };
      }

      const [manifestBytes, signatureBytes] = await Promise.all([
        this.fetchResponse(manifestAsset.browser_download_url, MAX_MANIFEST_BYTES),
        this.fetchResponse(signatureAsset.browser_download_url, MAX_SIGNATURE_BYTES)
      ]);
      const verified = verifySignedManifest(
        manifestBytes,
        signatureBytes,
        this.publicKeyDerBase64,
        this.clientVersion
      );
      if (!verified.compatible) {
        writeJsonAtomic(this.statePath, {
          checkedAt: this.now(),
          status: "incompatible",
          reason: verified.reason,
          manifest: verified.manifest,
          candidateManifest: cached
            ? state.candidateManifest || state.manifest || null
            : null
        });
        return { ok: true, checked: true, candidate: cached, reason: verified.reason };
      }
      if (verified.manifest.archiveUrl !== archiveAsset.browser_download_url) {
        throw new Error("Signed archive URL does not match the GitHub release asset.");
      }

      const archiveBytes = await this.fetchResponse(
        verified.manifest.archiveUrl,
        MAX_ARCHIVE_BYTES
      );
      const extracted = await this.extractArchive(archiveBytes, verified.manifest);
      writeJsonAtomic(this.statePath, {
        checkedAt: this.now(),
        status: "available",
        reason: "",
        releaseId: release.id || null,
        manifest: verified.manifest,
        candidateManifest: verified.manifest
      });
      return {
        ok: true,
        checked: true,
        candidate: this.candidate(
          extracted.root,
          extracted.pluginManifest,
          verified.manifest
        ),
        reason: ""
      };
    } catch (error) {
      return {
        ok: false,
        checked: true,
        candidate: cached,
        reason: "remote-check-failed",
        error: safeError(error)
      };
    }
  }
}

module.exports = {
  ARCHIVE_URL_PREFIX,
  CHECK_INTERVAL_MS,
  DomiPluginUpdater,
  RELEASE_API_URL,
  SIGNING_PUBLIC_KEY_DER_B64,
  compareVersions,
  safeError,
  sha256,
  validateArchiveEntries,
  validateManifest,
  verifySignedManifest
};
