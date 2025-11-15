import React, { useState, useRef } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

interface PanelInfo {
  id: string;
  messageId: string;
  sourceMessageId?: string;
  sourcePanelId?: string;
  position: number;
}

export const TimelineStackedArchitectural: React.FC = () => {
  const [panels, setPanels] = useState<PanelInfo[]>([
    { id: "main", messageId: "", position: 0 },
  ]);
  const [selectedIds, setSelectedIds] = useState<Record<string, string>>({ main: "" });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPanelId, setHoveredPanelId] = useState<string | null>(null);

  const panelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const rootMessages = getRootMessages();

  const openInNewPanel = (messageId: string, sourcePanelId: string, sourceMessageId: string) => {
    const existingPanel = panels.find((p) => p.messageId === messageId && p.id !== "main");
    if (existingPanel) return;

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

          const sourcePanelRect = sourcePanel.getBoundingClientRect();
          const targetPanelRect = targetPanel.getBoundingClientRect();
          const sourceRect = sourceMessage.getBoundingClientRect();
          const targetRect = targetMessage.getBoundingClientRect();

          // Calculate positions relative to container
          const sourceY = sourceRect.top + sourceRect.height / 2 - containerRect.top;
          const targetY = targetRect.top + targetRect.height / 2 - containerRect.top;

          const sourcePanelRight = sourcePanelRect.right - containerRect.left;
          const targetPanelLeft = targetPanelRect.left - containerRect.left;
          const targetPanelRight = targetPanelRect.right - containerRect.left;

          // Path:
          // 1. Start at message center right
          // 2. Go right to edge of source panel
          // 3. Follow edge of target panel (down/up)
          // 4. Go left into target message center
          const sourceStartX = sourceRect.right - containerRect.left;
          const targetEndX = targetRect.left + targetRect.width / 2 - containerRect.left;

          const pathParts = [
            // Start at source message
            `M ${sourceStartX} ${sourceY}`,
            // Go right to source panel edge
            `L ${sourcePanelRight} ${sourceY}`,
            // Go to target panel edge (vertical along border)
            `L ${targetPanelLeft} ${sourceY}`,
            // Follow target panel border to target message height
            `L ${targetPanelLeft} ${targetY}`,
            // Go into target message center
            `L ${targetEndX} ${targetY}`,
          ];

          connections.push(
            <path
              key={panel.id}
              d={pathParts.join(' ')}
              stroke="#9575cd"
              strokeWidth="2"
              fill="none"
              opacity="0.6"
            />
          );
        }
      }
    });

    return connections;
  };

  const renderMessage = (msg: GraphMessage, panelId: string) => {
    const replyCount = msg.replyIds?.length || 0;
    const isSelected = selectedIds[panelId] === msg.id;
    const isHovered = hoveredId === msg.id && hoveredPanelId === panelId;

    // Check if this message is connected (is a source or target of a connection)
    const isConnected = panels.some(
      p => p.sourceMessageId === msg.id || (p.id === panelId && p.messageId === msg.id)
    );

    return (
      <div
        key={msg.id}
        ref={(el) => {
          messageRefs.current[`${panelId}-${msg.id}`] = el;
        }}
        style={{
          padding: "14px",
          marginBottom: "10px",
          border: isSelected ? "2px solid #673ab7" : "1px solid #e0e0e0",
          borderRadius: "6px",
          backgroundColor: isSelected
            ? "#f3e5f5"
            : isConnected
            ? "#f5f5f5"  // Subtle darkened background for connected messages
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
        <div style={{ marginTop: "8px", fontSize: "14px", lineHeight: "1.5" }}>
          {msg.content}
        </div>
        {replyCount > 0 && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#673ab7", fontWeight: 600 }}>
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
              backgroundColor: "#673ab7",
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
            backgroundColor: "#673ab7",
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
          {rootMessages.map((msg) => renderMessage(msg, "main"))}
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
            backgroundColor: "#673ab7",
            color: "#fff",
            borderBottom: "2px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>Thread Panel</div>
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
              backgroundColor: "#f9f9f9",
              padding: "12px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#673ab7",
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
                  border: "1px solid #e0e0e0",
                  borderRadius: "6px",
                  fontSize: "12px",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "10px", color: "#673ab7", fontWeight: 700 }}>
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
          {currentMsg && renderMessage(currentMsg, panel.id)}

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
              {replies.map((reply) => renderMessage(reply, panel.id))}
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
          💡 Architectural Connections
        </div>
        <div style={{ fontSize: "12px", color: "#555", lineHeight: "1.6" }}>
          • <strong>Shift+Click</strong> or hover button to open panels
          <br />• Lines follow panel edges (no curves flying through space)
          <br />• Connected messages have subtle darkened background
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
