import assert from "node:assert/strict";
import { test } from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { gfm } from "micromark-extension-gfm";
import { remarkMessageFormatting } from "../src/message-formatting.ts";

function formatted(source) {
  const root = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  remarkMessageFormatting()(root, { value: source });
  return root;
}

function nodes(root, type) {
  return [...(root.type === type ? [root] : []), ...(root.children || []).flatMap(child => nodes(child, type))];
}

test("legacy underline renders without dropping historical trailing spaces", () => {
  const root = formatted("正文 ++重点句子。 ++ 结尾");
  assert.equal(nodes(root, "underline").length, 1);
  assert.equal(nodes(root, "underline")[0].children[0].value, "重点句子。 ");
});

test("code, arithmetic, math, escaped delimiters and link destinations remain literal", () => {
  for (const source of [
    "C++ 与 C++，i++ 和 ++index", "$a++b++c$", "$$a++b++c$$",
    "\\+\\+字面内容\\+\\+", "`++code++`", "``代码 ` ++code++``",
    "```cpp\n++index;\nindex++;\n```", "    ++code++",
    "[链接](https://example.com/C++/D++)", "https://example.com/++segment++",
    "$a**b**++c++$"
  ]) {
    const root = formatted(source);
    assert.equal(nodes(root, "underline").length, 0, source);
  }
  const root = formatted("[链接](https://example.com/C++/D++)");
  assert.equal(nodes(root, "link")[0].url, "https://example.com/C++/D++");
});

test("portable underline keeps nested emphasis and links", () => {
  const root = formatted('<u>正文 **重点** 与 [链接](https://example.com)</u>');
  const underlined = nodes(root, "underline");
  assert.equal(underlined.length, 1);
  assert.equal(nodes(underlined[0], "strong").length, 1);
  assert.equal(nodes(underlined[0], "link").length, 1);
});

test("H4 and H5 retain heading levels even when completely underlined", () => {
  const root = formatted("#### <u>章节</u>\n\n---\n\n##### <u>小节</u>");
  assert.deepEqual(nodes(root, "heading").map(node => node.depth), [4, 5]);
  assert.equal(nodes(root, "thematicBreak").length, 1);
});

test("legacy oversized underlined emphasis remains a bold paragraph", () => {
  const root = formatted("## <u>旧版正文重点</u>");
  assert.equal(nodes(root, "heading").length, 0);
  assert.equal(nodes(root, "strong").length, 1);
});

test("HTML with attributes never becomes an executable formatting element", () => {
  const root = formatted('<u onclick="alert(1)">内容</u>');
  assert.equal(nodes(root, "underline").length, 0);
  assert.equal(nodes(root, "html").length, 0);
  assert.ok(nodes(root, "text").some(node => node.value.includes("onclick")));
});
