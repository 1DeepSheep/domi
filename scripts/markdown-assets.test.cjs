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

    const outsideImage = path.join(path.dirname(root), "outside.png");
    fs.writeFileSync(outsideImage, png);
    assert.throws(
      () => resolveMarkdownImagePath(documentPath, "../outside.png"),
      /所在文件夹内/
    );

    const markdown = [
      "---",
      "project: Domi",
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
    assert.doesNotMatch(clipboard.html, /project: Domi/, "frontmatter should not enter rich clipboard HTML");

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
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
