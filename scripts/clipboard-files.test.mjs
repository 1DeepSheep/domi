import assert from "node:assert/strict";
import test from "node:test";
import { filesFromClipboardData, filePathsFromClipboardData } from "../src/clipboard-files.ts";

function clipboardData(files, itemFiles) {
  return {
    files,
    items: itemFiles.map((file) => ({
      kind: "file",
      getAsFile: () => file
    }))
  };
}

test("file URL paste preserves names and spaces and deduplicates Finder paths", () => {
  const uri = "file:///synthetic/" + encodeURIComponent("示例公司 BP.pdf");
  assert.deepEqual(filePathsFromClipboardData({ getData: type => type === "text/uri-list"
    ? `# Finder files\r\n${uri}\r\n${uri}\r\nfile://localhost/synthetic/data.xlsx` : "" }),
  ["/synthetic/示例公司 BP.pdf", "/synthetic/data.xlsx"]);
});

test("ordinary text, web links and invalid or non-local file URLs are not file imports", () => {
  for (const value of ["", "参会者：示例负责人", "/synthetic/data.pdf", "https://example.com/bp.pdf", "file:///bad%ZZ.pdf", "file://remote/share/bp.pdf", "file:///bad%00.pdf"]) {
    assert.deepEqual(filePathsFromClipboardData({ getData: () => value }), []);
  }
});

test("composer paste uses the direct file view only once", () => {
  const directImage = {
    name: "image.png",
    size: 1024,
    type: "image/png",
    lastModified: 100
  };
  const itemImage = {
    ...directImage,
    lastModified: 200
  };
  assert.deepEqual(
    filesFromClipboardData(clipboardData([directImage], [itemImage])),
    [directImage]
  );
});

test("composer paste falls back to item files when the direct view is empty", () => {
  const itemImage = {
    name: "image.png",
    size: 1024,
    type: "image/png",
    lastModified: 200
  };
  assert.deepEqual(
    filesFromClipboardData(clipboardData([], [itemImage])),
    [itemImage]
  );
});

test("composer paste preserves multiple files from the authoritative direct view", () => {
  const first = {
    name: "first.png",
    size: 1024,
    type: "image/png",
    lastModified: 100
  };
  const second = {
    name: "second.png",
    size: 2048,
    type: "image/png",
    lastModified: 100
  };
  assert.deepEqual(
    filesFromClipboardData(clipboardData([first, second], [first, second])),
    [first, second]
  );
});
