const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  buildMarkdownClipboardPayload,
  detectImageMime,
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

    const literalUnderlineSyntax = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "`++代码示例++`"
    });
    assert.match(literalUnderlineSyntax.html, /<code>\+\+代码示例\+\+<\/code>/);
    assert.doesNotMatch(literalUnderlineSyntax.html, /<u\b/);

    const missing = buildMarkdownClipboardPayload({
      documentPath,
      markdown: "![缺失图片](assets/not-found.png)"
    });
    assert.equal(missing.imageCount, 0);
    assert.equal(missing.missingImageCount, 1);
    assert.match(missing.html, /未找到/);

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
