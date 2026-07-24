import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/instrument-sans/wght.css";
import "@fontsource-variable/newsreader/wght.css";
import App from "./App";
import AppErrorBoundary from "./AppErrorBoundary";
import { workbench } from "./bridge";
import "./styles.css";

function errorMessage(value: unknown) {
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function reportRendererIssue(report: Parameters<typeof workbench.reportRendererIssue>[0]) {
  try {
    workbench.reportRendererIssue(report);
  } catch (error) {
    console.error("豆米无法上报渲染异常", error);
  }
}

window.addEventListener("error", (event) => {
  reportRendererIssue({
    kind: "error",
    message: event.message || errorMessage(event.error),
    stack: event.error instanceof Error ? event.error.stack : undefined,
    source: event.filename,
    line: event.lineno,
    column: event.colno
  });
});

window.addEventListener("unhandledrejection", (event) => {
  reportRendererIssue({
    kind: "unhandled-rejection",
    message: errorMessage(event.reason),
    stack: event.reason instanceof Error ? event.reason.stack : undefined
  });
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>
);
