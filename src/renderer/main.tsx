import React from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "@xterm/xterm/css/xterm.css";
import { App } from "./App.js";

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class RootErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: ""
  };

  public static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      message: String(error instanceof Error ? error.message : error)
    };
  }

  public componentDidCatch(error: unknown): void {
    console.error("Uncaught renderer error", error);
  }

  public render(): React.ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div style={{
        height: "100vh",
        width: "100%",
        display: "grid",
        placeItems: "center",
        background: "#0b0f14",
        color: "#d9e5fb",
        fontFamily: '"Space Grotesk", "Segoe UI", sans-serif',
        padding: "24px",
        boxSizing: "border-box"
      }}>
        <div style={{ maxWidth: "640px", border: "1px solid #27364d", borderRadius: "12px", padding: "20px" }}>
          <h2 style={{ marginTop: 0 }}>Renderer Error</h2>
          <p style={{ opacity: 0.9, marginBottom: "16px" }}>The app hit an unexpected UI error. Reload to recover.</p>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", opacity: 0.8 }}>{this.state.message}</pre>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "12px",
              border: "1px solid #27364d",
              background: "#141d2a",
              color: "#d9e5fb",
              borderRadius: "8px",
              padding: "10px 14px",
              cursor: "pointer"
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}

const rootEl = document.getElementById("app");

if (!rootEl) {
  throw new Error("App root was not found");
}

createRoot(rootEl).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <App />
    </RootErrorBoundary>
  </React.StrictMode>
);
