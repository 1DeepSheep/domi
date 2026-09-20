const MAX_CHECKS = 32;
const MAX_REPORT_BYTES = 24 * 1024;
const MAX_INPUT_TEXT = 4096;
const REDACTED = "[redacted]";

// Read only explicitly allowed own data properties. Do not walk unknown
// objects, call toJSON/toString, evaluate getters, or copy prototype fields.
function ownValue(value, key) {
  if (!value || typeof value !== "object") return undefined;
  try { return Object.getOwnPropertyDescriptor(value, key)?.value; }
  catch { return undefined; }
}

function endpoint(value) {
  if (typeof value !== "string" || value.length > MAX_INPUT_TEXT) return undefined;
  try {
    const url = new URL(value);
    if (!["https:", "http:", "wss:", "ws:"].includes(url.protocol)) return REDACTED;
    // Paths may themselves be keys or account identifiers. Keep only origin,
    // even when a path appears to be a harmless API version suffix.
    return url.origin;
  } catch { return REDACTED; }
}

function text(value, limit = 240) {
  if (typeof value !== "string") return undefined;
  let result = value.slice(0, MAX_INPUT_TEXT)
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\\\//g, "/");
  // Normalize escaped paths and credentials before masking, including common
  // double-encoded URLs. No network or filesystem lookups are performed.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try { result = decodeURIComponent(result); } catch { break; }
  }
  result = result.trim().split(/[\r\n]/, 1)[0];
  if (/^(?:command failed|command execution|stdout|stderr|aggregatedOutput)\b/i.test(result)) {
    return "[command output omitted]";
  }
  result = result
    // Embedded command output, task prompts and material bodies are never an
    // exportable diagnostic field, even if nested inside a detail string.
    .replace(/(?:["']?\b(?:stdout|stderr|aggregatedOutput|prompt|messages|transcript|documentContent|taskContent)["']?|任务材料|逐字稿|原始输出)\s*[:=：][\s\S]*/gi, "[content omitted]")
    .replace(/\b(?:proxy-)?authorization\s*[:=][\s\S]*/gi, `Authorization: ${REDACTED}`)
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+\/-]+=*/gi, REDACTED)
    .replace(/\b(?:https?|wss?):\/\/[^\s<>"'\])}]+/gi, (url) => endpoint(url) || REDACTED)
    .replace(/\bfile:\/\/[^\r\n"'<>]*/gi, "[local path]")
    .replace(/(?:\/(?:Users|home|private|var|tmp|Volumes|Applications|Library|opt|usr|etc)(?:\/|\b)|~[/\\]|\b[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>;,，。)]*/g, "[local path]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+/gi, "[email]")
    .replace(/(["']?\b(?:[A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|PASSWORD|PASSWD|SECRET|TOKEN|CREDENTIAL)[A-Z0-9_]*|apiKey|session[_-]?id|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^,;\r\n}]+)/gi, `$1${REDACTED}`)
    .replace(/\b(?:sk-(?:proj-|ant-)?[A-Za-z0-9_-]{6,}|gh[opusr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|AKIA[A-Z0-9]{16})\b/g, REDACTED)
    .replace(/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, REDACTED)
    .replace(/\b[A-Za-z0-9+/]{32,}={0,2}\b/g, REDACTED);
  return result.length > limit ? `${result.slice(0, limit - 1)}…` : result;
}

const boolean = (value) => typeof value === "boolean" ? value : undefined;
const number = (value) => typeof value === "number" && Number.isFinite(value)
  && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
const identifier = (value) => typeof value === "string" && /^[A-Za-z0-9_.:-]{1,96}$/.test(value)
  ? text(value, 96) : undefined;
const version = (value) => typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9.+_-]{0,63}$/.test(value)
  ? text(value, 64) : undefined;
const shortText = (value) => text(value, 80);

function record(input, schema) {
  const output = {};
  for (const [key, convert] of Object.entries(schema)) {
    const safeValue = convert(ownValue(input, key));
    if (safeValue !== undefined) output[key] = safeValue;
  }
  return output;
}

const STATUS_FIELDS = {
  ok: boolean,
  status: identifier,
  stage: identifier,
  code: identifier,
  errorCode: identifier,
  diagnosticCode: identifier,
  durationMs: number,
  timeoutMs: number,
  httpStatus: number,
  timedOut: boolean,
  cancelled: boolean
};

/**
 * Produce a bounded report for export. The schema is intentionally independent
 * of the full settings/runtime objects; new fields require an explicit review.
 * Only three fixed object levels are supported, with no generic recursion.
 */
function sanitizeDiagnosticReport(report) {
  const output = {
    schemaVersion: 1,
    sanitized: true,
    ...record(report, { ok: boolean, generatedAt: number, durationMs: number }),
    app: record(ownValue(report, "app"), {
      name: shortText, version, packaged: boolean, codexVersion: version, pluginVersion: version
    }),
    system: record(ownValue(report, "system"), {
      platform: identifier, arch: identifier, release: version
    }),
    connection: record(ownValue(report, "connection"), {
      ...STATUS_FIELDS,
      authMode: (value) => ["chatgpt", "relay", "api"].includes(value) ? value : undefined,
      providerLabel: shortText,
      apiBaseUrl: (value) => text(endpoint(value)),
      credentialStored: boolean,
      modelOk: boolean,
      toolOk: boolean,
      workspaceOk: boolean,
      error: text
    }),
    checks: []
  };
  const stage = ownValue(report, "stage");
  if (typeof stage === "string") {
    const safeStage = identifier(stage);
    if (safeStage !== undefined) output.stage = safeStage;
  } else if (stage && typeof stage === "object") {
    output.stage = record(stage, { ...STATUS_FIELDS, id: identifier });
  }
  const network = ownValue(report, "network");
  if (network && typeof network === "object") {
    output.network = record(network, {
      ...STATUS_FIELDS, online: boolean, reachable: boolean, proxyConfigured: boolean,
      endpoint: (value) => text(endpoint(value)), error: text
    });
  }
  const checks = ownValue(report, "checks");
  const count = Array.isArray(checks) ? ownValue(checks, "length") : 0;
  for (let index = 0; index < Math.min(count, MAX_CHECKS); index += 1) {
    const check = record(ownValue(checks, String(index)), {
      ...STATUS_FIELDS, id: identifier, label: shortText, detail: text, error: text, version
    });
    if (!Object.keys(check).length) continue;
    output.checks.push(check);
    if (Buffer.byteLength(JSON.stringify(output), "utf8") > MAX_REPORT_BYTES - 64) {
      output.checks.pop();
      output.truncated = true;
      break;
    }
  }
  if (count > MAX_CHECKS) output.truncated = true;
  return output;
}

module.exports = { MAX_CHECKS, MAX_REPORT_BYTES, sanitizeDiagnosticReport };
