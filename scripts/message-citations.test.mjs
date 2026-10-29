import assert from "node:assert/strict";
import test from "node:test";
import { fromMarkdown } from "mdast-util-from-markdown";
import { remarkRepairLocalDocumentLinks } from "../src/message-document-links.ts";
import { isLocalMarkdownResource, isLocalPdfResource } from "../src/document-resources.ts";
import {
  codexFileCitationHref,
  codexFileCitationPath,
  parseCodexFileCitation,
  remarkCodexFileCitations,
  splitCodexFileCitations
} from "../src/message-citations.ts";

function repaired(source) {
  const tree = fromMarkdown(source);
  remarkRepairLocalDocumentLinks()(tree, { value: source });
  return tree;
}

function collectNodes(tree, type) {
  return [...(tree.type === type ? [tree] : []), ...(tree.children || []).flatMap(child => collectNodes(child, type))];
}

test("repairs historical local document links missing their angle closer without exposing paths", () => {
  const transcript = "/synthetic/documents/Documents/domi/work/context/" + "a".repeat(150) + "/10-28 中文 回顾(第一版)-transcript.md";
  const notes = "/synthetic/documents/Documents/纪要/20261028-行业交流-纪要.md";
  const source = `已完成。\n\n- [完整文字稿](<${transcript})：直接复用。\n- [结构化纪要](<${notes})：正文摘要。`;
  const tree = repaired(source);
  const links = collectNodes(tree, "link");
  assert.deepEqual(links.map(node => node.url), [transcript, notes]);
  assert.deepEqual(links.map(node => node.children[0].value), ["完整文字稿", "结构化纪要"]);
  assert.equal(collectNodes(tree, "text").map(node => node.value).join(""), "已完成。完整文字稿：直接复用。结构化纪要：正文摘要。");
});

test("standard angle destinations and balanced filename parentheses keep exact targets", () => {
  for (const destination of ["/synthetic/documents/中文 文件(新).md", "/synthetic/documents/版本((新)).pdf", "/synthetic/documents/报价%20标记.md", "file:///synthetic/documents/中文%20文件.md", "~/Documents/交流纪要.markdown"]) {
    const standard = repaired(`[纪要](<${destination}>)`);
    const historical = repaired(`[纪要](<${destination})`);
    assert.equal(collectNodes(standard, "link")[0].url, destination);
    assert.equal(collectNodes(historical, "link")[0].url, destination);
  }
  const tree = repaired("[纪要](</synthetic/documents/纪要.md:12)：保留定位 [资料](</synthetic/documents/BP.pdf)：后文");
  assert.deepEqual(collectNodes(tree, "link").map(node => node.url), ["/synthetic/documents/纪要.md:12", "/synthetic/documents/BP.pdf"]);
});

test("recovery never promotes unsafe schemes, code, escaped examples, images or incomplete destinations", () => {
  const malformed = "[纪要](</synthetic/documents/note.md)";
  for (const source of [
    "[不安全](<javascript:alert(1).md)", "[不安全](<data:text/html,test.md)", "[远端](<https://example.com/note.md)",
    "[远端文件](<file://example.com/note.md)", "[远端文件](<//example.com/note.md)",
    "[未完成](</synthetic/documents/note.md", "[未完成](</synthetic/documents/note.md>" ,
    "[跨行](</synthetic/documents/\nnote.md)", "[命令](</synthetic/documents/tool.sh)",
    "[歧义](</synthetic/documents/unbalanced(draft.md)", "[歧义](</synthetic/documents/note.md)/not-the-end.md",
    "[注入](</synthetic/documents/note.md\" onclick=\"alert(1))",
    `\`${malformed}\``, `\`\`\`md\n${malformed}\n\`\`\``, `\\${malformed}`, `!${malformed}`,
    "[实体编码](</synthetic/documents/a&amp;b.md)"
  ]) assert.equal(collectNodes(repaired(source), "link").length, 0, source);
  const linked = repaired(`[${malformed}](https://example.com)`);
  assert.equal(collectNodes(linked, "link").length, 1, "Do not make a link inside an existing link");
});

test("local document recognition never bypasses URL safety based on a file extension", () => {
  for (const resource of [
    "javascript:alert(1).md", "data:text/html,note.md", "vbscript:payload.pdf", "https://example.com/note.md",
    "<https://example.com/note.md>", "%6Aavascript:payload.md", "file://example.com/note.pdf", "//example.com/note.md", "\u0000/synthetic/documents/note.md"
  ]) {
    assert.equal(isLocalMarkdownResource(resource), false, resource);
    assert.equal(isLocalPdfResource(resource), false, resource);
  }
  for (const resource of ["/synthetic/documents/中文 文件(新).md", "notes/交流.md", "file:///synthetic/documents/纪要.md", "file://localhost/synthetic/documents/纪要.md", "</synthetic/documents/纪要.md>"]) {
    assert.equal(isLocalMarkdownResource(resource), true, resource);
  }
  assert.equal(isLocalPdfResource("/synthetic/documents/原始 材料(1).pdf"), true);
});

test("turns a local PDF citation into a short material label", () => {
  const citation = parseCodexFileCitation(
    'path="/资料库/ExampleWear/原始材料/ExampleInterview 管访纪要.pdf" purpose="source"'
  );
  assert.deepEqual(citation, {
    path: "/资料库/ExampleWear/原始材料/ExampleInterview 管访纪要.pdf",
    label: "ExampleInterview 管访纪要.pdf",
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

const managedContext = { managedRoots: ["/资料库", "/domi/projects/thread-1"] };
const originalName = "【BP】示例公司 AI.pdf";
const storedName = `1700000000000-0-${originalName}`;
const storedPath = `/资料库/示例公司/原始材料/${storedName}`;

test("legacy attachment citations display original names while preserving exact paths", () => {
  for (const label of [undefined, storedName, storedPath]) {
    const source = `path=${JSON.stringify(storedPath)}${label === undefined ? "" : ` label=${JSON.stringify(label)}`}`;
    const citation = parseCodexFileCitation(source, managedContext);
    assert.equal(citation?.label, originalName);
    assert.equal(citation?.path, storedPath);
    assert.equal(codexFileCitationPath(codexFileCitationHref(citation.path)), storedPath);
  }
});

test("citation display cleanup preserves semantic labels and workbook locations", () => {
  const citation = parseCodexFileCitation(
    `path=${JSON.stringify(storedPath)} label="原始 BP 与产品资料" sheet="融资" range="A1:C3"`,
    managedContext
  );
  assert.equal(citation?.label, "原始 BP 与产品资料 · 融资!A1:C3");
  assert.equal(citation?.path, storedPath);
});

test("metadata preserves an original filename that itself begins with numbers", () => {
  const context = {
    ...managedContext,
    attachments: [{ path: storedPath, name: storedName }]
  };
  const citation = parseCodexFileCitation(`path=${JSON.stringify(storedPath)}`, context);
  assert.equal(citation?.label, storedName);
});

test("citation filesystem paths preserve literal percent escapes in filenames", () => {
  for (const name of ["销售%20增长.pdf", "收入%2F成本.pdf"]) {
    const path = `/资料库/示例公司/原始材料/1700000000000-0-${name}`;
    const citation = parseCodexFileCitation(`path=${JSON.stringify(path)}`, managedContext);
    assert.equal(citation?.label, name);
    assert.equal(citation?.path, path);
    const tree = {
      type: "root",
      children: [{ type: "link", url: codexFileCitationHref(path), children: [{ type: "text", value: path.split("/").at(-1) }] }]
    };
    remarkCodexFileCitations(managedContext)(tree);
    assert.equal(tree.children[0].children[0].value, name);
    assert.equal(codexFileCitationPath(tree.children[0].url), path);
  }
});

test("date and version prefixes and files outside managed directories stay unchanged", () => {
  for (const path of [
    "/资料库/示例公司/原始材料/20260914-0-示例公司.pdf",
    "/资料库/示例公司/原始材料/v7.0.4-示例公司.pdf",
    `/Downloads/attachments/${storedName}`,
    `/资料库外部/示例公司/原始材料/${storedName}`,
    `/资料库/示例公司/研究报告/${storedName}`
  ]) {
    const citation = parseCodexFileCitation(`path=${JSON.stringify(path)}`, managedContext);
    assert.equal(citation?.label, path.split("/").at(-1));
    assert.equal(citation?.path, path);
  }
});

test("ordinary local Markdown links clean storage labels without changing destinations", () => {
  const fileUrl = `file://${encodeURI(storedPath)}`;
  const targets = [storedPath, encodeURI(storedPath), fileUrl];
  for (const url of targets) {
    const tree = {
      type: "root",
      children: [{
        type: "paragraph",
        children: [{ type: "link", url, children: [{ type: "text", value: storedName }] }]
      }]
    };
    remarkCodexFileCitations(managedContext)(tree);
    assert.equal(tree.children[0].children[0].children[0].value, originalName);
    assert.equal(tree.children[0].children[0].url, url);
  }
});

test("ordinary links preserve descriptive labels, formatting, external links and code", () => {
  const marker = `:codex-file-citation{path=${JSON.stringify(storedPath)}}`;
  const tree = {
    type: "root",
    children: [
      { type: "link", url: storedPath, children: [{ type: "text", value: "原始 BP" }] },
      { type: "link", url: storedPath, children: [{ type: "strong", children: [{ type: "text", value: storedName }] }] },
      { type: "link", url: `https://example.com/attachments/${storedName}`, children: [{ type: "text", value: storedName }] },
      { type: "inlineCode", value: marker },
      { type: "code", value: marker },
      { type: "paragraph", children: [{ type: "text", value: marker }] }
    ]
  };
  remarkCodexFileCitations(managedContext)(tree);
  assert.equal(tree.children[0].children[0].value, "原始 BP");
  assert.equal(tree.children[1].children[0].type, "strong");
  assert.equal(tree.children[1].children[0].children[0].value, storedName);
  assert.equal(tree.children[2].children[0].value, storedName);
  assert.equal(tree.children[3].value, marker);
  assert.equal(tree.children[4].value, marker);
  assert.equal(tree.children[5].children[0].children[0].value, originalName);
  assert.equal(codexFileCitationPath(tree.children[5].children[0].url), storedPath);
});

test("reference-style Markdown links clean filename labels while preserving definitions", () => {
  const definition = { type: "definition", identifier: "bp", url: storedPath, title: "资料" };
  const tree = {
    type: "root",
    children: [
      { type: "paragraph", children: [
        { type: "linkReference", identifier: "bp", children: [{ type: "text", value: storedName }] },
        { type: "linkReference", identifier: "bp", children: [{ type: "text", value: "产品与融资材料" }] },
        { type: "linkReference", identifier: "missing", children: [{ type: "text", value: storedName }] }
      ] },
      definition,
      { type: "definition", identifier: "bp", url: "/different-target.pdf" }
    ]
  };
  remarkCodexFileCitations(managedContext)(tree);
  assert.equal(tree.children[0].children[0].children[0].value, originalName);
  assert.equal(tree.children[0].children[1].children[0].value, "产品与融资材料");
  assert.equal(tree.children[0].children[2].children[0].value, storedName);
  assert.equal(tree.children[1], definition);
  assert.equal(definition.url, storedPath);
});
