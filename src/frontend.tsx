/**
 * Threading Model Wireframes - Interactive Demo
 * Entry point for the React app showcasing 10 different threading UX approaches
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { sampleMessages } from "./data/sampleMessages";
import { Option1InlineCollapse } from "./wireframes/Option1InlineCollapse";
import { Option2SplitPanel } from "./wireframes/Option2SplitPanel";
import { Option3HoverReveal } from "./wireframes/Option3HoverReveal";
import { Option4ConversationCards } from "./wireframes/Option4ConversationCards";
import { Option5TimelineJump } from "./wireframes/Option5TimelineJump";
import { Option6IndentedTree } from "./wireframes/Option6IndentedTree";
import { Option7StackedCards } from "./wireframes/Option7StackedCards";
import { Option8CompactLinks } from "./wireframes/Option8CompactLinks";
import { Option9SlackEnhanced } from "./wireframes/Option9SlackEnhanced";
import { Option10ConversationFirst } from "./wireframes/Option10ConversationFirst";

const wireframes = [
  { id: 1, name: "Inline Collapse", component: Option1InlineCollapse, description: "Expand/collapse threads inline with depth indicators" },
  { id: 2, name: "Split Panel", component: Option2SplitPanel, description: "Dedicated thread viewer alongside feed" },
  { id: 3, name: "Hover Reveal", component: Option3HoverReveal, description: "Clean feed, hover shows preview" },
  { id: 4, name: "Conversation Cards", component: Option4ConversationCards, description: "Expandable branches in discrete cards" },
  { id: 5, name: "Timeline Jump", component: Option5TimelineJump, description: "Chronological feed with thread modals" },
  { id: 6, name: "Indented Tree", component: Option6IndentedTree, description: "Classic tree with connector lines" },
  { id: 7, name: "Stacked Cards", component: Option7StackedCards, description: "Physical depth through layering" },
  { id: 8, name: "Compact Links", component: Option8CompactLinks, description: "Aggressive compression with modal expansion" },
  { id: 9, name: "Slack Enhanced", component: Option9SlackEnhanced, description: "Familiar Slack pattern with improvements" },
  { id: 10, name: "Conversation-First", component: Option10ConversationFirst, description: "Conversations get cards, flat messages are dividers" },
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
        <h1 style={{ margin: "0 0 8px 0", fontSize: "24px", fontWeight: 700 }}>
          Threading Model Wireframes
        </h1>
        <p style={{ margin: "0 0 16px 0", fontSize: "14px", color: "#666" }}>
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
      <div style={{ padding: "20px 0", minHeight: "calc(100vh - 200px)" }}>
        <CurrentWireframe messages={sampleMessages} />
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
        <p style={{ margin: 0 }}>
          Use the buttons above to switch between different threading models.
          Each wireframe demonstrates a unique UX approach.
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
