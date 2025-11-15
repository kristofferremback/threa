import React, { useState, useRef, useEffect } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

interface PanelInfo {
  id: string;
  messageId: string;
  sourceMessageId?: string; // Which message opened this panel
  sourcePanelId?: string; // Which panel it was opened from
  position: number;
}

export const TimelineStackedConnected: React.FC = () => {
  const [panels, setPanels] = useState<PanelInfo[]>([
    { id: "main", messageId: "", position: 0 }, // Main timeline panel
  ]);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({
    main: "",
  });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPanelId, setHoveredPanelId] = useState<string | null>(null);

  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const rootMessages = getRootMessages();

  const openInNewPanel = (messageId: string, sourcePanelId: string, sourceMessageId: string) => {
    // Check if panel already exists for this message
    const existingPanel = panels.find((p) => p.messageId === messageId && p.id !== "main");
    if (existingPanel) {
      // Just select it
      return;
    }

    const newPanel: PanelInfo = {
      id: `panel-${Date.now()}`,
      messageId,
      sourceMessageId,
      sourcePanelId,
      position: panels.length,
    };

    setPanels([...panels, newPanel]);
    setSelectedIds({ ...selectedIds, [newPanel.id]: messageId });
  };

  const closePanel = (panelId: string) => {
    if (panelId === "main") return;
    setPanels(panels.filter((p) => p.id !== panelId));
    const newSelectedIds = { ...selectedIds };
    delete newSelectedIds[panelId];
    setSelectedIds(newSelectedIds);
  };

  const selectMessage = (panelId: string, messageId: string) => {
    setSelectedIds({ ...selectedIds, [panelId]: messageId });
  };

  // Draw connections between panels
  const drawConnections = () => {
    const connections: JSX.Element[] = [];

    panels.forEach((panel) => {
      if (panel.sourcePanelId && panel.sourceMessageId) {
        const sourcePanel = panelRefs.current[panel.sourcePanelId];
        const targetPanel = panelRefs.current[panel.id];
        const sourceMessage = messageRefs.current[`${panel.sourcePanelId}-${panel.sourceMessageId}`];
        const targetMessage = messageRefs.current[`${panel.id}-${panel.messageId}`];

        if (sourcePanel && targetPanel && sourceMessage && targetMessage) {
          const sourcePanelRect = sourcePanel.getBoundingClientRect();
          const targetPanelRect = targetPanel.getBoundingClientRect();
          const sourceRect = sourceMessage.getBoundingClientRect();
          const targetRect = targetMessage.getBoundingClientRect();

          // Calculate connection points
          const startX = sourceRect.right - sourcePanelRect.left;
          const startY = sourceRect.top + sourceRect.height / 2 - sourcePanelRect.top;
          const endX = targetRect.left - targetPanelRect.left;
          const endY = targetRect.top + targetRect.height / 2 - targetPanelRect.top;

          // Calculate bezier curve control points
          const distance = targetPanelRect.left - sourcePanelRect.right;
          const cp1x = startX + distance * 0.5;
          const cp1y = startY;
          const cp2x = endX - distance * 0.5;
          const cp2y = endY;

          connections.push(
            <svg
              key={panel.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
                zIndex: 1,
              }}
            >
              <defs>
                <marker
                  id={`arrow-${panel.id}`}
                  markerWidth="10"
                  markerHeight="10"
                  refX="9"
                  refY="3"
                  orient="auto"
                  markerUnits="strokeWidth"
                >
                  <path d="M0,0 L0,6 L9,3 z" fill="#673ab7" />
                </marker>
              </defs>
              <path
                d={`M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`}
                stroke="#673ab7"
                strokeWidth="3"
                fill="none"
                markerEnd={`url(#arrow-${panel.id})`}
                opacity="0.6"
              />
            </svg>
          );
        }
      }
    });

    return connections;
  };

  const renderMessage = (
    msg: GraphMessage,
    panelId: string,
    isTimeline: boolean = false
  ) => {
    const replyCount = msg.replyIds?.length || 0;
    const isSelected = selectedIds[panelId] === msg.id;
    const isHovered = hoveredId === msg.id && hoveredPanelId === panelId;
    const isHighlighted = Object.values(selectedIds).includes(msg.id) && !isSelected;

    return (
      <div
        key={msg.id}
        ref={(el) => {
          messageRefs.current[`${panelId}-${msg.id}`] = el;
        }}
        style={{
          padding: isTimeline ? "14px" : "12px",
          marginBottom: "8px",
          border: isSelected
            ? "3px solid #673ab7"
            : isHighlighted
            ? "2px solid #9c27b0"
            : isHovered
            ? "2px solid #673ab7"
            : "2px solid #e0e0e0",
          borderRadius: "6px",
          backgroundColor: isSelected
            ? "#f3e5f5"
            : isHighlighted
            ? "#fce4ec"
            : "#fff",
          cursor: "pointer",
          transition: "all 0.2s",
          position: "relative",
        }}
        onClick={(e) => {
          if (e.shiftKey && replyCount > 0) {
            openInNewPanel(msg.id, panelId, msg.id);
          } else {
            selectMessage(panelId, msg.id);
          }
        }}
        onMouseEnter={() => {
          setHoveredId(msg.id);
          setHoveredPanelId(panelId);
        }}
        onMouseLeave={() => {
          setHoveredId(null);
          setHoveredPanelId(null);
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
          <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
        </div>
        <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.5" }}>
          {msg.content}
        </div>
        {replyCount > 0 && (
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#673ab7", fontWeight: 600 }}>
            💬 {replyCount}
          </div>
        )}

        {/* Hover button to open in new panel */}
        {isHovered && replyCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openInNewPanel(msg.id, panelId, msg.id);
            }}
            style={{
              position: "absolute",
              top: "8px",
              right: "8px",
              padding: "6px 12px",
              fontSize: "11px",
              backgroundColor: "#673ab7",
              color: "#fff",
              border: "none",
              borderRadius: "4px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Open in panel →
          </button>
        )}
      </div>
    );
  };

  const renderMainTimeline = () => {
    return (
      <div
        ref={(el) => {
          panelRefs.current["main"] = el;
        }}
        style={{
          width: "400px",
          borderRight: "1px solid #ddd",
          overflowY: "auto",
          backgroundColor: "#fff",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            padding: "16px",
            backgroundColor: "#673ab7",
            color: "#fff",
            zIndex: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>#engineering</h3>
          <div style={{ fontSize: "11px", opacity: 0.9, marginTop: "4px" }}>
            Shift+click or hover to open in panel
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          {rootMessages.map((msg) => renderMessage(msg, "main", true))}
        </div>
      </div>
    );
  };

  const renderThreadPanel = (panel: PanelInfo) => {
    if (panel.id === "main") return null;

    const msg = messageGraph[panel.messageId];
    if (!msg) return null;

    const parentChain = getParentChain(panel.messageId);
    const replies = getReplies(panel.messageId);
    const currentSelected = selectedIds[panel.id] || panel.messageId;
    const currentMsg = messageGraph[currentSelected];

    return (
      <div
        key={panel.id}
        ref={(el) => {
          panelRefs.current[panel.id] = el;
        }}
        style={{
          width: "450px",
          borderRight: "1px solid #ddd",
          backgroundColor: "#fafafa",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          position: "relative",
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#673ab7",
            color: "#fff",
            borderBottom: "1px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700 }}>Thread Panel</div>
            <div style={{ fontSize: "11px", opacity: 0.8, marginTop: "2px" }}>
              Opened from: {messageGraph[panel.sourceMessageId!]?.author}
            </div>
          </div>
          <button
            onClick={() => closePanel(panel.id)}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "20px",
              color: "#fff",
            }}
          >
            ×
          </button>
        </div>

        {/* Parent context */}
        {parentChain.length > 0 && (
          <div
            style={{
              maxHeight: "150px",
              borderBottom: "1px solid #ddd",
              backgroundColor: "#fff8e1",
              padding: "12px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                fontWeight: 700,
                color: "#666",
                marginBottom: "8px",
                textTransform: "uppercase",
              }}
            >
              Context ({parentChain.length})
            </div>
            {parentChain.map((parent) => (
              <div
                key={parent.id}
                onClick={() => selectMessage(panel.id, parent.id)}
                style={{
                  padding: "8px",
                  marginBottom: "6px",
                  backgroundColor: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontWeight: 600 }}>{parent.author}:</span> {parent.content}
              </div>
            ))}
          </div>
        )}

        {/* Thread content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* Current message */}
          {renderMessage(currentMsg || msg, panel.id)}

          {/* Replies */}
          {currentMsg && getReplies(currentMsg.id).length > 0 && (
            <>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 700,
                  color: "#666",
                  marginTop: "16px",
                  marginBottom: "12px",
                  textTransform: "uppercase",
                }}
              >
                Replies ({getReplies(currentMsg.id).length})
              </div>
              {getReplies(currentMsg.id).map((reply) => renderMessage(reply, panel.id))}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
      {/* Instructions */}
      <div
        style={{
          padding: "12px 16px",
          backgroundColor: "#f3e5f5",
          border: "1px solid #673ab7",
          borderRadius: "6px",
          marginBottom: "16px",
        }}
      >
        <div style={{ fontSize: "13px", fontWeight: 600, color: "#673ab7", marginBottom: "4px" }}>
          💡 How to use:
        </div>
        <div style={{ fontSize: "12px", color: "#555" }}>
          • <strong>Shift+Click</strong> a message to open it in a new panel
          <br />• <strong>Hover</strong> over a message to see "Open in panel" button
          <br />• Purple lines show which message opened which panel
          <br />• Messages are highlighted across panels
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            height: "600px",
            border: "1px solid #ddd",
            overflowX: "auto",
            position: "relative",
          }}
        >
          {renderMainTimeline()}
          {panels.map((panel) => renderThreadPanel(panel))}

          {panels.length === 1 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#999",
                backgroundColor: "#fafafa",
                flexDirection: "column",
                gap: "12px",
              }}
            >
              <div style={{ fontSize: "16px", fontWeight: 600 }}>No panels open</div>
              <div style={{ fontSize: "13px", textAlign: "center", maxWidth: "300px" }}>
                Shift+click a message or use the "Open in panel" button to open threads
              </div>
            </div>
          )}
        </div>

        {/* Draw connections */}
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, pointerEvents: "none" }}>
          {drawConnections()}
        </div>
      </div>
    </div>
  );
};
