const CALLOUT_LABELS: Record<string, string> = {
  abstract: "摘要",
  bug: "问题",
  caution: "警告",
  danger: "危险",
  example: "示例",
  failure: "失败",
  info: "提示",
  important: "重点",
  note: "备注",
  question: "问题",
  quote: "引用",
  success: "完成",
  tip: "建议",
  todo: "待办",
  warning: "注意"
};

function transformOutsideInlineCode(line: string, transform: (value: string) => string) {
  let result = "";
  let cursor = 0;

  while (cursor < line.length) {
    const tickStart = line.indexOf("`", cursor);
    if (tickStart < 0) {
      result += transform(line.slice(cursor));
      break;
    }

    result += transform(line.slice(cursor, tickStart));
    let tickEnd = tickStart + 1;
    while (line[tickEnd] === "`") tickEnd += 1;
    const marker = line.slice(tickStart, tickEnd);
    const closingTick = line.indexOf(marker, tickEnd);

    if (closingTick < 0) {
      result += transform(line.slice(tickStart));
      break;
    }

    result += line.slice(tickStart, closingTick + marker.length);
    cursor = closingTick + marker.length;
  }

  return result;
}

function transformOutsideCodeFences(markdown: string, transform: (line: string) => string) {
  const eol = markdown.includes("\r\n") ? "\r\n" : "\n";
  const lines = markdown.split(/\r?\n/);
  let fenceCharacter = "";
  let fenceLength = 0;

  return lines.map((line) => {
    const fence = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      const marker = fence[1];
      if (!fenceCharacter) {
        fenceCharacter = marker[0];
        fenceLength = marker.length;
      } else if (marker[0] === fenceCharacter && marker.length >= fenceLength) {
        fenceCharacter = "";
        fenceLength = 0;
      }
      return line;
    }

    if (fenceCharacter) return line;
    return transformOutsideInlineCode(line, transform);
  }).join(eol);
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function encodeInternalToken(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function escapeLinkLabel(value: string) {
  return value.replace(/([\\\[\]])/g, "\\$1");
}

function unescapeLinkLabel(value: string) {
  return value.replace(/\\([\\\[\]])/g, "$1");
}

function replaceWikiLinksForEditor(value: string) {
  return value.replace(/\\?\[\\?\[([^\]\n]+?)\\?\]\\?\]/g, (_match, inner: string) => {
    const separator = inner.lastIndexOf("|");
    const target = (separator >= 0 ? inner.slice(0, separator) : inner).trim();
    const label = (separator >= 0 ? inner.slice(separator + 1) : target).trim() || target;
    if (!target) return _match;
    return `[${escapeLinkLabel(label)}](domi-wiki:${encodeInternalToken(target)})`;
  });
}

function replaceCalloutForEditor(value: string) {
  const match = value.match(/^(\s*>\s*)\\?\[!([a-z0-9_-]+)\\?\]([+-]?)(?:\s+(.*))?$/i);
  if (!match) return value;

  const [, prefix, rawType, fold, rawTitle = ""] = match;
  const type = rawType.toLowerCase();
  const label = CALLOUT_LABELS[type] || "提示";
  const token = encodeInternalToken(`${type}${fold}`);
  const title = rawTitle.trim();
  return `${prefix}[${label}](domi-callout:${token})${title ? ` ${title}` : ""}  `;
}

function restoreInternalLinks(value: string) {
  const calloutsRestored = value.replace(
    /\[((?:\\.|[^\]])+)\]\(<?domi-callout:([^)>\s]+)>?\)/g,
    (_match, _label: string, encodedToken: string) => {
      const token = safeDecode(encodedToken);
      const fold = token.endsWith("+") || token.endsWith("-") ? token.slice(-1) : "";
      const type = fold ? token.slice(0, -1) : token;
      return `[!${type}]${fold}`;
    }
  );

  return calloutsRestored.replace(
    /\[((?:\\.|[^\]])+)\]\(<?domi-wiki:([^)>\s]+)>?\)/g,
    (_match, rawLabel: string, encodedTarget: string) => {
      const label = unescapeLinkLabel(rawLabel);
      const target = safeDecode(encodedTarget);
      return label === target ? `[[${target}]]` : `[[${target}|${label}]]`;
    }
  );
}

export function prepareMarkdownForEditor(markdown: string) {
  return transformOutsideCodeFences(markdown, (line) =>
    replaceWikiLinksForEditor(replaceCalloutForEditor(line))
  );
}

export function restoreMarkdownFromEditor(markdown: string) {
  return transformOutsideCodeFences(markdown, (line) =>
    restoreInternalLinks(line).replace(/(\[![a-z0-9_-]+\][+-]?(?:\s+.*?)?)\s{2}$/i, "$1")
  );
}
