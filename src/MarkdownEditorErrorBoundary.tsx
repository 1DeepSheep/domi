import { Component, Fragment, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { workbench } from "./bridge";

type MarkdownEditorErrorBoundaryProps = {
  children: ReactNode;
  documentKey: string;
};

type MarkdownEditorErrorBoundaryState = {
  error: Error | null;
  retryKey: number;
};

export default class MarkdownEditorErrorBoundary extends Component<
  MarkdownEditorErrorBoundaryProps,
  MarkdownEditorErrorBoundaryState
> {
  state: MarkdownEditorErrorBoundaryState = { error: null, retryKey: 0 };

  static getDerivedStateFromError(error: Error): MarkdownEditorErrorBoundaryState {
    return { error, retryKey: 0 };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Markdown 编辑器渲染失败", error, info.componentStack);
    workbench.reportRendererIssue({
      kind: "markdown-editor-boundary",
      message: error.message || "Markdown 编辑器渲染失败",
      stack: [error.stack, info.componentStack].filter(Boolean).join("\n")
    });
  }

  componentDidUpdate(previousProps: MarkdownEditorErrorBoundaryProps) {
    if (previousProps.documentKey !== this.props.documentKey && this.state.error) {
      this.setState({ error: null, retryKey: 0 });
    }
  }

  render() {
    if (!this.state.error) {
      return <Fragment key={`${this.props.documentKey}:${this.state.retryKey}`}>{this.props.children}</Fragment>;
    }

    return (
      <div className="markdown-editor-recovery" role="alert">
        <AlertCircle size={19} />
        <div>
          <strong>文档编辑器加载失败</strong>
          <span>文档本身没有被修改，可以重试载入编辑器。</span>
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
