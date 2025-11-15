/**
 * Threading Model Wireframes V2 - Graph-Based Panel Navigation
 * Interactive demo showcasing 10 different panel-based threading approaches
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Option1SingleThreadPanel } from "./wireframes-v2/Option1SingleThreadPanel";
import { Option2TabbedThreads } from "./wireframes-v2/Option2TabbedThreads";
import { Option3StackedPanels } from "./wireframes-v2/Option3StackedPanels";
import { Option4GraphNavigator } from "./wireframes-v2/Option4GraphNavigator";
import { Option5FocusMode } from "./wireframes-v2/Option5FocusMode";
import { Option6TimelineContext } from "./wireframes-v2/Option6TimelineContext";
import { Option7BidirectionalNav } from "./wireframes-v2/Option7BidirectionalNav";
import { Option8ConnectionMap } from "./wireframes-v2/Option8ConnectionMap";
import { Option9ThreadHistory } from "./wireframes-v2/Option9ThreadHistory";
import { Option10MultiContext } from "./wireframes-v2/Option10MultiContext";

const wireframes = [
  {
    id: 1,
    name: "Single Panel + Breadcrumbs",
    component: Option1SingleThreadPanel,
    description: "One thread at a time with breadcrumb navigation and 'Open Parent' button",
  },
  {
    id: 2,
    name: "Tabbed Threads",
    component: Option2TabbedThreads,
    description: "Multiple threads in tabs - open parent in new tab, switch between threads easily",
  },
  {
    id: 3,
    name: "Stacked Panels",
    component: Option3StackedPanels,
    description: "Horizontal stack of panels - each thread opens in a new panel to the right",
  },
  {
    id: 4,
    name: "Graph Navigator",
    component: Option4GraphNavigator,
    description: "Visual graph showing parent → current → children with clickable nodes",
  },
  {
    id: 5,
    name: "Focus Mode",
    component: Option5FocusMode,
    description: "Current message highlighted, parent above, siblings & replies below",
  },
  {
    id: 6,
    name: "Timeline + Context",
    component: Option6TimelineContext,
    description: "Chronological feed with thread context showing parent chain",
  },
  {
    id: 7,
    name: "Bidirectional Navigator",
    component: Option7BidirectionalNav,
    description: "Prominent Up/Down buttons for graph navigation with parent/reply previews",
  },
  {
    id: 8,
    name: "Connection Map",
    component: Option8ConnectionMap,
    description: "Mini-map visualization of thread connections + detailed thread view",
  },
  {
    id: 9,
    name: "Thread History",
    component: Option9ThreadHistory,
    description: "Browser-style back/forward navigation through thread jumps",
  },
  {
    id: 10,
    name: "Multi-Context",
    component: Option10MultiContext,
    description: "Parent context always visible at top, current message highlighted, replies below",
  },
];

function App() {
  const [selectedOption, setSelectedOption] = useState(1);

  const CurrentWireframe = wireframes.find((w) => w.id === selectedOption)!.component;
  const currentDescription = wireframes.find((w) => w.id === selectedOption)!.description;

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, sans-serif" }}>
      {/* Header */}
      <div
        style={{
          position: "sticky",
          top: 0,
          backgroundColor: "#fff",
          borderBottom: "2px solid #ddd",
          padding: "16px 20px",
          zIndex: 100,
          boxShadow: "0 2px 4px rgba(0,0,0,0.05)",
        }}
      >
        <h1 style={{ margin: "0 0 4px 0", fontSize: "24px", fontWeight: 700 }}>
          Graph-Based Threading Models
        </h1>
        <p style={{ margin: "0 0 4px 0", fontSize: "13px", color: "#666" }}>
          All options use side panels with hover previews and "Open Parent" functionality
        </p>
        <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#333", fontWeight: 500 }}>
          {currentDescription}
        </p>

        {/* Navigation */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {wireframes.map((wireframe) => (
            <button
              key={wireframe.id}
              onClick={() => setSelectedOption(wireframe.id)}
              style={{
                padding: "8px 16px",
                fontSize: "13px",
                fontWeight: 600,
                backgroundColor: selectedOption === wireframe.id ? "#0066cc" : "#fff",
                color: selectedOption === wireframe.id ? "#fff" : "#333",
                border: selectedOption === wireframe.id ? "none" : "1px solid #ddd",
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.2s",
              }}
              onMouseEnter={(e) => {
                if (selectedOption !== wireframe.id) {
                  e.currentTarget.style.backgroundColor = "#f5f5f5";
                }
              }}
              onMouseLeave={(e) => {
                if (selectedOption !== wireframe.id) {
                  e.currentTarget.style.backgroundColor = "#fff";
                }
              }}
            >
              {wireframe.id}. {wireframe.name}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{ padding: "20px 0", minHeight: "calc(100vh - 250px)" }}>
        <CurrentWireframe />
      </div>

      {/* Footer */}
      <div
        style={{
          marginTop: "40px",
          padding: "20px",
          backgroundColor: "#f5f5f5",
          borderTop: "1px solid #ddd",
          textAlign: "center",
          fontSize: "13px",
          color: "#666",
        }}
      >
        <p style={{ margin: "0 0 8px 0" }}>
          <strong>Key Features:</strong> All wireframes treat messages as nodes in a graph, not a tree
        </p>
        <p style={{ margin: 0 }}>
          Hover over messages for previews • Click to open in side panel • Navigate with "Open Parent" buttons
        </p>
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
