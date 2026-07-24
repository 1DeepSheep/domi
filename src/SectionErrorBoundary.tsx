import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { workbench } from "./bridge";

type SectionErrorBoundaryProps = {
  children: ReactNode;
  resetKey: string;
  title?: string;
  description?: string;
};

type SectionErrorBoundaryState = {
  error: Error | null;
  retryKey: number;
};

export function RenderRegion({ render }: { render: () => ReactNode }) {
  return <>{render()}</>;
}

export default class SectionErrorBoundary extends Component<
  SectionErrorBoundaryProps,
  SectionErrorBoundaryState
> {
  state: SectionErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<SectionErrorBoundaryState> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("界面区域渲染失败", error, info.componentStack);
    workbench.reportRendererIssue({
      kind: "section-boundary",
      message: error.message || "界面区域渲染失败",
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n")
    });
  }

  componentDidUpdate(previousProps: SectionErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null, retryKey: 0 });
    }
  }

  render() {
    if (!this.state.error) {
      // resetKey is only a recovery signal. Keying the live subtree with it
      // remounts streamed messages on every delta and replays their enter animation.
      return (
        <Fragment key={this.state.retryKey}>
          {this.props.children}
        </Fragment>
      );
    }

    return (
      <div className="section-recovery" role="alert">
        <AlertCircle size={19} />
        <div>
          <strong>{this.props.title || "这部分界面暂时无法显示"}</strong>
          <span>{this.props.description || "其他数据和任务没有受到影响，可以重试加载。"}</span>
        </div>
        <button
          type="button"
          onClick={() => this.setState((current) => ({
            error: null,
            retryKey: current.retryKey + 1
          }))}
        >
          <RefreshCw size={15} />
          重试
        </button>
      </div>
    );
  }
}
