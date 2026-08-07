export type GridColumnId = string;

export type GridCellAddress = {
  rowIndex: number;
  columnId: GridColumnId;
};

export type GridNavigationCommand =
  | "left"
  | "right"
  | "up"
  | "down"
  | "next"
  | "previous"
  | "row-start"
  | "row-end"
  | "grid-start"
  | "grid-end"
  | "page-up"
  | "page-down";

export type GridColumn<Row> = {
  id: GridColumnId;
  label?: string;
  visible?: boolean;
  editable?: boolean;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  read: (row: Row) => unknown;
  write?: (row: Row, value: unknown) => Row;
  parsePastedValue?: (text: string, row: Row) => unknown;
  formatCopiedValue?: (value: unknown, row: Row) => string;
};

export type ResolvedGridColumn<Row> = GridColumn<Row> & {
  columnIndex: number;
  width: number;
};

export type GridSelection = {
  anchor: GridCellAddress;
  focus: GridCellAddress;
};

export type GridSelectionRect = {
  rowStart: number;
  rowEnd: number;
  columnStart: number;
  columnEnd: number;
};

export type GridMutation = {
  rowIndex: number;
  columnId: GridColumnId;
  value: unknown;
};

export type GridRowPatch = {
  rowIndex: number;
  changes: Record<GridColumnId, unknown>;
};

export type GridRowDensity = "compact" | "standard" | "comfortable";

export type GridViewPreferences = {
  version: 1;
  columnOrder: GridColumnId[];
  hiddenColumnIds: GridColumnId[];
  columnWidths: Record<GridColumnId, number>;
  rowDensity: GridRowDensity;
};

export type GridVirtualRange = {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
  totalSize: number;
};

export type GridCellGeneration = number;

export const GRID_ROW_HEIGHTS: Readonly<Record<GridRowDensity, number>> = {
  compact: 32,
  standard: 40,
  comfortable: 48
};

export const DEFAULT_GRID_VIEW_PREFERENCES: GridViewPreferences = {
  version: 1,
  columnOrder: [],
  hiddenColumnIds: [],
  columnWidths: {},
  rowDensity: "standard"
};

const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 56;
const MAX_COLUMN_WIDTH = 960;

export function nextGridCellGeneration(current?: GridCellGeneration) {
  return Math.max(0, Number.isSafeInteger(current) ? Number(current) : 0) + 1;
}

export function isCurrentGridCellGeneration(
  generations: ReadonlyMap<string, GridCellGeneration>,
  cellId: string,
  generation: GridCellGeneration
) {
  return generations.get(cellId) === generation;
}

export function shouldReconcileOptimisticValue(source: unknown, optimistic: unknown) {
  if (Object.is(source, optimistic)) return true;
  return Array.isArray(source)
    && Array.isArray(optimistic)
    && source.length === optimistic.length
    && source.every((value, index) => Object.is(value, optimistic[index]));
}

export function choiceSelectionWithValue(
  selected: readonly string[],
  value: string,
  multiple: boolean
) {
  const next = new Set(multiple ? selected : []);
  next.add(value);
  return [...next];
}

function finiteInteger(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback;
}

function clamped(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0))];
}

function normalizedColumnWidth<Row>(column: GridColumn<Row>, requested?: number) {
  const minimum = Math.max(MIN_COLUMN_WIDTH, finiteInteger(column.minWidth, MIN_COLUMN_WIDTH));
  const maximum = Math.max(minimum, finiteInteger(column.maxWidth, MAX_COLUMN_WIDTH));
  const fallback = finiteInteger(column.width, DEFAULT_COLUMN_WIDTH);
  return clamped(finiteInteger(requested, fallback), minimum, maximum);
}

export function defaultCellAddress(columnIds: readonly GridColumnId[]): GridCellAddress | null {
  return columnIds.length ? { rowIndex: 0, columnId: columnIds[0] } : null;
}

export function normalizeCellAddress(
  address: GridCellAddress | null | undefined,
  rowCount: number,
  columnIds: readonly GridColumnId[]
): GridCellAddress | null {
  if (rowCount <= 0 || columnIds.length === 0) return null;
  const requestedColumn = address ? columnIds.indexOf(address.columnId) : -1;
  return {
    rowIndex: clamped(finiteInteger(address?.rowIndex, 0), 0, rowCount - 1),
    columnId: columnIds[requestedColumn >= 0 ? requestedColumn : 0]
  };
}

export function moveActiveCell(
  activeCell: GridCellAddress | null | undefined,
  command: GridNavigationCommand,
  rowCount: number,
  columnIds: readonly GridColumnId[],
  options: {
    pageSize?: number;
    isNavigable?: (cell: GridCellAddress) => boolean;
  } = {}
): GridCellAddress | null {
  const current = normalizeCellAddress(activeCell, rowCount, columnIds);
  if (!current) return null;
  const currentColumn = columnIds.indexOf(current.columnId);
  const pageSize = Math.max(1, finiteInteger(options.pageSize, 10));

  let rowIndex = current.rowIndex;
  let columnIndex = currentColumn;
  if (command === "left") columnIndex -= 1;
  if (command === "right") columnIndex += 1;
  if (command === "up") rowIndex -= 1;
  if (command === "down") rowIndex += 1;
  if (command === "row-start") columnIndex = 0;
  if (command === "row-end") columnIndex = columnIds.length - 1;
  if (command === "grid-start") {
    rowIndex = 0;
    columnIndex = 0;
  }
  if (command === "grid-end") {
    rowIndex = rowCount - 1;
    columnIndex = columnIds.length - 1;
  }
  if (command === "page-up") rowIndex -= pageSize;
  if (command === "page-down") rowIndex += pageSize;
  if (command === "next") {
    columnIndex += 1;
    if (columnIndex >= columnIds.length) {
      columnIndex = 0;
      rowIndex += 1;
    }
  }
  if (command === "previous") {
    columnIndex -= 1;
    if (columnIndex < 0) {
      columnIndex = columnIds.length - 1;
      rowIndex -= 1;
    }
  }

  // Tab navigation wraps between rows, but never jumps backwards at either
  // outer edge of the grid. The React layer can use a null next action to add
  // a row explicitly instead of making the active-cell model surprising.
  if ((command === "next" && rowIndex >= rowCount) || (command === "previous" && rowIndex < 0)) {
    return current;
  }

  rowIndex = clamped(rowIndex, 0, rowCount - 1);
  columnIndex = clamped(columnIndex, 0, columnIds.length - 1);
  const candidate = { rowIndex, columnId: columnIds[columnIndex] };
  if (!options.isNavigable || options.isNavigable(candidate)) return candidate;

  const direction = command === "previous" || command === "left" || command === "up" || command === "page-up"
    ? -1
    : 1;
  const currentFlatIndex = current.rowIndex * columnIds.length + currentColumn;
  const candidateFlatIndex = candidate.rowIndex * columnIds.length + columnIndex;
  const totalCells = rowCount * columnIds.length;
  for (
    let flatIndex = candidateFlatIndex;
    flatIndex >= 0 && flatIndex < totalCells;
    flatIndex += direction
  ) {
    if (flatIndex === currentFlatIndex) continue;
    const next = {
      rowIndex: Math.floor(flatIndex / columnIds.length),
      columnId: columnIds[flatIndex % columnIds.length]
    };
    if (options.isNavigable(next)) return next;
  }
  return current;
}

export function createGridSelection(
  anchor: GridCellAddress,
  focus: GridCellAddress = anchor
): GridSelection {
  return { anchor: { ...anchor }, focus: { ...focus } };
}

export function selectionRect(
  selection: GridSelection,
  rowCount: number,
  columnIds: readonly GridColumnId[]
): GridSelectionRect | null {
  const anchor = normalizeCellAddress(selection.anchor, rowCount, columnIds);
  const focus = normalizeCellAddress(selection.focus, rowCount, columnIds);
  if (!anchor || !focus) return null;
  const anchorColumn = columnIds.indexOf(anchor.columnId);
  const focusColumn = columnIds.indexOf(focus.columnId);
  return {
    rowStart: Math.min(anchor.rowIndex, focus.rowIndex),
    rowEnd: Math.max(anchor.rowIndex, focus.rowIndex),
    columnStart: Math.min(anchorColumn, focusColumn),
    columnEnd: Math.max(anchorColumn, focusColumn)
  };
}

export function cellsInSelection(
  selection: GridSelection,
  rowCount: number,
  columnIds: readonly GridColumnId[]
): GridCellAddress[] {
  const rect = selectionRect(selection, rowCount, columnIds);
  if (!rect) return [];
  const cells: GridCellAddress[] = [];
  for (let rowIndex = rect.rowStart; rowIndex <= rect.rowEnd; rowIndex += 1) {
    for (let columnIndex = rect.columnStart; columnIndex <= rect.columnEnd; columnIndex += 1) {
      cells.push({ rowIndex, columnId: columnIds[columnIndex] });
    }
  }
  return cells;
}

export function selectionContains(
  selection: GridSelection,
  cell: GridCellAddress,
  rowCount: number,
  columnIds: readonly GridColumnId[]
) {
  const rect = selectionRect(selection, rowCount, columnIds);
  const columnIndex = columnIds.indexOf(cell.columnId);
  return Boolean(
    rect
    && cell.rowIndex >= rect.rowStart
    && cell.rowIndex <= rect.rowEnd
    && columnIndex >= rect.columnStart
    && columnIndex <= rect.columnEnd
  );
}

export function extendGridSelection(
  selection: GridSelection,
  command: GridNavigationCommand,
  rowCount: number,
  columnIds: readonly GridColumnId[],
  options: { pageSize?: number } = {}
): GridSelection {
  return {
    anchor: selection.anchor,
    focus: moveActiveCell(selection.focus, command, rowCount, columnIds, options) ?? selection.focus
  };
}

export function parseTsv(text: string): string[][] {
  if (text.length === 0) return [[""]];
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;
  let endedWithRowBreak = false;

  const pushField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    endedWithRowBreak = false;
    if (character === '"') {
      if (inQuotes && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (inQuotes) {
        inQuotes = false;
      } else if (!fieldStarted) {
        inQuotes = true;
        fieldStarted = true;
      } else {
        field += character;
      }
      continue;
    }
    if (!inQuotes && character === "\t") {
      pushField();
      continue;
    }
    if (!inQuotes && (character === "\n" || character === "\r")) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
      endedWithRowBreak = true;
      continue;
    }
    field += character;
    fieldStarted = true;
  }
  if (!endedWithRowBreak || row.length > 0 || field.length > 0) pushRow();
  return rows.length ? rows : [[""]];
}

function escapedTsvField(value: string) {
  return /[\t\n\r"]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function serializeTsv(matrix: readonly (readonly unknown[])[]) {
  return matrix
    .map((row) => row.map((value) => escapedTsvField(value == null ? "" : String(value))).join("\t"))
    .join("\n");
}

export function rectangularMatrix<T>(matrix: readonly (readonly T[])[], fill: T): T[][] {
  const width = matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  return matrix.map((row) => Array.from({ length: width }, (_, index) => row[index] ?? fill));
}

export function selectionToTsv<Row>(
  rows: readonly Row[],
  columns: readonly GridColumn<Row>[],
  selection: GridSelection
) {
  const columnIds = columns.map((column) => column.id);
  const rect = selectionRect(selection, rows.length, columnIds);
  if (!rect) return "";
  const matrix: string[][] = [];
  for (let rowIndex = rect.rowStart; rowIndex <= rect.rowEnd; rowIndex += 1) {
    const outputRow: string[] = [];
    for (let columnIndex = rect.columnStart; columnIndex <= rect.columnEnd; columnIndex += 1) {
      const column = columns[columnIndex];
      const value = column.read(rows[rowIndex]);
      outputRow.push(column.formatCopiedValue
        ? column.formatCopiedValue(value, rows[rowIndex])
        : value == null ? "" : String(value));
    }
    matrix.push(outputRow);
  }
  return serializeTsv(matrix);
}

export function planPasteMutations<Row>(options: {
  rows: readonly Row[];
  columns: readonly GridColumn<Row>[];
  start: GridCellAddress;
  matrix: readonly (readonly string[])[];
  selection?: GridSelection;
}): GridMutation[] {
  const { rows, columns, start, matrix, selection } = options;
  if (rows.length === 0 || columns.length === 0 || matrix.length === 0) return [];
  const columnIds = columns.map((column) => column.id);
  const normalizedStart = normalizeCellAddress(start, rows.length, columnIds);
  if (!normalizedStart) return [];
  const startColumn = columnIds.indexOf(normalizedStart.columnId);
  const selectionBounds = selection ? selectionRect(selection, rows.length, columnIds) : null;
  const isSingleValue = matrix.length === 1 && (matrix[0]?.length ?? 0) === 1;
  const targetRows = isSingleValue && selectionBounds
    ? selectionBounds.rowEnd - selectionBounds.rowStart + 1
    : matrix.length;
  const targetColumns = isSingleValue && selectionBounds
    ? selectionBounds.columnEnd - selectionBounds.columnStart + 1
    : matrix.reduce((maximum, row) => Math.max(maximum, row.length), 0);
  const targetRowStart = isSingleValue && selectionBounds ? selectionBounds.rowStart : normalizedStart.rowIndex;
  const targetColumnStart = isSingleValue && selectionBounds ? selectionBounds.columnStart : startColumn;
  const mutations: GridMutation[] = [];

  for (let rowOffset = 0; rowOffset < targetRows; rowOffset += 1) {
    const rowIndex = targetRowStart + rowOffset;
    if (rowIndex >= rows.length) break;
    for (let columnOffset = 0; columnOffset < targetColumns; columnOffset += 1) {
      const columnIndex = targetColumnStart + columnOffset;
      if (columnIndex >= columns.length) break;
      const column = columns[columnIndex];
      // Planning is also used to create IPC/database patches. A renderer does
      // not need to provide an in-memory writer merely to ask the backend to
      // persist a value; applyGridMutations will still require one.
      if (column.editable === false) continue;
      const sourceRow = isSingleValue ? matrix[0] : matrix[rowOffset];
      if (!sourceRow || (!isSingleValue && columnOffset >= sourceRow.length)) continue;
      const text = sourceRow[isSingleValue ? 0 : columnOffset] ?? "";
      mutations.push({
        rowIndex,
        columnId: column.id,
        value: column.parsePastedValue ? column.parsePastedValue(text, rows[rowIndex]) : text
      });
    }
  }
  return mutations;
}

export function coalesceGridMutations(mutations: readonly GridMutation[]) {
  const keyed = new Map<string, GridMutation>();
  for (const mutation of mutations) {
    keyed.set(`${mutation.rowIndex}\u0000${mutation.columnId}`, mutation);
  }
  return [...keyed.values()];
}

export function groupMutationsByRow(mutations: readonly GridMutation[]): GridRowPatch[] {
  const patches = new Map<number, Record<GridColumnId, unknown>>();
  for (const mutation of coalesceGridMutations(mutations)) {
    const changes = patches.get(mutation.rowIndex) ?? {};
    changes[mutation.columnId] = mutation.value;
    patches.set(mutation.rowIndex, changes);
  }
  return [...patches.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowIndex, changes]) => ({ rowIndex, changes }));
}

export function applyGridMutations<Row>(
  rows: readonly Row[],
  columns: readonly GridColumn<Row>[],
  mutations: readonly GridMutation[]
): Row[] {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const nextRows = [...rows];
  for (const mutation of coalesceGridMutations(mutations)) {
    if (mutation.rowIndex < 0 || mutation.rowIndex >= nextRows.length) continue;
    const column = columnsById.get(mutation.columnId);
    if (!column?.write || column.editable === false) continue;
    nextRows[mutation.rowIndex] = column.write(nextRows[mutation.rowIndex], mutation.value);
  }
  return nextRows;
}

export function parseGridViewPreferences(
  input: string | unknown,
  knownColumnIds: readonly GridColumnId[] = []
): GridViewPreferences {
  let parsed: unknown = input;
  if (typeof input === "string") {
    try {
      parsed = JSON.parse(input);
    } catch {
      parsed = null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...DEFAULT_GRID_VIEW_PREFERENCES, columnWidths: {} };
  }
  const record = parsed as Record<string, unknown>;
  const known = new Set(knownColumnIds);
  const keepColumn = (columnId: string) => known.size === 0 || known.has(columnId);
  const rawWidths = record.columnWidths && typeof record.columnWidths === "object" && !Array.isArray(record.columnWidths)
    ? record.columnWidths as Record<string, unknown>
    : {};
  const columnWidths: Record<string, number> = {};
  for (const [columnId, width] of Object.entries(rawWidths)) {
    if (!keepColumn(columnId)) continue;
    const numericWidth = finiteInteger(width, Number.NaN);
    if (Number.isFinite(numericWidth)) {
      columnWidths[columnId] = clamped(numericWidth, MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH);
    }
  }
  const rowDensity = record.rowDensity === "compact" || record.rowDensity === "comfortable"
    ? record.rowDensity
    : "standard";
  return {
    version: 1,
    columnOrder: uniqueStrings(record.columnOrder).filter(keepColumn),
    hiddenColumnIds: uniqueStrings(record.hiddenColumnIds).filter(keepColumn),
    columnWidths,
    rowDensity
  };
}

export function serializeGridViewPreferences(
  preferences: GridViewPreferences,
  knownColumnIds: readonly GridColumnId[] = []
) {
  return JSON.stringify(parseGridViewPreferences(preferences, knownColumnIds));
}

export function withColumnWidth(
  preferences: GridViewPreferences,
  columnId: GridColumnId,
  width: number
): GridViewPreferences {
  return {
    ...preferences,
    columnWidths: {
      ...preferences.columnWidths,
      [columnId]: clamped(finiteInteger(width, DEFAULT_COLUMN_WIDTH), MIN_COLUMN_WIDTH, MAX_COLUMN_WIDTH)
    }
  };
}

export function withRowDensity(
  preferences: GridViewPreferences,
  rowDensity: GridRowDensity
): GridViewPreferences {
  return { ...preferences, rowDensity };
}

export function resolveVisibleColumns<Row>(
  columns: readonly GridColumn<Row>[],
  preferences: GridViewPreferences = DEFAULT_GRID_VIEW_PREFERENCES
): ResolvedGridColumn<Row>[] {
  const columnsById = new Map(columns.map((column) => [column.id, column]));
  const hidden = new Set(preferences.hiddenColumnIds);
  const orderedIds = [
    ...preferences.columnOrder.filter((columnId) => columnsById.has(columnId)),
    ...columns.map((column) => column.id).filter((columnId) => !preferences.columnOrder.includes(columnId))
  ];
  return orderedIds
    .map((columnId) => columnsById.get(columnId))
    .filter((column): column is GridColumn<Row> => Boolean(column && column.visible !== false && !hidden.has(column.id)))
    .map((column, columnIndex) => ({
      ...column,
      columnIndex,
      width: normalizedColumnWidth(column, preferences.columnWidths[column.id])
    }));
}

export function calculateVirtualRange(options: {
  rowCount: number;
  rowHeight: number;
  scrollOffset: number;
  viewportSize: number;
  overscan?: number;
}): GridVirtualRange {
  const rowCount = Math.max(0, finiteInteger(options.rowCount, 0));
  const rowHeight = Math.max(1, finiteInteger(options.rowHeight, GRID_ROW_HEIGHTS.standard));
  const viewportSize = Math.max(0, Number.isFinite(options.viewportSize) ? options.viewportSize : 0);
  const totalSize = rowCount * rowHeight;
  if (rowCount === 0) {
    return {
      startIndex: 0,
      endIndex: 0,
      offsetTop: 0,
      visibleStartIndex: 0,
      visibleEndIndex: 0,
      totalSize: 0
    };
  }
  const maximumOffset = Math.max(0, totalSize - viewportSize);
  const scrollOffset = clamped(
    Number.isFinite(options.scrollOffset) ? options.scrollOffset : 0,
    0,
    maximumOffset
  );
  const overscan = Math.max(0, finiteInteger(options.overscan, 4));
  const visibleStartIndex = clamped(Math.floor(scrollOffset / rowHeight), 0, rowCount - 1);
  const visibleEndIndex = clamped(
    Math.max(visibleStartIndex + 1, Math.ceil((scrollOffset + viewportSize) / rowHeight)),
    0,
    rowCount
  );
  const startIndex = Math.max(0, visibleStartIndex - overscan);
  const endIndex = Math.min(rowCount, visibleEndIndex + overscan);
  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * rowHeight,
    visibleStartIndex,
    visibleEndIndex,
    totalSize
  };
}
