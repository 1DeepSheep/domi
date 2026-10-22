import { useEffect, useRef, useState } from "react";
import { hasNativeWorkbench, workbench } from "./bridge";
import { executeSourcingRun, sourcingRequestText } from "./sourcing-run";
import { sourcingSnapshotError } from "./sourcing-status";
import { workflowPrompt, workflows } from "./workflows";
import type { CodexRunRequest } from "./env";
import type { SourcingSettings, SourcingSnapshot, SourcingSource, SourcingFocus } from "./sourcing-types";

type RunOptions = Pick<CodexRunRequest, "workspacePath" | "model" | "reasoningEffort" | "serviceTier">;
export function useSourcing(options: {
  ready: boolean;
  automaticAccess: boolean;
  getRunOptions: () => RunOptions;
  preview?: SourcingSnapshot;
}) {
  const [snapshot, setSnapshot] = useState<SourcingSnapshot | null>(options.preview || null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const runningRef = useRef(false);
  const readingRef = useRef(false);
  const mountedRef = useRef(true);
  const snapshotRef = useRef(snapshot);
  const snapshotRevisionRef = useRef(0);
  snapshotRef.current = snapshot;
  const accept = (value: SourcingSnapshot) => {
    snapshotRevisionRef.current += 1;
    snapshotRef.current = value;
    if (mountedRef.current) {
      setSnapshot(value);
      setError(sourcingSnapshotError(value));
    }
  };
  async function refresh() {
    if (optionsRef.current.preview || readingRef.current) return;
    readingRef.current = true;
    setLoading(true);
    const revision = snapshotRevisionRef.current;
    try {
      const value = await workbench.listSourcing();
      if (revision === snapshotRevisionRef.current) accept(value);
    }
    catch (cause) { if (mountedRef.current) setError(String(cause)); }
    finally { readingRef.current = false; if (mountedRef.current) setLoading(false); }
  }
  async function save(request: { settings?: Partial<SourcingSettings>; sources?: SourcingSource[]; focuses?: SourcingFocus[] }) {
    if (optionsRef.current.preview) {
      const previous = snapshotRef.current!;
      accept({ ...previous, settings: { ...previous.settings, ...request.settings }, sources: request.sources ?? previous.sources, focuses: request.focuses ?? previous.focuses,
        focusConfigured: request.focuses !== undefined ? true : previous.focusConfigured });
      return;
    }
    const result = await workbench.configureSourcing(request);
    accept(result);
    if (!result.ok) throw new Error(result.error || "保存失败。");
  }
  async function run(automatic = false) {
    if (runningRef.current) return;
    if (optionsRef.current.preview) {
      setError("这是界面预览，未执行真实搜索或入库。");
      return;
    }
    if (!hasNativeWorkbench) { setError("请在 domi 客户端运行水下项目发现。"); return; }
    if (automatic && (!optionsRef.current.ready || !optionsRef.current.automaticAccess)) return;
    runningRef.current = true;
    setBusy(true);
    setError("");
    let poll: number | undefined;
    try {
      await executeSourcingRun({
        begin: workbench.beginSourcing,
        finish: workbench.finishSourcing,
        onSnapshot: accept,
        execute: async lease => {
          const workflow = workflows.find(item => item.id === "underwater-sourcing")!;
          const requestText = sourcingRequestText(lease);
          poll = window.setInterval(() => void refresh(), 15_000);
          return workbench.runCodex({
            ...optionsRef.current.getRunOptions(), runId: lease.runId!,
            workflowId: workflow.id, webSearch: true, ephemeral: true,
            background: automatic, allowUserInput: false,
            requestOrigin: "programmatic", userInstructionText: "", requestText,
            prompt: workflowPrompt(workflow, requestText, "", true, "programmatic")
          });
        }
      }, !automatic);
    } catch (cause) { if (mountedRef.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      if (poll) window.clearInterval(poll);
      runningRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }
  const actionsRef = useRef({ refresh, run });
  actionsRef.current = { refresh, run };
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);
  useEffect(() => {
    if (!options.ready || options.preview) return;
    void actionsRef.current.refresh();
    if (!hasNativeWorkbench) return;
    const tick = () => {
      const current = snapshotRef.current;
      if (!current?.configured || !current.settings.enabled || runningRef.current) return;
      if ((current.focusConfigured || current.focuses?.length) && !current.focuses?.some(focus => focus.enabled)) return;
      // begin() is the authority for calendar day, retry backoff and active leases.
      if (current.run.nextRunAt && current.run.nextRunAt > Date.now()) return;
      void actionsRef.current.run(true);
    };
    const interval = window.setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    const visible = () => { if (document.visibilityState === "visible") tick(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", tick);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [options.ready, Boolean(options.preview)]);
  return { snapshot, loading, busy, error: error || (snapshot?.settings.enabled && !options.automaticAccess && !options.preview
    ? "每日发现等待联网授权：请在设置中允许自动外部访问；也可手动立即发现。" : ""), refresh, run,
    saveSettings: (settings: Partial<SourcingSettings>) => save({ settings }),
    saveSources: (sources: SourcingSource[]) => save({ sources }),
    saveFocuses: (focuses: SourcingFocus[]) => save({ focuses }) };
}
