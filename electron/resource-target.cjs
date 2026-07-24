function candidateStrings(value) {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value.flatMap(candidateStrings);
  if (typeof value === "object") {
    return [
      value.link,
      value.url,
      value.href,
      value.text,
      value.value
    ].flatMap(candidateStrings);
  }
  return [String(value)];
}

function unwrapMarkdownDestination(value) {
  let candidate = String(value || "").trim().replace(/\u200b/g, "");
  const markdown = candidate.match(/^\[[^\]]*]\(\s*(.+)\s*\)$/s);
  if (markdown) candidate = markdown[1].trim();
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  const titled = candidate.match(/^(https?:\/\/\S+?)(?:\s+["'][^"']*["'])?$/i);
  return titled ? titled[1] : candidate;
}

function normalizeWebResource(value) {
  for (const rawCandidate of candidateStrings(value)) {
    const candidate = unwrapMarkdownDestination(rawCandidate);
    if (!/^https?:\/\//i.test(candidate)) continue;
    try {
      const parsed = new URL(candidate);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed.href;
    } catch {
      // Try the next representation returned by the source field.
    }
  }
  return "";
}

module.exports = {
  normalizeWebResource,
  unwrapMarkdownDestination
};
