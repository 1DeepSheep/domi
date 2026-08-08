const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  prepareMarkdownForFeishu,
  verifyFeishuMarkdownImport
} = require("../electron/markdown-feishu-fidelity.cjs");

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-markdown-fidelity-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "one.png"), "one");
  fs.writeFileSync(path.join(root, "assets", "two.png"), "two");
  const sourcePath = path.join(root, "report.md");
  const markdown = `# 一级标题

第一段含 **粗体**、*斜体*、~~删除~~、[来源甲](https://example.com/a) 和 [来源乙](https://example.com/b)。

- 第一项
  - 嵌套甲
  - 嵌套乙
- [x] 已完成
- [ ] 待处理

| 公司 | 评级 |
|:---|---:|
| 甲 | A |
| 乙 | B |

\`\`\`js
const answer = 42;
\`\`\`

![图片甲](assets/one.png)
![图片乙](assets/two.png)

## 二级标题

最后结论。
`;
  fs.writeFileSync(sourcePath, markdown);
  const prepared = prepareMarkdownForFeishu({ markdown, sourcePath, libraryRoot: root, title: "报告" });
  assert.equal(prepared.fidelity.status, "ready");
  let imported = prepared.content;
  for (const [index, asset] of prepared.assets.entries()) {
    imported = imported.replace(
      `${asset.marker} · ${asset.caption}`,
      `![${asset.caption}](https://docs.invalid/media/${index + 1}.png)`
    );
  }
  assert.equal(verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: imported }).status, "passed");
  return { root, sourcePath, prepared, imported };
}

test("strict readback rejects every ordered structure mutation", (t) => {
  const { prepared, imported } = fixture(t);
  const mutations = new Map([
    ["heading depth", imported.replace("# 一级标题", "## 一级标题")],
    ["list hierarchy", imported.replace("  - 嵌套乙", "- 嵌套乙")],
    ["list order", imported.replace("  - 嵌套甲\n  - 嵌套乙", "  - 嵌套乙\n  - 嵌套甲")],
    ["task checked state", imported.replace('<checkbox done="true">', '<checkbox done="false">')],
    ["table matrix", imported.replace("| 甲 | A |\n| 乙 | B |", "| 乙 | B |\n| 甲 | A |")],
    ["code language", imported.replace("```js", "```ts")],
    ["code body", imported.replace("const answer = 42;", "const answer = 43;")],
    ["link URL", imported.replace("https://example.com/a", "https://example.com/changed")],
    ["link label", imported.replace("[来源甲]", "[来源丙]")],
    ["link order", imported.replace(
      "[来源甲](https://example.com/a) 和 [来源乙](https://example.com/b)",
      "[来源乙](https://example.com/b) 和 [来源甲](https://example.com/a)"
    )],
    ["image alt", imported.replace("![图片甲]", "![图片改名]")],
    ["image order", imported.replace(
      "![图片甲](https://docs.invalid/media/1.png)\n![图片乙](https://docs.invalid/media/2.png)",
      "![图片乙](https://docs.invalid/media/2.png)\n![图片甲](https://docs.invalid/media/1.png)"
    )],
    ["body removal", imported.replace("最后结论。", "")],
    ["body insertion", imported.replace("最后结论。", "额外内容。\n\n最后结论。")]
  ]);
  for (const [name, changed] of mutations) {
    const verified = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: changed });
    assert.equal(verified.status, "failed", name);
  }
});

test("strict readback rejects any residual or missing asset marker", (t) => {
  const { prepared, imported } = fixture(t);
  const asset = prepared.assets[0];
  const residual = imported.replace(
    "![图片甲](https://docs.invalid/media/1.png)",
    `${asset.marker} · ${asset.caption}`
  );
  const verified = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: residual });
  assert.equal(verified.status, "failed");
  assert.deepEqual(verified.residualMarkers, [asset.marker]);

  const malformedPrepared = { ...prepared, content: prepared.content.replace(asset.marker, "marker-lost") };
  const malformed = verifyFeishuMarkdownImport({ prepared: malformedPrepared, fetchedMarkdown: imported });
  assert.equal(malformed.status, "failed");
  assert.deepEqual(malformed.missingPreparedMarkers, [asset.marker]);
});

test("preflight blocks syntax whose full fidelity cannot be proven", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-markdown-blocked-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cases = new Map([
    ["remote-image-not-verifiable", "![远程图](https://example.com/image.png)"],
    ["data-image-not-verifiable", "![内嵌图](data:image/png;base64,AAAA)"],
    ["relative-links-require-target-map", "[本地纪要](notes/meeting.md)"],
    ["relative-links-require-target-map-reference", "[本地纪要][meeting]\n\n[meeting]: notes/meeting.md"],
    ["footnotes-kept-as-text", "正文[^1]\n\n[^1]: 脚注"],
    ["unsupported-html-visible-text", "<details><summary>展开</summary>正文</details>"],
    ["image-title-not-verifiable", '![图](https://example.com/image.png "说明")'],
    ["reserved-image-marker-collision", "正文误含 domi飞书图片1-deadbeef 标记"]
  ]);
  for (const [name, markdown] of cases) {
    const sourcePath = path.join(root, `${name}.md`);
    fs.writeFileSync(sourcePath, markdown);
    const prepared = prepareMarkdownForFeishu({ markdown, sourcePath, libraryRoot: root, title: name });
    assert.equal(prepared.fidelity.status, "blocked", name);
    const codes = prepared.fidelity.degradations.map((item) => item.code);
    const expectedCode = name === "relative-links-require-target-map-reference"
      ? "relative-links-require-target-map"
      : name;
    assert.ok(codes.includes(expectedCode), `${name}: ${codes.join(", ")}`);
    const sameReadback = verifyFeishuMarkdownImport({ prepared, fetchedMarkdown: prepared.content });
    assert.equal(sameReadback.status, "failed", `${name} must never return passed after blocked preflight`);
  }

  const nestedTaskPath = path.join(root, "nested-task-list-visual-fallback.md");
  const nestedTaskMarkdown = "- 父项\n  - [x] 子任务";
  fs.writeFileSync(nestedTaskPath, nestedTaskMarkdown);
  const nestedTask = prepareMarkdownForFeishu({
    markdown: nestedTaskMarkdown,
    sourcePath: nestedTaskPath,
    libraryRoot: root,
    title: "嵌套任务"
  });
  assert.equal(nestedTask.fidelity.status, "blocked");
  assert.match(nestedTask.content, /^  - ☑ 子任务$/m);
  assert.equal(verifyFeishuMarkdownImport({
    prepared: nestedTask,
    fetchedMarkdown: nestedTask.content
  }).status, "failed");

  fs.mkdirSync(path.join(root, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "assets", "caption.png"), "caption");
  const titledLocalMarkdown = '![本地图](assets/caption.png "独立说明")';
  const titledLocalPath = path.join(root, "titled-local.md");
  fs.writeFileSync(titledLocalPath, titledLocalMarkdown);
  const titledLocal = prepareMarkdownForFeishu({
    markdown: titledLocalMarkdown,
    sourcePath: titledLocalPath,
    libraryRoot: root,
    title: "本地带说明图片"
  });
  assert.equal(titledLocal.fidelity.status, "blocked");
  assert.ok(titledLocal.fidelity.degradations.some((item) => item.code === "image-title-not-verifiable"));
});
