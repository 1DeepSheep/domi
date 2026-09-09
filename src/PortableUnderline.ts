import Underline from "@tiptap/extension-underline";
import { findLegacyUnderline } from "../shared/legacy-underline.mjs";

// Keep underline as an editor mark, but save portable HTML instead of Tiptap's
// private ++ delimiter. All DOM attributes, commands and shortcuts are inherited.
export const PortableUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(source) {
      return source.search(/<u\s*>|\+\+/i);
    },
    tokenize(source, tokens, lexer) {
      // Parse only our inline formatting tag, so nested Markdown marks and
      // links survive. The default HTML parser treats their source as text.
      const html = /^<u\s*>([^\n]*?)<\/u\s*>/i.exec(source);
      if (html) return { type: "underline", raw: html[0], text: html[1], tokens: lexer.inlineTokens(html[1]) };
      const prefix = tokens.map(token => token.raw || token.text || "").join("");
      // Marked can tokenize the display text of an explicit URL link again.
      // A ++ path/query segment stays part of that URL, never a formatting mark.
      if (/(?:https?:\/\/|www\.)[^\s<>]*$/i.test(prefix)) return undefined;
      const legacy = findLegacyUnderline(source, { prefix });
      if (!legacy || legacy.start !== 0) return undefined;
      return { type: "underline", raw: source.slice(0, legacy.end), text: legacy.content, tokens: lexer.inlineTokens(legacy.content) };
    }
  }
});
