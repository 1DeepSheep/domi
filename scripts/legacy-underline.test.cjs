const test = require("node:test");
const assert = require("node:assert/strict");
const { findLegacyUnderline, mapLegacyUnderline, legacyUnderlineOpaqueRanges } = require("../shared/legacy-underline.mjs");
const format = (source, options) => mapLegacyUnderline(source, ({ content }) => `<u>${content}</u>`, options);

test("CJK adjacency and UTF-16 offsets preserve exact source content", () => {
  const source = "😀前++关键内容++后";
  assert.deepEqual(findLegacyUnderline(source), { start: 3, end: 11, contentStart: 5, contentEnd: 9, content: "关键内容" });
  assert.equal(format(source), "😀前<u>关键内容</u>后");
});

test("ASCII word/digit/underscore and additional plus adjacency are literal", () => {
  for (const source of ["C++ 与 C++", "x++ 与 y++", "i++ +j++", "a++text++", "++text++x", "1++text++", "++text++2", "_++text++", "+++text+++", "++++", "++a+++", "+++a++"]) {
    assert.equal(findLegacyUnderline(source), null, source);
    assert.equal(format(source), source, source);
  }
});

test("historical closing spaces are preserved without allowing leading or empty content", () => {
  assert.equal(format("++重点  ++"), "<u>重点  </u>");
  assert.equal(format("++重点\t++"), "<u>重点\t</u>");
  for (const source of ["++ leading++", "++\tleading++", "++ ++", "++\t++", "++\n++"]) assert.equal(format(source), source);
});

test("multiple spans, nested emphasis, fromIndex and mapper offsets", () => {
  const source = "**++第一++** 和 ++second++。";
  const calls = [];
  assert.equal(mapLegacyUnderline(source, (match) => { calls.push(match); return `<u>${match.content}</u>`; }), "**<u>第一</u>** 和 <u>second</u>。");
  assert.equal(calls.length, 2);
  assert.equal(findLegacyUnderline(source, { fromIndex: calls[0].end }).content, "second");
  assert.equal(findLegacyUnderline(source, { fromIndex: source.length + 1 }), null);
});

test("escaped pairs use backslash parity and do not become opening delimiters", () => {
  for (const source of [String.raw`\++literal++`, String.raw`\+\+literal\+\+`, String.raw`++literal\++`]) assert.equal(format(source), source);
  assert.equal(format(String.raw`\\++valid++`), String.raw`\\<u>valid</u>`);
});

test("code spans use exact arbitrary backtick runs and protect delimiter-looking code", () => {
  for (const source of ["`++code++`", "`` a`++code++` ``", "```` a```++code++``` ````", "`unclosed ++code++", "`line\n++code++`", "```js\n++code++\n```"]) assert.equal(format(source), source);
  assert.equal(format("++before `++code++` after++"), "<u>before `++code++` after</u>");
  assert.equal(format("`++code++` ++prose++"), "`++code++` <u>prose</u>");
});

test("inline and display math remain literal, including escaped TeX delimiters", () => {
  for (const source of ["$a++b++c$", "$$a++b++c$$", "$$\na++b++\n$$", String.raw`\(a++b++\)`, String.raw`\[a++b++\]`, "$unclosed++math++", "$$unclosed\n++math++"]) assert.equal(format(source), source);
  assert.equal(format("$a++b++$ ++prose++"), "$a++b++$ <u>prose</u>");
  assert.equal(format(String.raw`\$literal ++prose++`), String.raw`\$literal <u>prose</u>`);
  assert.equal(format("++math++", { insideMath: true }), "++math++");
});

test("tokenizer prefixes restore word, escape, code and math context", () => {
  for (const prefix of ["C", "i", "2", "_", "+", "\\", "$a", "$$a\n", "`code", "``code`", String.raw`\(a`]) {
    assert.equal(findLegacyUnderline("++literal++", { prefix }), null, prefix);
  }
  assert.equal(findLegacyUnderline("++valid++", { prefix: "中文" }).start, 0);
  assert.equal(findLegacyUnderline("++literal++", { previousText: "C" }), null);
  assert.equal(findLegacyUnderline("++literal++", { previousChar: "C" }), null);
  assert.equal(findLegacyUnderline("++valid++", { prefix: " ", previousText: "C" }).content, "valid");
});

test("an incomplete prefix span ends before later valid prose", () => {
  const source = "math$ ++prose++";
  const match = findLegacyUnderline(source, { prefix: "$before " });
  assert.equal(match.content, "prose");
  assert.equal(source.slice(match.start, match.end), "++prose++");
  assert.equal(findLegacyUnderline("code` ++prose++", { prefix: "`before " }).content, "prose");
});

test("pairing never crosses a line or an invalid intervening delimiter", () => {
  for (const source of ["++a\nb++", "++a\r\nb++", "++a\rb++", "++a `line\nbreak` b++"]) assert.equal(format(source), source);
  assert.equal(format("++bad++word and ++good++"), "++bad++word and <u>good</u>");
  assert.equal(format("++bad+++ and ++good++"), "++bad+++ and <u>good</u>");
  assert.equal(format("++bad++++word++"), "++bad++++word++");
});

test("mapping leaves untouched BOM, line endings and literal source slices exact", () => {
  const source = "\uFEFFbefore\r\n++重点 ++\r\nafter\r\n";
  assert.equal(format(source), "\uFEFFbefore\r\n<u>重点 </u>\r\nafter\r\n");
  assert.equal(mapLegacyUnderline(source, (match) => source.slice(match.start, match.end)), source);
  assert.equal(format(format(source)), format(source));
});

test("bad inputs fail explicitly and ESM exports work from Node CommonJS", async () => {
  const esm = await import("../shared/legacy-underline.mjs");
  assert.equal(esm.findLegacyUnderline, findLegacyUnderline);
  assert.throws(() => findLegacyUnderline(null), TypeError);
  assert.throws(() => mapLegacyUnderline("++a++", () => null), TypeError);
  assert.throws(() => mapLegacyUnderline("++a++", null), TypeError);
});

test("shared opaque ranges protect HTML-looking code and math with exact UTF-16 slices", () => {
  const segments = ["$a<br>b$", "$<u>literal</u>$", String.raw`\(a<br>b\)`, "`<u>code</u>`", "$$\n<br>display\n$$"];
  const source = `😀 prefix ${segments.join(" prose ")} suffix`;
  const ranges = legacyUnderlineOpaqueRanges(source);
  assert.deepEqual(ranges.map(({ start, end }) => source.slice(start, end)), segments);
  assert.ok(ranges.every((range, index) => range.start >= (ranges[index - 1]?.end || 0) && range.end > range.start));
  assert.deepEqual(legacyUnderlineOpaqueRanges("ordinary <u>prose</u><br>"), []);
  assert.deepEqual(legacyUnderlineOpaqueRanges("\\$price and \\`literal"), []);
  assert.throws(() => legacyUnderlineOpaqueRanges(null), TypeError);
});
