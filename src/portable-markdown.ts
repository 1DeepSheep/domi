import type { Editor, JSONContent } from "@tiptap/core";
import { mapLegacyUnderline } from "../shared/legacy-underline.mjs";

export function serializePortableMarkdown(editor: Editor): string {
  if (!editor.markdown) return editor.getMarkdown();
  const document = structuredClone(editor.getJSON());
  const source = JSON.stringify(document);
  let placeholder = "\uE000domi-literal-plus\uE001";
  while (source.includes(placeholder)) placeholder += "x";

  function protectLiteralDelimiters(node: JSONContent) {
    if (node.type === "codeBlock" || node.marks?.some(mark => mark.type === "code")) return;
    if (node.content?.some(child => child.type === "text")) {
      // The editor has already distinguished underline marks from literal
      // text. Tiptap does not escape +, so protect only literal delimiters that
      // could be read as legacy underline on reopen. Math and code stay intact;
      // link destinations are attributes and never enter this text traversal.
      // Scan each inline block together: a literal pair can span bold/link
      // text nodes. Mask code while retaining UTF-16 offsets into the originals.
      let inlineText = "";
      const spans: { node: JSONContent; start: number }[] = [];
      for (const child of node.content) {
        if (child.type === "text" && child.text) {
          if (child.marks?.some(mark => mark.type === "code")) inlineText += "\uFFFC".repeat(child.text.length);
          else {
            spans.push({ node: child, start: inlineText.length });
            // Backticks/backslashes in a text node are already literal, not
            // Markdown code/escape syntax. Do not let them hide a delimiter.
            inlineText += child.text.replace(/[\\`]/g, "\uFFFC");
          }
        } else inlineText += child.type === "hardBreak" ? "\n" : "\uFFFC";
      }
      const delimiterPositions = new Set<number>();
      mapLegacyUnderline(inlineText, match => {
        for (const position of [match.start, match.start + 1, match.contentEnd, match.contentEnd + 1]) delimiterPositions.add(position);
        return "";
      });
      for (const span of spans) {
        span.node.text = span.node.text!.split("").map((character, index) =>
          delimiterPositions.has(span.start + index) ? placeholder : character
        ).join("");
      }
      return;
    }
    node.content?.forEach(protectLiteralDelimiters);
  }
  protectLiteralDelimiters(document);
  return editor.markdown.serialize(document).split(placeholder).join("\\+");
}
