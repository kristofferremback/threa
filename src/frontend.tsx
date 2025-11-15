/**
 * Timeline + Stacked Hybrid Wireframes
 * Combining Timeline view with Stacked Panels and visual connectors
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TimelineStackedConnected } from "./wireframes-enhanced/TimelineStackedConnected";
import { TimelineStackedAnimated } from "./wireframes-enhanced/TimelineStackedAnimated";
import { TimelineStackedArchitectural } from "./wireframes-enhanced/TimelineStackedArchitectural";

const wireframes = [
  {
    id: 1,
    name: "Architectural Lines",
    component: TimelineStackedArchitectural,
    description: "Clean lines that follow panel edges - no curves through space",
    color: "#673ab7",
    features: [
      "Lines follow panel borders",
      "Subtle darkened backgrounds",
      "Clean, minimal design",
      "Edge-to-edge routing",
      "Professional look",
    ],
  },
  {
    id: 2,
    name: "Bezier Curve Connectors",
    component: TimelineStackedConnected,
    description: "Smooth curved lines connecting panels with highlighted messages",
    color: "#512da8",
    features: [
      "Shift+click to open panel",
      "Hover button shortcut",
      "Smooth bezier curves",
      "Message highlighting",
      "Arrow indicators",
    ],
  },
  {
    id: 3,
    name: "Animated Color Connectors",
    component: TimelineStackedAnimated,
    description: "Straight lines with unique colors and pulse animations for each panel",
    color: "#3f51b5",
    features: [
      "Each panel gets unique color",
      "Pulse animation on open",
      "Color-coded highlights",
      "Straight line connectors",
      "Glow effects",
    ],
  },
];

function App() {
  const [selectedOption, setSelectedOption] = useState(1);

  const CurrentWireframe = wireframes.find((w) => w.id === selectedOption)!.component;
  const currentWireframe = wireframes.find((w) => w.id === selectedOption)!;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif", backgroundColor: "#fafafa", minHeight: "100vh" }}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "#fff",
          borderBottom: "2px solid #ddd",
          padding: "24px",
          zIndex: 100,
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
        }}
      >
        <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
          <h1 style={{ margin: "0 0 8px 0", fontSize: "32px", fontWeight: 800, color: "#333" }}>
            Timeline + Stacked Panels
          </h1>
          <p style={{ margin: "0 0 20px 0", fontSize: "15px", color: "#666", lineHeight: "1.6" }}>
            Combining the best of Timeline + Context with Stacked Panels. Visual connections show panel relationships.
          </p>

          {/* Navigation cards */}
          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap" }}>
            {wireframes.map((wireframe) => {
              const isSelected = selectedOption === wireframe.id;
              return (
                <div
                  key={wireframe.id}
                  onClick={() => setSelectedOption(wireframe.id)}
                  style={{
                    flex: "1 1 350px",
                    padding: "20px",
                    backgroundColor: isSelected ? wireframe.color : "#fff",
                    color: isSelected ? "#fff" : "#333",
                    border: isSelected ? "none" : "2px solid #e0e0e0",
                    borderRadius: "12px",
                    cursor: "pointer",
                    transition: "all 0.3s",
                    boxShadow: isSelected
                      ? "0 6px 16px rgba(0,0,0,0.15)"
                      : "0 2px 6px rgba(0,0,0,0.05)",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = wireframe.color;
                      e.currentTarget.style.backgroundColor = "#f9f9f9";
                      e.currentTarget.style.transform = "translateY(-2px)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = "#e0e0e0";
                      e.currentTarget.style.backgroundColor = "#fff";
                      e.currentTarget.style.transform = "translateY(0)";
                    }
                  }}
                >
                  <div style={{ fontSize: "20px", fontWeight: 700, marginBottom: "10px" }}>
                    {wireframe.id}. {wireframe.name}
                  </div>
                  <div
                    style={{
                      fontSize: "14px",
                      opacity: isSelected ? 0.95 : 0.7,
                      marginBottom: "14px",
                      lineHeight: "1.5",
                    }}
                  >
                    {wireframe.description}
                  </div>
                  <div style={{ fontSize: "12px", opacity: isSelected ? 0.9 : 0.6 }}>
                    {wireframe.features.map((feature, idx) => (
                      <div key={idx} style={{ marginBottom: "5px" }}>
                        • {feature}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "32px 24px", maxWidth: "1600px", margin: "0 auto" }}>
        <CurrentWireframe />
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "60px",
          padding: "32px",
          backgroundColor: currentWireframe.color,
          color: "#fff",
        }}
      >
        <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
          <h3 style={{ margin: "0 0 16px 0", fontSize: "24px", fontWeight: 700 }}>
            {currentWireframe.name}
          </h3>
          <p style={{ margin: "0 0 20px 0", fontSize: "15px", opacity: 0.9, lineHeight: "1.7" }}>
            {currentWireframe.description}
          </p>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-start",
              gap: "12px",
              flexWrap: "wrap",
              fontSize: "13px",
            }}
          >
            {currentWireframe.features.map((feature, idx) => (
              <div
                key={idx}
                style={{
                  padding: "10px 18px",
                  backgroundColor: "rgba(255,255,255,0.2)",
                  borderRadius: "24px",
                  border: "1px solid rgba(255,255,255,0.3)",
                }}
              >
                ✓ {feature}
              </div>
            ))}
          </div>
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
  const root = (import.meta.hot.data.root ??= createRoot(elem));
  root.render(app);
} else {
  createRoot(elem).render(app);
}
