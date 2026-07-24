const assert = require("node:assert/strict");
const test = require("node:test");
const { normalizeWebResource } = require("../electron/resource-target.cjs");

test("web resources accept direct and Markdown-formatted news links", () => {
  const url = "https://www.nasa.gov/news-release/example/";
  assert.equal(normalizeWebResource(url), url);
  assert.equal(normalizeWebResource(`[${url}](${url})`), url);
  assert.equal(normalizeWebResource(`[查看原文](${url})`), url);
  assert.equal(normalizeWebResource(`<${url}>`), url);
});

test("web resources read URL objects returned by Feishu fields", () => {
  assert.equal(
    normalizeWebResource({
      text: "查看原文",
      link: "https://example.com/article"
    }),
    "https://example.com/article"
  );
  assert.equal(
    normalizeWebResource([{ text: "来源" }, { url: "https://example.com/source" }]),
    "https://example.com/source"
  );
});

test("web resources reject local, relative and executable protocols", () => {
  assert.equal(normalizeWebResource("article.html"), "");
  assert.equal(normalizeWebResource("/tmp/article.html"), "");
  assert.equal(normalizeWebResource("javascript:alert(1)"), "");
  assert.equal(normalizeWebResource("[危险](javascript:alert(1))"), "");
});
