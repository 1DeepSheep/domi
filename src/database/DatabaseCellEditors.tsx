import {
  autoUpdate,
  computePosition,
  flip,
  offset,
  shift,
  size
} from "@floating-ui/dom";
import { Check, ChevronDown, ExternalLink, Plus, Search, X } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import { choiceSelectionWithValue } from "./grid-model";

export type DatabaseCellKind =
  | "text"
  | "longtext"
  | "number"
  | "date"
  | "single"
  | "multi"
  | "link"
  | "boolean";

export type DatabaseCellOption = {
  value: string;
  label?: string;
  tone?: "blue" | "green" | "red" | "indigo" | "sand" | "purple" | "cyan" | "pink" | "gray";
};

export type DatabaseCellNavigation =
  | "left"
  | "right"
  | "up"
  | "down"
  | "next"
  | "previous";

export type DatabaseCellEditorProps = {
  kind: DatabaseCellKind;
  value: unknown;
  options?: DatabaseCellOption[];
  allowCustomOptions?: boolean;
  placeholder?: string;
  referenceElement: HTMLElement | null;
  disabled?: boolean;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  onNavigate: (direction: DatabaseCellNavigation) => void;
  onPreview?: (url: string) => void;
};

type FloatingSurfaceProps = {
  referenceElement: HTMLElement | null;
  className?: string;
  children: ReactNode;
  onOutside: () => void;
};

function useFloatingSurface(
  referenceElement: HTMLElement | null,
  surface: HTMLElement | null,
  placementOffset = 4
) {
  useLayoutEffect(() => {
    if (!referenceElement || !surface) return;
    const update = () => {
      void computePosition(referenceElement, surface, {
        placement: "bottom-start",
        strategy: "fixed",
        middleware: [
          offset(placementOffset),
          flip({ padding: 10 }),
          shift({ padding: 10 }),
          size({
            padding: 10,
            apply({ availableHeight, rects, elements }) {
              Object.assign(elements.floating.style, {
                maxHeight: `${Math.max(160, Math.min(420, availableHeight))}px`,
                minWidth: `${Math.max(220, Math.min(520, rects.reference.width))}px`
              });
            }
          })
        ]
      }).then(({ x, y }) => {
        Object.assign(surface.style, { left: `${x}px`, top: `${y}px` });
      });
    };
    return autoUpdate(referenceElement, surface, update, {
      ancestorResize: true,
      ancestorScroll: true,
      elementResize: true,
      layoutShift: true
    });
  }, [placementOffset, referenceElement, surface]);
}

function FloatingSurface({ referenceElement, className = "", children, onOutside }: FloatingSurfaceProps) {
  const [surface, setSurface] = useState<HTMLDivElement | null>(null);
  useFloatingSurface(referenceElement, surface);

  useEffect(() => {
    if (!surface) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (surface.contains(target) || referenceElement?.contains(target)) return;
      onOutside();
    };
    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [onOutside, referenceElement, surface]);

  return createPortal(
    <div
      ref={setSurface}
      className={`database-floating-editor ${className}`.trim()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body
  );
}

/**
 * Commits a draft when virtualization or a record reorder unmounts its editor.
 * The microtask guard deliberately survives React StrictMode's setup/cleanup
 * probe without committing an editor that was immediately remounted.
 */
function useCommitOnUnmount(commit: () => void) {
  const commitRef = useRef(commit);
  const mountedRef = useRef(false);
  commitRef.current = commit;
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      queueMicrotask(() => {
        if (!mountedRef.current) commitRef.current();
      });
    };
  }, []);
}

function keyNavigation(
  event: KeyboardEvent<HTMLInputElement>,
  commit: () => void,
  cancel: () => void,
  navigate: (direction: DatabaseCellNavigation) => void
) {
  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    return true;
  }
  if (event.key === "Tab") {
    event.preventDefault();
    commit();
    navigate(event.shiftKey ? "previous" : "next");
    return true;
  }
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
    navigate(event.shiftKey ? "up" : "down");
    return true;
  }
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    event.preventDefault();
    commit();
    navigate(event.key === "ArrowUp" ? "up" : "down");
    return true;
  }
  if (event.key === "ArrowLeft" && event.currentTarget.selectionStart === 0) {
    event.preventDefault();
    commit();
    navigate("left");
    return true;
  }
  if (
    event.key === "ArrowRight"
    && event.currentTarget.selectionStart === event.currentTarget.value.length
  ) {
    event.preventDefault();
    commit();
    navigate("right");
    return true;
  }
  return false;
}

function clampChoiceIndex(index: number, choiceCount: number) {
  if (choiceCount <= 0) return 0;
  return Math.max(0, Math.min(index, choiceCount - 1));
}

function InlineTextEditor({
  value,
  placeholder,
  kind,
  disabled,
  onCommit,
  onCancel,
  onNavigate,
  onPreview
}: DatabaseCellEditorProps) {
  const initialValue = value == null ? "" : String(value);
  const [draft, setDraft] = useState(initialValue);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  const parse = useCallback(() => {
    if (kind !== "number") return draft;
    if (!draft.trim()) return null;
    const parsed = Number(draft);
    return Number.isFinite(parsed) ? parsed : value;
  }, [draft, kind, value]);
  const commit = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(parse());
  }, [onCommit, parse]);
  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }, [onCancel]);
  useCommitOnUnmount(commit);

  return (
    <span
      className={`database-inline-editor ${kind === "link" ? "link" : ""}`}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        value={draft}
        type={kind === "number" ? "number" : kind === "link" ? "url" : "text"}
        inputMode={kind === "number" ? "decimal" : undefined}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => keyNavigation(event, commit, cancel, onNavigate)}
      />
      {kind === "link" && draft.trim() && onPreview ? (
        <button
          type="button"
          aria-label="预览链接"
          title="在右栏预览"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => onPreview(draft.trim())}
        >
          <ExternalLink size={13} />
        </button>
      ) : null}
    </span>
  );
}

function toDateInputValue(value: unknown) {
  if (value == null || value === "") return "";
  const date = value instanceof Date
    ? value
    : new Date(typeof value === "number" && value < 10_000_000_000 ? value * 1_000 : value as string | number);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateEditor({ value, disabled, onCommit, onCancel, onNavigate }: DatabaseCellEditorProps) {
  const [draft, setDraft] = useState(() => toDateInputValue(value));
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  const parse = useCallback(() => {
    if (!draft) return null;
    const timestamp = new Date(`${draft}T00:00:00`).getTime();
    if (typeof value === "number" || value == null) return timestamp;
    return draft;
  }, [draft, value]);
  const commit = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(parse());
  }, [onCommit, parse]);
  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }, [onCancel]);
  useCommitOnUnmount(commit);

  return (
    <span
      className="database-inline-editor date"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="date"
        value={draft}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => keyNavigation(event, commit, cancel, onNavigate)}
      />
    </span>
  );
}

function LongTextEditor({
  value,
  placeholder,
  referenceElement,
  disabled,
  onCommit,
  onCancel,
  onNavigate
}: DatabaseCellEditorProps) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const finishedRef = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const commit = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(draft);
  }, [draft, onCommit]);
  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }, [onCancel]);
  useCommitOnUnmount(commit);
  useLayoutEffect(() => {
    textareaRef.current?.focus({ preventScroll: true });
    textareaRef.current?.setSelectionRange(draft.length, draft.length);
    // Moving the cursor after every keystroke made editing feel broken.
    // The initial caret placement is all that is needed.
  }, []);

  return (
    <FloatingSurface
      referenceElement={referenceElement}
      className="database-longtext-editor"
      onOutside={commit}
    >
      <div className="database-floating-editor-head">
        <span>完整内容</span>
        <small>自动保存</small>
        <button type="button" aria-label="关闭" onClick={commit}><X size={14} /></button>
      </div>
      <textarea
        ref={textareaRef}
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            cancel();
          } else if (event.key === "Tab") {
            event.preventDefault();
            commit();
            onNavigate(event.shiftKey ? "previous" : "next");
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            commit();
            onNavigate(event.shiftKey ? "up" : "down");
          }
        }}
      />
      <div className="database-floating-editor-foot">
        <span>⌘↵ 保存并向下 · Esc 撤销</span>
      </div>
    </FloatingSurface>
  );
}

function ChoiceEditor({
  value,
  options = [],
  allowCustomOptions,
  referenceElement,
  kind,
  onCommit,
  onCancel,
  onNavigate
}: DatabaseCellEditorProps) {
  const multiple = kind === "multi";
  const initial = useMemo(
    () => new Set(multiple ? (Array.isArray(value) ? value.map(String) : []) : value == null || value === "" ? [] : [String(value)]),
    [multiple, value]
  );
  const [selected, setSelected] = useState(initial);
  const [query, setQuery] = useState("");
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const finishedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => inputRef.current?.focus({ preventScroll: true }), []);

  const commit = useCallback((next = selected) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCommit(multiple ? [...next] : ([...next][0] || ""));
  }, [multiple, onCommit, selected]);
  const cancel = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    onCancel();
  }, [onCancel]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleOptions = options.filter((option) => {
    if (!normalizedQuery) return true;
    return `${option.label || option.value} ${option.value}`.toLocaleLowerCase().includes(normalizedQuery);
  });
  const customValue = query.trim();
  const canCreate = Boolean(
    allowCustomOptions
    && customValue
    && !options.some((option) => option.value.toLocaleLowerCase() === customValue.toLocaleLowerCase())
  );
  const choiceCount = visibleOptions.length + (canCreate ? 1 : 0);

  useEffect(() => {
    setHighlightedIndex((current) => clampChoiceIndex(current, choiceCount));
  }, [choiceCount]);
  useLayoutEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(".highlighted")
      ?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  useCommitOnUnmount(() => {
    if (multiple) commit();
  });

  const toggle = (optionValue: string) => {
    const next = new Set(multiple ? selected : []);
    if (multiple && next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    setSelected(next);
    if (!multiple) commit(next);
  };

  return (
    <FloatingSurface
      referenceElement={referenceElement}
      className="database-choice-editor"
      onOutside={() => multiple ? commit() : cancel()}
    >
      <label className="database-choice-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={query}
          placeholder="搜索或输入选项"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const direction = event.key === "ArrowDown" ? 1 : -1;
              setHighlightedIndex((current) => {
                if (!choiceCount) return 0;
                return (current + direction + choiceCount) % choiceCount;
              });
            } else if (event.key === "Tab") {
              event.preventDefault();
              if (canCreate) {
                const next = new Set(choiceSelectionWithValue([...selected], customValue, multiple));
                setSelected(next);
                // Commit the newly constructed set synchronously. Relying on
                // the state update plus unmount cleanup loses the custom item
                // when Tab immediately navigates to the next cell.
                commit(next);
              } else {
                commit();
              }
              onNavigate(event.shiftKey ? "previous" : "next");
            } else if (event.key === "Enter") {
              event.preventDefault();
              if (highlightedIndex < visibleOptions.length) {
                toggle(visibleOptions[highlightedIndex].value);
              } else if (canCreate) {
                toggle(customValue);
              }
            }
          }}
        />
        <ChevronDown size={13} />
      </label>
      <div ref={listRef} className="database-choice-list">
        {visibleOptions.map((option, index) => (
          <button
            type="button"
            className={[
              selected.has(option.value) ? "selected" : "",
              highlightedIndex === index ? "highlighted" : ""
            ].filter(Boolean).join(" ")}
            key={option.value}
            onPointerEnter={() => setHighlightedIndex(index)}
            onClick={() => toggle(option.value)}
          >
            <span className={`database-choice-dot ${option.tone || "gray"}`} />
            <span>{option.label || option.value}</span>
            {selected.has(option.value) ? <Check size={14} /> : null}
          </button>
        ))}
        {canCreate ? (
          <button
            type="button"
            className={`create ${highlightedIndex === visibleOptions.length ? "highlighted" : ""}`}
            onPointerEnter={() => setHighlightedIndex(visibleOptions.length)}
            onClick={() => toggle(customValue)}
          >
            <Plus size={14} />
            <span>创建“{customValue}”</span>
          </button>
        ) : null}
        {!visibleOptions.length && !canCreate ? <p>没有匹配的选项</p> : null}
      </div>
      {multiple ? (
        <div className="database-choice-footer">
          <span>已选 {selected.size} 项</span>
          <button type="button" onClick={() => commit()}>完成</button>
        </div>
      ) : null}
    </FloatingSurface>
  );
}

function BooleanEditor({ value, disabled, onCommit, onCancel, onNavigate }: DatabaseCellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => inputRef.current?.focus({ preventScroll: true }), []);
  return (
    <label
      className="database-boolean-editor"
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="checkbox"
        checked={Boolean(value)}
        disabled={disabled}
        onChange={(event) => onCommit(event.target.checked)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Tab") {
            event.preventDefault();
            onCommit(event.currentTarget.checked);
            onNavigate(event.shiftKey ? "previous" : "next");
          } else if (event.key === "Enter") {
            event.preventDefault();
            onCommit(!event.currentTarget.checked);
            onNavigate(event.shiftKey ? "up" : "down");
          }
        }}
      />
      <span><Check size={12} /></span>
    </label>
  );
}

export function DatabaseCellEditor(props: DatabaseCellEditorProps) {
  switch (props.kind) {
    case "longtext":
      return <LongTextEditor {...props} />;
    case "date":
      return <DateEditor {...props} />;
    case "single":
    case "multi":
      return <ChoiceEditor {...props} />;
    case "boolean":
      return <BooleanEditor {...props} />;
    case "text":
    case "number":
    case "link":
    default:
      return <InlineTextEditor {...props} />;
  }
}
