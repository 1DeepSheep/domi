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
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (candidate.startsWith("#") || candidate.startsWith("//") || /[\u0000-\u001f\u007f]/.test(candidate)) return "";
  if (/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^file:\/\//i.test(candidate)) return "";
    try {
      const url = new URL(candidate);
      if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost") || !url.pathname.startsWith("/")) return "";
    } catch { return ""; }
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
