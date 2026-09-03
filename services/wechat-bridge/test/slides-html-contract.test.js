import assert from "node:assert/strict";
import test from "node:test";
import contract from "../src/slides-html-contract.cjs";

test("single-file checks cover unquoted and every resource-bearing attribute", () => {
  for (const html of [
    "<img src=https://example.test/a.png>",
    "<link rel=stylesheet href=./sidecar.css>",
    '<img src="data:image/png;base64,AAA" srcset="https://example.test/a.png 2x">',
    '<svg><use xlink:href="https://example.test/icons.svg#chart"></use></svg>',
    '<video src="data:video/mp4;base64,AAA" poster="https://example.test/poster.jpg"></video>',
    '<source srcset="data:image/png;base64,AAA 1x, //example.test/a.png 2x">',
    '<img title="a > b" src=./local.png>',
    '<img src="https&#58;//example.test/a.png">',
    '<object data=blob:local-object></object>',
  ]) assert.ok(contract.externalLocalResourceIn(html), html);
});

test("data URL srcsets, fragments and ordinary source hyperlinks remain valid", () => {
  for (const html of [
    '<img src=data:image/png;base64,AAA>',
    '<source srcset="data:image/png;base64,AAA 1x, data:image/png;base64,BBB 2x">',
    '<svg><use xlink:href="#chart"></use></svg>',
    '<img src="data:image/svg+xml,%3Csvg%3E" title="a > b">',
    '<a href="https://example.test/source">Source</a>',
    '<style>.logo { background: url("data:image/png;base64,AAA"); }</style>',
  ]) assert.equal(contract.externalLocalResourceIn(html), "", html);
});

test("page structure matches exact .slide classes on any HTML element", () => {
  assert.equal(contract.slideElementsIn('<div class=slide data-layout=custom></div>').length, 1);
  assert.equal(contract.slideElementsIn('<section class="slide cover" data-template = "cover"></section>').length, 1);
  assert.equal(contract.slideElementsIn('<div class="slide-preview"></div>').length, 0);
  assert.equal(contract.slideElementsIn('<!-- <section class=slide></section> -->').length, 0);
});
