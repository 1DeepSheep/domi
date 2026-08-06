import assert from "node:assert/strict";
import test from "node:test";
import { filesFromClipboardData } from "../src/clipboard-files.ts";

function clipboardData(files, itemFiles) {
  return {
    files,
    items: itemFiles.map((file) => ({
      kind: "file",
      getAsFile: () => file
    }))
  };
}

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
