const path = require("node:path");
const { fileURLToPath } = require("node:url");

const DOCUMENT_EXTENSION_PATTERN = /\.(?:md|markdown|pdf)$/i;
const LINE_SUFFIX_PATTERN = /:(\d+)(?::(\d+))?$/;

function unwrapDocumentDestination(value) {
  let candidate = String(value || "").trim().replace(/\u200b/g, "");
  const markdown = candidate.match(/^\[[^\]]*]\(\s*(.+)\s*\)$/s);
  if (markdown) candidate = markdown[1].trim();
  if (candidate.startsWith("<") && candidate.endsWith(">")) {
    candidate = candidate.slice(1, -1).trim();
  }
  const titled = candidate.match(/^(.+?)(?:\s+["'][^"']*["'])$/s);
  if (titled && /\.(?:md|markdown|pdf)(?::\d+(?::\d+)?)?(?:[?#].*)?$/i.test(titled[1])) {
    candidate = titled[1].trim();
  }
  return candidate;
}

function decodeLocalPath(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseLocationSuffix(value) {
  let resourcePath = value;
  let line = 0;
  let column = 0;

  const separatorIndex = resourcePath.search(/[?#]/);
  if (separatorIndex >= 0) {
    const suffix = resourcePath.slice(separatorIndex);
    resourcePath = resourcePath.slice(0, separatorIndex);
    const fragmentLocation = suffix.match(/#L?(\d+)(?:C(\d+))?/i);
    const queryLocation = suffix.match(/[?&](?:line|ln)=(\d+)(?:&(?:column|col)=(\d+))?/i);
    const location = fragmentLocation || queryLocation;
    if (location) {
      line = Number(location[1]) || 0;
      column = Number(location[2]) || 0;
    }
  }

  const lineSuffix = resourcePath.match(LINE_SUFFIX_PATTERN);
  if (lineSuffix) {
    const withoutSuffix = resourcePath.slice(0, -lineSuffix[0].length);
    if (DOCUMENT_EXTENSION_PATTERN.test(withoutSuffix)) {
      resourcePath = withoutSuffix;
      line = Number(lineSuffix[1]) || line;
      column = Number(lineSuffix[2]) || column;
    }
  }

  return { resourcePath, line, column };
}

function normalizeLocalDocumentResource(value) {
  let candidate = unwrapDocumentDestination(value);
  if (!candidate || /^https?:\/\//i.test(candidate) || candidate.startsWith("#")) return null;

  let resourcePath = candidate;
  let urlLocation = { line: 0, column: 0 };
  if (/^file:\/\//i.test(candidate)) {
    try {
      const fileUrl = new URL(candidate);
      const hash = fileUrl.hash;
      const search = fileUrl.search;
      fileUrl.hash = "";
      fileUrl.search = "";
      resourcePath = fileURLToPath(fileUrl);
      urlLocation = parseLocationSuffix(`${resourcePath}${search}${hash}`);
      resourcePath = urlLocation.resourcePath;
    } catch {
      return null;
    }
  } else {
    resourcePath = decodeLocalPath(resourcePath);
  }

  const location = parseLocationSuffix(resourcePath);
  resourcePath = location.resourcePath;
  if (!DOCUMENT_EXTENSION_PATTERN.test(resourcePath)) return null;

  return {
    path: resourcePath,
    extension: path.extname(resourcePath).toLowerCase(),
    line: location.line || urlLocation.line,
    column: location.column || urlLocation.column
  };
}

module.exports = {
  normalizeLocalDocumentResource,
  unwrapDocumentDestination
};
