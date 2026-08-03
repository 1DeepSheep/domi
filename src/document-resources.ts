function decodedResource(resource: string) {
  try {
    return decodeURIComponent(resource);
  } catch {
    return resource;
  }
}

function localDocumentCandidate(resource?: string) {
  if (!resource) return "";
  let candidate = decodedResource(resource.trim().replace(/\u200b/g, ""));
  if (/^https?:\/\//i.test(candidate) || candidate.startsWith("#")) return "";
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  return candidate;
}

export function isLocalMarkdownResource(resource?: string) {
  return /\.(?:md|markdown)(?:(?::\d+(?::\d+)?)|[?#].*)?$/i.test(
    localDocumentCandidate(resource)
  );
}

export function isLocalPdfResource(resource?: string) {
  return /\.pdf(?:(?::\d+(?::\d+)?)|[?#].*)?$/i.test(
    localDocumentCandidate(resource)
  );
}
