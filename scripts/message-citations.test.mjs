import assert from "node:assert/strict";
import test from "node:test";
import {
  codexFileCitationHref,
  codexFileCitationPath,
  parseCodexFileCitation,
  remarkCodexFileCitations,
  splitCodexFileCitations
} from "../src/message-citations.ts";

test("turns a local PDF citation into a short material label", () => {
  const citation = parseCodexFileCitation(
    'path="/资料库/Mist/原始材料/Ambi 管访纪要.pdf" purpose="source"'
  );
  assert.deepEqual(citation, {
    path: "/资料库/Mist/原始材料/Ambi 管访纪要.pdf",
    label: "Ambi 管访纪要.pdf",
    artifactKind: undefined,
    sheet: undefined,
    range: undefined
  });
});

test("adds workbook sheet and range without exposing the full path", () => {
  const citation = parseCodexFileCitation(
    'path="/资料库/项目跟踪.xlsx" artifact_kind="workbook" sheet="最新" range="A6:C12"'
  );
  assert.equal(citation?.label, "项目跟踪.xlsx · 最新!A6:C12");
});

test("keeps surrounding prose and supports multiple citations", () => {
  const segments = splitCodexFileCitations(
    '参考 :codex-file-citation{path="/项目/纪要.md"} 和 :codex-file-citation{path="/项目/BP.pdf"}。'
  );
  assert.deepEqual(segments.map((segment) => segment.type), [
    "text", "citation", "text", "citation", "text"
  ]);
  assert.equal(segments[1].type === "citation" && segments[1].value.label, "纪要.md");
  assert.equal(segments[3].type === "citation" && segments[3].value.label, "BP.pdf");
});

test("leaves malformed markers visible instead of inventing a target", () => {
  const source = ':codex-file-citation{purpose="source"}';
  assert.deepEqual(splitCodexFileCitations(source), [{ type: "text", value: source }]);
});

test("citation hrefs round-trip unicode paths and reject unrelated links", () => {
  const path = "/资料库/项目/原始材料/管访纪要.pdf";
  assert.equal(codexFileCitationPath(codexFileCitationHref(path)), path);
  assert.equal(codexFileCitationPath("https://example.com"), "");
  assert.equal(codexFileCitationPath("javascript:alert(1)"), "");
});

test("remark conversion does not create nested links or alter code", () => {
  const marker = ':codex-file-citation{path="/项目/纪要.md"}';
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", children: [{ type: "text", value: marker }] },
      { type: "inlineCode", value: marker },
      {
        type: "link",
        url: "https://example.com",
        children: [{ type: "text", value: marker }]
      }
    ]
  };
  remarkCodexFileCitations()(tree);
  assert.equal(tree.children[0].children[0].type, "link");
  assert.equal(tree.children[1].value, marker);
  assert.equal(tree.children[2].children[0].type, "text");
});
