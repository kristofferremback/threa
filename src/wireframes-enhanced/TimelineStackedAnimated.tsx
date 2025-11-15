import React, { useState, useRef } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

interface PanelInfo {
  id: string;
  messageId: string;
  sourceMessageId?: string;
  sourcePanelId?: string;
  position: number;
  color: string;
}

const PANEL_COLORS = ["#673ab7", "#3f51b5", "#2196f3", "#009688", "#4caf50", "#ff9800"];

export const TimelineStackedAnimated: React.FC = () => {
  const [panels, setPanels] = useState<PanelInfo[]>([
    { id: "main", messageId: "", position: 0, color: "#673ab7" },
  ]);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({ main: "" });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPanelId, setHoveredPanelId] = useState<string | null>(null);
  const [pulseConnections, setPulseConnections] = useState<Set<string>>(new Set());

  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const rootMessages = getRootMessages();

  const openInNewPanel = (messageId: string, sourcePanelId: string, sourceMessageId: string) => {
    const existingPanel = panels.find((p) => p.messageId === messageId && p.id !== "main");
    if (existingPanel) return;

    const colorIndex = panels.length % PANEL_COLORS.length;
    const newPanel: PanelInfo = {
      id: `panel-${Date.now()}`,
      messageId,
      sourceMessageId,
      sourcePanelId,
      position: panels.length,
      color: PANEL_COLORS[colorIndex],
    };

    setPanels([...panels, newPanel]);
    setSelectedIds({ ...selectedIds, [newPanel.id]: messageId });

    // Pulse animation
    setPulseConnections(new Set([newPanel.id]));
    setTimeout(() => setPulseConnections(new Set()), 1000);
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

  const drawConnections = () => {
    const connections: JSX.Element[] = [];

    panels.forEach((panel) => {
      if (panel.sourcePanelId && panel.sourceMessageId) {
        const sourcePanel = panelRefs.current[panel.sourcePanelId];
        const targetPanel = panelRefs.current[panel.id];
        const sourceMessage = messageRefs.current[`${panel.sourcePanelId}-${panel.sourceMessageId}`];
        const targetMessage = messageRefs.current[`${panel.id}-${panel.messageId}`];

        if (sourcePanel && targetPanel && sourceMessage && targetMessage) {
          const containerRect = sourcePanel.parentElement?.getBoundingClientRect();
          if (!containerRect) return;

          const sourceRect = sourceMessage.getBoundingClientRect();
          const targetRect = targetMessage.getBoundingClientRect();

          const startX = sourceRect.right - containerRect.left;
          const startY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
          const endX = targetRect.left - containerRect.left;
          const endY = targetRect.top + targetRect.height / 2 - containerRect.top;

          const isPulsing = pulseConnections.has(panel.id);

          connections.push(
            <g key={panel.id}>
              {/* Glow effect */}
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={panel.color}
                strokeWidth="8"
                opacity="0.2"
                strokeLinecap="round"
              />
              {/* Main line */}
              <line
                x1={startX}
                y1={startY}
                x2={endX}
                y2={endY}
                stroke={panel.color}
                strokeWidth="3"
                strokeLinecap="round"
                opacity="0.8"
                strokeDasharray={isPulsing ? "10,5" : undefined}
              >
                {isPulsing && (
                  <animate
                    attributeName="stroke-dashoffset"
                    from="0"
                    to="-15"
                    dur="0.5s"
                    repeatCount="indefinite"
                  />
                )}
              </line>
              {/* Arrow */}
              <polygon
                points={`${endX},${endY} ${endX - 10},${endY - 5} ${endX - 10},${endY + 5}`}
                fill={panel.color}
                opacity="0.8"
              />
              {/* Start dot */}
              <circle cx={startX} cy={startY} r="5" fill={panel.color} opacity="0.8" />
              {/* End dot */}
              <circle cx={endX} cy={endY} r="5" fill={panel.color} opacity="0.8" />
            </g>
          );
        }
      }
    });

    return connections;
  };

  const renderMessage = (msg: GraphMessage, panelId: string, panelColor: string) => {
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
          padding: "14px",
          marginBottom: "10px",
          border: isSelected
            ? `3px solid ${panelColor}`
            : isHighlighted
            ? `2px solid ${panelColor}`
            : isHovered
            ? `2px solid ${panelColor}`
            : "2px solid #e0e0e0",
          borderRadius: "8px",
          backgroundColor: isSelected
            ? `${panelColor}15`
            : isHighlighted
            ? `${panelColor}08`
            : "#fff",
          cursor: "pointer",
          transition: "all 0.2s",
          position: "relative",
          boxShadow: isSelected ? `0 0 0 3px ${panelColor}20` : "none",
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
        {/* Color indicator bar */}
        {isSelected && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: "4px",
              backgroundColor: panelColor,
              borderRadius: "8px 0 0 8px",
            }}
          />
        )}

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
          <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
        </div>
        <div style={{ marginTop: "8px", fontSize: "14px", lineHeight: "1.5" }}>{msg.content}</div>
        {replyCount > 0 && (
          <div
            style={{
              marginTop: "10px",
              display: "inline-block",
              padding: "4px 10px",
              backgroundColor: `${panelColor}15`,
              borderRadius: "12px",
              fontSize: "12px",
              color: panelColor,
              fontWeight: 600,
            }}
          >
            💬 {replyCount}
          </div>
        )}

        {isHovered && replyCount > 0 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              openInNewPanel(msg.id, panelId, msg.id);
            }}
            style={{
              position: "absolute",
              top: "10px",
              right: "10px",
              padding: "6px 14px",
              fontSize: "11px",
              backgroundColor: panelColor,
              color: "#fff",
              border: "none",
              borderRadius: "6px",
              cursor: "pointer",
              fontWeight: 700,
              boxShadow: "0 2px 6px rgba(0,0,0,0.2)",
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
          borderRight: "2px solid #ddd",
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
            backgroundColor: panels[0].color,
            color: "#fff",
            zIndex: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>#engineering</h3>
          <div style={{ fontSize: "11px", opacity: 0.9, marginTop: "4px" }}>
            Timeline · Shift+click to open thread panel
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          {rootMessages.map((msg) => renderMessage(msg, "main", panels[0].color))}
        </div>
      </div>
    );
  };

  const renderThreadPanel = (panel: PanelInfo) => {
    if (panel.id === "main") return null;

    const msg = messageGraph[panel.messageId];
    if (!msg) return null;

    const parentChain = getParentChain(panel.messageId);
    const currentSelected = selectedIds[panel.id] || panel.messageId;
    const currentMsg = messageGraph[currentSelected];
    const replies = currentMsg ? getReplies(currentMsg.id) : [];

    return (
      <div
        key={panel.id}
        ref={(el) => {
          panelRefs.current[panel.id] = el;
        }}
        style={{
          width: "420px",
          borderRight: "2px solid #ddd",
          backgroundColor: "#fafafa",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
          position: "relative",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            backgroundColor: panel.color,
            color: "#fff",
            borderBottom: "2px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, display: "flex", alignItems: "center", gap: "8px" }}>
              <div
                style={{
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: "#fff",
                }}
              />
              Thread Panel
            </div>
            <div style={{ fontSize: "11px", opacity: 0.85, marginTop: "3px" }}>
              From: {messageGraph[panel.sourceMessageId!]?.author}
            </div>
          </div>
          <button
            onClick={() => closePanel(panel.id)}
            style={{
              border: "none",
              background: "rgba(255,255,255,0.2)",
              cursor: "pointer",
              fontSize: "18px",
              color: "#fff",
              borderRadius: "4px",
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        </div>

        {parentChain.length > 0 && (
          <div
            style={{
              maxHeight: "140px",
              borderBottom: "1px solid #ddd",
              backgroundColor: `${panel.color}08`,
              padding: "12px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: panel.color,
                marginBottom: "8px",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
              }}
            >
              ↑ Context ({parentChain.length})
            </div>
            {parentChain.map((parent, idx) => (
              <div
                key={parent.id}
                onClick={() => selectMessage(panel.id, parent.id)}
                style={{
                  padding: "8px 10px",
                  marginBottom: "6px",
                  backgroundColor: "#fff",
                  border: `1px solid ${panel.color}30`,
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <span
                  style={{
                    fontSize: "10px",
                    color: panel.color,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {idx + 1}.
                </span>
                <div>
                  <span style={{ fontWeight: 600 }}>{parent.author}:</span> {parent.content}
                </div>
              </div>
            ))}
          </div>
        )}

        <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#fff" }}>
          {currentMsg && renderMessage(currentMsg, panel.id, panel.color)}

          {replies.length > 0 && (
            <>
              <div
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  color: "#666",
                  marginTop: "16px",
                  marginBottom: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                ↓ Replies ({replies.length})
              </div>
              {replies.map((reply) => renderMessage(reply, panel.id, panel.color))}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "1600px", margin: "0 auto" }}>
      <div
        style={{
          padding: "14px 18px",
          backgroundColor: "#f3e5f5",
          border: "2px solid #673ab7",
          borderRadius: "8px",
          marginBottom: "16px",
        }}
      >
        <div style={{ fontSize: "14px", fontWeight: 700, color: "#673ab7", marginBottom: "6px" }}>
          💡 Animated Connections
        </div>
        <div style={{ fontSize: "12px", color: "#555", lineHeight: "1.6" }}>
          • <strong>Shift+Click</strong> or hover button to open panels
          <br />• Each panel gets a unique color
          <br />• <strong>Animated lines</strong> show panel relationships
          <br />• Messages highlighted with panel colors
        </div>
      </div>

      <div style={{ position: "relative" }}>
        <div
          style={{
            display: "flex",
            height: "600px",
            border: "2px solid #ddd",
            borderRadius: "8px",
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
              <div style={{ fontSize: "40px" }}>👆</div>
              <div style={{ fontSize: "16px", fontWeight: 600 }}>Open your first thread panel</div>
              <div style={{ fontSize: "13px", textAlign: "center", maxWidth: "300px" }}>
                Shift+click any message or use the hover button
              </div>
            </div>
          )}
        </div>

        <svg
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
          {drawConnections()}
        </svg>
      </div>
    </div>
  );
};
