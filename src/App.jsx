import React from "react";
import { invoke } from "@tauri-apps/api/core";
import PlayboxLauncher from "./PlayboxLauncher";

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, info: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("Playbox crash", error, info);
    this.setState({ info });
  }
  async resetConfig() {
    try {
      await invoke("reset_config");
    } catch (e) {
      console.error("reset_config", e);
    }
    window.location.reload();
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#1a1a1a", color: "#fff",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: 32,
      }}>
        <div style={{ maxWidth: 720, textAlign: "left" }}>
          <h1 style={{ fontSize: 22, margin: 0, color: "#f87171" }}>Playbox falhou ao iniciar</h1>
          <p style={{ color: "#aaa", marginTop: 12 }}>Detalhe do erro:</p>
          <pre style={{
            background: "#0f0f0f", padding: 14, borderRadius: 8,
            color: "#fca5a5", fontSize: 12, overflow: "auto", maxHeight: 220,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
          }}>{String(this.state.error?.stack || this.state.error)}</pre>
          <div style={{ display: "flex", gap: 12, marginTop: 18 }}>
            <button onClick={() => window.location.reload()} style={{
              padding: "10px 22px", background: "#fff", color: "#1a1a1a",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>Reiniciar</button>
            <button onClick={() => this.resetConfig()} style={{
              padding: "10px 22px", background: "#7f1d1d", color: "#fff",
              border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer",
            }}>Apagar config e reiniciar</button>
            <button onClick={() => invoke("quit_app")} style={{
              padding: "10px 22px", background: "transparent", color: "#aaa",
              border: "1px solid #444", borderRadius: 8, fontSize: 14, cursor: "pointer",
            }}>Sair</button>
          </div>
        </div>
      </div>
    );
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <PlayboxLauncher />
    </ErrorBoundary>
  );
}
