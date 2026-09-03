// Both hosts use this dependency-free tokenizer. HTML permits unquoted
// attributes and multiple resource attributes; neither may bypass single-file QA.
function decodeAttribute(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|colon);?/gi, (match, entity) => {
    if (entity[0] === "#") {
      const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", colon: ":" })[entity.toLowerCase()] || match;
  });
}

function attributesIn(source) {
  const attributes = [];
  const pattern = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (const match of String(source || "").matchAll(pattern)) {
    attributes.push({ name: match[1].toLowerCase(), value: decodeAttribute(match[2] ?? match[3] ?? match[4] ?? "") });
  }
  return attributes;
}

function htmlAttribute(source, name) {
  return attributesIn(source).find((attribute) => attribute.name === name.toLowerCase())?.value || "";
}

function elementsIn(html) {
  const elements = [];
  const source = String(html || "").replace(/<!--[\s\S]*?-->/g, "");
  const pattern = /<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
  for (const match of source.matchAll(pattern)) {
    elements.push({ tag: match[1].toLowerCase(), attributes: attributesIn(match[2]), source: match[0] });
  }
  return elements;
}

function slideElementsIn(html) {
  return elementsIn(html).filter((element) => element.attributes.some((attribute) => (
    attribute.name === "class" && attribute.value.split(/\s+/).includes("slide")
  )));
}

// URL tokens end at whitespace, not commas: data URLs contain a comma.
function srcsetReferences(value) {
  const references = [];
  let rest = String(value || "");
  while (rest.length) {
    rest = rest.replace(/^[\s,]+/, "");
    if (!rest) break;
    const token = rest.match(/^\S+/)?.[0] || "";
    if (!token) break;
    rest = rest.slice(token.length);
    references.push(token.replace(/,+$/, ""));
    if (token.endsWith(",")) continue;
    let depth = 0;
    let index = 0;
    for (; index < rest.length; index += 1) {
      if (rest[index] === "(") depth += 1;
      if (rest[index] === ")") depth = Math.max(0, depth - 1);
      if (rest[index] === "," && depth === 0) { index += 1; break; }
    }
    rest = rest.slice(index);
  }
  return references;
}

function externalReference(value) {
  const reference = String(value || "").trim();
  return reference && !reference.startsWith("#") && !/^data:/i.test(reference) ? reference : "";
}

function externalLocalResourceIn(html) {
  const resourceTags = new Set(["link", "base", "script", "img", "image", "source", "video", "audio", "iframe", "embed", "object", "use", "track", "input", "body", "table", "td", "th"]);
  const resourceAttributes = new Set(["src", "srcset", "href", "xlink:href", "poster", "data", "background"]);
  for (const element of elementsIn(html)) {
    if (!resourceTags.has(element.tag)) continue;
    for (const attribute of element.attributes) {
      if (!resourceAttributes.has(attribute.name)) continue;
      const references = attribute.name === "srcset" ? srcsetReferences(attribute.value) : [attribute.value];
      for (const reference of references) {
        const external = externalReference(reference);
        if (external) return external;
      }
    }
  }
  if (/@import\s+(?:url\s*\()?/i.test(html)) return "CSS @import";
  for (const match of String(html || "").matchAll(/url\(\s*(["']?)(.*?)\1\s*\)/gi)) {
    const external = externalReference(decodeAttribute(match[2]));
    if (external) return external;
  }
  return "";
}

module.exports = { htmlAttribute, externalLocalResourceIn, slideElementsIn, srcsetReferences };
