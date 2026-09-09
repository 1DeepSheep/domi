const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildMarkdownClipboardPayload,
  detectImageMime,
  normalizeLegacyUnderlineMarkdown,
  resolveMarkdownImagePath,
  savePastedMarkdownImage
} = require("../electron/markdown-assets.cjs");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl9sAAAAASUVORK5CYII=",
  "base64"
);

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domi-markdown-assets-"));
  const outsideImage = `${root}-outside.png`;
  const outsideDirectory = `${root}-outside`;
  try {
    const documentPath = path.join(root, "研究纪要.md");
    fs.writeFileSync(documentPath, "# 研究纪要\n", "utf8");

    assert.equal(detectImageMime(png), "image/png");
    const first = await savePastedMarkdownImage({
      documentPath,
      name: "截图.png",
      type: "image/png",
      data: png
    });
    assert.match(first.relativePath, /^assets\/image-\d{14}-[a-f0-9]{12}\.png$/);
    assert.equal(fs.readFileSync(first.path).equals(png), true);

    const duplicate = await savePastedMarkdownImage({
      documentPath,
      name: "另一张截图.png",
      type: "image/png",
      data: png
    });
    assert.equal(duplicate.path, first.path, "identical images should reuse the same asset");
    assert.equal(
      resolveMarkdownImagePath(documentPath, first.relativePath),
      fs.realpathSync(first.path)
    );

    fs.writeFileSync(outsideImage, png);
    assert.throws(
      () => resolveMarkdownImagePath(documentPath, "../outside.png"),
      /所在文件夹内/
    );

    const libraryRoot = path.join(root, "资料库");
    const noteDirectory = path.join(libraryRoot, "项目", "纪要");
    const materialDirectory = path.join(libraryRoot, "项目", "原始材料");
    fs.mkdirSync(noteDirectory, { recursive: true });
    fs.mkdirSync(materialDirectory, { recursive: true });
    const siblingDocumentPath = path.join(noteDirectory, "项目纪要.md");
    const siblingImagePath = path.join(materialDirectory, "流程图.png");
    fs.writeFileSync(siblingDocumentPath, "# 项目纪要\n", "utf8");
    fs.writeFileSync(siblingImagePath, png);
    assert.equal(
      resolveMarkdownImagePath(
        siblingDocumentPath,
        "../原始材料/流程图.png",
        { rootPath: libraryRoot }
      ),
      fs.realpathSync(siblingImagePath),
      "a trusted library may reference images in a sibling project folder"
    );
    assert.throws(
      () => resolveMarkdownImagePath(siblingDocumentPath, "../原始材料/流程图.png"),
      /所在文件夹内/,
      "the wider boundary must be granted only by the host-provided library root"
    );
    assert.throws(
      () => resolveMarkdownImagePath(siblingDocumentPath, outsideImage, { rootPath: libraryRoot }),
      /当前资料库内/,
      "an absolute image outside the trusted library must remain blocked"
    );
    const escapedImagePath = path.join(materialDirectory, "越界.png");
    fs.symlinkSync(outsideImage, escapedImagePath);
    assert.throws(
      () => resolveMarkdownImagePath(
        siblingDocumentPath,
        "../原始材料/越界.png",
        { rootPath: libraryRoot }
      ),
      /允许的资料库范围内/,
      "a symlink inside the library must not escape the trusted real path"
    );

    const siblingClipboard = buildMarkdownClipboardPayload({
      documentPath: siblingDocumentPath,
      rootPath: libraryRoot,
      markdown: "![流程图](../原始材料/流程图.png)"
    });
    assert.equal(siblingClipboard.imageCount, 1);
    assert.equal(siblingClipboard.missingImageCount, 0);
    assert.match(siblingClipboard.html, /data:image\/png;base64,/);

    fs.mkdirSync(outsideDirectory);
    const unsafeNoteDirectory = path.join(libraryRoot, "项目", "不安全纪要");
    fs.mkdirSync(unsafeNoteDirectory, { recursive: true });
    const unsafeDocumentPath = path.join(unsafeNoteDirectory, "纪要.md");
    fs.writeFileSync(unsafeDocumentPath, "# 纪要\n", "utf8");
    fs.symlinkSync(outsideDirectory, path.join(unsafeNoteDirectory, "assets"));
    await assert.rejects(
      () => savePastedMarkdownImage({
        documentPath: unsafeDocumentPath,
        rootPath: libraryRoot,
        name: "截图.png",
        type: "image/png",
        data: png
      }),
      /图片附件目录实际位置不在允许的资料库范围内/,
      "a symlinked asset directory must not write outside the trusted library"
    );
    assert.deepEqual(fs.readdirSync(outsideDirectory), []);

    const markdown = [
      "---",
      "project: domi",
      "---",
      "# 研究纪要",
      "",
      `![现场截图](${first.relativePath})`,
      "",
      "结论。"
    ].join("\n");
    const clipboard = buildMarkdownClipboardPayload({
      documentPath,
      markdown
    });
    assert.equal(clipboard.text, markdown);
    assert.equal(clipboard.imageCount, 1);
    assert.equal(clipboard.missingImageCount, 0);
    assert.match(clipboard.html, /data:image\/png;base64,/);
    assert.doesNotMatch(clipboard.html, /project: domi/, "frontmatter should not enter rich clipboard HTML");

    const emphasized = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "普通文字，++需要重点关注的投资判断++。"
    });
    assert.match(
      emphasized.html,
      /<u style="text-decoration:underline;text-underline-offset:2px;">需要重点关注的投资判断<\/u>/,
      "domi underline markdown must remain underlined in rich clipboard HTML"
    );
    assert.doesNotMatch(emphasized.html, /\+\+需要重点关注的投资判断\+\+/);
    assert.doesNotMatch(emphasized.text, /\+\+/);

    const htmlUnderline = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "- <u>X2.0统一实时交互视频模型</u>"
    });
    assert.match(
      htmlUnderline.html,
      /<u style="text-decoration:underline;text-underline-offset:2px;">X2\.0统一实时交互视频模型<\/u>/,
      "HTML underline emitted by the editor must become portable rich text"
    );
    assert.doesNotMatch(htmlUnderline.html, /&lt;\/?u/);
    assert.doesNotMatch(htmlUnderline.text, /<\/?u/);
    assert.match(htmlUnderline.text, /X2\.0统一实时交互视频模型/);

    const multilineHtmlUnderline = buildMarkdownClipboardPayload({
      documentPath,
      markdown: [
        "- <u>",
        "  跨行重点内容",
        "  </u>"
      ].join("\n")
    });
    assert.match(
      multilineHtmlUnderline.html,
      /<u style="text-decoration:underline;text-underline-offset:2px;">跨行重点内容<\/u>/
    );
    assert.doesNotMatch(multilineHtmlUnderline.html, /&lt;\/?u/);

    const emphasizedHeading = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "## ++团队的核心组合不是单一 EDA 工具团队，而是把 AI/算法、EDA 自动化与芯片量产交付放在同一闭环中。++"
    });
    assert.match(
      emphasizedHeading.html,
      /<p><strong><u style="text-decoration:underline;text-underline-offset:2px;">团队的核心组合不是单一 EDA 工具团队，[^<]+<\/u><\/strong><\/p>/,
      "an underlined emphasis sentence must paste as normal bold body text"
    );
    assert.doesNotMatch(emphasizedHeading.html, /<h[1-6]\b/i);
    assert.doesNotMatch(emphasizedHeading.text, /^\s*#{1,6}\s/m);
    assert.doesNotMatch(emphasizedHeading.text, /\+\+/);

    const htmlEmphasizedHeading = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "## <u>编辑器保存出的重点判断</u>"
    });
    assert.match(
      htmlEmphasizedHeading.html,
      /<p><strong><u style="text-decoration:underline;text-underline-offset:2px;">编辑器保存出的重点判断<\/u><\/strong><\/p>/
    );
    assert.doesNotMatch(htmlEmphasizedHeading.html, /<h[1-6]\b/i);
    assert.equal(htmlEmphasizedHeading.text, "编辑器保存出的重点判断");

    const realHeading = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "## 产品与技术"
    });
    assert.match(realHeading.html, /<h2>产品与技术<\/h2>/);

    const tableBreak = buildMarkdownClipboardPayload({
      documentPath,
      markdown: [
        "| 工作经历 |",
        "| --- |",
        "| IBM<br />Dell EMC<br>趋动科技 |"
      ].join("\n")
    });
    assert.match(
      tableBreak.html,
      /<td[^>]*style="[^"]*border:1px solid #ddd[^\"]*">IBM<br>Dell EMC<br>趋动科技<\/td>/,
      "table break markup must become real rich-text line breaks"
    );
    assert.doesNotMatch(tableBreak.html, /&lt;br/);
    assert.doesNotMatch(tableBreak.text, /<br\s*\/?\s*>/i);
    assert.match(tableBreak.text, /IBM\nDell EMC\n趋动科技/);

    const literalUnderlineSyntax = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "`++代码示例++`"
    });
    assert.match(literalUnderlineSyntax.html, /<code>\+\+代码示例\+\+<\/code>/);
    assert.doesNotMatch(literalUnderlineSyntax.html, /<u\b/);

    const literalHtmlSyntax = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "`<u>代码下划线<\/u><br />`"
    });
    assert.match(literalHtmlSyntax.html, /<code>&lt;u&gt;代码下划线&lt;\/u&gt;&lt;br \/&gt;<\/code>/);
    assert.match(literalHtmlSyntax.text, /`<u>代码下划线<\/u><br \/>`/);

    const unsafeHtml = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "<script>alert('unsafe')</script>"
    });
    assert.doesNotMatch(unsafeHtml.html, /<script>/i);
    assert.match(unsafeHtml.html, /&lt;script&gt;/i);

    const missing = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "![缺失图片](assets/not-found.png)"
    });
    assert.equal(missing.imageCount, 0);
    assert.equal(missing.missingImageCount, 1);
    assert.match(missing.html, /未找到/);

    const portableDocument = [
      "#### ++主标题++",
      "",
      "正文 **粗体** 和 [普通链接](https://example.test/report)。",
      "",
      "---",
      "",
      "##### <u>子标题</u>",
      "",
      "- ++保留 **粗体** 与 [链接](https://example.test/C++/D++) 的判断++",
      "  - 第二层列表",
      "",
      "1. 顺序事项",
      "2. 后续事项",
      "",
      "| 指标 | 内容 |",
      "| --- | --- |",
      "| **数据** | <u>重点</u><br>第二行 |"
    ].join("\n");
    const portable = buildMarkdownClipboardPayload({ documentPath, markdown: portableDocument });
    assert.match(portable.html, /<h4><u[^>]*>主标题<\/u><\/h4>/);
    assert.match(portable.html, /<h5><u[^>]*>子标题<\/u><\/h5>/);
    assert.match(portable.html, /<hr>/);
    assert.match(portable.html, /<strong>粗体<\/strong>/);
    assert.match(portable.html, /<a href="https:\/\/example\.test\/C\+\+\/D\+\+">链接<\/a>/);
    assert.equal((portable.html.match(/<ul>/g) || []).length, 2);
    assert.match(portable.html, /<ol>/);
    assert.match(portable.html, /<table[^>]*>/);
    assert.match(portable.html, /<td[^>]*><u[^>]*>重点<\/u><br>第二行<\/td>/);
    assert.match(portable.text, /^#### 主标题/m);
    assert.match(portable.text, /^##### 子标题/m);
    assert.match(portable.text, /https:\/\/example\.test\/C\+\+\/D\+\+/);

    const literalCases = [
      "C++ 与 C++ 的比较；x++；a++b++c",
      "\\+\\+转义文字\\+\\+",
      "`++inline++` and ``a ` ++code++``",
      "`code\n++multiline++`",
      "    ++indented code++\n    <u>literal</u><br>",
      "```text\n++fenced++\n<u>literal</u><br>\n```",
      "~~~text\n++tilde fenced++\n~~~",
      "> ```text\n> ++quoted code++\n> ```",
      "- 条目\n\n      ++nested indented code++",
      "$a++b++c$ and $$x++y++z$$",
      "$$\na++b++c\n$$",
      "[链接](https://example.test/++segment++ \"++title++\")",
      "https://example.test/++segment++",
      "![++alt++](https://example.test/++image++.png)",
      "[id]: https://example.test/++segment++ \"++title++\""
    ];
    for (const literal of literalCases) {
      assert.equal(normalizeLegacyUnderlineMarkdown(literal), literal, `normalization must preserve literal ${literal}`);
      const payload = buildMarkdownClipboardPayload({ documentPath, markdown: literal });
      assert.equal(payload.text, literal, `plain clipboard must preserve literal ${literal}`);
      assert.doesNotMatch(payload.html, /<u\b/, `rich clipboard must not invent underline for ${literal}`);
    }
    const frontmatterLiteral = "---\r\nlabel: ++literal++\r\n---\r\n\r\n😀++中文重点++后文";
    const normalizedLiteral = normalizeLegacyUnderlineMarkdown(frontmatterLiteral);
    assert.equal(normalizedLiteral, "---\r\nlabel: ++literal++\r\n---\r\n\r\n😀<u>中文重点</u>后文");
    assert.equal(normalizeLegacyUnderlineMarkdown(normalizedLiteral), normalizedLiteral, "canonical conversion is idempotent");
    for (const reference of ["[++label++]\n\n[++label++]: https://example.test", "[++label++][]\n\n[++label++]: https://example.test", "[标签][++ref++]\n\n[++ref++]: https://example.test"]) {
      assert.equal(normalizeLegacyUnderlineMarkdown(reference), reference, "reference IDs must remain byte-for-byte stable");
    }
    assert.equal(normalizeLegacyUnderlineMarkdown("正文[^++note++]\n\n[^++note++]: ++重点++"),
      "正文[^++note++]\n\n[^++note++]: <u>重点</u>", "footnote labels are identifiers, only their body may change");
    for (const math of ["$a<br>b$", "$<u>literal</u>$", "\\(a<br>b\\)", "$$\na<br>b\n$$"]) {
      assert.equal(buildMarkdownClipboardPayload({ documentPath, markdown: math }).text, math,
        "HTML-like literal text inside math must not be stripped or converted to newlines");
    }
    const mathAndEmphasis = "$a++b++c$ 与 ++真正重点++。";
    assert.equal(normalizeLegacyUnderlineMarkdown(mathAndEmphasis), "$a++b++c$ 与 <u>真正重点</u>。");
    const outerLink = "++[资料](https://example.test/++segment++) 与 `++literal++`++";
    assert.equal(normalizeLegacyUnderlineMarkdown(outerLink), "<u>[资料](https://example.test/++segment++) 与 `++literal++`</u>");
    assert.match(buildMarkdownClipboardPayload({ documentPath, markdown: outerLink }).html,
      /<u[^>]*><a href="https:\/\/example\.test\/\+\+segment\+\+">资料<\/a> 与 <code>\+\+literal\+\+<\/code><\/u>/);

    for (const straddle of [
      "[label ++](https://example.test) word++",
      "++before [label++](https://example.test)",
      "**bold ++end** outside++",
      "++outside *inside++*",
      "~~deleted ++inside~~ outside++",
      "<u>++inside</u> outside++"
    ]) {
      assert.equal(normalizeLegacyUnderlineMarkdown(straddle), straddle, "underline delimiters must share the same inline container stack");
    }
    for (const nested of ["[label ++inside++](https://example.test)", "**bold ++inside++**", "++before **bold** after++"]) {
      const html = buildMarkdownClipboardPayload({ documentPath, markdown: nested }).html;
      assert.match(html, /<u style=/, "properly nested underline remains supported");
    }

    const underlineBlock = buildMarkdownClipboardPayload({ documentPath,
      markdown: "<u>\n**粗体内容** 和 [资料链接](https://example.test)\n</u>" });
    assert.match(underlineBlock.html, /<u[^>]*><strong>粗体内容<\/strong> 和 <a href="https:\/\/example\.test">资料链接<\/a><\/u>/);
    for (const destination of ["javascript:alert%281%29", "data:text/html;base64,PHNjcmlwdD4=", "vbscript:msgbox%281%29", "file:///private/secret", "java\nscript:alert%281%29"]) {
      const payload = buildMarkdownClipboardPayload({ documentPath, markdown: `[可见标签](<${destination}>)` });
      assert.doesNotMatch(payload.html, /<a\b/, `unsafe scheme must not be copied as a live link: ${destination}`);
      assert.match(payload.html, /可见标签/);
    }
    for (const destination of ["https://example.test", "mailto:example@example.com", "#section", "./relative.md"]) {
      const payload = buildMarkdownClipboardPayload({ documentPath, markdown: `[可见标签](${destination})` });
      assert.match(payload.html, /<a href=/, `safe links stay interactive: ${destination}`);
    }
    const unsafeUnderline = buildMarkdownClipboardPayload({ documentPath, markdown: '<u onclick="alert(1)" style="color:red">安全内容</u>' });
    assert.doesNotMatch(unsafeUnderline.html, /onclick|color:red/);
    assert.match(unsafeUnderline.html, /<u style="text-decoration:underline;text-underline-offset:2px;">安全内容<\/u>/);

    console.log("markdown assets tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outsideImage, { force: true });
    fs.rmSync(outsideDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
