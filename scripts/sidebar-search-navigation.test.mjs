import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalEntityHomepagePath,
  documentLibraryExpansionPath,
  documentLibraryHasDocumentPath,
  entityPrimaryDocumentPath,
  nextSidebarSearchKey,
  validSidebarSearchKey
} from "../src/sidebar-search-navigation.ts";

const mixedResults = ["project:p1", "project:p2", "person:u1"];

test("sidebar search navigation enters at the first result and crosses result groups", () => {
  assert.equal(nextSidebarSearchKey(mixedResults, "", "next"), "project:p1");
  assert.equal(nextSidebarSearchKey(mixedResults, "project:p2", "next"), "person:u1");
  assert.equal(nextSidebarSearchKey(mixedResults, "person:u1", "previous"), "project:p2");
});

test("sidebar search navigation wraps at both ends", () => {
  assert.equal(nextSidebarSearchKey(mixedResults, "person:u1", "next"), "project:p1");
  assert.equal(nextSidebarSearchKey(mixedResults, "project:p1", "previous"), "person:u1");
});

test("sidebar search navigation fails safely for empty or stale results", () => {
  assert.equal(nextSidebarSearchKey([], "project:p1", "next"), "");
  assert.equal(validSidebarSearchKey(mixedResults, "person:u1"), "person:u1");
  assert.equal(validSidebarSearchKey(mixedResults, "project:removed"), "project:p1");
  assert.equal(validSidebarSearchKey([], "project:p1"), "");
});

test("entity search derives only the canonical homepage inside a verified workspace", () => {
  assert.equal(
    canonicalEntityHomepagePath("/library/3.项目库/AI/芯聚科技/", "project"),
    "/library/3.项目库/AI/芯聚科技/项目主页.md"
  );
  assert.equal(
    canonicalEntityHomepagePath("C:\\library\\4.人脉库\\张三\\", "person"),
    "C:\\library\\4.人脉库\\张三\\人物主页.md"
  );
  assert.equal(canonicalEntityHomepagePath("", "project"), "");
});

test("entity search accepts a legacy indexed document only inside the verified workspace", () => {
  assert.equal(
    entityPrimaryDocumentPath(
      "/library/3.项目库/AI/旧项目",
      "project",
      "/library/3.项目库/AI/旧项目/首次交流纪要.md"
    ),
    "/library/3.项目库/AI/旧项目/首次交流纪要.md"
  );
  assert.equal(
    entityPrimaryDocumentPath(
      "/library/3.项目库/AI/旧项目",
      "project",
      "/library/3.项目库/AI/旧项目/路演材料.pdf"
    ),
    "/library/3.项目库/AI/旧项目/路演材料.pdf"
  );
  assert.equal(
    entityPrimaryDocumentPath(
      "/library/3.项目库/AI/已改名项目",
      "project",
      "/library/3.项目库/AI/旧目录/项目主页.md"
    ),
    "/library/3.项目库/AI/已改名项目/项目主页.md"
  );
  assert.equal(
    entityPrimaryDocumentPath(
      "/library/3.项目库/AI/芯聚科技",
      "project",
      "/library/3.项目库/AI/芯聚科技/../其他项目/项目主页.md"
    ),
    "/library/3.项目库/AI/芯聚科技/项目主页.md"
  );
});

test("entity search expands the canonical document folder without guessing from its name", () => {
  const nodes = [{
    kind: "folder",
    path: "/library/3.项目库",
    children: [{
      kind: "folder",
      path: "/library/3.项目库/AI",
      children: [{
        kind: "folder",
        path: "/library/3.项目库/AI/芯聚科技",
        children: [{
          kind: "markdown",
          path: "/library/3.项目库/AI/芯聚科技/项目主页.md"
        }]
      }]
    }]
  }];

  assert.deepEqual(
    documentLibraryExpansionPath(nodes, "/library/3.项目库/AI/芯聚科技"),
    ["/library/3.项目库", "/library/3.项目库/AI", "/library/3.项目库/AI/芯聚科技"]
  );
  assert.equal(
    documentLibraryHasDocumentPath(
      nodes,
      "/library/3.项目库/AI/芯聚科技/项目主页.md"
    ),
    true
  );
  assert.equal(
    documentLibraryHasDocumentPath(
      nodes,
      "/library/3.项目库/AI/芯聚科技/缺失主页.md"
    ),
    false
  );
  assert.equal(documentLibraryExpansionPath(nodes, "/library/3.项目库/芯聚科技"), null);
});
