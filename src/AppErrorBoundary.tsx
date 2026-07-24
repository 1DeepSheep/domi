import { Component, type ErrorInfo, type ReactNode } from "react";
import { workbench } from "./bridge";

type AppErrorBoundaryProps = {
  children: ReactNode;
};

type AppErrorBoundaryState = {
  error: Error | null;
};

export default class AppErrorBoundary extends Component<
  AppErrorBoundaryProps,
  AppErrorBoundaryState
> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("豆米界面渲染失败", error, info.componentStack);
    workbench.reportRendererIssue({
      kind: "react-boundary",
      message: error.message || "豆米界面渲染失败",
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n")
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <main className="app-recovery" role="alert">
        <div className="app-recovery__panel">
          <div className="app-recovery__mark">豆米</div>
          <h1>界面加载失败</h1>
          <p>本地对话和配置没有被删除。重新载入后，豆米会尝试恢复正在执行的任务。</p>
          <button type="button" onClick={() => window.location.reload()}>
            重新载入
          </button>
          <details>
            <summary>查看错误信息</summary>
            <pre>{this.state.error.message}</pre>
          </details>
        </div>
      </main>
    );
  }
}
