/**
 * Enhanced Threading Wireframes - Final 3 Options
 * Deep dive into Stacked Panels, Timeline + Context, and Multi-Context
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { EnhancedStackedPanels } from "./wireframes-enhanced/EnhancedStackedPanels";
import { EnhancedTimeline } from "./wireframes-enhanced/EnhancedTimeline";
import { EnhancedMultiContext } from "./wireframes-enhanced/EnhancedMultiContext";

const wireframes = [
  {
    id: 1,
    name: "Stacked Panels",
    component: EnhancedStackedPanels,
    description: "Horizontal panel stack with minimize, pin, and panel management",
    color: "#2196f3",
    features: [
      "Pin important panels",
      "Minimize to avatar",
      "Hover previews",
      "Close all unpinned",
      "Unlimited panels",
    ],
  },
  {
    id: 2,
    name: "Timeline + Context",
    component: EnhancedTimeline,
    description: "Chronological timeline with collapsible parent context and visual threading",
    color: "#673ab7",
    features: [
      "Temporal awareness",
      "Visual thread lines",
      "Collapsible context",
      "Timeline dots",
      "Full conversation flow",
    ],
  },
  {
    id: 3,
    name: "Multi-Context",
    component: EnhancedMultiContext,
    description: "Parent context always visible with resizable split and numbered steps",
    color: "#ff6f00",
    features: [
      "Never lose context",
      "Resizable context panel",
      "Numbered parent chain",
      "Highlighted current",
      "Visual connections",
    ],
  },
];

function App() {
  const [selectedOption, setSelectedOption] = useState(1);

  const CurrentWireframe = wireframes.find((w) => w.id === selectedOption)!.component;
  const currentWireframe = wireframes.find((w) => w.id === selectedOption)!;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "#fff",
          borderBottom: "2px solid #ddd",
          padding: "20px",
          zIndex: 100,
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
        }}
      >
        <h1 style={{ margin: "0 0 6px 0", fontSize: "28px", fontWeight: 800 }}>
          Enhanced Threading Models
        </h1>
        <p style={{ margin: "0 0 20px 0", fontSize: "14px", color: "#666", lineHeight: "1.5" }}>
          Exploring the top 3 panel-based threading approaches with advanced features and polish
        </p>

        {/* Navigation cards */}
        <div style={{ display: "flex", gap: "12px", flexWrap: "wrap" }}>
          {wireframes.map((wireframe) => {
            const isSelected = selectedOption === wireframe.id;
            return (
              <div
                key={wireframe.id}
                onClick={() => setSelectedOption(wireframe.id)}
                style={{
                  flex: "1 1 300px",
                  padding: "16px",
                  backgroundColor: isSelected ? wireframe.color : "#fff",
                  color: isSelected ? "#fff" : "#333",
                  border: isSelected ? "none" : "2px solid #e0e0e0",
                  borderRadius: "10px",
                  cursor: "pointer",
                  transition: "all 0.3s",
                  boxShadow: isSelected
                    ? "0 4px 12px rgba(0,0,0,0.15)"
                    : "0 2px 4px rgba(0,0,0,0.05)",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = wireframe.color;
                    e.currentTarget.style.backgroundColor = "#fafafa";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.backgroundColor = "#fff";
                  }
                }}
              >
                <div style={{ fontSize: "18px", fontWeight: 700, marginBottom: "8px" }}>
                  {wireframe.id}. {wireframe.name}
                </div>
                <div
                  style={{
                    fontSize: "13px",
                    opacity: isSelected ? 0.95 : 0.7,
                    marginBottom: "12px",
                    lineHeight: "1.4",
                  }}
                >
                  {wireframe.description}
                </div>
                <div style={{ fontSize: "11px", opacity: isSelected ? 0.9 : 0.6 }}>
                  {wireframe.features.map((feature, idx) => (
                    <div key={idx} style={{ marginBottom: "4px" }}>
                      • {feature}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "24px 0" }}>
        <CurrentWireframe />
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "40px",
          padding: "24px",
          backgroundColor: currentWireframe.color,
          color: "#fff",
          textAlign: "center",
        }}
      >
        <h3 style={{ margin: "0 0 12px 0", fontSize: "20px", fontWeight: 700 }}>
          {currentWireframe.name}
        </h3>
        <p style={{ margin: "0 0 16px 0", fontSize: "14px", opacity: 0.9, lineHeight: "1.6" }}>
          {currentWireframe.description}
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: "24px",
            flexWrap: "wrap",
            fontSize: "13px",
          }}
        >
          {currentWireframe.features.map((feature, idx) => (
            <div
              key={idx}
              style={{
                padding: "8px 16px",
                backgroundColor: "rgba(255,255,255,0.2)",
                borderRadius: "20px",
              }}
            >
              ✓ {feature}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const elem = document.getElementById("root")!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

if (import.meta.hot) {
  // With hot module reloading, `import.meta.hot.data` is persisted.
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  // The hot module reloading API is not available in production.
  createRoot(elem).render(app);
}
