import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  markdownToPdf,
  prepareAttachmentForWeixin,
} from "../src/markdown-pdf.js";

test("Markdown attachments become readable PDF files without changing the source", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-markdown-pdf-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const source = path.join(directory, "research.md");
  const output = path.join(directory, "research.pdf");
  const markdown = "# Research report\n\n## Highlights\n\n- First point\n- Second point\n";
  fs.writeFileSync(source, markdown);

  await markdownToPdf({ inputPath: source, outputPath: output });

  assert.equal(fs.readFileSync(source, "utf8"), markdown);
  assert.equal(fs.readFileSync(output).subarray(0, 5).toString("ascii"), "%PDF-");
  assert.equal(fs.statSync(output).size > 1_000, true);
});

test("only Markdown attachments are converted for Weixin delivery", async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "domi-markdown-delivery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const textFile = path.join(directory, "notes.txt");
  fs.writeFileSync(textFile, "plain text");

  assert.equal(await prepareAttachmentForWeixin(textFile), textFile);
});
