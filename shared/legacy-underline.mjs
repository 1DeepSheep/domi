// This is an inline delimiter scanner, not a Markdown parser. Callers must keep
// frontmatter, HTML, link destinations, block code and other opaque AST nodes
// out of the input. Prefix carries the original text preceding a tokenizer's
// substring; every returned offset remains relative to source, in UTF-16 units.
const WORD_OR_PLUS = /[A-Za-z0-9_+]/;
const SPACE = /\s/u;

function escapedAt(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function runEnd(text, index, character) {
  while (text[index] === character) index += 1;
  return index;
}

function lineEnd(text, index) {
  while (index < text.length && text[index] !== "\n" && text[index] !== "\r") index += 1;
  return index;
}

function matchingRun(text, from, character, length, maximum = text.length) {
  for (let index = from; index < maximum;) {
    if (text[index] !== character) { index += 1; continue; }
    const end = runEnd(text, index, character);
    if (end - index === length && (character === "`" || !escapedAt(text, index))) return end;
    index = end;
  }
  return -1;
}

function opaqueRanges(text) {
  const ranges = [];
  for (let index = 0; index < text.length;) {
    if (escapedAt(text, index)) { index += 1; continue; }
    const character = text[index];
    if (character === "`") {
      const openingEnd = runEnd(text, index, "`");
      const closingEnd = matchingRun(text, openingEnd, "`", openingEnd - index);
      // Unclosed inline code is ambiguous. Leave the rest of its line alone;
      // a complete code span may legitimately cross line boundaries.
      const end = closingEnd < 0 ? lineEnd(text, openingEnd) : closingEnd;
      ranges.push({ start: index, end }); index = end; continue;
    }
    if (character === "$" && (text[index + 1] === "$" || (text[index + 1] && !SPACE.test(text[index + 1])))) {
      const openingEnd = runEnd(text, index, "$");
      const length = openingEnd - index;
      const maximum = length === 1 ? lineEnd(text, openingEnd) : text.length;
      const closingEnd = matchingRun(text, openingEnd, "$", length, maximum);
      const end = closingEnd < 0 ? maximum : closingEnd;
      ranges.push({ start: index, end }); index = end; continue;
    }
    if (character === "\\" && ["(", "["].includes(text[index + 1])) {
      const close = text[index + 1] === "(" ? "\\)" : "\\]";
      const maximum = close === "\\)" ? lineEnd(text, index + 2) : text.length;
      let end = maximum;
      for (let cursor = index + 2; cursor < maximum - 1; cursor += 1) {
        if (text.startsWith(close, cursor) && !escapedAt(text, cursor)) { end = cursor + 2; break; }
      }
      ranges.push({ start: index, end }); index = end; continue;
    }
    index += 1;
  }
  return ranges;
}

function* scan(source, options = {}) {
  if (typeof source !== "string") throw new TypeError("Legacy underline source must be a string.");
  if (options.insideMath === true) return;
  const prefix = options.prefix ?? options.previousText ?? options.previousChar ?? "";
  if (typeof prefix !== "string") throw new TypeError("Legacy underline prefix must be a string.");
  const fromIndex = Number.isFinite(options.fromIndex) ? Math.max(0, Math.trunc(options.fromIndex)) : 0;
  const text = prefix + source, base = prefix.length;
  const ranges = opaqueRanges(text);
  let rangeIndex = 0, opening = -1;
  for (let index = base + fromIndex; index < text.length;) {
    while (ranges[rangeIndex]?.end <= index) rangeIndex += 1;
    const range = ranges[rangeIndex];
    if (range && range.start <= index) {
      // An inline code/math span may occur inside underlined prose. Its literal
      // delimiters are opaque, but a newline still terminates underline pairing.
      if (/[\r\n]/.test(text.slice(index, range.end))) opening = -1;
      index = range.end; continue;
    }
    if (text[index] === "\r" || text[index] === "\n") { opening = -1; index += 1; continue; }
    if (text[index] !== "+") { index += 1; continue; }
    const end = runEnd(text, index, "+");
    if (end - index !== 2 || escapedAt(text, index)) {
      if (end - index > 2 && !escapedAt(text, index)) opening = -1;
      index = end; continue;
    }
    const before = text[index - 1] || "", after = text[end] || "";
    const canClose = !WORD_OR_PLUS.test(after);
    if (opening >= 0 && canClose) {
      const contentStart = opening + 2, contentEnd = index;
      const content = text.slice(contentStart, contentEnd);
      if (content && content.trim()) {
        yield { start: opening - base, end: end - base,
          contentStart: contentStart - base, contentEnd: contentEnd - base, content };
      }
      opening = -1;
    } else {
      // An invalid intervening pair must not make the scanner swallow an
      // unrelated later phrase. Leading whitespace is invalid; trailing spaces
      // before a closing pair are retained for historical document compatibility.
      opening = !WORD_OR_PLUS.test(before) && after && !SPACE.test(after) && after !== "+" ? index : -1;
    }
    index = end;
  }
}

export function findLegacyUnderline(source, options = {}) {
  return scan(source, options).next().value ?? null;
}

// Use the same opaque regions when applying other inline presentation edits
// (for example removing an HTML underline wrapper for plain-text clipboard).
// Ranges cover code/math only; callers still protect other Markdown AST nodes.
export function legacyUnderlineOpaqueRanges(source) {
  if (typeof source !== "string") throw new TypeError("Legacy underline source must be a string.");
  return opaqueRanges(source);
}

export function mapLegacyUnderline(source, mapper, options = {}) {
  if (typeof mapper !== "function") throw new TypeError("Legacy underline mapper must be a function.");
  let cursor = 0, output = "";
  for (const match of scan(source, options)) {
    const replacement = mapper(match);
    if (typeof replacement !== "string") throw new TypeError("Legacy underline mapper must return a string.");
    output += source.slice(cursor, match.start) + replacement;
    cursor = match.end;
  }
  return output + source.slice(cursor);
}
