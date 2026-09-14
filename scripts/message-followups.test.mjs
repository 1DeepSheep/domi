import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import { parseMessageFollowup, remarkCodexFollowups } from "../src/message-followups.ts";

const marker = ':codex-followup[准备创始人访谈]{prompt="整理按优先级排序的访谈提纲。"}';
function transform(source) {
  const tree = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
  const followups = new Map();
  remarkCodexFollowups(followups)(tree, { value: source });
  return { tree, followups };
}

test("parses single and double colon markers with Chinese labels and a complete request", () => {
  for (const source of [marker, `:${marker}`, ` ${marker} `]) {
    assert.deepEqual(parseMessageFollowup(source), { label: "准备创始人访谈", prompt: "整理按优先级排序的访谈提纲。" });
  }
});

test("decodes supported label and JSON prompt escapes without interpreting content", () => {
  const prompt = '比较“新产品”与 "旧产品"，路径 C:\\资料\\客户；\n下一行：<button onclick="alert(1)">不执行</button>。';
  const source = String.raw`:codex-followup[比较\[产品\]与路径\\样本]{prompt=` + JSON.stringify(prompt) + "}";
  assert.deepEqual(parseMessageFollowup(source), { label: "比较[产品]与路径\\样本", prompt });
  assert.equal(parseMessageFollowup(String.raw`:codex-followup[中文]{prompt="\u4e2d\u6587"}`)?.prompt, "中文");
});

test("rejects incomplete chunks, extra attributes and non-directive prose", () => {
  for (const source of [
    marker.slice(0, -1), marker.slice(0, -2), marker.slice(0, 20),
    `前面的解释 ${marker}`, `${marker} 后面的解释`, `${marker}\n更多内容`,
    `“${marker}”`, `"${marker}"`, `\\${marker}`, `:::${marker.slice(1)}`,
    marker.replace('prompt=', 'href='), marker.replace(/}$/, ' url="https://example.com"}'),
    marker.replace(/}$/, ' prompt="重复属性"}'), marker.replace('"整理按优先级排序的访谈提纲。"', "'整理提纲'"),
    ':codex-followup[]{prompt="请求"}', ':codex-followup[名称]{prompt=" "}',
    String.raw`:codex-followup[名称]{prompt="未知\q转义"}`,
    String.raw`:codex-followup[名称]{prompt="空字节\u0000"}`,
    ':codex-followup[名称]{prompt="真正\n换行"}',
    ':codex-followup[名称\n换行]{prompt="请求"}'
  ]) assert.equal(parseMessageFollowup(source), null, source);
});

test("bounds label, prompt and source sizes", () => {
  assert.equal(parseMessageFollowup(`:codex-followup[${"名".repeat(161)}]{prompt="请求"}`), null);
  assert.equal(parseMessageFollowup(`:codex-followup[名称]{prompt=${JSON.stringify("文".repeat(8_001))}}`), null);
  assert.equal(parseMessageFollowup(" ".repeat(16_385)), null);
  assert.equal(parseMessageFollowup(`:codex-followup[${"名".repeat(160)}]{prompt=${JSON.stringify("文".repeat(8_000))}}`)?.prompt.length, 8_000);
});

test("reads raw paragraph positions so Markdown escapes cannot alter a request", () => {
  const prompt = String.raw`核验 C:\材料\新产品，包括 "标签"、[产品](https://example.com) 和 **指标**。`;
  const source = `- :codex-followup[准备提纲]{prompt=${JSON.stringify(prompt)}}\n- :${marker}`;
  const { tree, followups } = transform(source);
  assert.deepEqual([...followups.values()], [
    { label: "准备提纲", prompt },
    { label: "准备创始人访谈", prompt: "整理按优先级排序的访谈提纲。" }
  ]);
  assert.equal(tree.children[0].type, "list");
  for (const item of tree.children[0].children) {
    assert.deepEqual(item.data.hProperties.className, ["message-followup-item"]);
    assert.equal(item.children[0].children[0].type, "domiFollowup");
    assert.deepEqual(Object.keys(item.children[0].children[0].data.hProperties), ["data-domi-followup-id"]);
  }
  assert.equal(JSON.stringify(tree).includes("domi-followup:"), false);
});

test("leaves code, quoted instructions, HTML, headings, tables and inline examples untouched", () => {
  for (const source of [
    `\`${marker}\``, `\`\`\`text\n${marker}\n\`\`\``, `    ${marker}`,
    `> ${marker}`, `> - ${marker}`, `- > ${marker}`,
    `<div>\n${marker}\n</div>`, `<span>${marker}</span>`,
    `# ${marker}`, `| 示例 |\n| --- |\n| ${marker} |`,
    `例子：${marker}`, `[${marker}](https://example.com)`, `**${marker}**`,
    marker.replace(":codex", "&#58;codex"), `\\${marker}`
  ]) {
    const before = fromMarkdown(source, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
    const { tree, followups } = transform(source);
    assert.equal(followups.size, 0, source);
    assert.deepEqual(tree, before, source);
  }
});

test("multiple suggestions coexist with ordinary links and unrelated list contents", () => {
  const source = `[普通链接](https://example.com)\n\n${marker}\n\n- ${marker}\n\n  保留后续解释\n\n- 普通列表项`;
  const { tree, followups } = transform(source);
  assert.equal(followups.size, 2);
  assert.equal(tree.children[0].children[0].url, "https://example.com");
  const list = tree.children[2];
  assert.equal(list.children[0].data, undefined, "A list item containing ordinary prose keeps its standard list presentation");
  assert.equal(list.children[0].children[1].children[0].value, "保留后续解释");
  assert.equal(list.children[1].children[0].children[0].value, "普通列表项");
});

test("missing source or positions do not guess an action from decoded AST text", () => {
  const tree = { type: "root", children: [{ type: "paragraph", children: [{ type: "text", value: marker }] }] };
  const followups = new Map([["stale", { label: "旧操作", prompt: "旧请求" }]]);
  remarkCodexFollowups(followups)(tree, { value: marker });
  assert.equal(followups.size, 0);
  assert.equal(tree.children[0].children[0].type, "text");
});
