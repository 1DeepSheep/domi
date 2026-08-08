import {
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  LoaderCircle,
  Rows3,
  Trash2,
  X
} from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import type { DomiNewsItem, DomiPerson, DomiProject } from "../env";
import {
  DatabaseCellEditor,
  DatabaseLongTextViewer,
  type DatabaseCellEditorProps,
  type DatabaseCellKind,
  type DatabaseCellNavigation,
  type DatabaseCellOption
} from "./DatabaseCellEditors";
import {
  gridCellClickIntent,
  isCurrentGridCellGeneration,
  nextGridCellGeneration,
  parseTsv,
  planPasteMutations,
  serializeTsv,
  shouldReconcileOptimisticValue,
  type GridColumn as ModelGridColumn,
  type GridSelection as ModelGridSelection
} from "./grid-model";
import "./database-grid.css";

export type DatabaseRecord = DomiProject | DomiPerson | DomiNewsItem;
export type DatabaseRowHeight = 32 | 40 | 48;

export type DatabaseGridColumn<T extends DatabaseRecord> = {
  key: string;
  label: string;
  kind: DatabaseCellKind;
  width?: number;
  minWidth?: number;
  maxWidth?: number;
  editable?: boolean | ((record: T) => boolean);
  required?: boolean;
  align?: "left" | "center" | "right";
  placeholder?: string;
  options?: DatabaseCellOption[] | ((record: T) => DatabaseCellOption[]);
  allowCustomOptions?: boolean;
  getValue?: (record: T) => unknown;
  setValue?: (value: unknown, record: T) => Partial<T>;
  parsePaste?: (text: string, record: T) => unknown;
  formatValue?: (value: unknown, record: T) => ReactNode;
  render?: (value: unknown, record: T) => ReactNode;
  className?: string;
};

export type DatabasePatchContext<T extends DatabaseRecord> = {
  reason: "edit" | "paste" | "batch" | "clear";
  fields: string[];
  original: Partial<T>;
};

export type DatabaseGridProps<T extends DatabaseRecord> = {
  records: T[];
  columns: DatabaseGridColumn<T>[];
  onPatch: (
    record: T,
    patch: Partial<T>,
    context: DatabasePatchContext<T>
  ) => Promise<T | void> | T | void;
  onPreview?: (record: T, column: DatabaseGridColumn<T>, value: unknown) => void;
  onDelete?: (record: T) => Promise<void> | void;
  /** App owns filtering and sorting; these are only surfaced as quiet view context. */
  filter?: ReactNode;
  sort?: ReactNode;
  getRecordId?: (record: T) => string;
  height?: number | string;
  initialRowHeight?: DatabaseRowHeight;
  persistenceKey?: string;
  emptyMessage?: string;
  readOnly?: boolean;
  overscan?: number;
  ariaLabel?: string;
  className?: string;
};

type CellPosition = { row: number; column: number };
type CellIdentity = { recordId: string; columnKey: string };
type SelectionRange = { anchor: CellPosition; focus: CellPosition };
type OptimisticCell = { value: unknown; sourceValue: unknown; generation: number };
type SaveState = "saving" | "saved" | "error";
type ContextMenuState<T extends DatabaseRecord> = {
  record: T;
  x: number;
  y: number;
};

const ROW_NUMBER_WIDTH = 44;
const HEADER_HEIGHT = 40;
const DEFAULT_COLUMN_WIDTH = 160;
const MIN_COLUMN_WIDTH = 72;
const MAX_COLUMN_WIDTH = 720;
const SAVED_INDICATOR_MS = 1_200;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function sameValue(left: unknown, right: unknown) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((item, index) => Object.is(item, right[index]));
  }
  return false;
}

function cellId(recordId: string, columnKey: string) {
  return `${recordId}\u0000${columnKey}`;
}

function normalizedSelection(selection: SelectionRange) {
  return {
    rowStart: Math.min(selection.anchor.row, selection.focus.row),
    rowEnd: Math.max(selection.anchor.row, selection.focus.row),
    columnStart: Math.min(selection.anchor.column, selection.focus.column),
    columnEnd: Math.max(selection.anchor.column, selection.focus.column)
  };
}

function selectionSize(selection: SelectionRange) {
  const range = normalizedSelection(selection);
  return (range.rowEnd - range.rowStart + 1) * (range.columnEnd - range.columnStart + 1);
}

function defaultRecordId(record: DatabaseRecord) {
  return record.recordId;
}

function readColumnValue<T extends DatabaseRecord>(record: T, column: DatabaseGridColumn<T>) {
  if (column.getValue) return column.getValue(record);
  return (record as unknown as Record<string, unknown>)[column.key];
}

function patchForValue<T extends DatabaseRecord>(
  record: T,
  column: DatabaseGridColumn<T>,
  value: unknown
): Partial<T> {
  if (column.setValue) return column.setValue(value, record);
  return { [column.key]: value } as Partial<T>;
}

function columnIsEditable<T extends DatabaseRecord>(
  column: DatabaseGridColumn<T>,
  record: T,
  readOnly: boolean
) {
  if (readOnly) return false;
  return typeof column.editable === "function" ? column.editable(record) : column.editable !== false;
}

function dateLabel(value: unknown) {
  if (value == null || value === "") return "—";
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1_000 : value as string | number);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function plainTextValue(value: unknown, kind: DatabaseCellKind) {
  if (value == null || value === "") return "";
  if (kind === "boolean") return value ? "是" : "否";
  if (kind === "date") return dateLabel(value);
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function displayValue<T extends DatabaseRecord>(
  value: unknown,
  record: T,
  column: DatabaseGridColumn<T>,
  onPreview?: () => void
) {
  if (column.render) return column.render(value, record);
  if (column.formatValue) return column.formatValue(value, record);
  if (column.kind === "boolean") {
    return (
      <span className={`database-grid-boolean ${value ? "checked" : ""}`}>
        {value ? <Check size={12} /> : null}
      </span>
    );
  }
  if (column.kind === "multi") {
    const values = Array.isArray(value) ? value.map(String) : [];
    if (!values.length) return <span className="database-grid-empty">—</span>;
    const options = typeof column.options === "function" ? column.options(record) : column.options || [];
    return (
      <span className="database-grid-pills">
        {values.slice(0, 3).map((item) => {
          const option = options.find((candidate) => candidate.value === item);
          return <span className={`database-grid-pill ${option?.tone || "gray"}`} key={item}>{option?.label || item}</span>;
        })}
        {values.length > 3 ? <span className="database-grid-pill more">+{values.length - 3}</span> : null}
      </span>
    );
  }
  if (column.kind === "single") {
    if (value == null || value === "") return <span className="database-grid-empty">—</span>;
    const options = typeof column.options === "function" ? column.options(record) : column.options || [];
    const option = options.find((candidate) => candidate.value === String(value));
    return <span className={`database-grid-pill ${option?.tone || "gray"}`}>{option?.label || String(value)}</span>;
  }
  if (column.kind === "link") {
    if (!value) return <span className="database-grid-empty">—</span>;
    return (
      <button type="button" className="database-grid-preview-link" onClick={(event) => {
        event.stopPropagation();
        onPreview?.();
      }}>
        <ExternalLink size={13} />
        <span>{String(value)}</span>
      </button>
    );
  }
  if (column.kind === "date") return dateLabel(value);
  if (value == null || value === "") return <span className="database-grid-empty">—</span>;
  return <span className={column.kind === "longtext" ? "database-grid-clamped" : ""}>{String(value)}</span>;
}

function parsePastedValue<T extends DatabaseRecord>(
  text: string,
  column: DatabaseGridColumn<T>,
  record: T,
  current: unknown
) {
  if (column.parsePaste) return column.parsePaste(text, record);
  const trimmed = text.trim();
  switch (column.kind) {
    case "number": {
      if (!trimmed) return null;
      const number = Number(trimmed.replace(/,/g, ""));
      return Number.isFinite(number) ? number : current;
    }
    case "boolean":
      return /^(1|true|yes|y|是|有|✓)$/i.test(trimmed);
    case "multi":
      return trimmed ? trimmed.split(/[,，;；\n]+/).map((item) => item.trim()).filter(Boolean) : [];
    case "date": {
      if (!trimmed) return null;
      const parsed = new Date(trimmed).getTime();
      if (Number.isNaN(parsed)) return current;
      return typeof current === "number" || current == null ? parsed : trimmed;
    }
    default:
      return text.replace(/\r?\n/g, "\n");
  }
}

type GridCellProps<T extends DatabaseRecord> = {
  record: T;
  recordId: string;
  rowIndex: number;
  columnIndex: number;
  column: DatabaseGridColumn<T>;
  width: number;
  value: unknown;
  active: boolean;
  selected: boolean;
  editing: boolean;
  expanded: boolean;
  editable: boolean;
  saveState?: SaveState;
  error?: string;
  onActivate: (position: CellPosition, extend: boolean) => void;
  onExtend: (position: CellPosition) => void;
  onExpand: (position: CellPosition) => void;
  onCollapse: () => void;
  onEdit: (position: CellPosition) => void;
  onCommit: (position: CellPosition, value: unknown) => void;
  onCancel: () => void;
  onNavigate: (direction: DatabaseCellNavigation) => void;
  onPreview?: (record: T, column: DatabaseGridColumn<T>, value: unknown) => void;
};

const GridCell = memo(function GridCell<T extends DatabaseRecord>({
  record,
  recordId,
  rowIndex,
  columnIndex,
  column,
  width,
  value,
  active,
  selected,
  editing,
  expanded,
  editable,
  saveState,
  error,
  onActivate,
  onExtend,
  onExpand,
  onCollapse,
  onEdit,
  onCommit,
  onCancel,
  onNavigate,
  onPreview
}: GridCellProps<T>) {
  const cellRef = useRef<HTMLDivElement>(null);
  const clickTimerRef = useRef<number | null>(null);
  const firstClickAtRef = useRef(0);
  const position = { row: rowIndex, column: columnIndex };
  const options = typeof column.options === "function" ? column.options(record) : column.options;
  const style = { width, minWidth: width, maxWidth: width };
  const handlePreview = onPreview ? () => onPreview(record, column, value) : undefined;

  useEffect(() => () => {
    if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
  }, []);

  return (
    <div
      ref={cellRef}
      role="gridcell"
      tabIndex={active ? 0 : -1}
      data-record-id={recordId}
      data-column-key={column.key}
      data-row-index={rowIndex}
      data-column-index={columnIndex}
      data-database-editable={editable ? "true" : undefined}
      className={[
        "database-grid-cell",
        column.className || "",
        column.align ? `align-${column.align}` : "",
        selected ? "selected" : "",
        active ? "active" : "",
        editing ? "editing" : "",
        error ? "failed" : ""
      ].filter(Boolean).join(" ")}
      style={style}
      title={error || (column.kind === "longtext" ? plainTextValue(value, column.kind) : undefined)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        onActivate(position, event.shiftKey);
      }}
      onPointerEnter={(event) => {
        if (event.buttons === 1) onExtend(position);
      }}
      onClick={(event) => {
        if (gridCellClickIntent(column.kind, event.detail, editable) !== "expand") return;
        if (!plainTextValue(value, column.kind)) return;
        firstClickAtRef.current = Date.now();
        if (clickTimerRef.current !== null) window.clearTimeout(clickTimerRef.current);
        clickTimerRef.current = window.setTimeout(() => {
          clickTimerRef.current = null;
          onExpand(position);
        }, 280);
      }}
      onDoubleClick={(event) => {
        event.preventDefault();
        if (clickTimerRef.current !== null) {
          window.clearTimeout(clickTimerRef.current);
          clickTimerRef.current = null;
        }
        if (gridCellClickIntent(column.kind, event.detail, editable) === "edit") onEdit(position);
      }}
    >
      {editing ? (
        <DatabaseCellEditor
          key={`${recordId}:${column.key}`}
          kind={column.kind}
          value={value}
          options={options}
          allowCustomOptions={column.allowCustomOptions}
          placeholder={column.placeholder}
          referenceElement={cellRef.current}
          onCommit={(next) => onCommit(position, next)}
          onCancel={onCancel}
          onNavigate={onNavigate}
          onPreview={handlePreview ? () => handlePreview() : undefined}
        />
      ) : displayValue(value, record, column, handlePreview)}
      {expanded && !editing ? (
        <DatabaseLongTextViewer
          value={value}
          referenceElement={cellRef.current}
          onClose={onCollapse}
          onEdit={editable ? () => onEdit(position) : undefined}
          onFollowUpClick={editable ? (target) => {
            if (target.closest("a, button")) return;
            if (Date.now() - firstClickAtRef.current <= 520) onEdit(position);
          } : undefined}
        />
      ) : null}
      {saveState === "saving" ? <LoaderCircle className="database-cell-save spinning" size={11} /> : null}
      {saveState === "saved" ? <Check className="database-cell-save saved" size={11} /> : null}
      {saveState === "error" ? <span className="database-cell-error-dot" /> : null}
    </div>
  );
}) as <T extends DatabaseRecord>(props: GridCellProps<T>) => ReactNode;

type GridRowProps<T extends DatabaseRecord> = {
  record: T;
  recordId: string;
  rowIndex: number;
  top: number;
  rowHeight: DatabaseRowHeight;
  columns: DatabaseGridColumn<T>[];
  columnWidths: Record<string, number>;
  values: unknown[];
  selection: ReturnType<typeof normalizedSelection>;
  activeCell: CellPosition | null;
  editingCell: CellIdentity | null;
  expandedCell: CellIdentity | null;
  readOnly: boolean;
  saveStates: Map<string, SaveState>;
  errors: Map<string, string>;
  onActivate: GridCellProps<T>["onActivate"];
  onExtend: GridCellProps<T>["onExtend"];
  onExpand: GridCellProps<T>["onExpand"];
  onCollapse: GridCellProps<T>["onCollapse"];
  onEdit: GridCellProps<T>["onEdit"];
  onCommit: (identity: CellIdentity, value: unknown) => void;
  onCancel: GridCellProps<T>["onCancel"];
  onNavigate: GridCellProps<T>["onNavigate"];
  onPreview?: GridCellProps<T>["onPreview"];
  onContextMenu: (record: T, x: number, y: number) => void;
};

const GridRow = memo(function GridRow<T extends DatabaseRecord>({
  record,
  recordId,
  rowIndex,
  top,
  rowHeight,
  columns,
  columnWidths,
  values,
  selection,
  activeCell,
  editingCell,
  expandedCell,
  readOnly,
  saveStates,
  errors,
  onActivate,
  onExtend,
  onExpand,
  onCollapse,
  onEdit,
  onCommit,
  onCancel,
  onNavigate,
  onPreview,
  onContextMenu
}: GridRowProps<T>) {
  return (
    <div
      role="row"
      className="database-grid-row"
      style={{ height: rowHeight, transform: `translateY(${top}px)` }}
      onContextMenu={(event) => {
        event.preventDefault();
        onContextMenu(record, event.clientX, event.clientY);
      }}
    >
      <div className="database-grid-row-number" style={{ width: ROW_NUMBER_WIDTH }}>{rowIndex + 1}</div>
      {columns.map((column, columnIndex) => {
        const active = activeCell?.row === rowIndex && activeCell.column === columnIndex;
        const editing = editingCell?.recordId === recordId && editingCell.columnKey === column.key;
        const expanded = expandedCell?.recordId === recordId && expandedCell.columnKey === column.key;
        const selected = rowIndex >= selection.rowStart && rowIndex <= selection.rowEnd
          && columnIndex >= selection.columnStart && columnIndex <= selection.columnEnd;
        const id = cellId(recordId, column.key);
        return (
          <GridCell
            key={column.key}
            record={record}
            recordId={recordId}
            rowIndex={rowIndex}
            columnIndex={columnIndex}
            column={column}
            width={columnWidths[column.key] || DEFAULT_COLUMN_WIDTH}
            value={values[columnIndex]}
            active={active}
            selected={selected}
            editing={editing}
            expanded={expanded}
            editable={columnIsEditable(column, record, readOnly)}
            saveState={saveStates.get(id)}
            error={errors.get(id)}
            onActivate={onActivate}
            onExtend={onExtend}
            onExpand={onExpand}
            onCollapse={onCollapse}
            onEdit={onEdit}
            onCommit={(_position, value) => onCommit({ recordId, columnKey: column.key }, value)}
            onCancel={onCancel}
            onNavigate={onNavigate}
            onPreview={onPreview}
          />
        );
      })}
    </div>
  );
}) as <T extends DatabaseRecord>(props: GridRowProps<T>) => ReactNode;

export function DatabaseGrid<T extends DatabaseRecord>({
  records,
  columns,
  onPatch,
  onPreview,
  onDelete,
  filter,
  sort,
  getRecordId = defaultRecordId as (record: T) => string,
  height = "min(68vh, 720px)",
  initialRowHeight = 40,
  persistenceKey = "domi-database-grid",
  emptyMessage = "没有匹配的记录",
  readOnly = false,
  overscan = 8,
  ariaLabel = "资料库表格",
  className = ""
}: DatabaseGridProps<T>) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewportHeight, setViewportHeight] = useState(560);
  const [scrollTop, setScrollTop] = useState(0);
  const [rowHeight, setRowHeight] = useState<DatabaseRowHeight>(() => {
    const saved = Number(localStorage.getItem(`${persistenceKey}:row-height`));
    return saved === 32 || saved === 40 || saved === 48 ? saved : initialRowHeight;
  });
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
    try {
      return JSON.parse(localStorage.getItem(`${persistenceKey}:column-widths`) || "{}") as Record<string, number>;
    } catch {
      return {};
    }
  });
  const [activeCell, setActiveCell] = useState<CellPosition | null>(records.length && columns.length ? { row: 0, column: 0 } : null);
  const [editingCell, setEditingCell] = useState<CellIdentity | null>(null);
  const [expandedCell, setExpandedCell] = useState<CellIdentity | null>(null);
  const [selection, setSelection] = useState<SelectionRange>({
    anchor: { row: 0, column: 0 },
    focus: { row: 0, column: 0 }
  });
  const [selecting, setSelecting] = useState(false);
  const [optimistic, setOptimistic] = useState<Map<string, OptimisticCell>>(() => new Map());
  const [saveStates, setSaveStates] = useState<Map<string, SaveState>>(() => new Map());
  const [errors, setErrors] = useState<Map<string, string>>(() => new Map());
  const [batchEditorOpen, setBatchEditorOpen] = useState(false);
  const [batchButton, setBatchButton] = useState<HTMLButtonElement | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState<T> | null>(null);
  const activeCellRef = useRef<CellPosition | null>(activeCell);
  const activeIdentityRef = useRef<CellIdentity | null>(
    records.length && columns.length
      ? { recordId: getRecordId(records[0]), columnKey: columns[0].key }
      : null
  );
  const editingCellRef = useRef<CellIdentity | null>(editingCell);
  const expandedCellRef = useRef<CellIdentity | null>(expandedCell);
  const saveTimersRef = useRef(new Map<string, number>());
  const cellGenerationsRef = useRef(new Map<string, number>());

  useEffect(() => { activeCellRef.current = activeCell; }, [activeCell]);
  useEffect(() => { editingCellRef.current = editingCell; }, [editingCell]);
  useEffect(() => { expandedCellRef.current = expandedCell; }, [expandedCell]);
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const update = () => setViewportHeight(container.clientHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);
  useEffect(() => () => {
    for (const timer of saveTimersRef.current.values()) window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    setOptimistic((current) => {
      let changed = false;
      const next = new Map(current);
      for (const record of records) {
        const recordId = getRecordId(record);
        for (const column of columns) {
          const id = cellId(recordId, column.key);
          const pending = next.get(id);
          if (!pending) continue;
          const source = readColumnValue(record, column);
          if (
            isCurrentGridCellGeneration(cellGenerationsRef.current, id, pending.generation)
            && shouldReconcileOptimisticValue(source, pending.value)
          ) {
            next.delete(id);
            changed = true;
          }
        }
      }
      return changed ? next : current;
    });
  }, [columns, getRecordId, records]);

  useEffect(() => {
    if (!records.length || !columns.length) {
      setActiveCell(null);
      setEditingCell(null);
      setExpandedCell(null);
      activeIdentityRef.current = null;
      return;
    }
    const identity = activeIdentityRef.current;
    const identityRow = identity
      ? records.findIndex((record) => getRecordId(record) === identity.recordId)
      : -1;
    const identityColumn = identity ? columns.findIndex((column) => column.key === identity.columnKey) : -1;
    const next = identityRow >= 0 && identityColumn >= 0
      ? { row: identityRow, column: identityColumn }
      : { row: 0, column: 0 };
    activeIdentityRef.current = {
      recordId: getRecordId(records[next.row]),
      columnKey: columns[next.column].key
    };
    setActiveCell((current) => current?.row === next.row && current.column === next.column ? current : next);
    setSelection((current) => {
      const currentRect = normalizedSelection(current);
      if (currentRect.rowStart === currentRect.rowEnd && currentRect.columnStart === currentRect.columnEnd) {
        return current.anchor.row === next.row
          && current.anchor.column === next.column
          && current.focus.row === next.row
          && current.focus.column === next.column
          ? current
          : { anchor: next, focus: next };
      }
      return current;
    });
    setEditingCell((current) => current
      && records.some((record) => getRecordId(record) === current.recordId)
      && columns.some((column) => column.key === current.columnKey)
      ? current
      : null);
    setExpandedCell((current) => current
      && records.some((record) => getRecordId(record) === current.recordId)
      && columns.some((column) => column.key === current.columnKey && column.kind === "longtext")
      ? current
      : null);
  }, [columns, getRecordId, records]);

  const resolvedWidths = useMemo(() => Object.fromEntries(columns.map((column) => [
    column.key,
    clamp(
      columnWidths[column.key] || column.width || DEFAULT_COLUMN_WIDTH,
      column.minWidth || MIN_COLUMN_WIDTH,
      column.maxWidth || MAX_COLUMN_WIDTH
    )
  ])), [columnWidths, columns]);
  const totalWidth = ROW_NUMBER_WIDTH + columns.reduce((sum, column) => sum + resolvedWidths[column.key], 0);
  const canvasHeight = records.length * rowHeight;
  const viewportBodyTop = Math.max(0, scrollTop - HEADER_HEIGHT);
  const visibleStart = clamp(Math.floor(viewportBodyTop / rowHeight) - overscan, 0, Math.max(0, records.length - 1));
  const visibleEnd = clamp(
    Math.ceil((viewportBodyTop + viewportHeight) / rowHeight) + overscan,
    0,
    records.length
  );
  const visibleRows = records.slice(visibleStart, visibleEnd);
  const normalized = normalizedSelection(selection);

  const valueAt = useCallback((record: T, column: DatabaseGridColumn<T>) => {
    const pending = optimistic.get(cellId(getRecordId(record), column.key));
    return pending ? pending.value : readColumnValue(record, column);
  }, [getRecordId, optimistic]);

  const modelColumns = useMemo<ModelGridColumn<T>[]>(() => columns.map((column) => ({
    id: column.key,
    label: column.label,
    editable: !readOnly && column.editable !== false,
    width: resolvedWidths[column.key],
    minWidth: column.minWidth,
    maxWidth: column.maxWidth,
    read: (record) => valueAt(record, column),
    parsePastedValue: (text, record) => parsePastedValue(
      text,
      column,
      record,
      valueAt(record, column)
    ),
    formatCopiedValue: (value) => plainTextValue(value, column.kind)
  })), [columns, readOnly, resolvedWidths, valueAt]);

  const scrollCellIntoView = useCallback((position: CellPosition) => {
    const container = scrollRef.current;
    if (!container) return;
    const top = HEADER_HEIGHT + position.row * rowHeight;
    const bottom = top + rowHeight;
    if (top < container.scrollTop + HEADER_HEIGHT) container.scrollTop = Math.max(0, top - HEADER_HEIGHT);
    else if (bottom > container.scrollTop + container.clientHeight) container.scrollTop = bottom - container.clientHeight;
    let left = ROW_NUMBER_WIDTH;
    for (let index = 0; index < position.column; index += 1) left += resolvedWidths[columns[index].key];
    const right = left + resolvedWidths[columns[position.column].key];
    if (left < container.scrollLeft + ROW_NUMBER_WIDTH) container.scrollLeft = Math.max(0, left - ROW_NUMBER_WIDTH);
    else if (right > container.scrollLeft + container.clientWidth) container.scrollLeft = right - container.clientWidth;
  }, [columns, resolvedWidths, rowHeight]);

  const focusCell = useCallback((position: CellPosition, edit = false, extend = false) => {
    if (!records.length || !columns.length) return;
    const next = {
      row: clamp(position.row, 0, records.length - 1),
      column: clamp(position.column, 0, columns.length - 1)
    };
    const identity = {
      recordId: getRecordId(records[next.row]),
      columnKey: columns[next.column].key
    };
    activeIdentityRef.current = identity;
    setActiveCell(next);
    setSelection((current) => extend ? { ...current, focus: next } : { anchor: next, focus: next });
    const shouldEdit = edit && columnIsEditable(columns[next.column], records[next.row], readOnly);
    setEditingCell(shouldEdit ? identity : null);
    setExpandedCell((current) => !shouldEdit
      && current?.recordId === identity.recordId
      && current.columnKey === identity.columnKey
      ? current
      : null);
    setBatchEditorOpen(false);
    scrollCellIntoView(next);
    if (!shouldEdit) window.requestAnimationFrame(() => {
      const recordId = getRecordId(records[next.row]);
      document.querySelector<HTMLElement>(
        `[data-record-id="${CSS.escape(recordId)}"][data-column-key="${CSS.escape(columns[next.column].key)}"]`
      )?.focus({ preventScroll: true });
    });
  }, [columns, getRecordId, readOnly, records, scrollCellIntoView]);

  const navigate = useCallback((direction: DatabaseCellNavigation) => {
    const current = activeCellRef.current;
    if (!current) return;
    let row = current.row;
    let column = current.column;
    if (direction === "left") column -= 1;
    else if (direction === "right") column += 1;
    else if (direction === "up") row -= 1;
    else if (direction === "down") row += 1;
    else if (direction === "next") {
      column += 1;
      if (column >= columns.length) { column = 0; row += 1; }
    } else if (direction === "previous") {
      column -= 1;
      if (column < 0) { column = columns.length - 1; row -= 1; }
    }
    focusCell({ row, column }, true);
  }, [columns.length, focusCell]);

  const applyPatches = useCallback(async (
    patches: Map<number, Partial<T>>,
    reason: DatabasePatchContext<T>["reason"]
  ) => {
    const affected: Array<{
      row: number;
      field: string;
      id: string;
      original: unknown;
      sourceValue: unknown;
      value: unknown;
      generation: number;
    }> = [];
    for (const [row, patch] of patches) {
      const record = records[row];
      if (!record) continue;
      const recordId = getRecordId(record);
      for (const [field, value] of Object.entries(patch)) {
        const column = columns.find((candidate) => candidate.key === field);
        if (!column) continue;
        const id = cellId(recordId, field);
        const generation = nextGridCellGeneration(cellGenerationsRef.current.get(id));
        cellGenerationsRef.current.set(id, generation);
        const priorTimer = saveTimersRef.current.get(id);
        if (priorTimer) {
          window.clearTimeout(priorTimer);
          saveTimersRef.current.delete(id);
        }
        affected.push({
          row,
          field,
          id,
          original: valueAt(record, column),
          sourceValue: readColumnValue(record, column),
          value,
          generation
        });
      }
    }
    const generationById = new Map(affected.map((item) => [item.id, item.generation]));
    setErrors((current) => {
      const next = new Map(current);
      for (const item of affected) next.delete(item.id);
      return next;
    });
    setOptimistic((current) => {
      const next = new Map(current);
      for (const item of affected) {
        next.set(item.id, {
          value: item.value,
          sourceValue: item.sourceValue,
          generation: item.generation
        });
      }
      return next;
    });
    setSaveStates((current) => {
      const next = new Map(current);
      for (const item of affected) next.set(item.id, "saving");
      return next;
    });

    await Promise.all([...patches].map(async ([row, patch]) => {
      const record = records[row];
      if (!record) return;
      const fields = Object.keys(patch);
      const original = Object.fromEntries(fields.map((field) => {
        const column = columns.find((candidate) => candidate.key === field);
        return [field, column ? readColumnValue(record, column) : undefined];
      })) as Partial<T>;
      try {
        await onPatch(record, patch, { reason, fields, original });
        const ids = fields.map((field) => cellId(getRecordId(record), field));
        setSaveStates((current) => {
          const next = new Map(current);
          for (const id of ids) {
            const generation = generationById.get(id);
            if (generation !== undefined && isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)) {
              next.set(id, "saved");
            }
          }
          return next;
        });
        for (const id of ids) {
          const generation = generationById.get(id);
          if (generation === undefined || !isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)) {
            continue;
          }
          saveTimersRef.current.set(id, window.setTimeout(() => {
            if (!isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)) return;
            setSaveStates((current) => {
              const next = new Map(current);
              if (next.get(id) === "saved") next.delete(id);
              return next;
            });
            saveTimersRef.current.delete(id);
          }, SAVED_INDICATOR_MS));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const ids = fields.map((field) => cellId(getRecordId(record), field));
        setOptimistic((current) => {
          const next = new Map(current);
          for (const id of ids) {
            const generation = generationById.get(id);
            const pending = next.get(id);
            if (
              generation !== undefined
              && pending?.generation === generation
              && isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)
            ) next.delete(id);
          }
          return next;
        });
        setSaveStates((current) => {
          const next = new Map(current);
          for (const id of ids) {
            const generation = generationById.get(id);
            if (generation !== undefined && isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)) {
              next.set(id, "error");
            }
          }
          return next;
        });
        setErrors((current) => {
          const next = new Map(current);
          for (const id of ids) {
            const generation = generationById.get(id);
            if (generation !== undefined && isCurrentGridCellGeneration(cellGenerationsRef.current, id, generation)) {
              next.set(id, message || "保存失败，请重试");
            }
          }
          return next;
        });
      }
    }));
  }, [columns, getRecordId, onPatch, records, valueAt]);

  const commitCell = useCallback((identity: CellIdentity, value: unknown) => {
    const row = records.findIndex((record) => getRecordId(record) === identity.recordId);
    const columnIndex = columns.findIndex((column) => column.key === identity.columnKey);
    const record = records[row];
    const column = columns[columnIndex];
    setEditingCell(null);
    if (!record || !column || !columnIsEditable(column, record, readOnly)) return;
    const current = valueAt(record, column);
    if (sameValue(value, current)) return;
    void applyPatches(new Map([[row, patchForValue(record, column, value)]]), "edit");
  }, [applyPatches, columns, getRecordId, readOnly, records, valueAt]);

  const selectionPatches = useCallback((value: unknown, reason: DatabasePatchContext<T>["reason"]) => {
    const range = normalizedSelection(selection);
    const patches = new Map<number, Partial<T>>();
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const record = records[row];
      if (!record) continue;
      let patch: Partial<T> = {};
      for (let columnIndex = range.columnStart; columnIndex <= range.columnEnd; columnIndex += 1) {
        const column = columns[columnIndex];
        if (!column || !columnIsEditable(column, record, readOnly)) continue;
        const nextValue = reason === "clear"
          ? column.kind === "multi" ? [] : column.kind === "boolean" ? false : column.kind === "number" || column.kind === "date" ? null : ""
          : value;
        patch = { ...patch, ...patchForValue(record, column, nextValue) };
      }
      if (Object.keys(patch).length) patches.set(row, patch);
    }
    if (patches.size) void applyPatches(patches, reason);
  }, [applyPatches, columns, readOnly, records, selection]);

  const selectionText = useCallback(() => {
    const range = normalizedSelection(selection);
    const matrix: string[][] = [];
    for (let row = range.rowStart; row <= range.rowEnd; row += 1) {
      const record = records[row];
      if (!record) continue;
      const cells: string[] = [];
      for (let column = range.columnStart; column <= range.columnEnd; column += 1) {
        cells.push(plainTextValue(valueAt(record, columns[column]), columns[column].kind));
      }
      matrix.push(cells);
    }
    return serializeTsv(matrix);
  }, [columns, records, selection, valueAt]);

  const copySelection = useCallback(async () => {
    const text = selectionText();
    try { await navigator.clipboard.writeText(text); } catch { /* copy event remains the fallback */ }
  }, [selectionText]);

  const handlePaste = useCallback((text: string) => {
    const start = activeCellRef.current;
    if (!start || !text) return;
    const matrix = parseTsv(text);
    const gridSelection: ModelGridSelection = {
      anchor: {
        rowIndex: selection.anchor.row,
        columnId: columns[selection.anchor.column]?.key || columns[0]?.key || ""
      },
      focus: {
        rowIndex: selection.focus.row,
        columnId: columns[selection.focus.column]?.key || columns[0]?.key || ""
      }
    };
    const planned = planPasteMutations({
      rows: records,
      columns: modelColumns,
      start: { rowIndex: start.row, columnId: columns[start.column]?.key || "" },
      matrix,
      selection: gridSelection
    });
    const patches = new Map<number, Partial<T>>();
    const accepted = planned.filter((mutation) => {
      const record = records[mutation.rowIndex];
      const column = columns.find((candidate) => candidate.key === mutation.columnId);
      return Boolean(record && column && columnIsEditable(column, record, readOnly));
    });
    for (const mutation of accepted) {
      const record = records[mutation.rowIndex];
      const column = columns.find((candidate) => candidate.key === mutation.columnId);
      if (!record || !column) continue;
      const prior = patches.get(mutation.rowIndex) || {};
      patches.set(mutation.rowIndex, {
        ...prior,
        ...patchForValue(record, column, mutation.value)
      });
    }
    if (!patches.size) return;
    const rowEnd = Math.max(...accepted.map((mutation) => mutation.rowIndex));
    const columnEnd = Math.max(...accepted.map((mutation) => columns.findIndex((column) => column.key === mutation.columnId)));
    setSelection({ anchor: start, focus: { row: rowEnd, column: columnEnd } });
    void applyPatches(patches, "paste");
  }, [applyPatches, columns, modelColumns, readOnly, records, selection]);

  const handleGridKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (editingCellRef.current) return;
    if (event.key === "Escape" && expandedCellRef.current) {
      event.preventDefault();
      setExpandedCell(null);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "a") {
      event.preventDefault();
      if (!records.length || !columns.length) return;
      setSelection({ anchor: { row: 0, column: 0 }, focus: { row: records.length - 1, column: columns.length - 1 } });
      return;
    }
    if (event.key === "Enter" || event.key === "F2") {
      event.preventDefault();
      if (activeCellRef.current) focusCell(activeCellRef.current, true, event.shiftKey);
      return;
    }
    const navigation = event.key === "ArrowLeft" ? "left"
      : event.key === "ArrowRight" ? "right"
        : event.key === "ArrowUp" ? "up"
          : event.key === "ArrowDown" ? "down"
            : event.key === "Tab" ? event.shiftKey ? "previous" : "next"
              : null;
    if (!navigation) return;
    event.preventDefault();
    const current = activeCellRef.current;
    if (!current) return;
    let row = current.row;
    let column = current.column;
    if (navigation === "left") column -= 1;
    else if (navigation === "right") column += 1;
    else if (navigation === "up") row -= 1;
    else if (navigation === "down") row += 1;
    else if (navigation === "next") { column += 1; if (column >= columns.length) { column = 0; row += 1; } }
    else { column -= 1; if (column < 0) { column = columns.length - 1; row -= 1; } }
    focusCell({ row, column }, false, event.shiftKey);
  }, [columns.length, focusCell, records.length]);

  const beginColumnResize = useCallback((column: DatabaseGridColumn<T>, event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = resolvedWidths[column.key];
    const min = column.minWidth || MIN_COLUMN_WIDTH;
    const max = column.maxWidth || MAX_COLUMN_WIDTH;
    document.body.classList.add("database-column-resizing");
    const move = (moveEvent: PointerEvent) => {
      setColumnWidths((current) => ({
        ...current,
        [column.key]: clamp(startWidth + moveEvent.clientX - startX, min, max)
      }));
    };
    const finish = () => {
      document.body.classList.remove("database-column-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      setColumnWidths((current) => {
        localStorage.setItem(`${persistenceKey}:column-widths`, JSON.stringify(current));
        return current;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }, [persistenceKey, resolvedWidths]);

  useEffect(() => {
    if (!selecting) return;
    const finish = () => setSelecting(false);
    window.addEventListener("pointerup", finish, { once: true });
    return () => window.removeEventListener("pointerup", finish);
  }, [selecting]);

  const batchColumn = normalized.columnStart === normalized.columnEnd ? columns[normalized.columnStart] : null;
  const batchRecord = records[normalized.rowStart];
  const batchValue = batchRecord && batchColumn ? valueAt(batchRecord, batchColumn) : null;

  return (
    <section className={`database-grid-component ${className}`.trim()}>
      <div className="database-grid-viewbar">
        <div className="database-grid-view-context">
          {filter ? <span>{filter}</span> : null}
          {sort ? <span>{sort}</span> : null}
        </div>
        <div className="database-grid-density" aria-label="行高">
          <Rows3 size={14} />
          {([32, 40, 48] as DatabaseRowHeight[]).map((value) => (
            <button
              type="button"
              key={value}
              className={rowHeight === value ? "active" : ""}
              title={value === 32 ? "紧凑" : value === 40 ? "标准" : "舒适"}
              onClick={() => {
                setRowHeight(value);
                localStorage.setItem(`${persistenceKey}:row-height`, String(value));
              }}
            >{value === 32 ? "紧凑" : value === 40 ? "标准" : "舒适"}</button>
          ))}
        </div>
        <span className="database-grid-record-count">{records.length} 条记录</span>
      </div>

      {selectionSize(selection) > 1 && records.length ? (
        <div className="database-grid-selection-toolbar" role="toolbar" aria-label="批量操作">
          <strong>{selectionSize(selection)} 个单元格</strong>
          <button type="button" onClick={() => void copySelection()}><Copy size={13} />复制</button>
          {batchColumn && batchRecord && columnIsEditable(batchColumn, batchRecord, readOnly) ? (
            <button ref={setBatchButton} type="button" onClick={() => setBatchEditorOpen((current) => !current)}>
              <Clipboard size={13} />批量设置
            </button>
          ) : null}
          {!readOnly ? <button type="button" onClick={() => selectionPatches(null, "clear")}><X size={13} />清空</button> : null}
        </div>
      ) : null}

      {batchEditorOpen && batchColumn && batchRecord ? (
        <DatabaseCellEditor
          kind={batchColumn.kind}
          value={batchValue}
          options={typeof batchColumn.options === "function" ? batchColumn.options(batchRecord) : batchColumn.options}
          allowCustomOptions={batchColumn.allowCustomOptions}
          placeholder={batchColumn.placeholder}
          referenceElement={batchButton}
          onCommit={(value) => {
            setBatchEditorOpen(false);
            selectionPatches(value, "batch");
          }}
          onCancel={() => setBatchEditorOpen(false)}
          onNavigate={() => setBatchEditorOpen(false)}
        />
      ) : null}

      <div
        ref={scrollRef}
        role="grid"
        aria-label={ariaLabel}
        aria-rowcount={records.length + 1}
        aria-colcount={columns.length + 1}
        tabIndex={0}
        className="database-grid-viewport"
        style={{ height }}
        onScroll={(event) => {
          setScrollTop(event.currentTarget.scrollTop);
          if (expandedCellRef.current) setExpandedCell(null);
        }}
        onKeyDown={handleGridKeyDown}
        onCopy={(event) => {
          if ((event.target as HTMLElement).closest("input, textarea")) return;
          event.preventDefault();
          event.clipboardData.setData("text/plain", selectionText());
        }}
        onPaste={(event) => {
          if ((event.target as HTMLElement).closest("input, textarea")) return;
          event.preventDefault();
          handlePaste(event.clipboardData.getData("text/plain"));
        }}
      >
        <div className="database-grid-header" role="row" style={{ width: totalWidth, minWidth: "100%", height: HEADER_HEIGHT }}>
          <div className="database-grid-row-number header" style={{ width: ROW_NUMBER_WIDTH }}>#</div>
          {columns.map((column) => {
            const width = resolvedWidths[column.key];
            return (
              <div
                role="columnheader"
                className="database-grid-column-header"
                style={{ width, minWidth: width, maxWidth: width }}
                key={column.key}
              >
                <span>{column.label}</span>
                {column.required ? <em>*</em> : null}
                <button
                  type="button"
                  className="database-grid-column-resizer"
                  aria-label={`调整“${column.label}”列宽`}
                  onPointerDown={(event) => beginColumnResize(column, event)}
                />
              </div>
            );
          })}
        </div>
        <div className="database-grid-canvas" style={{ width: totalWidth, minWidth: "100%", height: canvasHeight }}>
          {!records.length ? <div className="database-grid-no-records">{emptyMessage}</div> : null}
          {visibleRows.map((record, offset) => {
            const rowIndex = visibleStart + offset;
            const recordId = getRecordId(record);
            const values = columns.map((column) => valueAt(record, column));
            return (
              <GridRow
                key={recordId}
                record={record}
                recordId={recordId}
                rowIndex={rowIndex}
                top={rowIndex * rowHeight}
                rowHeight={rowHeight}
                columns={columns}
                columnWidths={resolvedWidths}
                values={values}
                selection={normalized}
                activeCell={activeCell}
                editingCell={editingCell}
                expandedCell={expandedCell}
                readOnly={readOnly}
                saveStates={saveStates}
                errors={errors}
                onActivate={(position, extend) => {
                  setSelecting(true);
                  focusCell(position, false, extend);
                }}
                onExtend={(position) => {
                  if (!selecting) return;
                  setActiveCell(position);
                  setSelection((current) => ({ ...current, focus: position }));
                }}
                onExpand={(position) => {
                  const current = activeCellRef.current;
                  if (!current || current.row !== position.row || current.column !== position.column) return;
                  const recordAtPosition = records[position.row];
                  const columnAtPosition = columns[position.column];
                  if (!recordAtPosition || columnAtPosition?.kind !== "longtext") return;
                  setExpandedCell({
                    recordId: getRecordId(recordAtPosition),
                    columnKey: columnAtPosition.key
                  });
                }}
                onCollapse={() => setExpandedCell(null)}
                onEdit={(position) => focusCell(position, true)}
                onCommit={commitCell}
                onCancel={() => setEditingCell(null)}
                onNavigate={navigate}
                onPreview={onPreview}
                onContextMenu={(target, x, y) => {
                  setContextMenu({ record: target, x, y });
                  const targetRow = records.indexOf(target);
                  if (targetRow >= 0) focusCell({ row: targetRow, column: activeCellRef.current?.column || 0 });
                }}
              />
            );
          })}
        </div>
      </div>

      <footer className="database-grid-statusbar">
        <span>单击选择/展开 · 双击或 Enter/F2 编辑 · 可直接粘贴飞书或 Excel 表格</span>
        {saveStates.size ? (
          <span className="database-grid-save-summary">
            {[...saveStates.values()].some((state) => state === "saving")
              ? <><LoaderCircle className="spinning" size={12} />保存中</>
              : [...saveStates.values()].some((state) => state === "error")
                ? <>部分单元格保存失败</>
                : <><Check size={12} />已保存</>}
          </span>
        ) : null}
      </footer>

      {contextMenu ? createPortal(
        <>
          <button className="database-grid-context-backdrop" type="button" aria-label="关闭菜单" onClick={() => setContextMenu(null)} />
          <div
            className="database-grid-context-menu"
            role="menu"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 210), top: Math.min(contextMenu.y, window.innerHeight - 130) }}
          >
            {onPreview ? (
              <button type="button" role="menuitem" onClick={() => {
                const firstPreview = columns.find((column) => column.kind === "link") || columns[0];
                onPreview(contextMenu.record, firstPreview, readColumnValue(contextMenu.record, firstPreview));
                setContextMenu(null);
              }}><ExternalLink size={14} />查看详情</button>
            ) : null}
            {onDelete && !readOnly ? (
              <button type="button" role="menuitem" className="danger" onClick={() => {
                const target = contextMenu.record;
                setContextMenu(null);
                void onDelete(target);
              }}><Trash2 size={14} />删除记录</button>
            ) : null}
          </div>
        </>,
        document.body
      ) : null}
    </section>
  );
}
