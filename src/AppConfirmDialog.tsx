import { AlertTriangle } from "lucide-react";
import {
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import "./app-confirm-dialog.css";

export type AppConfirmOptions = {
  title: string;
  message: ReactNode;
  detail?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
};

type ConfirmRequest = {
  id: number;
  options: AppConfirmOptions;
  opener: HTMLElement | null;
  resolve: (approved: boolean) => void;
};

type AppConfirmDialogProps = {
  request: ConfirmRequest | null;
  onSettle: (approved: boolean) => void;
};

function AppConfirmDialog({ request, onSettle }: AppConfirmDialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);

  useLayoutEffect(() => {
    if (!request) return;
    confirmButtonRef.current?.focus({ preventScroll: true });
  }, [request]);

  if (!request || typeof document === "undefined") return null;

  const { options } = request;
  return createPortal(
    <div
      className="app-confirm-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onSettle(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onSettle(false);
          return;
        }
        if (event.key === "Enter") {
          // Let the focused button keep its native meaning: Enter on “取消”
          // must never be converted into approval by the dialog container.
          if ((event.target as HTMLElement).closest("button")) return;
          event.preventDefault();
          event.stopPropagation();
          onSettle(true);
          return;
        }
        if (event.key !== "Tab") return;
        const buttons = Array.from(
          dialogRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []
        );
        if (buttons.length < 2) return;
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.shiftKey
          ? current <= 0 ? buttons.length - 1 : current - 1
          : current >= buttons.length - 1 ? 0 : current + 1;
        event.preventDefault();
        buttons[next]?.focus();
      }}
    >
      <div
        ref={dialogRef}
        className={`app-confirm-dialog ${options.tone === "danger" ? "danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <div className="app-confirm-icon" aria-hidden="true">
          <AlertTriangle size={18} />
        </div>
        <div className="app-confirm-copy">
          <h2 id={titleId}>{options.title}</h2>
          <div id={descriptionId} className="app-confirm-message">{options.message}</div>
          {options.detail && <div className="app-confirm-detail">{options.detail}</div>}
        </div>
        <div className="app-confirm-actions">
          <button type="button" onClick={() => onSettle(false)}>
            {options.cancelLabel || "取消"}
          </button>
          <button
            ref={confirmButtonRef}
            type="button"
            className={options.tone === "danger" ? "danger" : "primary"}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel || "继续"}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

export function useAppConfirm() {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const pendingRef = useRef<ConfirmRequest | null>(null);
  const requestIdRef = useRef(0);
  const settlingRef = useRef(false);

  const settle = useCallback((approved: boolean) => {
    const pending = pendingRef.current;
    if (!pending || settlingRef.current) return;
    settlingRef.current = true;
    pendingRef.current = null;
    setRequest(null);
    pending.resolve(approved);
    const opener = pending.opener;
    queueMicrotask(() => {
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    });
    settlingRef.current = false;
  }, []);

  const confirm = useCallback((options: AppConfirmOptions): Promise<boolean> => {
    // A second click while a decision is pending must not stack dialogs or actions.
    if (pendingRef.current) return Promise.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next: ConfirmRequest = {
        id: ++requestIdRef.current,
        options,
        opener: document.activeElement instanceof HTMLElement ? document.activeElement : null,
        resolve
      };
      pendingRef.current = next;
      setRequest(next);
    });
  }, []);

  useEffect(() => () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) pending.resolve(false);
  }, []);

  return {
    confirm,
    confirmDialog: <AppConfirmDialog request={request} onSettle={settle} />
  };
}
