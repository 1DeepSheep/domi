import assert from "node:assert/strict";
import test from "node:test";
import {
  GRID_ROW_HEIGHTS,
  applyGridMutations,
  calculateVirtualRange,
  cellsInSelection,
  choiceSelectionWithValue,
  createGridSelection,
  extendGridSelection,
  groupMutationsByRow,
  isCurrentGridCellGeneration,
  moveActiveCell,
  nextGridCellGeneration,
  parseGridViewPreferences,
  parseTsv,
  planPasteMutations,
  resolveVisibleColumns,
  selectionToTsv,
  serializeGridViewPreferences,
  serializeTsv,
  shouldReconcileOptimisticValue,
  withColumnWidth,
  withRowDensity
} from "../src/database/grid-model.ts";

const columns = [
  {
    id: "name",
    label: "公司名称",
    width: 180,
    read: (row) => row.name,
    write: (row, value) => ({ ...row, name: String(value) })
  },
  {
    id: "rating",
    label: "评级",
    width: 96,
    minWidth: 80,
    maxWidth: 200,
    read: (row) => row.rating,
    write: (row, value) => ({ ...row, rating: String(value) }),
    parsePastedValue: (value) => value.trim().toUpperCase()
  },
  {
    id: "system",
    label: "系统字段",
    editable: false,
    read: (row) => row.system
  }
];

const rows = [
  { name: "芯星元", rating: "A", system: "2026-08-07" },
  { name: "曼孚科技", rating: "S", system: "2026-08-06" },
  { name: "AutoTrust AI", rating: "B", system: "2026-08-05" }
];

test("keyboard navigation supports arrows, tab wrapping and grid boundaries", () => {
  const ids = ["name", "rating", "system"];
  assert.deepEqual(moveActiveCell({ rowIndex: 0, columnId: "name" }, "right", 3, ids), {
    rowIndex: 0,
    columnId: "rating"
  });
  assert.deepEqual(moveActiveCell({ rowIndex: 0, columnId: "system" }, "next", 3, ids), {
    rowIndex: 1,
    columnId: "name"
  });
  assert.deepEqual(moveActiveCell({ rowIndex: 1, columnId: "name" }, "previous", 3, ids), {
    rowIndex: 0,
    columnId: "system"
  });
  assert.deepEqual(moveActiveCell({ rowIndex: 1, columnId: "rating" }, "grid-end", 3, ids), {
    rowIndex: 2,
    columnId: "system"
  });
  assert.deepEqual(moveActiveCell({ rowIndex: 2, columnId: "system" }, "next", 3, ids), {
    rowIndex: 2,
    columnId: "system"
  });
  assert.deepEqual(moveActiveCell({ rowIndex: 0, columnId: "name" }, "previous", 3, ids), {
    rowIndex: 0,
    columnId: "name"
  });
});

test("navigation can skip cells that the React layer marks non-navigable", () => {
  assert.deepEqual(
    moveActiveCell(
      { rowIndex: 0, columnId: "name" },
      "next",
      3,
      ["name", "rating", "system"],
      { isNavigable: (cell) => cell.columnId !== "rating" }
    ),
    { rowIndex: 0, columnId: "system" }
  );
});

test("rectangular selection is normalized and can extend with the keyboard", () => {
  const ids = ["name", "rating", "system"];
  const selection = createGridSelection(
    { rowIndex: 2, columnId: "rating" },
    { rowIndex: 0, columnId: "name" }
  );
  assert.deepEqual(cellsInSelection(selection, 3, ids), [
    { rowIndex: 0, columnId: "name" },
    { rowIndex: 0, columnId: "rating" },
    { rowIndex: 1, columnId: "name" },
    { rowIndex: 1, columnId: "rating" },
    { rowIndex: 2, columnId: "name" },
    { rowIndex: 2, columnId: "rating" }
  ]);
  assert.deepEqual(extendGridSelection(selection, "down", 4, ids).focus, {
    rowIndex: 1,
    columnId: "name"
  });
});

test("TSV codec preserves spreadsheet quotes, tabs and embedded newlines", () => {
  const matrix = [["公司", "说明"], ["A\tB", "第一行\n第二行"], ['含"引号', ""]];
  const encoded = serializeTsv(matrix);
  assert.deepEqual(parseTsv(encoded), matrix);
  assert.deepEqual(parseTsv("A\tB\r\nC\tD\r\n"), [["A", "B"], ["C", "D"]]);
});

test("selection copy uses column formatters and returns a spreadsheet matrix", () => {
  const tsv = selectionToTsv(
    rows,
    columns,
    createGridSelection({ rowIndex: 0, columnId: "name" }, { rowIndex: 1, columnId: "rating" })
  );
  assert.equal(tsv, "芯星元\tA\n曼孚科技\tS");
});

test("paste planning clips at the grid edge, parses values and ignores read-only cells", () => {
  const mutations = planPasteMutations({
    rows,
    columns,
    start: { rowIndex: 1, columnId: "rating" },
    matrix: [["a", "ignored"], ["s", "ignored"]]
  });
  assert.deepEqual(mutations, [
    { rowIndex: 1, columnId: "rating", value: "A" },
    { rowIndex: 2, columnId: "rating", value: "S" }
  ]);
});

test("one pasted value fills the selected rectangle", () => {
  const selection = createGridSelection(
    { rowIndex: 0, columnId: "name" },
    { rowIndex: 1, columnId: "rating" }
  );
  const mutations = planPasteMutations({
    rows,
    columns,
    start: selection.focus,
    selection,
    matrix: [["a"]]
  });
  assert.equal(mutations.length, 4);
  assert.deepEqual(mutations.at(-1), { rowIndex: 1, columnId: "rating", value: "A" });
});

test("batch mutations coalesce per cell, group into persistence patches and stay immutable", () => {
  const mutations = [
    { rowIndex: 0, columnId: "rating", value: "B" },
    { rowIndex: 0, columnId: "rating", value: "S" },
    { rowIndex: 1, columnId: "name", value: "曼孚" }
  ];
  assert.deepEqual(groupMutationsByRow(mutations), [
    { rowIndex: 0, changes: { rating: "S" } },
    { rowIndex: 1, changes: { name: "曼孚" } }
  ]);
  const changed = applyGridMutations(rows, columns, mutations);
  assert.equal(rows[0].rating, "A");
  assert.equal(changed[0].rating, "S");
  assert.equal(changed[1].name, "曼孚");
  assert.equal(changed[2], rows[2]);
});

test("view preferences survive serialization and reject stale or unsafe values", () => {
  const initial = parseGridViewPreferences({
    columnOrder: ["rating", "unknown", "rating", "name"],
    hiddenColumnIds: ["system", "unknown"],
    columnWidths: { name: 420, rating: 99999, unknown: 80 },
    rowDensity: "comfortable"
  }, ["name", "rating", "system"]);
  assert.deepEqual(initial.columnOrder, ["rating", "name"]);
  assert.deepEqual(initial.hiddenColumnIds, ["system"]);
  assert.deepEqual(initial.columnWidths, { name: 420, rating: 960 });
  assert.equal(initial.rowDensity, "comfortable");
  assert.deepEqual(
    parseGridViewPreferences(serializeGridViewPreferences(initial, ["name", "rating", "system"])),
    initial
  );
  assert.equal(withColumnWidth(initial, "name", 20).columnWidths.name, 56);
  assert.equal(withRowDensity(initial, "compact").rowDensity, "compact");
  assert.equal(GRID_ROW_HEIGHTS.compact, 32);
});

test("visible column resolver applies saved order, visibility and per-column width constraints", () => {
  const preferences = parseGridViewPreferences({
    columnOrder: ["rating", "name", "system"],
    hiddenColumnIds: ["system"],
    columnWidths: { rating: 500 }
  }, columns.map((column) => column.id));
  assert.deepEqual(
    resolveVisibleColumns(columns, preferences).map(({ id, width, columnIndex }) => ({ id, width, columnIndex })),
    [
      { id: "rating", width: 200, columnIndex: 0 },
      { id: "name", width: 180, columnIndex: 1 }
    ]
  );
});

test("virtual range renders only visible rows plus overscan", () => {
  assert.deepEqual(calculateVirtualRange({
    rowCount: 1_000,
    rowHeight: 40,
    scrollOffset: 400,
    viewportSize: 200,
    overscan: 2
  }), {
    startIndex: 8,
    endIndex: 17,
    offsetTop: 320,
    visibleStartIndex: 10,
    visibleEndIndex: 15,
    totalSize: 40_000
  });
  assert.equal(calculateVirtualRange({
    rowCount: 0,
    rowHeight: 40,
    scrollOffset: 0,
    viewportSize: 200
  }).totalSize, 0);
});

test("cell generations keep stale saves from overwriting the newest optimistic edit", () => {
  const generations = new Map();
  const first = nextGridCellGeneration(generations.get("p1:rating"));
  generations.set("p1:rating", first);
  const second = nextGridCellGeneration(generations.get("p1:rating"));
  generations.set("p1:rating", second);

  assert.equal(isCurrentGridCellGeneration(generations, "p1:rating", first), false);
  assert.equal(isCurrentGridCellGeneration(generations, "p1:rating", second), true);
  assert.equal(shouldReconcileOptimisticValue("A", "S"), false);
  assert.equal(shouldReconcileOptimisticValue(["上海"], ["上海"]), true);
});

test("custom choice construction keeps the new value before Tab navigation unmounts the editor", () => {
  assert.deepEqual(choiceSelectionWithValue(["AI"], "Agent", true), ["AI", "Agent"]);
  assert.deepEqual(choiceSelectionWithValue(["AI"], "半导体", false), ["半导体"]);
});
