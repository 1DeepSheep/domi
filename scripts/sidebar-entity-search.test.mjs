import assert from "node:assert/strict";
import test from "node:test";
import { searchSidebarEntities } from "../src/sidebar-entity-search.ts";

const project = (name, extra = {}) => ({ recordId: name, name, domain: "AI", subdomains: [], status: "待交流", ...extra });
const mentions = Array.from({ length: 7 }, (_, index) => project(`示例项目${index}`, { notes: "对比 Aster 的业务" }));
const target = project("Aster lab", { aliases: ["Aster", "星原"], legalName: "示例星原科技有限公司" });

test("exact identity outranks recent note mentions before the five-result limit", () => {
  const projects = [...mentions, target];
  for (const query of ["Aster", "aster lab", "  ASTER  ", "Ａｓｔｅｒ", "星原", "示例星原科技有限公司"]) {
    assert.equal(searchSidebarEntities(projects, [], query).projects[0], target);
  }
  const results = searchSidebarEntities(projects, [], "Aster").projects;
  assert.deepEqual(results, [target, ...mentions.slice(0, 4)]);
  assert.deepEqual(projects, [...mentions, target], "search must not reorder the shared snapshot");
});

test("partial project names rank ahead of notes and metadata while preserving broad search", () => {
  const nameMatch = project("Aster tools");
  const metadataMatch = project("示例项目", { investors: ["Aster Capital"] });
  const results = searchSidebarEntities([...mentions, metadataMatch, nameMatch, target], [], "Ast").projects;
  assert.deepEqual(results, [nameMatch, target, metadataMatch, ...mentions.slice(0, 2)]);
  assert.equal(searchSidebarEntities([target], [], "AI").projects[0], target);
  assert.deepEqual(searchSidebarEntities([target], [], "missing").projects, []);
  assert.deepEqual(searchSidebarEntities([target], [], "  "), { projects: [], people: [] });
});

test("person name ranks ahead of matching organizations", () => {
  const people = Array.from({ length: 7 }, (_, index) => ({ recordId: `p${index}`, name: `示例人物${index}`, organization: "张一创立的公司", status: "", types: [], cities: [] }));
  const targetPerson = { ...people[0], recordId: "target", name: "张一", organization: "示例公司" };
  assert.deepEqual(searchSidebarEntities([], [...people, targetPerson], "张一").people, [targetPerson, ...people.slice(0, 4)]);
});
