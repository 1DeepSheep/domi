const forbiddenRuntimeNamePatterns = [
  /^\.env(?:\.|$)/i,
  /^\.npmrc$/i,
  /^\.privacy-terms\.local$/i,
  /^domi-plugin-config\.json$/i,
  /^domi\.sqlite3?(?:-.+)?$/i,
  /^(?:Cookies|Cookies-journal|Login Data|Local State|Web Data|DevToolsActivePort)$/i,
  /^(?:threads?|sessions?|history|runtime-state)\.json$/i,
  /^(?:plaud|lark|feishu).*(?:session|cookie|token|credential)/i
];

const secretPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  // Credentials are one HTTP header line. Do not join adjacent YAML lines.
  /\b(?:Bearer|Basic)[ \t]+[A-Za-z0-9._~+/=-]{12,}\b/i,
  /\b(?:client_secret|access_token|refresh_token|api_key|authorization|cookie)\b[ \t]*[:=][ \t]*["'][^"'\r\n]{12,}["']/i
];

function isForbiddenRuntimeName(name) {
  // A committed template is safe only after its contents pass the same secret
  // scanner as every other source file. Real .env variants remain forbidden.
  if (String(name || "").toLowerCase() === ".env.example") return false;
  return forbiddenRuntimeNamePatterns.some((pattern) => pattern.test(String(name || "")));
}

function containsHardcodedSecret(content) {
  return secretPatterns.some((pattern) => pattern.test(String(content || "")));
}

function containsOneDriveAccountPath(content) {
  // Match an actual path component such as /OneDrive-company/, not prose such
  // as “OneDrive-style folders”.
  return /(?:^|[/\\])OneDrive-[^/\\\s"'<>]+(?:[/\\]|$)/m.test(String(content || ""));
}

module.exports = {
  containsHardcodedSecret,
  containsOneDriveAccountPath,
  isForbiddenRuntimeName
};
